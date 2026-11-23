/**
 * AutoTransactions.gs: Gmail → ledger auto-entry, with a small parser registry.
 *
 * Turn on in ⚙️ Settings → GMAIL_PARSERS (e.g. "FUNDZBAZAR"). Each parser has:
 *   name, purchases: {query, parse(text) → {holder, scheme, folio, amount, ref}}
 *         redemptions: {query, parse(text) → {holder, rows:[{scheme, folio, amount, allUnits, date}]}}
 * The holder name in the mail must equal an owner's "Holder name" in the Owners tab, and the scheme
 * must match that owner's fund "Mail match (regex)" in the Funds tab.
 *
 * Adding your platform: copy PARSER_FUNDZBAZAR, change the Gmail query + regexes, register it in PARSERS.
 * See docs/GMAIL_PARSERS.md.
 */
const AT = { LABEL: 'MF-Processed', SEARCH_LIMIT: 100 };

const PARSER_FUNDZBAZAR = {
  name: 'FUNDZBAZAR',
  purchases: {
    query: 'from:transactions@fundzbazar.com subject:"eSIP Transaction Successful"',
    parse: function (t) {
      const m = t.match(/Client Name\s*:\s*(.+?)\s+Scheme Name\s*:\s*(.+?)\s+Folio\s*No\s*:\s*(\S+)\s+Amount\s*\(Rs\)\s*:\s*([\d,]+(?:\.\d+)?)/i);
      if (!m) return null;
      return { holder: m[1].trim().toUpperCase(), scheme: m[2].trim(), folio: m[3].trim(),
               amount: parseFloat(m[4].replace(/,/g, '')), ref: (t.match(/Transaction Reference Number\s*:\s*(\d+)/i) || [])[1] || '' };
    },
  },
  redemptions: {
    query: 'from:transactions@fundzbazar.com subject:"Redemption Transaction Successfully Placed"',
    parse: function (t) {
      const holder = ((t.match(/Holding Profile\s*:\s*([A-Z][A-Z .]*?[A-Z])\s+(?:-{3,}|\||Sr\.?\s*No)/i) || [])[1] || '').trim().toUpperCase();
      const re = /\|\s*\d+\s*\|\s*([\w\/]+)\s*\|\s*Redemption\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*(\d{2}\/\d{2}\/\d{4})/gi;
      const rows = []; let m;
      while ((m = re.exec(t)) !== null) {
        const d = m[4].split('/');
        rows.push({ folio: m[1], scheme: m[2].trim(), allUnits: /all\s*unit/i.test(m[3]),
                    amount: parseFloat((m[3].match(/[\d,]+(?:\.\d+)?/) || ['0'])[0].replace(/,/g, '')),
                    date: new Date(+d[2], +d[1] - 1, +d[0]) });
      }
      return holder && rows.length ? { holder: holder, rows: rows } : null;
    },
  },
};

const PARSERS = { FUNDZBAZAR: PARSER_FUNDZBAZAR };

// ===================== entry points =====================
function runAutoTransactions() {
  const names = String(setting('GMAIL_PARSERS') || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  if (!names.length) return;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;
  try {
    const log = getBook().getSheetByName(TABS.TXN_LOG);
    const done = loadDoneIds_(log);
    names.forEach(n => {
      const p = PARSERS[n];
      if (!p) { notifyError('runAutoTransactions', 'Unknown parser "' + n + '" in GMAIL_PARSERS'); return; }
      try {
        if (p.purchases) processPurchaseMails_(p, log, done);
        if (p.redemptions) processRedemptionMails_(p, log, done);
      } catch (e) { notifyError('Parser ' + n, e); }
    });
  } finally { lock.releaseLock(); }
}

function gmailQuery_(base) {
  const start = String(setting('GMAIL_START_DATE') || '').trim();
  return base + (start ? ' after:' + start : ' newer_than:30d') + ' -label:' + AT.LABEL;
}

function holderToOwner_(holder) {
  const o = getOwners().filter(x => x.holder && x.holder === holder)[0];
  return o ? o.name : null;
}

function findFundForMail_(owner, scheme) {
  return getFunds().filter(f => f.owner === owner && f.match && f.match.test(scheme))[0] || null;
}

// ===================== purchases =====================
function processPurchaseMails_(p, log, done) {
  GmailApp.search(gmailQuery_(p.purchases.query), 0, AT.SEARCH_LIMIT).forEach(thread => {
    let allDone = true;
    thread.getMessages().forEach(msg => {
      const id = msg.getId();
      if (done[id]) return;
      const x = p.purchases.parse(htmlToText_(msg.getBody()));
      if (!x) { logRow_(log, id, msg.getDate(), 'SKIP', '', '', 0, 0, 0, p.name + ': could not parse'); done[id] = 1; return; }
      const owner = holderToOwner_(x.holder);
      if (!owner) { done[id] = 1; return; }                        // someone else's mail
      const fund = findFundForMail_(owner, x.scheme);
      if (!fund) { logRow_(log, id, msg.getDate(), 'SKIP', x.scheme, x.folio, x.amount, 0, 0, 'No fund matches (check Funds → Mail match)'); done[id] = 1; return; }
      try {
        const r = addPurchase(fund, { date: localDate_(msg.getDate()), amount: x.amount, folio: x.folio, type: TXN.SIP, source: p.name + ' mail' });
        logRow_(log, id, r.date || msg.getDate(), TXN.SIP, fund.tab, x.folio, x.amount, r.nav || 0, r.units || 0,
                r.skipped ? 'Already in sheet, skipped' : 'Ref ' + x.ref);
        done[id] = 1;
      } catch (e) {
        if (/not published/.test(e.message)) { allDone = false; return; }  // NAV tomorrow → retry next run
        logRow_(log, id, msg.getDate(), 'ERROR', fund.tab, x.folio, x.amount, 0, 0, e.message); done[id] = 1;
      }
    });
    if (allDone) thread.addLabel(getOrCreateLabel_());
  });
}

// ===================== redemptions =====================
function processRedemptionMails_(p, log, done) {
  GmailApp.search(gmailQuery_(p.redemptions.query), 0, 50).forEach(thread => {
    let allDone = true;
    thread.getMessages().forEach(msg => {
      const id = msg.getId();
      if (done[id]) return;
      const x = p.redemptions.parse(htmlToText_(msg.getBody()));
      if (!x) { logRow_(log, id, msg.getDate(), 'SKIP', '', '', 0, 0, 0, p.name + ': redemption parse failed'); done[id] = 1; return; }
      const owner = holderToOwner_(x.holder);
      if (!owner) { done[id] = 1; return; }

      let pending = false;
      x.rows.forEach((row, i) => {
        const key = id + '#' + i;
        if (done[key]) return;
        const fund = findFundForMail_(owner, row.scheme);
        if (!fund) { logRow_(log, key, row.date, 'SKIP', row.scheme, row.folio, 0, 0, 0, 'No fund matches'); done[key] = 1; return; }
        const nav = navFrom(fund.code, row.date, 1);               // request after cut-off → next NAV
        if (!nav) { pending = true; return; }

        // Most accurate: actual bank credit ÷ NAV. Otherwise wait, then estimate.
        let units = null, note = '';
        const payout = findPayout_(fund.amc, row.date);
        if (payout) { units = round3_(payout / (nav.nav * (1 - 0.00001))); note = 'Units from bank credit ₹' + payout; }
        else if (String(setting('PAYOUT_QUERY') || '').trim() && daysBetween_(row.date, new Date()) < settingNum('PAYOUT_WAIT_DAYS')) { pending = true; return; }
        try {
          const r = redeem(fund, { date: nav.date, nav: nav.nav, units: units, amount: units ? 0 : row.amount, all: !units && row.allUnits, source: p.name + ' mail' });
          logRow_(log, key, r.date, TXN.REDEMPTION, fund.tab, row.folio, r.amount, r.nav, r.units,
                  (note || 'ESTIMATE from requested amount, verify with your statement') + ' | lots ' + r.lots + (r.split ? ' (1 split)' : ''));
        } catch (e) { logRow_(log, key, row.date, 'ERROR', fund.tab, row.folio, row.amount, nav.nav, 0, e.message); }
        done[key] = 1;
      });
      if (pending) allDone = false; else { logRow_(log, id, msg.getDate(), 'DONE', '', '', 0, 0, 0, 'Redemption mail processed'); done[id] = 1; }
    });
    if (allDone) thread.addLabel(getOrCreateLabel_());
  });
}

/** Optional: bank alert "Rs X credited … <AMC> … REDEMPTION" within 0–8 days of the request. */
function findPayout_(amc, reqDate) {
  const base = String(setting('PAYOUT_QUERY') || '').trim();
  if (!base || !amc) return null;
  const after = Utilities.formatDate(reqDate, tz_(), 'yyyy/MM/dd');
  const before = Utilities.formatDate(new Date(reqDate.getTime() + 9 * 864e5), tz_(), 'yyyy/MM/dd');
  for (const th of GmailApp.search(base + ' "' + amc + '" after:' + after + ' before:' + before, 0, 10)) {
    for (const msg of th.getMessages()) {
      const body = msg.getPlainBody();
      const m = body.match(/(?:Rs\.?|INR|₹)\s*([\d,]+(?:\.\d+)?)[\s\S]{0,80}?credited/i);
      if (m && body.toUpperCase().indexOf(amc) >= 0) return parseFloat(m[1].replace(/,/g, ''));
    }
  }
  return null;
}

// ===================== log / gmail helpers =====================
function loadDoneIds_(log) {
  const done = {};
  const n = log.getLastRow();
  if (n > 1) log.getRange(2, 2, n - 1, 1).getValues().forEach(r => { if (r[0]) done[r[0]] = 1; });
  return done;
}

function logRow_(log, key, date, type, tab, folio, amount, nav, units, note) {
  log.appendRow([new Date(), key, date, type, tab, folio, amount, nav, units, note]);
}

function getOrCreateLabel_() {
  return GmailApp.getUserLabelByName(AT.LABEL) || GmailApp.createLabel(AT.LABEL);
}

function htmlToText_(html) {
  return String(html).replace(/<\/t[dh]>/gi, ' | ').replace(/<\/tr>/gi, ' \n ').replace(/<br\s*\/?>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'")
    .replace(/[ \t\r\n]+/g, ' ');
}

/** Editor helper: test a parser on the newest matching mail without writing anything. */
function testParsers() {
  Object.keys(PARSERS).forEach(n => {
    const p = PARSERS[n];
    ['purchases', 'redemptions'].forEach(k => {
      if (!p[k]) return;
      const th = GmailApp.search(p[k].query, 0, 1)[0];
      console.log(n + ' ' + k + ': ' + (th ? JSON.stringify(p[k].parse(htmlToText_(th.getMessages()[0].getBody()))) : 'no mail found'));
    });
  });
}
