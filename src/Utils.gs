/** Utils.gs: date, number and text helpers shared by every module. */

function tz_() { return Session.getScriptTimeZone() || 'Asia/Kolkata'; }

/** "2026-11-01", "16-Nov-2026", "20-11-2026", "20/11/2026", Date: all become a local midnight Date (or null). */
function parseDateLoose(v) {
  if (v instanceof Date) return isNaN(v) ? null : new Date(v.getFullYear(), v.getMonth(), v.getDate());
  const s = String(v || '').trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  m = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);   // Indian DD-MM-YYYY
  const d = new Date(s);
  return isNaN(d) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function localDate_(d) {
  const s = Utilities.formatDate(d, tz_(), 'yyyy-MM-dd').split('-');
  return new Date(+s[0], +s[1] - 1, +s[2]);
}
function daysBetween_(a, b) { return Math.round((localDate_(b) - localDate_(a)) / 864e5); }
function round3_(x) { return Math.round(x * 1000) / 1000; }
function round2_(x) { return Math.round(x * 100) / 100; }

function getMonday(d) {
  d = new Date(d);
  const day = d.getDay();
  d.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Monday and Friday of the current week, formatted. */
function getFormattedMondayAndFriday() {
  const monday = getMonday(new Date());
  const friday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 4);
  return { formattedMonday: fmtD(monday), formattedFriday: fmtD(friday) };
}

// ---------- formatting ----------
/** ₹ in Indian grouping: ₹11,99,198 */
function inr(v) {
  const neg = v < 0; v = Math.abs(Math.round(v || 0));
  const s = v.toString();
  const last3 = s.slice(-3), rest = s.slice(0, -3);
  const out = rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3 : last3;
  return (neg ? '-₹' : '₹') + out;
}
function pct(v) { return (v >= 0 ? '+' : '') + (+v).toFixed(2) + '%'; }
function fmtD(d) { return Utilities.formatDate(d, tz_(), 'dd MMM yyyy'); }
function fmtShort(d) { return Utilities.formatDate(d, tz_(), 'dd MMM'); }

/** "Axis Small Cap Fund - Regular Plan - Growth" → "Axis Small Cap" */
function shortFundName(tab) {
  return String(tab).replace(/\s*\[[^\]]*\]\s*$/, '')
    .replace(/\s*-\s*(Regular|Direct)\s*Plan.*$/i, '').replace(/\s*-\s*Growth.*$/i, '')
    .replace(/\s+Fund\s*$/i, '').trim();
}

/** Escape text for HTML mails. */
function esc_(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Quote a tab name for use in a formula: 'My Fund''s tab' */
function q_(tab) { return "'" + String(tab).replace(/'/g, "''") + "'"; }

const INR_FMT_ = '[>=100000]"₹"##\\,##\\,##0;"₹"#,##0';
