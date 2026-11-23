/**
 * Import.gs: bulk entry.
 *
 * 1) "Import" tab: one row per transaction, then Menu → ⚙️ Process Import tab.
 *      Date | Fund (tab name / AMFI code / scheme name) | Owner | Type (SIP/Purchase/Redemption) |
 *      Amount | Units | NAV | Folio | Status (filled by the script, rows with a Status are skipped)
 * 2) Import dialog: paste a CSV (casparser output of your CAMS/KFintech CAS, or any export with similar
 *    headers). It is mapped into the Import tab; missing funds can be auto-added.
 */
const IMPORT_HEADERS = ['Date', 'Fund (tab / AMFI code / name)', 'Owner', 'Type', 'Amount', 'Units', 'NAV', 'Folio', 'Status'];

// ===================== Import tab → ledger =====================
function processImportTab() {
  const ss = getBook();
  const sh = ss.getSheetByName(TABS.IMPORT);
  if (!sh || sh.getLastRow() < 2) return toast_('Import tab is empty');
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  const touched = {};
  let ok = 0, bad = 0;
  try {
    const n = sh.getLastRow() - 1;
    const v = sh.getRange(2, 1, n, IMPORT_HEADERS.length).getValues();
    const todo = v.map((r, i) => ({ r: r, i: i, d: parseDateLoose(r[0]) }))
      .filter(x => String(x.r[8]).trim() === '' && String(x.r[1]).trim() !== '')
      .sort((a, b) => (a.d || 0) - (b.d || 0) || a.i - b.i);       // chronological: FIFO needs it
    const started = Date.now();
    for (const x of todo) {
      if (Date.now() - started > 300000) { toast_('Time limit: run Process Import again for the rest'); break; }
      let status;
      try {
        const r = x.r;
        if (!x.d) throw new Error('Bad date');
        const fund = resolveFund_(r[1], r[2]);
        if (!fund) throw new Error('Fund not found in Funds tab (add it with the Wizard or tick auto-add)');
        const type = normType_(r[3]);
        if (!type) throw new Error('Type must be SIP / Purchase / Redemption');
        if (type === TXN.REDEMPTION) {
          const res = redeem(fund, { date: x.d, units: Math.abs(+r[5]), amount: Math.abs(+r[4]), nav: +r[6], source: 'Import' });
          status = '✅ Redeemed ' + res.units + ' u @ ' + res.nav + (res.capped ? ' ⚠️ capped' : '');
        } else {
          const res = addPurchase(fund, { date: x.d, amount: Math.abs(+r[4]), units: Math.abs(+r[5]), nav: +r[6], folio: r[7], type: type, source: 'Import' });
          status = res.skipped ? '⏭️ Skipped: ' + res.reason : '✅ ' + res.units + ' u @ ' + res.nav;
        }
        touched[fund.tab] = 1; ok++;
      } catch (e) { status = '❌ ' + e.message; bad++; }
      sh.getRange(x.i + 2, 9).setValue(status + '  (' + Utilities.formatDate(new Date(), tz_(), 'dd-MMM HH:mm') + ')');
    }
  } finally { lock.releaseLock(); }
  toast_('Import done: ' + ok + ' ok, ' + bad + ' failed. See the Status column.');
}

function resolveFund_(fundCell, ownerCell) {
  const key = String(fundCell).trim(), owner = String(ownerCell || '').trim();
  const all = getFunds(true);
  const byOwner = list => owner ? list.filter(f => f.owner.toLowerCase() === owner.toLowerCase()) : list;
  let hit = all.filter(f => f.tab === key);
  if (hit.length) return hit[0];
  hit = byOwner(all.filter(f => f.code === key.replace(/\.0$/, '')));
  if (hit.length === 1) return hit[0];
  hit = byOwner(all.filter(f => f.match && f.match.test(key)));
  return hit.length === 1 ? hit[0] : null;
}

function normType_(t) {
  const s = String(t).trim().toLowerCase();
  if (/^(e?sip|purchase_sip|sip)$/.test(s)) return TXN.SIP;
  if (/^(purchase|lumpsum|lump sum|buy|switch_in|switch in|switch_in_merger|dividend_reinvest|additional purchase)$/.test(s)) return TXN.PURCHASE;
  if (/^(redemption|redeem|sell|switch_out|switch out|switch_out_merger|swp)$/.test(s)) return TXN.REDEMPTION;
  return null;
}

// ===================== CSV dialog =====================
function showImportDialog() {
  const t = HtmlService.createTemplateFromFile('ImportDialog');
  t.owners = getOwners().map(o => o.name);
  SpreadsheetApp.getUi().showModalDialog(t.evaluate().setWidth(760).setHeight(560), '📥 Import transactions (CSV / casparser)');
}

/**
 * Maps CSV text into the Import tab.
 * Recognised headers (any case): date, scheme / scheme_name, amfi / amfi_code / scheme_code, isin, folio,
 * amount, units, nav, type / transaction_type / description.
 * opts = {owner, autoAdd, process}
 */
function importCsvText(text, opts) {
  opts = opts || {};
  const rows = Utilities.parseCsv(String(text || '').trim());
  if (rows.length < 2) throw new Error('No rows found. Paste the CSV including its header line.');
  const h = rows[0].map(x => String(x).trim().toLowerCase());
  const col = names => { for (const n of names) { const i = h.indexOf(n); if (i >= 0) return i; } return -1; };
  const C = {
    date: col(['date', 'transaction date', 'txn date', 'tran date']),
    scheme: col(['scheme', 'scheme name', 'scheme_name', 'fund', 'fund name']),
    code: col(['amfi', 'amfi_code', 'amfi code', 'scheme_code', 'scheme code']),
    folio: col(['folio', 'folio number', 'folio no']),
    amount: col(['amount', 'amount (inr)', 'amount (rs)']),
    units: col(['units', 'unit']),
    nav: col(['nav', 'price']),
    type: col(['type', 'transaction_type', 'transaction type', 'txn type']),
    desc: col(['description', 'narration']),
  };
  if (C.date < 0 || (C.scheme < 0 && C.code < 0)) throw new Error('CSV needs at least a "date" and a "scheme" or "amfi" column');

  const out = [], skipped = {}, newFunds = {};
  rows.slice(1).forEach(r => {
    const rawType = C.type >= 0 ? r[C.type] : (C.desc >= 0 ? r[C.desc] : '');
    let type = normType_(rawType);
    if (!type && C.desc >= 0) {                                    // fall back to description text
      const d = String(r[C.desc]).toLowerCase();
      type = /sip|systematic/.test(d) && /purchase|investment/.test(d) ? TXN.SIP
           : /redemption|switch.?out|withdraw/.test(d) ? TXN.REDEMPTION
           : /purchase|switch.?in|reinvest/.test(d) ? TXN.PURCHASE : null;
    }
    if (!type) { const k = String(rawType || 'blank'); skipped[k] = (skipped[k] || 0) + 1; return; }
    const code = C.code >= 0 ? String(r[C.code]).trim().replace(/\.0$/, '') : '';
    const fundKey = code || String(r[C.scheme]).trim();
    if (code && opts.autoAdd && !resolveFund_(code, opts.owner)) newFunds[code] = 1;
    out.push([parseDateLoose(r[C.date]) || r[C.date], fundKey, opts.owner || '', type,
      C.amount >= 0 ? Math.abs(parseFloat(String(r[C.amount]).replace(/,/g, '')) || 0) : '',
      C.units >= 0 ? Math.abs(parseFloat(String(r[C.units]).replace(/,/g, '')) || 0) || '' : '',
      C.nav >= 0 ? parseFloat(r[C.nav]) || '' : '', C.folio >= 0 ? r[C.folio] : '', '']);
  });

  const added = Object.keys(newFunds).map(code => addFundForOwner_(code, opts.owner));
  if (added.length) buildMasterData();

  const sh = getBook().getSheetByName(TABS.IMPORT);
  if (out.length) sh.getRange(sh.getLastRow() + 1, 1, out.length, IMPORT_HEADERS.length).setValues(out);
  sh.getRange('A2:A').setNumberFormat('dd-mmm-yyyy');
  if (opts.process) processImportTab();
  return 'Added ' + out.length + ' rows to the Import tab' + (added.length ? ', created ' + added.length + ' fund tab(s): ' + added.join(', ') : '') +
    (Object.keys(skipped).length ? '. Ignored types: ' + Object.keys(skipped).map(k => k + ' ×' + skipped[k]).join(', ') : '') +
    (opts.process ? '. Processed, see the Status column.' : '. Now run Menu → ⚙️ Process Import tab.');
}

/** Add one scheme for an owner: Funds row + fund tab. Returns the tab name. */
function addFundForOwner_(code, owner) {
  if (!owner) throw new Error('Pick an owner to auto-add funds');
  const info = getSchemeInfo(code);
  const tab = tabNameFor_(info.name, owner, getOwners().length > 1);
  const fund = { tab: tab, code: info.code, scheme: info.name, owner: owner, cat: info.cat, elss: info.elss, match: info.match, amc: info.amc };
  upsertFunds_([fund]);
  buildFundTab(getFundByTab(tab));
  return tab;
}

function toast_(msg) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss) ss.toast(msg, 'MF Tracker', 8);
  console.log(msg);
}
