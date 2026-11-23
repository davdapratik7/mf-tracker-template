/**
 * Advisor.gs: rule-based "advisor". It gives no advice; it only calculates the rules YOU set in ⚙️ Settings.
 *
 * Each run (weekly mail, or Menu → Run Advisor):
 *  1. Allocation : category-wise % vs your TARGET|… settings
 *  2. Overlap    : 2+ funds in one category → rank by NAV history, mark one "Primary"
 *  3. Signal     : NAV fall from 52-week high (MILD_DD / STRONG_DD) + category overweight check
 *  4. Top-up plan: split TOPUP_BUDGET across eligible funds (strong = 2× weight, underweight category = extra)
 * Output: "Advisor" tab + a section in the weekly mail.
 */

/** Settings → advisor config. Combined = one family group of all owners; Separate = one group per owner. */
function advisorConfig_() {
  const s = getSettings();
  const owners = getOwners();
  const groups = {};
  if (/^comb/i.test(String(s.ADVISOR_GROUPING)) && owners.length > 1) groups['Family'] = owners.map(o => o.name);
  const birth = {};
  owners.forEach(o => { if (o.birthYear) birth[o.name] = o.birthYear; });
  return {
    GROUPS: groups, TARGETS: s.TARGETS || {}, BIRTH_YEAR: birth,
    TOPUP_BUDGET: settingNum('TOPUP_BUDGET'), MILD_DD: settingNum('MILD_DD'), STRONG_DD: settingNum('STRONG_DD'),
    DRIFT_BAND: settingNum('DRIFT_BAND'), MIN_TOPUP: Math.max(1, settingNum('MIN_TOPUP')),
  };
}

function groupStyle_(o) {
  return o.owner === 'Family' && o.title.indexOf('(') > 0 ? { color: '#0b1f3a', light: '#eef2f7' } : ownerStyle(o.owner);
}

/** Menu / editor: calculate + refresh the Advisor tab. */
function runAdvisor() {
  const res = computeAdvisor();
  writeAdvisorSheet(res);
  return res;
}

/** Menu: refresh Advisor tab + mail only the Advisor section to ALERT_EMAIL. */
function sendAdvisorTestToMe() {
  const res = runAdvisor();
  MailApp.sendEmail({
    to: getRecipients('ALERT_EMAIL'),
    subject: '🧭 MF Advisor: ' + fmtD(new Date()),
    htmlBody: '<div style="font-family:Arial,sans-serif;max-width:680px;margin:auto;color:#222">' + renderAdvisorHtml(res) + '</div>'
  });
}

// ===================== CALCULATION =====================
function computeAdvisor() {
  const ADVISOR = advisorConfig_();
  const ss = getBook();
  const today = new Date();
  const funds = [];

  getFunds(true).forEach(f => {
    const sh = ss.getSheetByName(f.tab);
    if (!sh) return;
    const s = sh.getRange('S12:S18').getValues().map(r => +r[0] || 0);   // S12 invested, S14 value, S18 units
    const invested = s[0], value = s[2], units = s[6];
    if (value <= 0) return;
    const m = navMetrics_(f.code, today);
    funds.push(Object.assign({
      tab: f.tab, name: shortFundName(f.tab), owner: f.owner || '–', cat: f.cat || 'Other',
      invested: invested, value: value, units: units,
      avgCost: units ? invested / units : 0,
    }, m));
  });

  // groups from config; an owner not in any group is shown alone
  const groups = Object.assign({}, ADVISOR.GROUPS || {});
  const grouped = [].concat.apply([], Object.keys(groups).map(g => groups[g]));
  funds.forEach(x => { if (grouped.indexOf(x.owner) < 0 && !groups[x.owner]) groups[x.owner] = [x.owner]; });

  const result = { date: today, owners: [] };
  Object.keys(groups).forEach(o => {
    const members = groups[o];
    const list = funds.filter(x => members.indexOf(x.owner) >= 0);
    if (!list.length) return;
    const multi = members.length > 1;
    list.forEach(x => { x.label = x.name + (multi ? ' [' + x.owner + ']' : ''); });
    const total = list.reduce((a, x) => a + x.value, 0);
    const target = Object.keys(ADVISOR.TARGETS).length ? ADVISOR.TARGETS : null;

    // --- category allocation ---
    const cats = {};
    list.forEach(x => { cats[x.cat] = cats[x.cat] || { cat: x.cat, value: 0, funds: [] }; cats[x.cat].value += x.value; cats[x.cat].funds.push(x); });
    if (target) Object.keys(target).forEach(c => { cats[c] = cats[c] || { cat: c, value: 0, funds: [] }; });
    const catRows = Object.keys(cats).map(c => {
      const r = cats[c];
      r.pct = total ? r.value / total * 100 : 0;
      r.target = target ? (target[c] || 0) : null;
      r.drift = r.target === null ? null : r.pct - r.target;
      r.status = r.target === null ? '–'
        : r.drift > ADVISOR.DRIFT_BAND ? 'Overweight'
        : r.drift < -ADVISOR.DRIFT_BAND ? 'Underweight' : 'On target';
      return r;
    }).sort((a, b) => b.pct - a.pct);

    // --- overlap: 2+ funds in a category → pick a Primary by score ---
    catRows.forEach(r => {
      r.funds.forEach(x => { x.pctOfOwner = total ? x.value / total * 100 : 0; x.catStatus = r.status; x.dup = r.funds.length > 1; });
      if (r.funds.length > 1) {
        rankInCategory_(r.funds);
        r.primary = r.funds.filter(x => x.primary)[0].label;
      }
    });

    // --- signal ---
    list.forEach(x => {
      x.signal = x.dd >= ADVISOR.STRONG_DD ? 'Strong top-up' : x.dd >= ADVISOR.MILD_DD ? 'Top-up' : 'Normal SIP';
      x.eligible = x.signal !== 'Normal SIP';
      if (x.dup && !x.primary) { x.eligible = false; x.note = 'Duplicate in the same category; put new money in ' + cats[x.cat].primary; }
      if (x.eligible && x.catStatus === 'Overweight') { x.eligible = false; x.note = 'Category already overweight, no top-up'; }
      if (!x.note && x.signal !== 'Normal SIP') x.note = 'NAV ' + x.dd.toFixed(1) + '% below 52W high' + (x.nav < x.avgCost ? ', also below your average cost' : '');
      x.topup = 0;
    });

    // --- top-up plan: TOPUP_BUDGET per group, weighted by signal strength and category shortfall ---
    const elig = list.filter(x => x.eligible);
    const w = elig.map(x => (x.signal === 'Strong top-up' ? 2 : 1) * (1 + Math.max(0, -(cats[x.cat].drift || 0)) / 10));
    const wSum = w.reduce((a, b) => a + b, 0);
    let used = 0;
    elig.forEach((x, i) => {
      const amt = Math.floor(ADVISOR.TOPUP_BUDGET * w[i] / wSum / ADVISOR.MIN_TOPUP) * ADVISOR.MIN_TOPUP;
      x.topup = amt >= ADVISOR.MIN_TOPUP ? amt : 0;
      used += x.topup;
    });

    const ages = members.filter(m => (ADVISOR.BIRTH_YEAR || {})[m]).map(m => {
      const age = today.getFullYear() - ADVISOR.BIRTH_YEAR[m];
      return { who: m, age: age, equity: Math.max(0, 100 - age), aggressive: Math.max(0, 110 - age) };
    });
    result.owners.push({
      owner: o, title: multi ? o + ' (' + members.join(' + ') + ')' : o, total: total, target: !!target, cats: catRows,
      funds: list.sort((a, b) => b.value - a.value),
      topupUsed: used, topupBudget: ADVISOR.TOPUP_BUDGET,
      ageRule: ages.length ? ages : null,
    });
  });
  return result;
}

/** From mfapi NAV history: NAV, 52W high, drawdown, 1Y/3Y CAGR, 3Y max fall, median rolling 1Y return. */
function navMetrics_(code, today) {
  const h = navHistory(code);                    // Nav.gs (oldest → newest)
  const last = h[h.length - 1];
  const navAt = daysAgo => {
    const t = new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysAgo);
    for (let i = h.length - 1; i >= 0; i--) if (h[i].d <= t) return h[i];
    return null;
  };
  const yr = h.filter(x => x.d >= new Date(today.getFullYear() - 1, today.getMonth(), today.getDate()));
  const hi52 = yr.reduce((m, x) => Math.max(m, x.nav), 0);
  const p1 = navAt(365), p3 = navAt(1095);
  const cagr = (p, yrs) => p ? (Math.pow(last.nav / p.nav, 1 / yrs) - 1) * 100 : null;

  // biggest peak-to-trough fall in 3 years
  const w3 = h.filter(x => x.d >= new Date(today.getFullYear() - 3, today.getMonth(), today.getDate()));
  let peak = 0, maxDD = 0;
  w3.forEach(x => { peak = Math.max(peak, x.nav); maxDD = Math.max(maxDD, (peak - x.nav) / peak * 100); });

  // median rolling 1Y return over 3 years (consistency)
  const roll = [];
  for (let i = w3.length - 1; i >= 0; i -= 5) {
    const end = w3[i], startT = new Date(end.d.getFullYear() - 1, end.d.getMonth(), end.d.getDate());
    let s = null;
    for (let j = i; j >= 0; j--) if (w3[j].d <= startT) { s = w3[j]; break; }
    if (!s) break;
    roll.push((end.nav / s.nav - 1) * 100);
  }
  roll.sort((a, b) => a - b);
  const median = roll.length ? roll[Math.floor(roll.length / 2)] : null;

  return {
    nav: last.nav, navDate: last.d, hi52: hi52,
    dd: hi52 ? (hi52 - last.nav) / hi52 * 100 : 0,
    cagr1: cagr(p1, 1), cagr3: cagr(p3, 3), maxDD3: maxDD, roll1Median: median,
  };
}

/** Same-category funds: rank by 3Y CAGR (higher), rolling median (higher), max fall (lower); lowest total wins. */
function rankInCategory_(list) {
  const rankBy = (key, higherBetter) => {
    const vals = list.map(x => x[key]);
    list.forEach(x => {
      const v = x[key];
      x._score = (x._score || 0) + (v === null ? list.length : vals.filter(o => o !== null && (higherBetter ? o > v : o < v)).length);
    });
  };
  list.forEach(x => { x._score = 0; x.primary = false; });
  rankBy('cagr3', true); rankBy('roll1Median', true); rankBy('maxDD3', false);
  list.sort((a, b) => a._score - b._score || b.value - a.value);
  list[0].primary = true;
}

// ===================== SHEET =====================

function writeAdvisorSheet(res) {
  const ss = getBook();
  const sh = ss.getSheetByName('Advisor') || ss.insertSheet('Advisor', 1);
  sh.clear(); sh.clearConditionalFormatRules();
  sh.setHiddenGridlines(true);
  const W = 11;
  let r = 1;
  const band = (row, text, bg) => {
    sh.getRange(row, 1, 1, W).merge().setValue(text).setBackground(bg).setFontColor('#ffffff')
      .setFontWeight('bold').setFontSize(12).setVerticalAlignment('middle');
    sh.setRowHeight(row, 30);
  };
  band(r, '🧭 MF Advisor  |  ' + fmtD(res.date) + '  |  Rule-based calculator, the final decision is yours', '#0b1f3a');
  sh.getRange(r, 1).setFontSize(14).setHorizontalAlignment('center'); sh.setRowHeight(r, 40); r += 2;

  res.owners.forEach(o => {
    const st = groupStyle_(o), clr = st.color, light = st.light;
    band(r++, '👨‍👩 ' + o.title + '  |  Portfolio ' + inr(o.total) + (o.target ? '' : '  (no target set: allocation + signals only)'), clr);

    // category table
    const ch = [['Category', 'Funds', 'Value', 'Actual %', 'Target %', 'Drift', 'Status', 'Primary (new SIP here)']];
    o.cats.forEach(c => ch.push([c.cat, c.funds.length, c.value, c.pct / 100, c.target === null ? '' : c.target / 100,
      c.drift === null ? '' : c.drift / 100, c.status, c.primary || (c.funds[0] ? c.funds[0].label : '–')]));
    sh.getRange(r, 1, ch.length, 8).setValues(ch);
    styleTable_(sh, r, ch.length, 8, clr, light);
    sh.getRange(r + 1, 3, ch.length - 1, 1).setNumberFormat(INR_FMT_);
    sh.getRange(r + 1, 4, ch.length - 1, 3).setNumberFormat('0.0%');
    for (let i = 1; i < ch.length; i++) colorStatus_(sh.getRange(r + i, 7), ch[i][6]);
    r += ch.length + 1;

    // fund table
    const fh = [['Fund', 'Category', 'Value', '% of portfolio', 'Avg cost', 'NAV', 'From 52W high', '3Y CAGR', '3Y max fall', 'Signal', 'Top-up (₹)']];
    o.funds.forEach(x => fh.push([x.label + (x.dup ? (x.primary ? '  ★' : '  (dup)') : ''), x.cat, x.value, x.pctOfOwner / 100,
      x.avgCost, x.nav, -x.dd / 100, x.cagr3 === null ? '' : x.cagr3 / 100, -x.maxDD3 / 100, x.signal + (x.note ? ' – ' + x.note : ''), x.topup || '']));
    fh.push(['Top-up total', '', '', '', '', '', '', '', '', 'Budget ' + inr(o.topupBudget), o.topupUsed]);
    sh.getRange(r, 1, fh.length, W).setValues(fh);
    styleTable_(sh, r, fh.length, W, clr, light);
    sh.getRange(r + 1, 3, fh.length - 1, 1).setNumberFormat(INR_FMT_);
    sh.getRange(r + 1, 4, fh.length - 1, 1).setNumberFormat('0.0%');
    sh.getRange(r + 1, 5, fh.length - 1, 2).setNumberFormat('0.00');
    sh.getRange(r + 1, 7, fh.length - 1, 3).setNumberFormat('0.0%;-0.0%');
    sh.getRange(r + 1, 11, fh.length - 1, 1).setNumberFormat(INR_FMT_);
    sh.getRange(r + 1, 10, fh.length - 1, 1).setWrap(true);
    for (let i = 1; i < fh.length - 1; i++) {
      const sig = o.funds[i - 1].signal, cell = sh.getRange(r + i, 10);
      if (sig === 'Strong top-up') cell.setBackground('#d1fae5').setFontColor('#065f46');
      else if (sig === 'Top-up') cell.setBackground('#fef3c7').setFontColor('#92400e');
      if (!o.funds[i - 1].eligible && sig !== 'Normal SIP') cell.setFontColor('#6b7280');
    }
    sh.getRange(r + fh.length - 1, 1, 1, W).setFontWeight('bold').setBackground('#f3f4f6');
    r += fh.length + 1;

    if (o.ageRule) {
      sh.getRange(r++, 1, 1, W).merge().setValue('Age thumb-rule (100 − age): ' + o.ageRule.map(a => a.who + ' ' + a.age + ' yrs → equity ~' + a.equity +
        '% (aggressive ' + a.aggressive + '%)').join('  |  ') + '. This applies to all your savings (FD/PF/MF), not only MF.').setFontColor('#374151');
    }
    r += 1;
  });

  sh.getRange(r, 1, 1, W).merge().setValue('★ = Primary fund of its category (ranked on 3Y CAGR, rolling 1Y consistency and 3Y max fall). (dup) = another fund in the same category. ' +
    'Change the rules in ⚙️ Settings. ' + DISCLAIMER_TEXT).setFontSize(9).setFontColor('#6b7280').setWrap(true);
  sh.setRowHeight(r, 36);
  [190, 95, 95, 90, 80, 80, 90, 80, 90, 300, 90].forEach((px, i) => sh.setColumnWidth(i + 1, px));
  sh.getRange(1, 1, r, W).setFontFamily('Roboto').setVerticalAlignment('middle');
}

function styleTable_(sh, row, rows, cols, clr, light) {
  sh.getRange(row, 1, 1, cols).setBackground(clr).setFontColor('#ffffff').setFontWeight('bold').setHorizontalAlignment('center');
  for (let i = 1; i < rows; i++) sh.getRange(row + i, 1, 1, cols).setBackground(i % 2 ? '#ffffff' : light);
  sh.getRange(row, 1, rows, cols).setBorder(null, null, null, null, null, true, '#e5e7eb', SpreadsheetApp.BorderStyle.SOLID);
  sh.getRange(row, 1, rows, cols).setBorder(true, true, true, true, null, null, clr, SpreadsheetApp.BorderStyle.SOLID);
}

function colorStatus_(cell, status) {
  if (status === 'Overweight') cell.setBackground('#fee2e2').setFontColor('#991b1b').setFontWeight('bold');
  else if (status === 'Underweight') cell.setBackground('#fef3c7').setFontColor('#92400e').setFontWeight('bold');
  else if (status === 'On target') cell.setBackground('#d1fae5').setFontColor('#065f46').setFontWeight('bold');
}

// ===================== MAIL SECTION =====================
function renderAdvisorHtml(res) {
  const ADVISOR = advisorConfig_();
  const td = 'padding:6px 8px;border-bottom:1px solid #eee;font-size:12px;';
  let html = '<div style="background:#0b1f3a;color:#fff;border-radius:10px;padding:12px 16px;margin:18px 0 10px">' +
    '<div style="font-size:17px;font-weight:bold">🧭 Advisor: this week</div>' +
    '<div style="font-size:11px;color:#c7d2fe">Your rules: top-up when NAV is ' + ADVISOR.MILD_DD + '% / ' + ADVISOR.STRONG_DD +
    '% below its 52W high, budget ' + inr(ADVISOR.TOPUP_BUDGET) + '/month</div></div>';

  res.owners.forEach(o => {
    const clr = groupStyle_(o).color;
    html += '<div style="font-size:14px;font-weight:bold;color:' + clr + ';margin:10px 0 6px">👨‍👩 ' + esc_(o.title) + ': ' + inr(o.total) + '</div>';

    // allocation bars
    html += '<table style="width:100%;border-collapse:collapse">';
    o.cats.forEach(c => {
      const sc = c.status === 'Overweight' ? '#b91c1c' : c.status === 'Underweight' ? '#b45309' : c.status === 'On target' ? '#047857' : '#6b7280';
      const w = Math.max(1, Math.round(Math.min(100, c.pct)));
      html += '<tr><td style="' + td + 'width:28%">' + c.cat + (c.funds.length > 1 ? ' <span style="color:#b91c1c;font-size:10px">(' + c.funds.length + ' funds)</span>' : '') + '</td>' +
        '<td style="' + td + '"><table style="width:100%;border-collapse:collapse"><tr>' +
        '<td style="width:' + w + '%;height:8px;background:' + clr + ';border-radius:4px"></td><td style="width:' + (100 - w) + '%"></td></tr></table></td>' +
        '<td style="' + td + 'width:22%;text-align:right"><b>' + c.pct.toFixed(0) + '%</b>' + (c.target !== null ? ' / ' + c.target + '%' : '') + '</td>' +
        '<td style="' + td + 'width:16%;text-align:right;color:' + sc + ';font-weight:bold">' + c.status + '</td></tr>';
    });
    html += '</table>';

    // overlap notes
    o.cats.filter(c => c.funds.length > 1).forEach(c => {
      html += '<div style="font-size:12px;background:#fff7ed;border-left:3px solid #f59e0b;padding:6px 8px;margin-top:6px">⚠️ <b>' + c.cat + '</b>: ' +
        c.funds.length + ' funds (' + c.funds.map(x => x.label).join(', ') + '). By rank <b>' + c.primary +
        '</b> scores best (3Y CAGR, consistency, smaller falls). One option: route new SIP/top-ups there and let existing money in the others stay invested.</div>';
    });

    // actions
    const acts = o.funds.filter(x => x.topup > 0);
    html += '<div style="font-size:12px;font-weight:bold;margin:10px 0 4px">💰 Top-up plan</div>';
    if (acts.length) {
      html += '<table style="width:100%;border-collapse:collapse">';
      acts.forEach(x => {
        html += '<tr><td style="' + td + '"><b>' + x.label + '</b><br><span style="color:#6b7280;font-size:11px">' + x.note + '</span></td>' +
          '<td style="' + td + 'text-align:right;white-space:nowrap"><span style="background:' + (x.signal === 'Strong top-up' ? '#d1fae5;color:#065f46' : '#fef3c7;color:#92400e') +
          ';border-radius:8px;padding:2px 6px;font-size:11px">' + x.signal + '</span><br><b>' + inr(x.topup) + '</b></td></tr>';
      });
      html += '<tr><td style="' + td + '"><b>Total</b></td><td style="' + td + 'text-align:right"><b>' + inr(o.topupUsed) + '</b> / ' + inr(o.topupBudget) + '</td></tr></table>';
    } else {
      html += '<div style="font-size:12px;color:#6b7280">No fund is more than ' + ADVISOR.MILD_DD + '% below its 52W high (or its category is overweight). Rules say: normal SIP only, keep the top-up budget.</div>';
    }
    const skipped = o.funds.filter(x => x.signal !== 'Normal SIP' && !x.eligible);
    if (skipped.length) html += '<div style="font-size:11px;color:#6b7280;margin-top:4px">Signal but skipped: ' +
      skipped.map(x => x.label + ' (' + x.note + ')').join('; ') + '</div>';
    if (o.ageRule) html += '<div style="font-size:11px;color:#374151;margin-top:6px">📐 Age thumb-rule (100 − age): ' +
      o.ageRule.map(a => a.who + ' ' + a.age + ' yrs → equity ~' + a.equity + '% (aggressive ' + a.aggressive + '%)').join(' | ') +
      '. Applies to total savings (FD/PF/EPF/MF), not just this MF portfolio.</div>';
  });

  html += '<p style="font-size:10px;color:#888;margin-top:10px">' + DISCLAIMER_TEXT + ' Change the rules in ⚙️ Settings.</p>';
  return html;
}
