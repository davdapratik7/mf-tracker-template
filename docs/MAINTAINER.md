# Publishing the "Make a copy" template (maintainer)

The template is a Google Sheet with this code bound to it. People copy the sheet, and the bound script copies with it.
(Triggers and Script Properties are **not** copied, so every user's data and schedule stay their own.)

1. Create a **new, empty** Google Sheet named e.g. `MF Portfolio Tracker (Template)`.
2. Extensions → Apps Script → name the project `MF Tracker`. Push the code:
   `clasp push` (with this sheet's Script ID in `.clasp.json`) or copy-paste every file from `src/`.
3. Back in the sheet, run **only** `buildReadMeTab_` from the editor (creates the "Read Me" tab with the disclaimer).
   ⚠️ **Do not run the Setup Wizard in the template.** Your name, funds and emails would be copied to every user.
4. Delete any other tabs, so the template contains only *Read Me*.
5. Share → General access: **Anyone with the link → Viewer**.
6. Copy the link and replace `/edit…` at the end with `/copy`:
   `https://docs.google.com/spreadsheets/d/<TEMPLATE_ID>/copy`
   Put this link in the README ("Get started") and your release notes.
7. Updating the template later: push the new code to the template's script. Existing users keep their old copy;
   they update by copying the new `src/` files into their own script editor. Their data is untouched, because
   all configuration lives in their tabs.

## Release checklist
- [ ] `grep -ri` for personal emails, names, sheet IDs, folio numbers in `src/` and `docs/` returns nothing
- [ ] Fresh copy → wizard with 2 owners, 3 funds (one ELSS) → build OK
- [ ] Import `docs/sample-import.csv` → statuses ✅, one redemption split
- [ ] ➕ Add transaction (SIP + redemption) OK
- [ ] Menu → Send test report to me → mail renders on phone
- [ ] Run Advisor → tab renders, disclaimer visible
