# Install guide (5–10 minutes)

## 1. Make your copy
1. Open the template link you were given (it ends in `/copy`) → **Make a copy**.
   *No link?* Create a blank Google Sheet and follow **"Manual install"** below.
2. Open your copy. After a few seconds a **📈 MF Tracker** menu appears (reload the page if it does not).

## 2. Run the Setup Wizard
**📈 MF Tracker → 🧙 Setup Wizard**

The first time, Google shows *"Authorization required"*:
1. **Continue** → pick your Google account.
2. You may see **"Google hasn't verified this app"**. This is normal for personal scripts: the script runs in *your*
   copy, under *your* account. Click **Advanced → Go to (your sheet name) (unsafe)**.
3. Review the permissions (below) → **Allow**. Then run the wizard again from the menu.

| Permission | Why |
|---|---|
| See, edit… your spreadsheets | Read and write the tracker tabs |
| Connect to an external service | Fetch NAVs from `api.mfapi.in` (no personal data is sent) |
| Send email as you | Weekly/monthly reports and error alerts, sent to the addresses you enter |
| Run when you're not present | The daily 7 AM trigger (NAV update + scheduled mails) |
| Display content in prompts/sidebars | Wizard, entry form, import dialog |
| Read, compose… your Gmail | **Only used if you enable a Gmail parser** (auto-entry from transaction mails + labelling them "MF-Processed"). If you don't want this permission at all, delete `AutoTransactions.gs` in the script editor and remove `https://mail.google.com/` from `appsscript.json` *before* the first run |

Wizard steps: **Welcome/disclaimer → Profile & emails → Owners → Funds (search by name) → Targets & rules → Gmail + Build**.
**Build** creates one tab per fund, `Master Data`, `Advisor`, `Import`, the logs and the daily trigger.

## 3. Add your transactions
- **Fastest:** 📥 **Import CSV / CAS** → paste a CSV (see [CAS_IMPORT.md](CAS_IMPORT.md)). Tick *auto-add funds* and the fund tabs are created for you.
- **Manual:** ➕ **Add transaction** (sidebar). Pick fund, type, date and amount. NAV and units are filled in automatically.
  Copy the units from your statement for an exact match.
- **Spreadsheet-style:** type rows in the `Import` tab, then **⚙️ Process Import tab**.
- **Automatic:** enable a Gmail parser in the wizard (see [GMAIL_PARSERS.md](GMAIL_PARSERS.md)).

Rules: never type inside columns **K–P** of a fund tab (they are formulas), and don't rename fund tabs by hand.

## 4. Daily life
| When | What happens |
|---|---|
| Every day 7 AM | NAV update, 52W high/low, `Daily Log` snapshot |
| Saturday 7 AM | Weekly report (+ Advisor section) and optional Weekly NAV log |
| 1st of month | Last month's report |
| 10 PM (only if a Gmail parser is on) | Gmail auto-entry |

Change anything later: `⚙️ Settings` tab (emails, budget, thresholds, `TARGET|…` rows), `Owners` tab, or re-run the wizard.
New fund: wizard (step 4) or add a row in `Funds` → **🔁 Rebuild dashboard**.
Stop all automation: **🛠️ Maintenance → Remove all triggers**.

## Troubleshooting
| Problem | Fix |
|---|---|
| Menu not visible | Reload the sheet; wait 5–10 s |
| "NAV … not published yet" | AMFI publishes NAVs late at night; try the next day |
| Error mails | They name the function and the fund; most are temporary mfapi.in outages |
| Wrong units after redemption | Edit column H of the fund tab, or undo the row (change Type back) |
| Duplicate SIP | Delete the extra row (columns A–J only) |

---

## Manual install (no template link, or for developers)
**Copy-paste:** blank Google Sheet → **Extensions → Apps Script** → for every file in `src/` create a file with the
same name (`.gs` = Script, `.html` = HTML) and paste the content. Project Settings → *Show "appsscript.json"* →
paste `src/appsscript.json`. Save, reload the sheet, run the wizard.

**clasp:**
```bash
npm i -g @google/clasp && clasp login
# in the sheet: Extensions → Apps Script → Project Settings → copy the Script ID
cp .clasp.json.example .clasp.json   # paste your scriptId
clasp push
```
