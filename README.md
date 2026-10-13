# QuoteLens

Compare supplier quotes side by side. Drop in quotes as PDFs, spreadsheets or photos; QuoteLens lines up every item, adds delivery and tax, flags the fine print, and shows which supplier is really cheapest.

Everything runs in the visitor's browser: no server, no API costs, and quotes never leave the user's device.

## How it reads files
- **PDF with text**: read exactly with pdf.js
- **Excel / CSV**: read with SheetJS
- **Photos and scanned PDFs**: text recognition with tesseract.js (bundled, works offline)
- **Chrome with built-in AI (Gemini Nano)**: used automatically on computers that support it

## Files
- `index.html` – the page
- `app.js` – reading files, UI, export
- `parse.js` – turning text into items, matching items across suppliers, comparison (pure functions)
- `vendor/` – bundled libraries (pdf.js, SheetJS, tesseract.js + English data)
- `samples/` – three demo quotes used by "Try 3 sample quotes"
- `tools/test_parse.mjs` – run `node tools/test_parse.mjs` to check parsing and the comparison
- `tools/make_samples.py` – regenerates the sample quotes

## Hosting
GitHub Pages: Settings → Pages → Deploy from a branch → `main` / root.
