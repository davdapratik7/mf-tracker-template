/**
 * Ledger.gs: the single transaction engine used by the manual form, the Import tab and the Gmail parsers.
 *
 *   addPurchase(fund, {date, amount, nav?, units?, folio?, type?, source?})
 *   redeem(fund, {date, units? | amount? | all?, nav?, source?})   FIFO, ELSS 3-year lock-in, partial lot split
 *
 * Rows stay sorted by date, so FIFO is correct even when you import old history later.
 */

// ===================== purchases =====================
function addPurchase(fund, t) {
  const sh = getBook().getSheetByName(fund.tab);
  if (!sh) throw new Error('Tab missing for ' + fund.tab + ' (run Rebuild dashboard)');
  const date = parseDateLoose(t.date);
  if (!date) throw new Error('Invalid date');
  const amount = +t.amount;
  if (!(amount > 0)) throw new Error('Amount must be > 0');

  let nav = +t.nav || 0, navDate = date;
  if (!nav) {
    const n = navFrom(fund.code, date, 0);
    if (!n) throw new Error('NAV for ' + fmtD(date) + ' not published yet');
    nav = n.nav; navDate = n.date;
  }
  const units = +t.units > 0 ? round3_(+t.units) : round3_(amount * (1 - settingNum('STAMP_DUTY_PCT') / 100) / nav);
  if (!t.force && hasDuplicateRow_(sh, navDate, amount)) return { skipped: true, reason: 'Same date (±3 days) and amount already exists' };

  appendLot_(sh, fund, { folio: t.folio, date: navDate, type: t.type === TXN.PURCHASE ? TXN.PURCHASE : TXN.SIP,
                          amount: amount, nav: nav, units: units, source: t.source || 'Manual' });
  sortLots_(sh);
  return { skipped: false, date: navDate, nav: nav, units: units };
}

function appendLot_(sh, fund, t) {
  const target = lastDataRow(sh) + 1;
  if (target > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 50);
  let curNav = t.nav;
  try { const h = navHistory(fund.code); if (h.length) curNav = h[h.length - 1].nav; } catch (e) { /* keep purchase NAV */ }
  sh.getRange(target, 1, 1, LOT_COLS).setValues([[fund.scheme || fund.tab, t.folio || lastFolio_(sh), fund.cat,
    t.date, t.type, round2_(t.amount), t.nav, t.units, t.source || '', curNav]]);
}

function lastFolio_(sh) {
  const last = lastDataRow(sh);
  return last >= 2 ? sh.getRange(last, COL.FOLIO).getValue() : '';
}

function sortLots_(sh) {
  const last = lastDataRow(sh);
  if (last > 2) sh.getRange(2, 1, last - 1, LOT_COLS).sort({ column: COL.DATE, ascending: true });
}

/** Same date (±3 days) and same amount (±₹1) already present → treat as duplicate. */
function hasDuplicateRow_(sh, date, amount) {
  const last = lastDataRow(sh);
  if (last < 2) return false;
  return sh.getRange(2, COL.DATE, last - 1, 3).getValues()
    .some(r => r[0] instanceof Date && String(r[1]) !== TXN.REDEMPTION && Math.abs(daysBetween_(r[0], date)) <= 3 && Math.abs(+r[2] - amount) < 1);
}

// ===================== redemptions =====================
function openLots_(sh) {
  const last = lastDataRow(sh);
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, COL.UNITS).getValues().map((r, i) => ({
    row: i + 2, date: r[COL.DATE - 1] instanceof Date ? r[COL.DATE - 1] : parseDateLoose(r[COL.DATE - 1]),
    type: String(r[COL.TYPE - 1]).trim(), amount: +r[COL.AMT - 1], units: +r[COL.UNITS - 1],
  })).filter(l => l.type && l.type !== TXN.REDEMPTION && l.units > 0)
     .sort((a, b) => a.date - b.date || a.row - b.row);
}

/** Units that can be redeemed on `date` (ELSS: only lots older than 3 years). */
function redeemableUnits(fund, date) {
  const sh = getBook().getSheetByName(fund.tab);
  const lots = openLots_(sh).filter(l => !fund.elss || daysBetween_(l.date, date) >= 1095);
  return round3_(lots.reduce((s, l) => s + l.units, 0));
}

function redeem(fund, t) {
  const sh = getBook().getSheetByName(fund.tab);
  if (!sh) throw new Error('Tab missing for ' + fund.tab);
  const date = parseDateLoose(t.date);
  if (!date) throw new Error('Invalid date');
  let nav = +t.nav || 0, navDate = date;
  if (!nav) {
    const n = navFrom(fund.code, date, 0);
    if (!n) throw new Error('NAV for ' + fmtD(date) + ' not published yet');
    nav = n.nav; navDate = n.date;
  }
  const max = redeemableUnits(fund, navDate);
  if (max <= 0) throw new Error(fund.elss ? 'No ELSS units older than 3 years' : 'No units left to redeem');
  let units = t.all ? max : +t.units > 0 ? round3_(+t.units) : +t.amount > 0 ? round3_(+t.amount / nav) : 0;
  if (!(units > 0)) throw new Error('Give units, amount or "all units"');
  const capped = units > max + 0.0005;
  units = Math.min(units, max);

  const res = redeemFifo_(sh, fund, units, nav, navDate, t.source || 'Manual');
  sh.getRange(SUMMARY.LAST_RED_DATE).setValue(navDate);
  sh.getRange(SUMMARY.LAST_RED_NAV).setValue(nav);
  return { date: navDate, nav: nav, units: units, amount: round2_(units * nav), lots: res.lots, split: res.split, capped: capped };
}

/**
 * FIFO: oldest open lots are marked "Redemption" and their Curr NAV is frozen at the redemption NAV
 * (so Realised P&L = Curr Amt − Pur Amt). A partially sold lot is split into a sold row and a kept row.
 */
function redeemFifo_(sh, fund, unitsToRedeem, nav, date, source) {
  let left = unitsToRedeem, count = 0, split = false;
  const lots = openLots_(sh).filter(l => !fund.elss || daysBetween_(l.date, date) >= 1095);
  const note = 'Redeemed ' + fmtD(date) + ' @ ' + nav + ' (' + source + ')';
  // Work bottom-up on row numbers so an inserted split row does not shift lots still to be processed.
  const plan = [];
  for (const lot of lots) {
    if (left <= 0.0005) break;
    if (lot.units <= left + 0.0005) { plan.push({ lot: lot, full: true }); left = round3_(left - lot.units); }
    else { plan.push({ lot: lot, full: false, sell: round3_(left) }); left = 0; }
  }
  plan.sort((a, b) => b.lot.row - a.lot.row).forEach(p => {
    const r = p.lot.row;
    if (p.full) {
      sh.getRange(r, COL.TYPE).setValue(TXN.REDEMPTION);
      sh.getRange(r, COL.SOURCE).setValue(note);
      sh.getRange(r, COL.CURNAV).setValue(nav);
    } else {
      const keepUnits = round3_(p.lot.units - p.sell);
      const amtSold = round2_(p.lot.amount * p.sell / p.lot.units);
      const vals = sh.getRange(r, 1, 1, LOT_COLS).getValues()[0];
      sh.insertRowAfter(r);
      const kept = vals.slice();
      kept[COL.AMT - 1] = round2_(p.lot.amount - amtSold);
      kept[COL.UNITS - 1] = keepUnits;
      sh.getRange(r + 1, 1, 1, LOT_COLS).setValues([kept]);
      vals[COL.TYPE - 1] = TXN.REDEMPTION; vals[COL.AMT - 1] = amtSold; vals[COL.UNITS - 1] = p.sell;
      vals[COL.SOURCE - 1] = note + ' | split'; vals[COL.CURNAV - 1] = nav;
      sh.getRange(r, 1, 1, LOT_COLS).setValues([vals]);
      split = true;
    }
    count++;
  });
  return { lots: count, split: split };
}

// ===================== manual entry form =====================
function showEntryForm() {
  const t = HtmlService.createTemplateFromFile('EntryForm');
  t.funds = getFunds().map(f => ({ tab: f.tab, label: shortFundName(f.tab) + (getOwners().length > 1 ? ' [' + f.owner + ']' : ''), elss: f.elss }));
  SpreadsheetApp.getUi().showSidebar(t.evaluate().setTitle('Add transaction'));
}

/** Preview for the form: NAV on date + redeemable units. */
function previewEntry(tab, dateStr) {
  const fund = getFundByTab(tab);
  const date = parseDateLoose(dateStr);
  if (!fund || !date) return null;
  const n = navFrom(fund.code, date, 0);
  return { nav: n ? n.nav : null, navDate: n ? fmtD(n.date) : null, redeemable: redeemableUnits(fund, n ? n.date : date), elss: fund.elss };
}

/** form = {tab, type, date, amount, units, nav, folio, all} */
function submitEntry(form) {
  const fund = getFundByTab(form.tab);
  if (!fund) throw new Error('Pick a fund');
  const lock = LockService.getDocumentLock();
  lock.waitLock(20000);
  try {
    let r;
    if (form.type === TXN.REDEMPTION) {
      r = redeem(fund, { date: form.date, units: form.units, amount: form.amount, nav: form.nav, all: !!form.all, source: 'Manual' });
      return '✅ Redeemed ' + r.units + ' units @ ' + r.nav + ' (≈ ' + inr(r.amount) + ') from ' + r.lots + ' lot(s)' +
             (r.split ? ', 1 lot split' : '') + (r.capped ? '. ⚠️ Capped to available units' : '');
    }
    r = addPurchase(fund, { date: form.date, amount: form.amount, units: form.units, nav: form.nav, folio: form.folio,
                            type: form.type, source: 'Manual', force: !!form.force });
    if (r.skipped) return '⚠️ Skipped: ' + r.reason + '. Tick "add anyway" if this is a real second entry.';
    return '✅ Added ' + r.units + ' units @ ' + r.nav + ' on ' + fmtD(r.date);
  } finally { lock.releaseLock(); }
}
