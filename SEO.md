# Search pages

Google is the main way people find QuoteLens. One genuinely useful page per week: what it is, a worked example with
verified numbers, common mistakes, a free template or the "Try QuoteLens" button. Title + meta description, FAQ JSON-LD,
canonical URL, linked from index.html, added to sitemap.xml. No keyword stuffing, no fake reviews or statistics.

## Phrases

| Phrase (what people type) | Page | Status |
|---|---|---|
| comparative statement of quotations (format, in Excel, how to prepare) | comparative-statement-of-quotations.html + templates/comparative-statement-of-quotations.xlsx | done 2026-10-14 |
| quotation comparison sheet / format | (could be covered by the page above; or a short page focused on the sheet) | todo |
| how to compare supplier quotes | | todo |
| compare 3 quotations | | todo |
| price comparison of vendors | | todo |
| GST extra vs inclusive in quotation | | todo (natural next: example already in the CS page) |
| L1 L2 L3 quotation comparison | | todo |
| techno-commercial comparison | | todo |

## Notes
- The worked example on the comparative statement page (A ₹2,26,560 L2, B ₹2,29,746 L3, C ₹2,26,324 L1) was checked by
  recalculating the Excel template in LibreOffice.
- robots.txt only counts at the domain root, so on a project site (`/quotelens/`) Google will not read it. Submit
  `https://rohan-sharma-0803.github.io/quotelens/sitemap.xml` in Google Search Console instead (URL-prefix property for
  `https://rohan-sharma-0803.github.io/quotelens/`, verified with the HTML-file method).
