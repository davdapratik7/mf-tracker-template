/**
 * Builder.gs: creates tabs from the configuration, so no tab name is hard-coded anywhere.
 *   buildFundTab(fund)  one tab per fund holding: lots in A–J, ARRAYFORMULAs in K–P, summary in R/S
 *   buildMasterData()   owner-wise dashboard + projection, regenerated from the Funds list
 *   rebuildAll()        menu "Rebuild dashboard": missing fund tabs + Master Data + 52W values
 */

// ===================== system tabs =====================
function ensureSystemTabs_() {
  const ss = getBook();
  const mk = (name, headers, widths) => {
    let sh = ss.getSheetByName(name);
    if (!sh) {
      sh = ss.insertSheet(name, ss.getSheets().length);
      if (headers) {
        sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold')
          .setBackground('#0b1f3a').setFontColor('#ffffff');
        sh.setFrozenRows(1);
        (widths || []).forEach((w, i) => sh.setColumnWidth(i + 1, w));
      }
    }
    return sh;
  };
  mk(TABS.OWNERS, ['Owner name', 'Holder name (as printed on mails / CAS)', 'Birth year (optional)'], [160, 320, 150]);
  mk(TABS.FUNDS, FUND_HEADERS, [300, 90, 300, 110, 120, 100, 220, 110, 100]);
  mk(TABS.IMPORT, IMPORT_HEADERS, [100, 280, 110, 110, 100, 100, 100, 120, 320]);
  mk(TABS.NAV_LOG, ['Run at', 'NAV date', 'Fund tab', 'Rows', 'Previous NAV', 'New NAV'], [150, 100, 300, 70, 100, 100]);
  mk(TABS.DAILY_LOG, ['Date', 'Owner', 'Invested', 'Current value', 'Abs return %', 'XIRR %', 'ST gain', 'LT gain', 'Total gain'], [110, 120]);
  mk(TABS.TXN_LOG, ['Processed at', 'Mail / key ID', 'Txn date', 'Type', 'Fund tab', 'Folio', 'Amount', 'NAV', 'Units', 'Note'], [150, 200]);
  buildReadMeTab_();
}

function buildReadMeTab_() {
  const ss = getBook();
  const sh = ss.getSheetByName(TABS.ABOUT) || ss.insertSheet(TABS.ABOUT, 0);
  sh.clear();
  const lines = [
    ['📘 MF Portfolio Tracker: Read Me'],
    [''],
    ['⚠️ Disclaimer'],
    [DISCLAIMER_TEXT],
    [''],
    ['How it works'],
    ['• Every fund you hold has its own tab. Each row is one purchase lot (SIP / lump sum). Redemptions use FIFO and mark the oldest lots as "Redemption".'],
    ['• NAVs update daily from AMFI (mfapi.in). ELSS lots are locked for 3 years. STCG/LTCG use 365 days (equity); Debt category is always short-term.'],
    ['• Master Data = owner-wise dashboard + projection. Advisor = rule-based allocation / overlap / dip top-up calculator.'],
    [''],
    ['Adding transactions'],
    ['1. Menu → MF Tracker → ➕ Add transaction (manual form), or'],
    ['2. Fill the "Import" tab (or paste a casparser CSV through Menu → 📥 Import), then Menu → Process Import tab, or'],
    ['3. Enable a Gmail parser in ⚙️ Settings → GMAIL_PARSERS (see docs/GMAIL_PARSERS.md on GitHub).'],
    [''],
    ['Changing things'],
    ['• Settings: ⚙️ Settings tab (emails, budget, targets…). Owners: Owners tab. Funds: run the Setup Wizard again, or add a row in Funds and then Menu → 🔁 Rebuild dashboard.'],
    ['• Do not rename fund tabs by hand. Change the name in the Funds tab and rebuild instead.'],
  ];
  sh.getRange(1, 1, lines.length, 1).setValues(lines).setWrap(true).setVerticalAlignment('top');
  sh.setColumnWidth(1, 900);
  sh.getRange('A1').setFontSize(16).setFontWeight('bold');
  [3, 6, 11, 16].forEach(r => sh.getRange(r, 1).setFontWeight('bold').setFontSize(12));
  sh.getRange('A4').setBackground('#fff7ed').setFontColor('#9a3412');
  sh.setHiddenGridlines(true);
}

// ===================== owners / funds tables =====================
/** owners = [{name, holder, birthYear}] */
function writeOwners_(owners) {
  const sh = getBook().getSheetByName(TABS.OWNERS);
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 3).clearContent();
  if (owners.length) sh.getRange(2, 1, owners.length, 3)
    .setValues(owners.map(o => [o.name, String(o.holder || '').toUpperCase(), o.birthYear || '']));
  _ownersCache = null;
}

/** funds = [{tab, code, scheme, owner, cat, elss, match, amc, active}]. Existing rows (same tab) are updated, others kept. */
function upsertFunds_(funds) {
  const sh = getBook().getSheetByName(TABS.FUNDS);
  const n = Math.max(0, sh.getLastRow() - 1);
  const rows = n ? sh.getRange(2, 1, n, FUND_HEADERS.length).getValues() : [];
  funds.forEach(f => {
    const row = [f.tab, f.code, f.scheme || f.tab, f.owner, f.cat || 'Other', f.elss ? 'Yes' : 'No',
                 f.match || matchRegexFor(f.scheme || f.tab), f.amc || '', f.active === false ? 'No' : 'Yes'];
    const i = rows.findIndex(r => String(r[0]).trim() === f.tab);
    if (i >= 0) rows[i] = row; else rows.push(row);
  });
  if (rows.length) sh.getRange(2, 1, rows.length, FUND_HEADERS.length).setValues(rows);
  sh.getRange(2, 2, Math.max(1, rows.length), 1).setNumberFormat('0');
  _fundsCache = null;
}

/** Unique tab name for a scheme + owner (same scheme held by two people → two tabs). */
function tabNameFor_(schemeName, owner, multiOwner) {
  const base = safeTabName(schemeName);
  return multiOwner ? safeTabName(base.slice(0, 80) + ' [' + owner + ']') : base;
}

// ===================== fund tab =====================
function buildFundTab(fund) {
  const ss = getBook();
  let sh = ss.getSheetByName(fund.tab);
  const isNew = !sh;
  if (isNew) sh = ss.insertSheet(fund.tab, ss.getSheets().length);

  // Header A–J literal, K–P self-filling ARRAYFORMULAs (no per-row formulas to copy)
  sh.getRange(1, 1, 1, LOT_COLS).setValues([['Scheme', 'Folio No', 'Category', 'Tran Date', 'Tran Type',
    'Pur Amt', 'Pur NAV', 'Units', 'Source / Note', 'Curr NAV']]);
  const debt = fund.cat === 'Debt' ? 'TRUE' : 'FALSE';
  sh.getRange(1, 11, 1, 6).setFormulas([[
    '={"Curr Amt";ARRAYFORMULA(IF(H2:H="",,ROUND(H2:H*J2:J,2)))}',
    '={"Days";ARRAYFORMULA(IF(D2:D="",,TODAY()-INT(D2:D)))}',
    '={"GL ST";ARRAYFORMULA(IF((H2:H="")+(E2:E="' + TXN.REDEMPTION + '"),,IF(' + debt + '+(L2:L<=365),K2:K-F2:F,0)))}',
    '={"GL LT";ARRAYFORMULA(IF((H2:H="")+(E2:E="' + TXN.REDEMPTION + '"),,IF(' + debt + ',0,IF(L2:L>365,K2:K-F2:F,0))))}',
    '={"Ret ABS %";ARRAYFORMULA(IF((H2:H="")+(F2:F=0),,ROUND((K2:K-F2:F)/F2:F*100,2)))}',
    '={"Ret CAGR %";ARRAYFORMULA(IF((H2:H="")+(F2:F=0),,IF(L2:L<365,ROUND((K2:K-F2:F)/F2:F*100,2),ROUND(((K2:K/F2:F)^(365/L2:L)-1)*100,2))))}',
  ]]);

  // Summary block (open lots only; redemptions are reported as realised P&L)
  const R = TXN.REDEMPTION;
  const open = 'E2:E,"<>' + R + '",H2:H,"<>"';
  const block = [
    ['52W High NAV', ''], ['52W Low NAV', ''],
    ['Abs return % (open)', '=IFERROR(ROUND((S14-S12)/S12*100,2),0)'], ['', ''],
    ['XIRR % (open)', '=IFERROR(ROUND(XIRR({FILTER(-F2:F,E2:E<>"' + R + '",H2:H<>"");S14},{FILTER(D2:D,E2:E<>"' + R + '",H2:H<>"");TODAY()})*100,2),0)'], ['', ''],
    ['Unrealised ST gain', '=SUM(M2:M)'], ['', ''],
    ['Unrealised LT gain', '=SUM(N2:N)'], ['', ''],
    ['Invested (open)', '=SUMIFS(F2:F,' + open + ')'], ['', ''],
    ['Current value', '=SUMIFS(K2:K,' + open + ')'], ['', ''],
    ['Unrealised P&L', '=S14-S12'], ['', ''],
    ['Units held', '=ROUND(SUMIFS(H2:H,' + open + '),3)'], ['', ''],
    ['Realised P&L', '=SUMIFS(K2:K,E2:E,"' + R + '")-SUMIFS(F2:F,E2:E,"' + R + '")'], ['', ''],
    ['Last redemption date', ''], ['', ''],
    ['Last redemption NAV', ''], ['', ''],
    ['AMFI code', fund.code], ['', ''],
    ['Owner', fund.owner],
  ];
  const keep = isNew ? null : sh.getRange('S2:S3').getValues().concat([[sh.getRange(SUMMARY.LAST_RED_DATE).getValue()], [sh.getRange(SUMMARY.LAST_RED_NAV).getValue()]]);
  sh.getRange(2, 18, block.length, 2).setValues(block);
  if (keep) {
    sh.getRange('S2:S3').setValues([keep[0], keep[1]]);
    sh.getRange(SUMMARY.LAST_RED_DATE).setValue(keep[2][0]);
    sh.getRange(SUMMARY.LAST_RED_NAV).setValue(keep[3][0]);
  }

  // Formatting
  sh.getRange(1, 1, 1, 16).setFontWeight('bold').setBackground('#0b1f3a').setFontColor('#ffffff').setWrap(true);
  sh.setFrozenRows(1);
  sh.getRange('D2:D').setNumberFormat('dd-mmm-yyyy');
  sh.getRange('F2:F').setNumberFormat('#,##0.00');
  sh.getRange('G2:G').setNumberFormat('0.0000');
  sh.getRange('H2:H').setNumberFormat('0.000');
  sh.getRange('J2:J').setNumberFormat('0.0000');
  sh.getRange('K2:N').setNumberFormat('#,##0.00');
  sh.getRange('R2:R30').setFontWeight('bold').setFontColor('#374151');
  sh.getRange('S12:S20').setNumberFormat('#,##0.00');
  sh.getRange('S22').setNumberFormat('dd-mmm-yyyy');
  sh.getRange('S26').setNumberFormat('0');
  [300, 100, 110, 100, 100, 95, 85, 85, 220, 85, 100, 55, 90, 90, 80, 85, 20, 160, 120].forEach((w, i) => sh.setColumnWidth(i + 1, w));
  if (isNew) {
    sh.getRange('E2:E').setDataValidation(SpreadsheetApp.newDataValidation()
      .requireValueInList([TXN.SIP, TXN.PURCHASE, TXN.REDEMPTION], true).setAllowInvalid(false).build());
    const rules = [SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$E2="' + R + '"')
      .setFontColor('#9ca3af').setRanges([sh.getRange('A2:P')]).build()];
    sh.setConditionalFormatRules(rules);
    sh.setTabColor(ownerStyle(fund.owner).color);
  }
  return sh;
}

/** 52W high/low into S2/S3 of every active fund tab. */
function update52Week_() {
  const ss = getBook();
  getFunds().forEach(f => {
    const sh = ss.getSheetByName(f.tab);
    if (!sh) return;
    try { const r = high52Low52(f.code); sh.getRange('S2:S3').setValues([[r.hi], [r.lo]]); }
    catch (e) { console.warn('52W failed for ' + f.tab + ': ' + e.message); }
  });
}

// ===================== Master Data =====================
/**
 * One block per owner (6 columns wide), plus a "Family" block when there is more than one owner.
 * Rows: 3 Invested, 4 Current, 5 Abs %, 6 XIRR %, 7 ST, 8 LT, 9 Monthly SIP, 10 Realised P&L,
 *       11 Goal, 13+ projection table.
 */
function buildMasterData() {
  const ss = getBook();
  const sh = ss.getSheetByName(TABS.MASTER) || ss.insertSheet(TABS.MASTER, 1);
  sh.clear(); sh.clearConditionalFormatRules();
  sh.setHiddenGridlines(true);

  const funds = getFunds(true).filter(f => ss.getSheetByName(f.tab));
  const owners = getOwners().map(o => o.name).filter(n => funds.some(f => f.owner === n));
  const blocks = owners.map(o => ({ title: o, tabs: funds.filter(f => f.owner === o).map(f => f.tab), style: ownerStyle(o) }));
  if (owners.length > 1) blocks.push({ title: 'Family total', tabs: funds.map(f => f.tab), style: { color: '#0b1f3a', light: '#eef2f7' } });

  const S = q_(TABS.SETTINGS) + '!$A:$B';
  const years = Math.max(5, Math.min(50, settingNum('PROJECTION_YEARS')));
  const width = Math.max(1, blocks.length) * 6 - 2;
  sh.getRange(1, 1, 1, width).merge()
    .setFormula('="MF Portfolio  |  "&IFERROR(VLOOKUP("USER_NAME",' + S + ',2,0),"")&"  |  "&TEXT(TODAY(),"dd mmm yyyy")')
    .setFontSize(15).setFontWeight('bold').setBackground('#0b1f3a').setFontColor('#ffffff').setHorizontalAlignment('center');
  sh.setRowHeight(1, 36);

  if (!blocks.length) { sh.getRange('A3').setValue('No funds yet. Run Menu → MF Tracker → 🧙 Setup Wizard.'); return; }

  blocks.forEach((b, i) => {
    const c = 1 + i * 6;                       // first column of the block
    const V = col_(c + 2);
    const sum = cell => b.tabs.length ? '=SUM(' + b.tabs.map(t => q_(t) + '!' + cell).join(',') + ')' : '=0';
    const xirrW = b.tabs.length ? '=IFERROR(ROUND((' + b.tabs.map(t => 'N(' + q_(t) + '!S6)*N(' + q_(t) + '!S12)').join('+') + ')/' + V + '3,2),0)' : '=0';
    const sip = b.tabs.length ? '=ROUND(' + b.tabs.map(t => {
      const T = q_(t);
      return 'IFERROR(LET(s,SORT(FILTER({' + T + '!D2:D,' + T + '!F2:F},' + T + '!E2:E="' + TXN.SIP + '",ISNUMBER(' + T + '!D2:D)),1,FALSE),' +
             'IF(INDEX(s,1,1)>=TODAY()-40,INDEX(s,1,2),0)),0)';
    }).join('+') + ',0)' : '=0';

    const rows = [
      ['Invested amount', '', sum('S12')],
      ['Current value', '', sum('S14')],
      ['Absolute return %', '', '=IFERROR(ROUND((' + V + '4-' + V + '3)/' + V + '3*100,2),0)'],
      ['XIRR % (weighted)', '', xirrW],
      ['Unrealised ST gain', '', sum('S8')],
      ['Unrealised LT gain', '', sum('S10')],
      ['Monthly SIP (last 40 days)', '', sip],
      ['Realised P&L', '', sum('S20')],
      ['Goal', '', '=IFERROR(VALUE(VLOOKUP("GOAL_AMOUNT",' + S + ',2,0)),0)'],
    ];
    sh.getRange(2, c, 1, 4).merge().setValue('👤 ' + b.title).setBackground(b.style.color).setFontColor('#ffffff')
      .setFontWeight('bold').setFontSize(12).setHorizontalAlignment('center');
    sh.getRange(3, c, rows.length, 3).setValues(rows.map(r => [r[0], r[1], '']));
    sh.getRange(3, c + 2, rows.length, 1).setFormulas(rows.map(r => [r[2]]));
    for (let k = 0; k < rows.length; k++) sh.getRange(3 + k, c, 1, 2).merge();
    sh.getRange(3, c, rows.length, 4).setBackground(b.style.light);
    sh.getRange(3, c + 2, rows.length, 1).setNumberFormat(INR_FMT_).setFontWeight('bold').setHorizontalAlignment('right');
    sh.getRange(5, c + 2, 2, 1).setNumberFormat('0.00"%"');
    // short lakh/crore text next to big numbers
    for (let k = 0; k < rows.length; k++) {
      if (k === 2 || k === 3) continue;
      const ref = V + (3 + k);
      sh.getRange(3 + k, c + 3).setFormula('=IF(ABS(' + ref + ')>=10000000,TEXT(' + ref + '/10000000,"0.00")&" Cr",IF(ABS(' + ref + ')>=100000,TEXT(' + ref + '/100000,"0.00")&" L",""))')
        .setFontColor('#6b7280').setFontSize(9);
    }

    // projection
    const r0 = 14;
    sh.getRange(r0 - 1, c, 1, 4).merge()
      .setFormula('="Projection @ "&IFERROR(VLOOKUP("EXPECTED_RETURN",' + S + ',2,0),12)&"% a year + current SIP"')
      .setBackground(b.style.color).setFontColor('#ffffff').setFontWeight('bold').setHorizontalAlignment('center');
    sh.getRange(r0, c, 1, 4).setValues([['Year', 'Years ahead', 'Corpus', 'Lakh / Crore']]).setFontWeight('bold').setBackground(b.style.light);
    const pr = [];
    for (let y = 0; y <= years; y++) {
      const row = r0 + 1 + y;
      pr.push(['=YEAR(TODAY())+' + y, y,
        '=FV(IFERROR(VALUE(VLOOKUP("EXPECTED_RETURN",' + S + ',2,0)),12)/100/12,' + col_(c + 1) + row + '*12,-$' + V + '$9,-$' + V + '$4)',
        '=IF(' + V + row + '>=10000000,TEXT(' + V + row + '/10000000,"0.00")&" Cr",TEXT(' + V + row + '/100000,"0.00")&" L")&IF(AND(' + V + '$11>0,' + V + row + '>=' + V + '$11),"  🎯","")']);
    }
    sh.getRange(r0 + 1, c, pr.length, 4).setFormulas(pr.map(r => r.map(String)));
    sh.getRange(r0 + 1, c + 1, pr.length, 1).setValues(pr.map(r => [r[1]]));
    sh.getRange(r0 + 1, c + 2, pr.length, 1).setNumberFormat(INR_FMT_);
    sh.getRange(r0, c, pr.length + 1, 4).setBorder(true, true, true, true, null, null, '#d1d5db', SpreadsheetApp.BorderStyle.SOLID);
    [150, 70, 130, 110, 20, 20].forEach((w, k) => sh.setColumnWidth(c + k, w));
  });
  sh.getRange(13 + years + 3, 1, 1, width).merge().setValue('🎯 = goal reached (GOAL_AMOUNT in ⚙️ Settings). ' + DISCLAIMER_TEXT)
    .setWrap(true).setFontSize(9).setFontColor('#6b7280');
  sh.setRowHeight(13 + years + 3, 48);
}

function col_(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }

/** Menu: create missing fund tabs, refresh summary formulas, rebuild Master Data, 52W values. */
function rebuildAll() {
  resetCaches_();
  ensureSystemTabs_();
  getFunds(true).forEach(f => buildFundTab(f));
  update52Week_();
  buildMasterData();
  SpreadsheetApp.getActiveSpreadsheet() && SpreadsheetApp.getActiveSpreadsheet().toast('Dashboard rebuilt ✅', 'MF Tracker');
}
