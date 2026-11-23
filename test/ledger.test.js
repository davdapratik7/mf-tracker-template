// Mock test of the ledger engine (FIFO, split, ELSS lock-in, dedupe, CSV import). Run: node test/ledger.test.js
const assert=require('assert');
const fs=require('fs'),vm=require('vm');
const src=['Config','Utils','Nav','Ledger','Import','AutoTransactions'].map(f=>fs.readFileSync(require('path').join(__dirname,'..','src')+'/'+f+'.gs','utf8')).join('\n');
function a1(s){ if(/^[A-Z]+\d+:[A-Z]+$/.test(s)) s=s+'1000';const m=s.match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/);const c=x=>x.split('').reduce((a,ch)=>a*26+ch.charCodeAt(0)-64,0);return m?[+m[2],c(m[1]),m[4]?+m[4]-+m[2]+1:1,m[3]?c(m[3])-c(m[1])+1:1]:null}
class Sheet{constructor(n){this.n=n;this.d=[];}cell(r,c){while(this.d.length<r)this.d.push([]);return this.d[r-1][c-1]??''}
 set(r,c,v){while(this.d.length<r)this.d.push([]);this.d[r-1][c-1]=v}
 getMaxRows(){return Math.max(this.d.length,100)} insertRowsAfter(){} getName(){return this.n}
 getLastRow(){for(let i=this.d.length;i>0;i--)if(this.d[i-1].some(x=>x!==''&&x!=null))return i;return 0}
 insertRowAfter(r){this.d.splice(r,0,[])}
 getRange(r,c,nr,nc){if(typeof r==='string'){[r,c,nr,nc]=a1(r)}nr=nr||1;nc=nc||1;const sh=this;return{
  getValues(){const o=[];for(let i=0;i<nr;i++){const row=[];for(let j=0;j<nc;j++)row.push(sh.cell(r+i,c+j));o.push(row)}return o},
  getValue(){return sh.cell(r,c)},setValue(v){sh.set(r,c,v);return this},
  setValues(v){v.forEach((row,i)=>row.forEach((x,j)=>sh.set(r+i,c+j,x)));return this},
  sort(o){const rows=[];for(let i=0;i<nr;i++){rows.push(sh.d[r-1+i].slice(c-1,c-1+nc))}rows.sort((a,b)=>a[o.column-c]-b[o.column-c]);rows.forEach((x,i)=>{for(let j=0;j<nc;j++)sh.set(r+i,c+j,x[j])})},
  setNumberFormat(){return this}}}}
const sheets={};const book={getSheetByName:n=>sheets[n]||null,insertSheet:n=>sheets[n]=new Sheet(n)};
const ctx={console,Math,JSON,Date,String,Number,parseFloat,isNaN,RegExp,Object,Array,
 SpreadsheetApp:{getActiveSpreadsheet:()=>book},PropertiesService:{getScriptProperties:()=>({getProperty:()=>null})},
 Session:{getScriptTimeZone:()=>'Asia/Kolkata',getEffectiveUser:()=>({getEmail:()=>'x@y'})},
 Utilities:{formatDate:(d,tz,f)=>{const p=n=>String(n).padStart(2,'0');const M=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
   return f.replace('yyyy',d.getFullYear()).replace('MMM',M[d.getMonth()]).replace('MM',p(d.getMonth()+1)).replace('dd',p(d.getDate())).replace('HH','00').replace('mm','00')},
   parseCsv:t=>t.split('\n').map(l=>l.split(','))},
 LockService:{getDocumentLock:()=>({waitLock(){},releaseLock(){}})}};
vm.createContext(ctx);vm.runInContext(src,ctx);
// fake funds
sheets['Funds']=new Sheet('Funds');sheets['Funds'].d=[[],['Test Fund','100','Test Fund - Growth','Me','Small','No','test.*fund','TEST','Yes'],['Tax Fund','200','Tax Saver ELSS','Me','ELSS','Yes','tax','TAX','Yes']];
sheets['Owners']=new Sheet('Owners');sheets['Owners'].d=[[],['Me','ME HOLDER','']];
sheets['Import']=new Sheet('Import');sheets['Import'].d=[['h','h','h','h','h','h','h','h','Status']];
// nav history mock: NAV 10 on every day 2020..2026, latest 20
vm.runInContext(`navHistory = function(code){ const out=[]; for(let d=new Date(2020,0,1); d<=new Date(2026,10,20); d=new Date(d.getFullYear(),d.getMonth(),d.getDate()+1)) out.push({d:d,nav: code==='200'?50:10}); out[out.length-1].nav = code==='200'?60:20; return out; };`,ctx);
for(const t of ['Test Fund','Tax Fund']){const s=sheets[t]=new Sheet(t);s.d=[['Scheme','Folio','Cat','Date','Type','Amt','NAV','Units','Src','Cur']];}
const R=c=>vm.runInContext(c,ctx);
R(`var f=getFundByTab('Test Fund');
addPurchase(f,{date:'2024-03-01',amount:1000,nav:10,units:100});
addPurchase(f,{date:'2024-01-01',amount:1000,nav:10,units:100});
addPurchase(f,{date:'2024-02-01',amount:1000,nav:10,units:100});
var dup=addPurchase(f,{date:'2024-02-02',amount:1000,nav:10,units:100});`);
console.log('dup skipped:',R('dup.skipped'));

const res=R(`redeem(f,{date:'2025-01-10',units:150})`);
console.log('redeem',JSON.stringify(res));
console.table(sheets['Test Fund'].d.slice(1).filter(r=>r[3]).map(r=>({date:r[3].toDateString(),type:r[4],amt:r[5],units:r[7],cur:r[9],src:r[8]})));
console.log('redeemable now',R(`redeemableUnits(f,new Date(2025,0,11))`));
{const rows=sheets['Test Fund'].d.slice(1).filter(r=>r[3]);assert.deepStrictEqual(rows.map(r=>r[4]),['Redemption','Redemption','SIP','SIP']);assert.deepStrictEqual(rows.map(r=>r[7]),[100,50,50,100]);assert.strictEqual(R(`redeemableUnits(f,new Date(2025,0,11))`),150);}
// ELSS lock-in
R(`var e=getFundByTab('Tax Fund'); addPurchase(e,{date:'2023-01-05',amount:500,units:10}); addPurchase(e,{date:'2025-06-05',amount:500,units:10});`);
console.log('ELSS redeemable 2026-11-20:',R(`redeemableUnits(e,new Date(2026,10,20))`));assert.strictEqual(R(`redeemableUnits(e,new Date(2026,10,20))`),10);
try{R(`redeem(e,{date:'2025-07-01',all:true})`)}catch(x){console.log('ELSS early err:',x.message)}
console.log('ELSS all:',JSON.stringify(R(`redeem(e,{date:'2026-11-19',all:true})`)));
// helpers
console.log(R(`[mapCategory('Equity Scheme - Small Cap Fund','x'),mapCategory('Equity Scheme - Large & Mid Cap Fund',''),mapCategory('Other Scheme - Index Funds','Motilal Oswal Nifty Midcap 150 Index Fund'),mapCategory('Other Scheme - Gold ETF','Nippon Gold BeES'),mapCategory('Equity Scheme - ELSS',''),mapCategory('Hybrid Scheme - Multi Asset Allocation',''),mapCategory('Debt Scheme - Liquid Fund','')]`));
console.log(R(`matchRegexFor('Axis Small Cap Fund - Regular Plan - Growth')`), R(`matchRegexFor('Parag Parikh Flexi Cap Fund - Direct Plan - Growth')`));
console.log(R(`new RegExp(matchRegexFor('Axis Small Cap Fund - Regular Plan - Growth'),'i').test('AXIS SMALLCAP FUND REGULAR GROWTH')`));
// fundzbazar parse
console.log(JSON.stringify(R(`PARSER_FUNDZBAZAR.purchases.parse('Client Name : ME HOLDER Scheme Name : Test Fund Regular Growth Folio No : 123/45 Amount (Rs) : 2,000.00 Transaction Reference Number : 999')`)));
// import csv
R(`addFundForOwner_ = function(){ throw new Error('should not be called'); }`);
console.log(R(`importCsvText('date,scheme,amfi,folio,amount,units,nav,type\\n2026-01-05,Test Fund,100,1/1,2000,100,20,PURCHASE_SIP\\n2026-01-05,Test Fund,100,1/1,0.1,,,STAMP_DUTY_TAX\\n2026-02-05,Test Fund,100,1/1,-200,-10,20,REDEMPTION',{owner:'Me',autoAdd:true,process:false})`));
console.log(sheets['Import'].d.slice(1));
R(`toast_=function(m){console.log('TOAST',m)}`);
R(`processImportTab()`);
console.log(sheets['Import'].d.slice(1).map(r=>r[8]));
assert.ok(sheets['Import'].d.slice(1).every(r=>String(r[8]).startsWith('✅')));
console.log('ALL ASSERTS PASSED');
