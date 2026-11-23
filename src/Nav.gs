/**
 * Nav.gs: everything that talks to mfapi.in (free, AMFI data, no API key).
 *   /mf/search?q=…    scheme search (Setup Wizard)
 *   /mf/{code}/latest latest NAV + meta (category, fund house)
 *   /mf/{code}        full NAV history (52W, reports, Advisor, past-date NAVs)
 */
const MFAPI = 'https://api.mfapi.in/mf/';

function mfapiJson_(path) {
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try {
      const res = UrlFetchApp.fetch(MFAPI + path, { muteHttpExceptions: true });
      if (res.getResponseCode() === 200) return JSON.parse(res.getContentText());
      lastErr = new Error('mfapi HTTP ' + res.getResponseCode());
    } catch (e) { lastErr = e; }
    Utilities.sleep(800 * (i + 1));
  }
  throw lastErr;
}

/** Scheme search for the wizard. Returns [{code, name}] (max 25). */
function searchSchemes(query) {
  const q = String(query || '').trim();
  if (q.length < 3) return [];
  const list = mfapiJson_('search?q=' + encodeURIComponent(q)) || [];
  return list.slice(0, 25).map(x => ({ code: String(x.schemeCode), name: x.schemeName }));
}

/** Meta + latest NAV for one scheme code (wizard preview). */
function getSchemeInfo(code) {
  const j = mfapiJson_(String(code).trim() + '/latest');
  if (!j || !j.meta || !j.data || !j.data.length) throw new Error('Scheme code ' + code + ' not found on mfapi.in');
  const m = j.meta;
  return {
    code: String(m.scheme_code), name: m.scheme_name, house: m.fund_house, category: m.scheme_category,
    cat: mapCategory(m.scheme_category, m.scheme_name), elss: /elss|tax\s*saver/i.test(m.scheme_category + ' ' + m.scheme_name),
    nav: parseFloat(j.data[0].nav), navDate: j.data[0].date,
    amc: amcKeyword(m.fund_house), match: matchRegexFor(m.scheme_name), tab: safeTabName(m.scheme_name),
    growth: !/idcw|dividend/i.test(m.scheme_name),
  };
}

/** Latest NAV {nav, date: Date}. */
function latestNav(code) {
  const j = mfapiJson_(String(code) + '/latest');
  return { nav: parseFloat(j.data[0].nav), date: parseDateLoose(j.data[0].date) };
}

/** Full history [{d: Date, nav}] oldest → newest, cached for the run. */
var _navHistCache = {};
function navHistory(code) {
  code = String(code);
  if (!_navHistCache[code]) {
    const data = (mfapiJson_(code) || {}).data || [];
    _navHistCache[code] = data.map(x => ({ d: parseDateLoose(x.date), nav: parseFloat(x.nav) }))
      .filter(x => x.d && x.nav > 0).reverse();
  }
  return _navHistCache[code];
}

/** First NAV on/after date (offset 0) or strictly after date (offset 1), within 7 days. */
function navFrom(code, date, offset) {
  const h = navHistory(code);
  const from = new Date(date.getFullYear(), date.getMonth(), date.getDate() + (offset || 0));
  const until = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 7);
  for (let i = 0; i < h.length; i++) if (h[i].d >= from && h[i].d <= until) return { date: h[i].d, nav: h[i].nav };
  return null;
}

/** 52-week high / low from history. */
function high52Low52(code) {
  const h = navHistory(code);
  const cut = new Date(); cut.setFullYear(cut.getFullYear() - 1);
  const yr = h.filter(x => x.d >= cut);
  if (!yr.length) return { hi: '', lo: '' };
  return { hi: Math.max.apply(null, yr.map(x => x.nav)), lo: Math.min.apply(null, yr.map(x => x.nav)) };
}

// ---------- mapping helpers ----------
/** AMFI category text ("Equity Scheme - Small Cap Fund") → tracker category. */
function mapCategory(amfiCat, name) {
  const c = String(amfiCat || '').toLowerCase(), n = String(name || '').toLowerCase();
  if (/elss|tax\s*sav/.test(c + n)) return 'ELSS';
  if (/gold|silver/.test(c + ' ' + n)) return 'Gold/Silver';
  if (/overseas|international|global|nasdaq|s&p 500|us equity/.test(c + ' ' + n)) return 'International';
  if (/index|etf/.test(c)) {
    if (/small\s*cap|smallcap/.test(n)) return 'Small';
    if (/mid\s*cap|midcap/.test(n) && !/large/.test(n)) return 'Mid';
    if (/bond|gilt|g-sec|sdl|liquid|debt|psu/.test(n)) return 'Debt';
    return 'Large/Index';
  }
  if (/large\s*&\s*mid/.test(c)) return 'Large & Mid';
  if (/large cap/.test(c)) return 'Large/Index';
  if (/mid cap/.test(c)) return 'Mid';
  if (/small cap/.test(c)) return 'Small';
  if (/flexi|multi cap|focused|value|contra|dividend yield/.test(c)) return 'Flexi/Multi';
  if (/sectoral|thematic/.test(c)) return 'Sectoral/Thematic';
  if (/hybrid|balanced|arbitrage|asset allocation|equity savings/.test(c)) return 'Hybrid';
  if (/debt|liquid|money market|gilt|bond|duration|overnight|credit|banking and psu|floater/.test(c)) return 'Debt';
  return 'Other';
}

/** "Axis Mutual Fund" → "AXIS" (used to find the AMC in a bank credit alert). */
function amcKeyword(house) {
  return String(house || '').replace(/mutual\s*fund/i, '').trim().split(/\s+/)[0].toUpperCase();
}

/** Scheme name → loose regex used to recognise the scheme in mails / CSVs. */
function matchRegexFor(name) {
  const stop = /^(fund|plan|growth|option|regular|direct|the|of|scheme|and|india|mutual|-|&)$/i;
  const words = String(name).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w && !stop.test(w));
  let re = words.slice(0, 4).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  if (/direct/i.test(name)) re += '.*direct';
  return re;
}

/** Sheet tab names: max 100 chars, no []*?/\: */
function safeTabName(name) {
  return String(name).replace(/[\[\]\*\?\/\\:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90);
}
