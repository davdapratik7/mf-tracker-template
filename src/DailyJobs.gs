/**
 * DailyJobs.gs: what the daily trigger runs.
 *   dailyJob()          → updateCurrentNAV → 52W high/low → Daily Log snapshot → scheduled mails
 *   updateCurrentNAV()  → column J of every open lot (Redemption rows stay frozen)
 *   logDailyData()      → one row per owner in "Daily Log", only on days with a new NAV
 */
function dailyJob() {
  resetCaches_();
  try { updateCurrentNAV(); } catch (e) { notifyError('updateCurrentNAV', e); }
  try { update52Week_(); } catch (e) { notifyError('update52Week', e); }
  try { logDailyData(); } catch (e) { notifyError('logDailyData', e); }
  const today = new Date();
  if (today.getDay() === 6) {                       // Saturday
    if (settingYes('WEEKLY_REPORT')) sendWeeklyReport();
    if (settingYes('WEEKLY_NAV_LOG')) { try { sendWeeklyNavLog(); } catch (e) { notifyError('sendWeeklyNavLog', e); } }
  }
  if (today.getDate() === 1 && settingYes('MONTHLY_REPORT')) sendLastMonthReport();
}

function updateCurrentNAV() {
  const ss = getBook();
  const logSheet = ss.getSheetByName(TABS.NAV_LOG);
  const logData = [], failed = [];

  getFunds().forEach(fund => {
    const sheet = ss.getSheetByName(fund.tab);
    if (!sheet) return;
    try {
      const latest = latestNav(fund.code);
      if (!(latest.nav > 0)) throw new Error('NAV missing');
      const last = lastDataRow(sheet);
      if (last < 2) return;
      const n = last - 1;
      const types = sheet.getRange(2, COL.TYPE, n, 1).getValues();
      const navCol = sheet.getRange(2, COL.CURNAV, n, 1).getValues();
      let previous = null, changed = 0;
      const updated = navCol.map((r, i) => {
        if (String(types[i][0]).trim() === TXN.REDEMPTION || !String(types[i][0]).trim()) return [r[0]];
        if (parseFloat(r[0]) !== latest.nav) { if (previous === null) previous = parseFloat(r[0]); changed++; return [latest.nav]; }
        return [r[0]];
      });
      if (changed) {
        sheet.getRange(2, COL.CURNAV, n, 1).setValues(updated);
        logData.push([new Date(), latest.date, fund.tab, changed, previous, latest.nav]);
      }
    } catch (e) { failed.push(fund.tab + ' → ' + e.message); }
  });

  if (logData.length && logSheet) logSheet.getRange(logSheet.getLastRow() + 1, 1, logData.length, logData[0].length).setValues(logData);
  if (failed.length) notifyError('updateCurrentNAV', failed.join('\n'));
}

/** Snapshot per owner (computed from the fund tabs, independent of the Master Data layout). */
function logDailyData() {
  const funds = getFunds(true);
  if (!funds.length) return;
  const navDate = latestNav(funds[0].code).date;
  const key = Utilities.formatDate(navDate, tz_(), 'yyyy-MM-dd');
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('LAST_DAILY_LOG_NAV_DATE') === key) return;   // holiday / weekend: no new NAV

  const ss = getBook();
  const rows = ownerTotals_().map(t => [navDate, t.owner, t.invested, t.value,
    t.invested ? round2_((t.value - t.invested) / t.invested * 100) : 0, t.xirr, t.st, t.lt, round2_(t.st + t.lt)]);
  const log = ss.getSheetByName(TABS.DAILY_LOG);
  if (rows.length && log) log.getRange(log.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  props.setProperty('LAST_DAILY_LOG_NAV_DATE', key);
}

/** [{owner, invested, value, st, lt, xirr}] from each fund tab's summary block. */
function ownerTotals_() {
  const ss = getBook();
  const acc = {};
  getFunds(true).forEach(f => {
    const sh = ss.getSheetByName(f.tab);
    if (!sh) return;
    const s = sh.getRange('S2:S20').getValues().map(r => +r[0] || 0);   // index = row − 2
    const a = acc[f.owner] = acc[f.owner] || { owner: f.owner, invested: 0, value: 0, st: 0, lt: 0, xw: 0 };
    a.invested += s[10]; a.value += s[12]; a.st += s[6]; a.lt += s[8]; a.xw += s[4] * s[10];
  });
  return Object.keys(acc).map(k => {
    const a = acc[k];
    return { owner: a.owner, invested: round2_(a.invested), value: round2_(a.value), st: round2_(a.st), lt: round2_(a.lt),
             xirr: a.invested ? round2_(a.xw / a.invested) : 0 };
  });
}
