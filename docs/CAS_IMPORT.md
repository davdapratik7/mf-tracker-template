# Importing your history (CAS / CSV)

## Why not upload the CAS PDF directly?
The CAMS / KFintech Consolidated Account Statement is a **password-protected PDF**. Apps Script cannot decrypt or
parse PDFs, and sending your CAS + password to a third-party server would be a privacy risk. So the CAS is converted
to CSV **on your own computer** first.

## Option A: casparser (recommended, free, open source)
1. Get a *detailed* CAS (with transactions) from CAMS, KFintech or MFCentral. It arrives by email as a PDF.
2. On your PC (Python 3.8+):
   ```bash
   pip install casparser
   casparser CAS.pdf -p YOUR_CAS_PASSWORD -o cas.csv
   ```
3. Open `cas.csv` in a text editor, copy everything, then in the sheet: **📥 Import CSV / CAS** → pick the owner →
   paste → **Import**.
   - *Auto-add funds* creates a tab for every AMFI code that is not in the `Funds` tab yet.
   - Stamp duty / STT / TDS rows and dividend payouts are ignored. Switch-in counts as a purchase, switch-out as a redemption.
4. Check the **Status** column of the `Import` tab. ❌ rows need a fix (usually an unknown fund) → fix → **⚙️ Process Import tab** again.
5. Importing a CAS for a second person: run it again with the other owner selected.

## Option B: any CSV / platform export
Paste a CSV with a header row. Recognised columns (case-insensitive):

| Needed | Column names accepted |
|---|---|
| ✅ | `date` |
| ✅ one of | `amfi` / `amfi_code` / `scheme_code`, or `scheme` / `scheme name` (matched against Funds → *Mail match*) |
| ✅ | `type` (`SIP`, `PURCHASE`, `PURCHASE_SIP`, `REDEMPTION`, `SWITCH_IN`, `SWITCH_OUT`…) or a `description` text |
| recommended | `amount`, `units`, `nav`, `folio` |

Units and NAV are filled in from AMFI if missing (units net of 0.005% stamp duty). Copy the real units if you have them.
See [`sample-import.csv`](sample-import.csv) (demo folios; check the AMFI codes in the wizard search before relying on them).

## Option C: type into the Import tab
Columns: `Date | Fund (tab / AMFI code / name) | Owner | Type | Amount | Units | NAV | Folio | Status`. Leave Status
empty and run **⚙️ Process Import tab**. Rows are processed in date order, so FIFO stays correct.

## Duplicates
A purchase with the same amount within ±3 days of an existing lot is skipped (⏭️). If it really is a second
purchase, add it with ➕ Add transaction → *Add anyway*.
