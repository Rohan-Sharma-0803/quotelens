# Real-document testing

How: serve the folder (`python3 -m http.server`), open `index.html` with Playwright, `setInputFiles('#files', file)`,
wait until no quote is `reading`, then read `window.__quotelens.quotes`. Unit checks: `node tools/test_parse.mjs`
(exits 1 on any failure; includes the three samples and line layouts taken from the documents below).

"Read correctly" = the line's amount and quantity/rate are right and the description identifies the item.
Free (0.00) lines are counted as expected but are never read (they do not affect totals).

The samples must always give: Shree Interiors Depot cheapest complete at ₹2,65,854; BuildMart Traders missing the
LED panel with ₹7,700 charges; Apex ₹2,73,642.

## 2026-10-14: e-invoice / VAT-column layouts (13 new documents)

Sources: `ZUGFeRD/mustangproject` test resources, `akretion/factur-x` fixtures, `katanaml/sparrow` sample data.

| Document | Kind | Lines expected | Before | After | Notes |
|---|---|---|---|---|---|
| EN16931_Einfach.pdf | German e-invoice, rate-first, `9,9000`, VAT % column | 2 | 0 | 2 | 2 VAT-breakdown rows still read as "check this line" items |
| EN16931_1_Teilrechnung.pdf | same family | 4 | 0 | 4 | |
| X19_01_Warenrechnung_fx.pdf | same family, 4 pages | 6 | 0 | 5 | free line (0,00) not read; phone number line read as a flagged item |
| MustangGnuaccountingBeispielRE-20170509_505.pdf | quantity first, VAT % before price | 3 | 0 | 3 | |
| MustangBeispiel20221026.pdf | German invoice | 2 | 2 | 2 | |
| invoice_1.pdf (sparrow) | net, VAT %, gross columns | 4 | 0 | 4 | before: gross taken as amount / wrong lines |
| Facture_F20180027.pdf | French, description on line above | 3 | 2 | 2 | qty/rate swapped (both decimals, rate first); third line has no description on its row |
| invoice_EN16931.pdf (factur-x) | French, discounts per line, multi-row | 3 | 0 | 1 | too complex for line parser |
| ORDER-X_EX01...COMFORT.pdf | purchase order, multi-row lines | 3 | 0 | 0 | numbers spread over 3 rows |
| 103767-Invoice-2026-03-24-1.pdf | Business Central invoice | 1 | 0 | 0 | item line contains a shipment date → rejected as junk |
| receipt_00001.png | photo, Indonesian receipt | 8 | 0 | 0 | OCR too noisy |
| receipt_00003.png | photo, Indonesian receipt | 2 | 1 | 1 | |
| wholefoods-20211211_005.jpg | photo, long US receipt | 4 | 0 | 0 | OCR read only the footer |

Text PDFs: **4 → 23 of 31 lines** read correctly; documents read fully **1 → 5 of 10**. Photos unchanged (1 of 14 lines).

Regression set (invoice2data `tests/compare` + `tests/files`, 13 PDFs, first tested 2026-10-13: 6 of 13 read fully):
10 give identical output; 3 improved — QualityHosting.pdf 0 → 7 of 7 lines (quantity-first layout),
camelot-bol100649863.pdf BenQ monitor line now read (VAT % column), camelot-example.pdf "Double A" line now read.
Now **9 of 13** read fully.

### Fix made (parse.js)
- Item lines with tax columns after the amount (`qty rate amount 18% tax total`, CGST+SGST pairs, `net 10% gross`)
  now take the net amount instead of rejecting the line or taking the gross.
- Exact qty × rate matches win over the ±1 rounding tolerance (stops `7,50 7,50 10% 8,25` from using 8,25).
- Single decimal comma with 1, 2 or 4+ digits (`9,9000`, `3,3333`, `12,5`) is a decimal; `1,234` stays thousands.
- Quantity written before the description (`400,00 Balloons ... 0,79 € 316,00 €`) now keeps the description.
- `N° TVA` / `No. VAT` registration lines are no longer read as items. `PCE`/`Stk` are units.

## Known failure patterns (next candidates)
1. Multi-row line items (description, numbers and discounts on separate rows): Facture, factur-x, ORDER-X.
2. A date inside an item line makes the whole line junk (103767).
3. VAT breakdown tables (`Umsatzsteuer (S) 275,00 7 19,25`) read as flagged items.
4. Photo receipts: OCR quality, not parsing.
5. Still want: Indian GST quotation / proforma PDFs (₹, lakh grouping, HSN column) — none found in reachable repos yet.
