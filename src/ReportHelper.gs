/**
 * ReportHelper.gs: one builder for weekly / monthly / custom-range reports.
 * start = last NAV before the period (previous close), end = last NAV in the period, both from the official
 * AMFI history (mfapi.in), plus the ₹ impact on your units.
 */

/** Holdings (columns A–H): open lots bought on or before endDate (lots sold later still count for past periods). */
function holdingsAsOf(sheet, endDate) {
  const last = lastDataRow(sheet);
  if (last < 2) return { units: 0, invested: 0 };
  return sheet.getRange(2, 1, last - 1, 8).getValues().reduce((h, r) => {
    const d = r[3] instanceof Date ? r[3] : null;
    if (!d || d > endDate || !String(r[4]).trim()) return h;
    if (String(r[4]).trim() === TXN.REDEMPTION && redeemedOn_(r[8]) && redeemedOn_(r[8]) <= endDate) return h;
    h.units += +r[7] || 0;
    h.invested += +r[5] || 0;
    return h;
  }, { units: 0, invested: 0 });
}

/**
 * Builds the report data.
 * @param {Date} start  first day of the period
 * @param {Date} end    last day of the period
 * @param {string[]=} tabs  only these fund tabs (default: all)
 */
function buildNavReport(start, end, tabs) {
  const ss = getBook();
  const s0 = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const e0 = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59);
  const rows = [], errors = [];

  getFunds(true).filter(f => !tabs || tabs.indexOf(f.tab) >= 0).forEach(f => {
    try {
      const hist = navHistory(f.code);
      const before = hist.filter(x => x.d < s0);
      const inRange = hist.filter(x => x.d >= s0 && x.d <= e0);
      if (!inRange.length) return;
      const startPt = before.length ? before[before.length - 1] : inRange[0];
      const endPt = inRange[inRange.length - 1];
      const hi = inRange.reduce((a, b) => (b.nav > a.nav ? b : a));
      const lo = inRange.reduce((a, b) => (b.nav < a.nav ? b : a));

      const sheet = ss.getSheetByName(f.tab);
      const h = sheet ? holdingsAsOf(sheet, e0) : { units: 0, invested: 0 };
      rows.push({
        name: shortFundName(f.tab), owner: f.owner || '–',
        startNav: startPt.nav, startDate: startPt.d,
        endNav: endPt.nav, endDate: endPt.d,
        chgPct: (endPt.nav - startPt.nav) / startPt.nav * 100,
        hi: hi, lo: lo,
        units: h.units, invested: h.invested,
        value: h.units * endPt.nav,
        periodRs: h.units * (endPt.nav - startPt.nav),
      });
    } catch (e) {
      errors.push(f.tab + ': ' + e.message);
    }
  });

  rows.sort((a, b) => b.chgPct - a.chgPct);
  // separate total per owner, like Master Data
  const owners = [];
  rows.forEach(r => { if (owners.indexOf(r.owner) < 0) owners.push(r.owner); });
  const totals = owners.map(o => {
    const held = rows.filter(r => r.owner === o && r.units > 0);
    const value = held.reduce((s, r) => s + r.value, 0);
    const invested = held.reduce((s, r) => s + r.invested, 0);
    const period = held.reduce((s, r) => s + r.periodRs, 0);
    return { owner: o, value: value, invested: invested, gain: value - invested, period: period,
             periodPct: value - period > 0 ? period / (value - period) * 100 : 0 };
  }).filter(t => t.value > 0);
  return { start: s0, end: end, rows: rows, errors: errors, totals: totals };
}

/** Mobile-friendly HTML (inline styles so Gmail renders it). */
function renderNavReportHtml(title, rep) {
  const up = v => v >= 0;
  const clr = v => (up(v) ? '#1a7f37' : '#cf222e');
  const arrow = v => (up(v) ? '▲' : '▼');
  const best = rep.rows[0], worst = rep.rows[rep.rows.length - 1];
  const td = 'padding:8px 10px;border-bottom:1px solid #eee;font-size:13px;';
  const multi = rep.totals.length > 1;

  let html =
    '<div style="font-family:Arial,sans-serif;max-width:680px;margin:auto;color:#222">' +
    '<h2 style="margin:0 0 4px">' + title + (setting('USER_NAME') ? ' · ' + esc_(setting('USER_NAME')) : '') + '</h2>' +
    '<div style="color:#666;font-size:13px;margin-bottom:14px">' + fmtD(rep.start) + ' → ' + fmtD(rep.end) + '</div>';

  rep.totals.forEach(t => {
    if (multi) html += '<div style="font-size:13px;font-weight:bold;margin:4px 0">👤 ' + t.owner + '</div>';
    html +=
      '<table style="width:100%;border-collapse:separate;border-spacing:8px 0;margin:0 -8px 14px"><tr>' +
      card('This period', '<span style="color:' + clr(t.period) + '">' + arrow(t.period) + ' ' + inr(t.period) + '</span>',
           '<span style="color:' + clr(t.period) + '">' + pct(t.periodPct) + '</span>') +
      card('Portfolio value', inr(t.value), 'Invested ' + inr(t.invested)) +
      card('Total gain', '<span style="color:' + clr(t.gain) + '">' + inr(t.gain) + '</span>',
           t.invested ? pct(t.gain / t.invested * 100) : '') +
      '</tr></table>';
  });
  if (best && worst && rep.rows.length > 1) {
    html += '<div style="font-size:13px;margin-bottom:12px">🏆 Best: <b>' + best.name + '</b> ' +
            '<span style="color:' + clr(best.chgPct) + '">' + pct(best.chgPct) + '</span> &nbsp;|&nbsp; ' +
            '🔻 Worst: <b>' + worst.name + '</b> <span style="color:' + clr(worst.chgPct) + '">' + pct(worst.chgPct) + '</span></div>';
  }

  html += '<table style="width:100%;border-collapse:collapse">' +
    '<tr style="background:#f6f8fa;text-align:left;font-size:12px;color:#555">' +
    '<th style="' + td + '">Fund</th><th style="' + td + '">NAV</th><th style="' + td + '">Change</th>' +
    '<th style="' + td + '">Your ₹ impact</th><th style="' + td + '">Range (Low – High)</th></tr>';
  rep.rows.forEach(r => {
    html += '<tr>' +
      '<td style="' + td + '"><b>' + r.name + '</b>' + (multi ? ' <span style="font-size:10px;color:#fff;background:#8b949e;border-radius:4px;padding:1px 4px">' + r.owner + '</span>' : '') + (r.units > 0 ? '<br><span style="color:#888;font-size:11px">Value ' + inr(r.value) + '</span>' : '') + '</td>' +
      '<td style="' + td + '">' + r.startNav.toFixed(2) + ' → <b>' + r.endNav.toFixed(2) + '</b></td>' +
      '<td style="' + td + 'color:' + clr(r.chgPct) + ';font-weight:bold">' + arrow(r.chgPct) + ' ' + pct(r.chgPct) + '</td>' +
      '<td style="' + td + 'color:' + clr(r.periodRs) + '">' + (r.units > 0 ? inr(r.periodRs) : '–') + '</td>' +
      '<td style="' + td + 'font-size:12px;color:#555">' + r.lo.nav.toFixed(2) + ' (' + fmtShort(r.lo.d) + ') – ' +
        r.hi.nav.toFixed(2) + ' (' + fmtShort(r.hi.d) + ')</td>' +
      '</tr>';
  });
  html += '</table>';

  html += '<p style="font-size:11px;color:#888;margin-top:12px">Change = last NAV before the period → last NAV of the period. ' +
          '"Your ₹ impact" = your units × NAV change (new SIPs inside the period are not included). NAV source: AMFI via mfapi.in.</p>' +
          '<p style="font-size:10px;color:#888">' + DISCLAIMER_TEXT + '</p>';
  if (rep.errors.length) html += '<p style="font-size:11px;color:#cf222e">⚠️ Data nahi mila: ' + rep.errors.join('; ') + '</p>';
  return html + '</div>';

  function card(label, big, small) {
    return '<td style="background:#f6f8fa;border-radius:8px;padding:10px;width:33%;vertical-align:top">' +
      '<div style="font-size:11px;color:#666">' + label + '</div>' +
      '<div style="font-size:17px;font-weight:bold;margin:2px 0">' + big + '</div>' +
      '<div style="font-size:11px;color:#666">' + small + '</div></td>';
  }
}

/** Build + mail. to = comma-separated emails. */
function sendNavReport(title, start, end, to, tabs, withAdvisor) {
  const rep = buildNavReport(start, end, tabs);
  if (!rep.rows.length) throw new Error('No NAV data in this date range.');
  let html = renderNavReportHtml(title, rep);
  if (withAdvisor) {
    try { html = html.replace(/<\/div>$/, renderAdvisorHtml(runAdvisor()) + '</div>'); }
    catch (e) { notifyError('Advisor', e); }
  }
  const subj = title + ' (' + fmtD(start) + ' – ' + fmtD(end) + ')' +
               rep.totals.map(t => ' | ' + (rep.totals.length > 1 ? t.owner + ' ' : '') + (t.period >= 0 ? '▲ ' : '▼ ') + inr(t.period)).join('');
  MailApp.sendEmail({ to: to, subject: subj, htmlBody: html });
  return html;
}


/** "Redeemed 12 Nov 2026 @ …" note in column I → Date. */
function redeemedOn_(note) {
  const m = String(note || '').match(/Redeemed (\d{1,2} \w{3} \d{4})/);
  return m ? parseDateLoose(m[1]) : null;
}
