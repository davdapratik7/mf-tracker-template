/** Reports.gs: scheduled reports + backends for the three report dialogs. */

function sendWeeklyReport() {
  try {
    const today = new Date();
    sendNavReport('📊 Weekly MF Report', getMonday(today), today, getRecipients('REPORT_EMAILS'), null, settingYes('ADVISOR_IN_REPORT'));
  } catch (e) { notifyError('sendWeeklyReport', e); }
}

function sendLastMonthReport() {
  try {
    const t = new Date();
    const start = new Date(t.getFullYear(), t.getMonth() - 1, 1), end = new Date(t.getFullYear(), t.getMonth(), 0);
    sendNavReport('📅 Monthly MF Report', start, end, getRecipients('REPORT_EMAILS'), null, false);
  } catch (e) { notifyError('sendLastMonthReport', e); }
}

/** Editor/menu: last 7 days report to ALERT_EMAIL (test). */
function sendTestReportToMe() {
  const end = new Date();
  const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 6);
  sendNavReport('🧪 Test MF Report', start, end, getRecipients('ALERT_EMAIL'), null, true);
  toast_('Test report sent to ' + getRecipients('ALERT_EMAIL'));
}

// ===================== dialogs =====================
function showDialog_(file, title, w, h, vars) {
  const t = HtmlService.createTemplateFromFile(file);
  t.defaultEmail = getRecipients('REPORT_EMAILS').split(',')[0];
  Object.keys(vars || {}).forEach(k => { t[k] = vars[k]; });
  SpreadsheetApp.getUi().showModalDialog(t.evaluate().setWidth(w).setHeight(h), title);
}
function showWeekSelectionDialog() { showDialog_('WeeklyForm', 'Send weekly report', 900, 500); }
function showMonthSelectionDialog() { showDialog_('MonthlyForm', 'Send monthly report', 900, 500); }
function showCustomReportDialog() { showDialog_('CustomReportForm', 'Custom report', 1024, 900, { fundsList: getFunds(true).map(f => f.tab) }); }

/** Weeks / months that have NAV data in the NAV log (or, for a new sheet, the last 12 weeks). */
function navLogDates_() {
  const sh = getBook().getSheetByName(TABS.NAV_LOG);
  const out = [];
  if (sh && sh.getLastRow() > 1) sh.getRange(2, 2, sh.getLastRow() - 1, 1).getValues()
    .forEach(r => { const d = r[0] instanceof Date ? r[0] : parseDateLoose(r[0]); if (d) out.push(d); });
  if (!out.length) for (let i = 0; i < 84; i += 7) { const d = new Date(); d.setDate(d.getDate() - i); out.push(d); }
  return out;
}

function getAvailableWeekRanges() {
  const weeks = {};
  navLogDates_().forEach(d => { const m = getMonday(d); weeks[m.getTime()] = m; });
  return Object.keys(weeks).map(k => weeks[k]).sort((a, b) => b - a).map(m => {
    const fri = new Date(m.getFullYear(), m.getMonth(), m.getDate() + 4);
    return Utilities.formatDate(m, tz_(), 'dd-MMM-yyyy') + ' to ' + Utilities.formatDate(fri, tz_(), 'dd-MMM-yyyy');
  });
}

function sendWeeklyNAVSummary1(formData) {
  try {
    const start = parseDateLoose(formData.startDate);
    if (!start) throw new Error('Pick a week');
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 4);
    const html = sendNavReport('📊 Weekly MF Report', start, end, formData.email);
    return { success: true, message: 'Email sent ✅', htmlBody: html };
  } catch (e) { return { success: false, message: 'Error: ' + e.message }; }
}

function getAvailableMonthRanges() {
  const months = {};
  navLogDates_().forEach(d => {
    const first = new Date(d.getFullYear(), d.getMonth(), 1);
    months[Utilities.formatDate(first, tz_(), 'MMMM yyyy')] = Utilities.formatDate(first, tz_(), 'yyyy-MM-dd');
  });
  return Object.keys(months).map(k => ({ display: k, value: months[k] })).sort((a, b) => (a.value < b.value ? 1 : -1));
}

function sendMonthlyNAVSummary(formData) {
  try {
    const start = parseDateLoose(formData.startDate);
    if (!start) throw new Error('Pick a month');
    const monthEnd = new Date(start.getFullYear(), start.getMonth() + 1, 0);
    const html = sendNavReport('📅 Monthly MF Report', start, monthEnd > new Date() ? new Date() : monthEnd, formData.email);
    return { success: true, message: 'Email sent ✅', htmlBody: html };
  } catch (e) { return { success: false, message: 'Error: ' + e.message }; }
}

/** data = {dateRange: 'YYYY-MM-DD - YYYY-MM-DD', funds: [tabs], emails: [..]} */
function processSelectedDateData(data) {
  try {
    const parts = String(data.dateRange || '').split(' - ');
    const start = parseDateLoose(parts[0]), end = parseDateLoose(parts[1] || parts[0]);
    if (!start || !end) throw new Error('Invalid date range');
    const emails = (data.emails || []).filter(e => e && e.indexOf('@') > 0).join(',');
    if (!emails) throw new Error('Enter at least one email');
    sendNavReport('📈 MF Report', start, end, emails, data.funds && data.funds.length ? data.funds : null);
    return { success: true, message: 'Email sent ✅' };
  } catch (e) { return { success: false, message: 'Error: ' + e.message }; }
}
