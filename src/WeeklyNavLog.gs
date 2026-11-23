/**
 * WeeklyNavLog.gs: the per-fund "Weekly NAV Update Log" mail (Settings → WEEKLY_NAV_LOG = Yes, Saturdays).
 * One card per fund: NAV, 52-week range bar, and the % change on each purchase from the last 3 months.
 */
function sendWeeklyNavLog() {
  const ss = getBook();
  let body = createEmailHeader();
  let cards = 0;
  getFunds().forEach(f => {
    const sh = ss.getSheetByName(f.tab);
    if (!sh) return;
    try {
      const h = navHistory(f.code);
      if (!h.length) return;
      const cur = h[h.length - 1], r = high52Low52(f.code);
      body = appendEmailRow(body, f.tab, cur.nav, r.hi, r.lo, prettifyJSON(lastThreeMonthsBuys_(sh), cur.nav), new Date(), fmtD(cur.d));
      cards++;
    } catch (e) { console.warn(f.tab + ': ' + e.message); }
  });
  if (!cards) return;
  const w = getFormattedMondayAndFriday(), range = w.formattedMonday + ' – ' + w.formattedFriday;
  body = body.replace('__DATE_RANGE__', 'Monday – Friday: ' + range) +
    '<p style="font-size:11px;color:#888;margin-top:10px">Black line = today\'s NAV between the 52-week low (left) and high (right). ' +
    '"Since" = % change from that month\'s buy NAV. NAV source: AMFI via mfapi.in.</p>' +
    '<p style="font-size:10px;color:#888">' + DISCLAIMER_TEXT + '</p></div>';
  MailApp.sendEmail({ to: getRecipients('REPORT_EMAILS'), subject: '📈 Weekly NAV Update Log (' + range + ')', htmlBody: body });
}

/** JSON string [{"Month-year": "Oct-26", "Buying Nav At": 123.4}] of open lots bought in the last 3 months. */
function lastThreeMonthsBuys_(sh) {
  const last = lastDataRow(sh);
  if (last < 2) return '[]';
  const cut = new Date(); cut.setMonth(cut.getMonth() - 3);
  return JSON.stringify(sh.getRange(2, 1, last - 1, COL.NAV).getValues()
    .filter(r => r[COL.DATE - 1] instanceof Date && r[COL.DATE - 1] >= cut && String(r[COL.TYPE - 1]).trim() !== TXN.REDEMPTION)
    .map(r => ({ 'Month-year': Utilities.formatDate(r[COL.DATE - 1], tz_(), 'MMM-yy'), 'Buying Nav At': r[COL.NAV - 1] })));
}

function createEmailHeader() {
  return '<div style="font-family:Arial,sans-serif;max-width:680px;margin:auto;color:#222">' +
    '<div style="background:#0b1f3a;color:#fff;border-radius:10px;padding:16px 18px;margin-bottom:14px">' +
      '<div style="font-size:20px;font-weight:bold">📈 Weekly NAV Update Log</div>' +
      '<div style="font-size:12px;color:#c7d2fe;margin-top:4px">__DATE_RANGE__</div>' +
    '</div>' +
    '<div style="font-size:12px;color:#555;margin:0 2px 12px">Each fund: today\'s NAV, where it sits in its 52-week range, ' +
    'and how your purchases of the last 3 months are doing.</div>';
}

function appendEmailRow(emailBody, sheetName, currentNAV, highNAV, lowNAV, prettifiedJSON, currentDate, updatedDate) {
  const cur = +currentNAV, hi = +highNAV, lo = +lowNAV;
  const fund = getFundByTab(sheetName) || {};
  const owner = fund.owner || '';
  const ownerClr = ownerStyle(owner).color;
  const pos = hi > lo ? Math.max(0, Math.min(100, (cur - lo) / (hi - lo) * 100)) : 50;
  const fromHigh = hi ? (cur - hi) / hi * 100 : 0;
  const fromLow = lo ? (cur - lo) / lo * 100 : 0;
  const zone = pos >= 80 ? ['#d1fae5', '#065f46', 'Near high']
             : pos <= 25 ? ['#fee2e2', '#991b1b', 'Near low']
             : ['#fef3c7', '#92400e', 'Mid-range'];
  const left = Math.round(pos), right = 100 - left;

  emailBody +=
    '<div style="border:1px solid #e5e7eb;border-left:4px solid ' + ownerClr + ';border-radius:10px;padding:12px 14px;margin-bottom:12px">' +
      '<table style="width:100%;border-collapse:collapse"><tr>' +
        '<td style="font-size:14px;font-weight:bold">' + esc_(shortFundName(sheetName)) +
          ' <span style="font-size:10px;color:#fff;background:' + ownerClr + ';border-radius:4px;padding:1px 5px;vertical-align:middle">' + esc_(owner) + '</span></td>' +
        '<td style="text-align:right;font-size:11px;color:#888">NAV date: ' + updatedDate + '</td>' +
      '</tr></table>' +
      '<table style="width:100%;border-collapse:collapse;margin-top:6px"><tr>' +
        '<td style="font-size:22px;font-weight:bold;color:' + ownerClr + '">₹' + cur.toFixed(2) + '</td>' +
        '<td style="text-align:right"><span style="background:' + zone[0] + ';color:' + zone[1] + ';font-size:11px;font-weight:bold;border-radius:10px;padding:3px 8px">' + zone[2] + '</span></td>' +
      '</tr></table>' +
      '<div style="font-size:11px;color:#666;margin-top:8px">52-week range</div>' +
      '<table style="width:100%;border-collapse:collapse;margin-top:3px"><tr>' +
        (left > 0 ? '<td style="width:' + left + '%;height:8px;background:' + ownerClr + ';border-radius:4px 0 0 4px"></td>' : '') +
        '<td style="width:2px;height:12px;background:#111"></td>' +
        (right > 0 ? '<td style="width:' + right + '%;height:8px;background:#e5e7eb;border-radius:0 4px 4px 0"></td>' : '') +
      '</tr></table>' +
      '<table style="width:100%;border-collapse:collapse;font-size:11px;color:#555;margin-top:2px"><tr>' +
        '<td>Low ₹' + lo.toFixed(2) + ' <span style="color:#047857">(' + pct(fromLow) + ' above)</span></td>' +
        '<td style="text-align:right">High ₹' + hi.toFixed(2) + ' <span style="color:' + (fromHigh < 0 ? '#b91c1c' : '#047857') + '">(' + pct(fromHigh) + ')</span></td>' +
      '</tr></table>';
  emailBody += '<div style="font-size:12px;font-weight:bold;margin:10px 0 4px">🛒 Purchases in the last 3 months</div>';
  if (prettifiedJSON && prettifiedJSON.trim()) {
    emailBody +=
      '<table style="width:100%;border-collapse:collapse;font-size:12px">' +
        '<tr style="background:#f6f8fa;color:#555"><th style="text-align:left;padding:5px 8px">Month</th>' +
        '<th style="text-align:right;padding:5px 8px">Buy NAV</th><th style="text-align:right;padding:5px 8px">Since</th></tr>' +
        prettifiedJSON +
      '</table>';
  } else {
    emailBody += '<div style="font-size:12px;color:#888">No purchases in this period.</div>';
  }
  return emailBody + '</div>';
}

function prettifyJSON(jsonData, currentNAV) {
  let data;
  try { data = JSON.parse(jsonData) || []; } catch (e) { return ''; }
  return data.map((d, i) => {
    const buy = parseFloat(d['Buying Nav At']);
    if (!buy) return '';
    const ch = (currentNAV - buy) / buy * 100;
    const up = ch >= 0;
    return '<tr style="background:' + (i % 2 ? '#fff' : '#fafafa') + '">' +
      '<td style="padding:5px 8px">' + d['Month-year'] + '</td>' +
      '<td style="padding:5px 8px;text-align:right">₹' + buy.toFixed(2) + '</td>' +
      '<td style="padding:5px 8px;text-align:right;font-weight:bold;color:' + (up ? '#047857' : '#b91c1c') + '">' +
        (up ? '▲ ' : '▼ ') + pct(ch) + '</td></tr>';
  }).join('');
}

