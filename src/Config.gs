/**
 * Config.gs: the configuration layer.
 *
 * Nothing personal is hard-coded here. Everything comes from three tabs that the
 * Setup Wizard creates (and that you can edit by hand later):
 *   ⚙️ Settings : key / value pairs (emails, budget, thresholds, targets…)
 *   Owners     : one row per person whose money is tracked
 *   Funds      : one row per fund holding (fund + owner), the source for every other module
 */

// ---------- fixed tab names (system tabs) ----------
const TABS = {
  SETTINGS: '⚙️ Settings',
  OWNERS: 'Owners',
  FUNDS: 'Funds',
  MASTER: 'Master Data',
  ADVISOR: 'Advisor',
  IMPORT: 'Import',
  NAV_LOG: 'Daily NAV Update Log',
  DAILY_LOG: 'Daily Log',
  TXN_LOG: 'Auto Txn Log',
  ABOUT: 'Read Me',
};

// ---------- fund tab layout (A–P lots, R/S summary block) ----------
const COL = { SCHEME: 1, FOLIO: 2, NATURE: 3, DATE: 4, TYPE: 5, AMT: 6, NAV: 7, UNITS: 8, SOURCE: 9, CURNAV: 10 };
const LOT_COLS = 10;            // A..J are written by the script; K..P are ARRAYFORMULAs
const SUMMARY = {               // column S cells, column R holds the labels
  HI52: 'S2', LO52: 'S3', ABS: 'S4', XIRR: 'S6', ST: 'S8', LT: 'S10',
  INVESTED: 'S12', VALUE: 'S14', UNREAL: 'S16', UNITS: 'S18', REALISED: 'S20',
  LAST_RED_DATE: 'S22', LAST_RED_NAV: 'S24', CODE: 'S26', OWNER: 'S28',
};
const TXN = { SIP: 'SIP', PURCHASE: 'Purchase', REDEMPTION: 'Redemption' };

// ---------- categories (Advisor allocation) ----------
const CATEGORIES = ['Large/Index', 'Large & Mid', 'Mid', 'Small', 'Flexi/Multi', 'ELSS',
  'Sectoral/Thematic', 'International', 'Hybrid', 'Debt', 'Gold/Silver', 'Other'];

const TARGET_PRESETS = {
  Aggressive:   { 'Large/Index': 20, 'Flexi/Multi': 30, 'Mid': 25, 'Small': 25 },
  Moderate:     { 'Large/Index': 35, 'Flexi/Multi': 30, 'Mid': 15, 'Small': 10, 'Hybrid': 10 },
  Conservative: { 'Large/Index': 30, 'Flexi/Multi': 15, 'Hybrid': 25, 'Debt': 30 },
};

/** Default settings: key -> [default value, description]. Setup writes these into ⚙️ Settings. */
const SETTING_DEFAULTS = {
  USER_NAME:          ['', 'Your name (shown in report headers)'],
  ALERT_EMAIL:        ['', 'Script errors and test mails go here'],
  REPORT_EMAILS:      ['', 'Weekly/monthly reports go to these addresses (comma-separated)'],
  WEEKLY_REPORT:      ['Yes', 'Send the weekly portfolio report every Saturday (Yes/No)'],
  MONTHLY_REPORT:     ['Yes', 'Send last month\'s report on the 1st (Yes/No)'],
  WEEKLY_NAV_LOG:     ['No', 'Send the per-fund "Weekly NAV Update Log" mail on Saturday (Yes/No)'],
  ADVISOR_IN_REPORT:  ['Yes', 'Add the Advisor section to the weekly report (Yes/No)'],
  EXPECTED_RETURN:    [12, 'Expected yearly return (%) used for the projection table'],
  GOAL_AMOUNT:        [10000000, 'Your corpus goal in ₹ (projection shows the year you reach it)'],
  PROJECTION_YEARS:   [20, 'Number of years in the projection table'],
  ADVISOR_GROUPING:   ['Combined', 'Combined = all owners as one family portfolio, Separate = each owner alone'],
  TOPUP_BUDGET:       [5000, 'Extra monthly money (₹) available for top-ups on dips'],
  MILD_DD:            [15, 'Fall (%) from 52-week high that triggers "Top-up"'],
  STRONG_DD:          [25, 'Fall (%) from 52-week high that triggers "Strong top-up"'],
  DRIFT_BAND:         [5, 'Allocation within ±this % of target counts as OK'],
  MIN_TOPUP:          [500, 'Smallest top-up amount the Advisor will suggest (₹)'],
  STAMP_DUTY_PCT:     [0.005, 'Stamp duty on purchases (%), used to compute units'],
  GMAIL_PARSERS:      ['', 'Gmail auto-entry parsers to run, comma-separated (e.g. FUNDZBAZAR). Blank = off'],
  GMAIL_START_DATE:   ['', 'Ignore mails before this date (yyyy/mm/dd). Set it to the day after your last manual entry'],
  PAYOUT_QUERY:       ['', 'Optional Gmail search for your bank\'s redemption-credit alert, e.g. from:alerts@yourbank.com "MF REDEMPTION"'],
  PAYOUT_WAIT_DAYS:   [10, 'Days to wait for the bank credit before using an estimate'],
  DISCLAIMER_ACCEPTED:['', 'Set by the Setup Wizard'],
  SETUP_DONE:         ['', 'Set by the Setup Wizard'],
};

// ===================== workbook =====================
function getBook() {
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('Spreadsheet not found. Open the sheet and run Setup once.');
  return SpreadsheetApp.openById(id);
}

/** Remember the sheet ID so time-driven triggers can always open it. */
function rememberBook_() {
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', SpreadsheetApp.getActiveSpreadsheet().getId());
}

// ===================== settings =====================
var _settingsCache = null;

function getSettings() {
  if (_settingsCache) return _settingsCache;
  const out = {};
  Object.keys(SETTING_DEFAULTS).forEach(k => { out[k] = SETTING_DEFAULTS[k][0]; });
  out.TARGETS = {};
  const sh = getBook().getSheetByName(TABS.SETTINGS);
  if (sh && sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(r => {
      const k = String(r[0]).trim();
      if (!k) return;
      if (k.indexOf('TARGET|') === 0) { if (r[1] !== '' && +r[1] > 0) out.TARGETS[k.slice(7)] = +r[1]; }
      else out[k] = r[1];
    });
  }
  _settingsCache = out;
  return out;
}

function setting(key) { return getSettings()[key]; }
function settingNum(key) { const v = parseFloat(setting(key)); return isNaN(v) ? +SETTING_DEFAULTS[key][0] : v; }
function settingYes(key) { return /^(y|yes|true|1|on)$/i.test(String(setting(key)).trim()); }

/** Write/overwrite settings. values = {KEY: value}; targets = {Category: pct} (replaces all targets). */
function saveSettings(values, targets) {
  const ss = getBook();
  const sh = ss.getSheetByName(TABS.SETTINGS) || ss.insertSheet(TABS.SETTINGS);
  const existing = {};
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues()
    .forEach(r => { if (r[0]) existing[r[0]] = [r[1], r[2]]; });

  const rows = [['Key', 'Value', 'What it does']];
  Object.keys(SETTING_DEFAULTS).forEach(k => {
    const v = values && k in values ? values[k] : (k in existing ? existing[k][0] : SETTING_DEFAULTS[k][0]);
    rows.push([k, v, SETTING_DEFAULTS[k][1]]);
  });
  let tg = targets;
  if (!tg) { tg = {}; Object.keys(existing).filter(k => k.indexOf('TARGET|') === 0).forEach(k => { tg[k.slice(7)] = existing[k][0]; }); }
  CATEGORIES.forEach(c => rows.push(['TARGET|' + c, tg[c] || '', 'Target allocation % for ' + c + ' (all targets should add up to 100)']));

  sh.clear();
  sh.getRange(1, 1, rows.length, 3).setValues(rows);
  sh.getRange(1, 1, 1, 3).setFontWeight('bold').setBackground('#0b1f3a').setFontColor('#ffffff');
  sh.setFrozenRows(1);
  sh.setColumnWidth(1, 190); sh.setColumnWidth(2, 260); sh.setColumnWidth(3, 520);
  sh.getRange(2, 2, rows.length - 1, 1).setNumberFormat('@').setBackground('#fffbea');
  _settingsCache = null;
}

// ===================== owners =====================
const OWNER_COLORS = [['#1f4e79', '#eaf1fb'], ['#6a1b9a', '#f5eafb'], ['#00695c', '#e6f4f1'],
                      ['#b45309', '#fdf3e7'], ['#9f1239', '#fdebef'], ['#374151', '#f3f4f6']];
var _ownersCache = null;

/** [{name, holder, birthYear, color, light}] from the Owners tab (row order = colour order). */
function getOwners() {
  if (_ownersCache) return _ownersCache;
  const sh = getBook().getSheetByName(TABS.OWNERS);
  const out = [];
  if (sh && sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues().forEach(r => {
      const name = String(r[0]).trim();
      if (!name) return;
      const c = OWNER_COLORS[out.length % OWNER_COLORS.length];
      out.push({ name: name, holder: String(r[1] || '').trim().toUpperCase(), birthYear: +r[2] || null, color: c[0], light: c[1] });
    });
  }
  _ownersCache = out;
  return out;
}
function ownerStyle(name) {
  const o = getOwners().filter(x => x.name === name)[0];
  return o ? { color: o.color, light: o.light } : { color: OWNER_COLORS[0][0], light: OWNER_COLORS[0][1] };
}

// ===================== funds =====================
const FUND_HEADERS = ['Tab name', 'AMFI code', 'Scheme name', 'Owner', 'Category', 'ELSS (Yes/No)',
                      'Mail match (regex)', 'AMC keyword', 'Active (Yes/No)'];
var _fundsCache = null;

/**
 * [{tab, code, scheme, owner, cat, elss, match:RegExp, amc, active}] from the Funds tab.
 * Inactive funds keep their tab, but NAV updates and Gmail matching skip them.
 */
function getFunds(includeInactive) {
  if (!_fundsCache) {
    const sh = getBook().getSheetByName(TABS.FUNDS);
    const out = [];
    if (sh && sh.getLastRow() > 1) {
      sh.getRange(2, 1, sh.getLastRow() - 1, FUND_HEADERS.length).getValues().forEach(r => {
        const tab = String(r[0]).trim();
        if (!tab || !r[1]) return;
        let re = null;
        try { re = r[6] ? new RegExp(String(r[6]), 'i') : null; } catch (e) { re = null; }
        out.push({ tab: tab, code: String(r[1]).trim(), scheme: String(r[2] || tab), owner: String(r[3] || '').trim(),
                   cat: String(r[4] || 'Other').trim(), elss: /^y/i.test(String(r[5])) || r[4] === 'ELSS',
                   match: re, amc: String(r[7] || '').trim().toUpperCase(), active: !/^n/i.test(String(r[8])) });
      });
    }
    _fundsCache = out;
  }
  return includeInactive ? _fundsCache : _fundsCache.filter(f => f.active);
}

function getFundByTab(tab) { return getFunds(true).filter(f => f.tab === tab)[0] || null; }

function resetCaches_() { _settingsCache = null; _ownersCache = null; _fundsCache = null; }

// ===================== misc helpers =====================
function getRecipients(key) {
  const v = String(setting(key) || '').trim();
  return v || String(setting('ALERT_EMAIL') || '').trim() || Session.getEffectiveUser().getEmail();
}

/** Last row with data in column A, ignoring the R/S summary block. */
function lastDataRow(sheet) {
  const a = sheet.getRange(1, 1, sheet.getMaxRows(), 1).getValues();
  for (let i = a.length - 1; i >= 0; i--) if (String(a[i][0]).trim()) return i + 1;
  return 1;
}

/** Do not fail silently: send an alert mail. */
function notifyError(where, err) {
  const msg = where + ': ' + (err && err.message ? err.message : err);
  console.error(msg);
  try { MailApp.sendEmail(getRecipients('ALERT_EMAIL'), '⚠️ MF Tracker script error: ' + where, msg); }
  catch (e) { console.error('Alert mail also failed: ' + e.message); }
}

const DISCLAIMER_TEXT = 'This tracker is a rule-based calculator, not investment advice. The author is not a ' +
  'SEBI-registered investment adviser or research analyst. NAVs come from AMFI via the free mfapi.in service and may be ' +
  'delayed or wrong. Gain and tax figures are approximate; verify against your CAS or AMC statement. You make your own decisions.';
