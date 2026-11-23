/**
 * Setup.gs: Setup Wizard backend, menu and triggers.
 * The wizard (Setup.html) collects profile, owners, funds, targets and rules, then saveSetup() builds everything.
 * It can be re-run at any time: it updates settings and adds new funds, and never deletes data.
 */

// ===================== menu =====================
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  const m = ui.createMenu('📈 MF Tracker');
  let done = false;
  try { done = !!String(setting('SETUP_DONE') || '').trim(); } catch (e) { done = false; }
  m.addItem('🧙 Setup Wizard', 'showSetupWizard');
  if (done) {
    m.addSeparator()
      .addItem('➕ Add transaction', 'showEntryForm')
      .addItem('📥 Import CSV / CAS', 'showImportDialog')
      .addItem('⚙️ Process Import tab', 'processImportTab')
      .addSeparator()
      .addItem('🔄 Update NAV now', 'menuUpdateNav')
      .addItem('🔁 Rebuild dashboard', 'rebuildAll')
      .addItem('🧭 Run Advisor', 'runAdvisor')
      .addSeparator()
      .addSubMenu(ui.createMenu('✉️ Reports')
        .addItem('Weekly report…', 'showWeekSelectionDialog')
        .addItem('Monthly report…', 'showMonthSelectionDialog')
        .addItem('Custom range…', 'showCustomReportDialog')
        .addItem('Send test report to me', 'sendTestReportToMe')
        .addItem('Send Advisor mail to me', 'sendAdvisorTestToMe'))
      .addSubMenu(ui.createMenu('🛠️ Maintenance')
        .addItem('Re-install triggers', 'menuInstallTriggers')
        .addItem('Run Gmail auto-entry now', 'runAutoTransactions')
        .addItem('Remove all triggers', 'removeTriggers'));
  }
  m.addToUi();
}

function menuUpdateNav() { updateCurrentNAV(); update52Week_(); toast_('NAV updated ✅'); }
function menuInstallTriggers() { installTriggers(); toast_('Triggers installed ✅'); }

// ===================== triggers =====================
const TRIGGER_HANDLERS = ['dailyJob', 'runAutoTransactions'];

function installTriggers() {
  removeTriggers(true);
  ScriptApp.newTrigger('dailyJob').timeBased().everyDays(1).atHour(7).create();          // NAV of the previous day is out by then
  if (String(setting('GMAIL_PARSERS') || '').trim() && typeof runAutoTransactions === 'function') {
    ScriptApp.newTrigger('runAutoTransactions').timeBased().everyDays(1).atHour(22).create();
  }
}

function removeTriggers(silent) {
  ScriptApp.getProjectTriggers().filter(t => TRIGGER_HANDLERS.indexOf(t.getHandlerFunction()) >= 0)
    .forEach(t => ScriptApp.deleteTrigger(t));
  if (silent !== true) toast_('Triggers removed');
}

// ===================== wizard =====================
function showSetupWizard() {
  const html = HtmlService.createTemplateFromFile('Setup').evaluate().setWidth(960).setHeight(680);
  SpreadsheetApp.getUi().showModalDialog(html, 'MF Tracker: Setup Wizard');
}

/** Everything the wizard needs to pre-fill itself (works on first run and on re-runs). */
function getSetupState() {
  const ss = getBook();
  const hasSettings = !!ss.getSheetByName(TABS.SETTINGS);
  const s = hasSettings ? getSettings() : {};
  const me = Session.getEffectiveUser().getEmail();
  const val = k => (k in s && s[k] !== '' ? s[k] : SETTING_DEFAULTS[k][0]);
  const settings = {};
  Object.keys(SETTING_DEFAULTS).forEach(k => { settings[k] = val(k); });
  if (!settings.ALERT_EMAIL) settings.ALERT_EMAIL = me;
  if (!settings.REPORT_EMAILS) settings.REPORT_EMAILS = me;
  return {
    settings: settings,
    targets: hasSettings ? s.TARGETS : {},
    owners: ss.getSheetByName(TABS.OWNERS) ? getOwners().map(o => ({ name: o.name, holder: o.holder, birthYear: o.birthYear || '' })) : [],
    funds: ss.getSheetByName(TABS.FUNDS) ? getFunds(true).map(f => ({ tab: f.tab, code: f.code, name: f.scheme, owner: f.owner, cat: f.cat, elss: f.elss, existing: true, active: f.active })) : [],
    categories: CATEGORIES, presets: TARGET_PRESETS, parsers: typeof PARSERS === 'undefined' ? [] : Object.keys(PARSERS),
    disclaimer: DISCLAIMER_TEXT,
  };
}

/**
 * payload = {settings:{…}, targets:{cat: pct}, owners:[{name, holder, birthYear}],
 *            funds:[{code, name, owner, cat, elss, existing, tab, active, amc, match}]}
 */
function saveSetup(payload) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    validateSetup_(payload);
    rememberBook_();
    resetCaches_();
    ensureSystemTabs_();

    const values = Object.assign({}, payload.settings, { DISCLAIMER_ACCEPTED: Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm') });
    saveSettings(values, payload.targets || {});
    writeOwners_(payload.owners);

    const multi = payload.owners.length > 1;
    const funds = payload.funds.map(f => {
      if (f.existing) {
        const cur = getFundByTab(f.tab);
        return Object.assign({}, cur, { owner: f.owner, cat: f.cat, elss: !!f.elss, active: f.active !== false,
                                        match: cur.match ? cur.match.source : '' });
      }
      return { tab: tabNameFor_(f.name, f.owner, multi), code: String(f.code), scheme: f.name, owner: f.owner,
               cat: f.cat, elss: !!f.elss, match: f.match || matchRegexFor(f.name), amc: f.amc || '', active: true };
    });
    upsertFunds_(funds);
    resetCaches_();
    getFunds(true).forEach(f => buildFundTab(f));
    update52Week_();
    buildMasterData();
    if (getFunds().length) { try { runAdvisor(); } catch (e) { console.warn('Advisor: ' + e.message); } }

    saveSettings({ SETUP_DONE: Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd') });
    installTriggers();
    cleanupDefaultSheet_();
    onOpen();
    return '✅ Setup complete: ' + payload.owners.length + ' owner(s), ' + getFunds(true).length + ' fund tab(s). ' +
           'Add your past transactions with ➕ Add transaction or 📥 Import.';
  } finally { lock.releaseLock(); }
}

function validateSetup_(p) {
  if (!p || !p.settings) throw new Error('Nothing to save');
  if (!p.disclaimerAccepted) throw new Error('Please accept the disclaimer first');
  if (!p.owners || !p.owners.length) throw new Error('Add at least one owner');
  const names = {};
  p.owners.forEach(o => {
    o.name = String(o.name || '').trim();
    if (!o.name) throw new Error('Owner name cannot be empty');
    if (/[\[\]'"]/.test(o.name)) throw new Error('Owner name cannot contain [ ] \' or "');
    if (names[o.name.toLowerCase()]) throw new Error('Duplicate owner: ' + o.name);
    names[o.name.toLowerCase()] = 1;
  });
  (p.funds || []).forEach(f => { if (!names[String(f.owner).toLowerCase()]) throw new Error('Fund ' + f.name + ' has an unknown owner'); });
  const sum = Object.keys(p.targets || {}).reduce((a, k) => a + (+p.targets[k] || 0), 0);
  if (sum && Math.abs(sum - 100) > 0.5) throw new Error('Target allocation adds up to ' + sum + '%, it must be 100%');
  const mail = String(p.settings.ALERT_EMAIL || '');
  if (mail && mail.indexOf('@') < 0) throw new Error('Alert email looks wrong');
}

/** Remove the empty default "Sheet1" that a new spreadsheet comes with. */
function cleanupDefaultSheet_() {
  const ss = getBook();
  ['Sheet1', 'Sheet 1'].forEach(n => {
    const sh = ss.getSheetByName(n);
    if (sh && sh.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(sh);
  });
}
