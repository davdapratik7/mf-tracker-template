# Gmail auto-entry parsers

Every night at 10 PM (only when `GMAIL_PARSERS` in ⚙️ Settings is not blank) the script searches your Gmail for
transaction mails, adds SIPs/purchases and FIFO-redeems units, labels the mails **MF-Processed** and logs every
action in the `Auto Txn Log` tab. A mail is never processed twice.

## Requirements
- `Owners` → **Holder name** must equal the name printed in the mail (upper-case, e.g. `ASHA R SHARMA`).
  Mails for other holders (e.g. a parent on the same platform) are ignored.
- `Funds` → **Mail match (regex)** must match the scheme name in the mail. The wizard fills a loose regex
  such as `axis.*small.*cap`; edit it if a fund is not recognised.
- `GMAIL_START_DATE` (yyyy/mm/dd): set it to the day **after** your last manual/imported entry.
- Family member's mails in another inbox? Set up auto-forwarding of their platform mails to your Gmail.

## Built-in: FUNDZBAZAR
- SIP: `from:transactions@fundzbazar.com subject:"eSIP Transaction Successful"`, NAV taken from the mail date (or the next NAV day)
- Redemption: `subject:"Redemption Transaction Successfully Placed"`, next NAV after the request date
- Optional `PAYOUT_QUERY`: if your bank sends a credit alert (e.g. `from:alerts@yourbank.com "MF REDEMPTION"`),
  the real credited amount ÷ NAV gives exact units. Otherwise the requested amount is used (marked ESTIMATE in the log).

## Adding your platform (Groww, Kuvera, Zerodha Coin, AMC / CAMS / KFintech confirmation mails…)
Mail formats differ and change over time, so only parsers that were tested on real mails are shipped.
To add one:
1. Open the script editor → `AutoTransactions.gs`.
2. Copy `PARSER_FUNDZBAZAR` to `PARSER_MYPLATFORM`. Change:
   - `name`
   - `purchases.query`: a Gmail search that finds only the SIP/purchase confirmation mails
   - `purchases.parse(text)`: return `{holder, scheme, folio, amount, ref}` or `null`
   - `redemptions` (optional): return `{holder, rows: [{scheme, folio, amount, allUnits, date}]}`
   `text` is the mail converted to one line of plain text (table cells separated by ` | `).
3. Register it: `const PARSERS = { FUNDZBAZAR: PARSER_FUNDZBAZAR, MYPLATFORM: PARSER_MYPLATFORM };`
4. Run `testParsers()` from the editor. It prints what each parser extracts from the newest matching mail, without writing anything.
5. Add `MYPLATFORM` to `GMAIL_PARSERS` in ⚙️ Settings and run **🛠️ Maintenance → Re-install triggers**.

Pull requests with new, tested parsers are welcome. Please remove all personal data from sample mails.
