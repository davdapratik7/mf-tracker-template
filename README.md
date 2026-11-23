# 📈 MF Portfolio Tracker: Google Sheets template

A free mutual fund tracker for Indian investors that runs entirely inside **your own Google Sheet**
(Google Sheets + Apps Script). Nothing to install and no server. Your data stays in your Google account.

> ⚠️ **Disclaimer:** this is a rule-based calculator, **not investment advice**. The author is not a
> SEBI-registered investment adviser or research analyst. NAV, gain and tax figures are approximate;
> always verify against your CAS / AMC statement. See [DISCLAIMER.md](DISCLAIMER.md).

## Features
| | |
|---|---|
| 📑 **Lot-wise ledger** | One tab per fund holding; each SIP/lump sum is a lot. FIFO redemptions with automatic partial-lot split |
| 🔒 **ELSS lock-in** | Only lots older than 3 years can be redeemed |
| 🧾 **STCG / LTCG** | 365-day split for equity; Debt category is always short-term. Realised P&L kept separately |
| 📊 **Daily NAV** | From AMFI via [mfapi.in](https://www.mfapi.in) (free), plus 52-week high/low and XIRR per fund |
| 👨‍👩‍👧 **Owners / family** | Track several people's money; owner-wise and family dashboard (Master Data) with a projection table |
| ✉️ **Report mails** | Weekly (Saturday) and monthly (1st) reports with your ₹ impact, plus an optional per-fund weekly NAV log |
| 🧭 **Advisor (rule-based)** | Category allocation vs **your** target, overlap ranking inside a category, dip top-up plan, "100 − age" thumb-rule |
| ➕ **3 ways to add transactions** | Manual form · CSV / CAS import (casparser) · Gmail auto-entry parsers (FundzBazar built in, add your own) |
| 🧙 **Setup Wizard** | Name, emails, owners, fund search by name (AMFI code filled in for you), targets and budget. Builds all tabs and triggers |

## Get started (users)
1. Open the template link → **File → Make a copy** (or use the `/copy` link you were given).
2. In your copy: **📈 MF Tracker → 🧙 Setup Wizard** → allow permissions → follow the 6 steps.
3. Add your history: **📥 Import CSV / CAS** (fastest) or **➕ Add transaction**.

Full guide: **[docs/INSTALL.md](docs/INSTALL.md)**. Permissions are explained there too.

## Repo layout
```
src/                     Apps Script project (push with clasp, or copy-paste)
  Config.gs              settings / owners / funds layer (reads the sheet, nothing hard-coded)
  Setup.gs + Setup.html  wizard, menu, triggers
  Builder.gs             fund tabs, Master Data, Read Me
  Ledger.gs + EntryForm  purchase / FIFO redemption engine + manual entry sidebar
  Import.gs + ImportDialog  Import tab + CSV / casparser import
  AutoTransactions.gs    Gmail parser registry (FundzBazar)
  Nav.gs                 mfapi.in client, category mapping
  DailyJobs.gs           daily trigger: NAV, 52W, daily log, scheduled mails
  ReportHelper.gs, Reports.gs, WeeklyNavLog.gs, *Form.html   report mails & dialogs
  Advisor.gs             rule-based advisor
docs/                    INSTALL, CAS_IMPORT, GMAIL_PARSERS, MAINTAINER, sample-import.csv
```

## License
MIT, see [LICENSE](LICENSE). Data: AMFI NAVs via mfapi.in (unofficial, free; no guarantee of availability).
