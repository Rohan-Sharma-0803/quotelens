import { parseQuoteText, parseQuoteRows, matchItems, compare, similarity } from '../parse.js';
import fs from 'fs';

const apexText = `Apex Building Supplies Pvt Ltd
Plot 14, Industrial Area Phase 2, Pune 411019 | GSTIN 27AABCA1234F1Z5
QUOTATION
Quote No: AQ-2026-1187 Date: 08-10-2026 To: Studio Nine Interiors
# Description Qty Unit Rate Amount
1 Gypsum Board 12.5mm 8x4 ft 120 Nos 465.00 55,800.00
2 GI Ceiling Channel 3m 200 Nos 118.00 23,600.00
3 Mineral Fibre Ceiling Tile 2x2 ft 300 Nos 92.00 27,600.00
4 LED Panel Light 2x2 36W 40 Nos 1,450.00 58,000.00
5 Wall Putty 40kg Bag 25 Bag 780.00 19,500.00
6 Acrylic Emulsion Paint 20L 12 Bucket 3,950.00 47,400.00
Sub Total 231,900.00
GST @ 18% 41,742.00
Grand Total 273,642.00
Terms & Conditions
1. Prices inclusive of delivery to site within Pune city limits.
2. Payment: 30% advance, balance within 15 days of delivery.
3. Delivery: 5-7 working days from order confirmation.
4. Quote valid for 30 days.`;

const shreeText = `SHREE INTERIORS DEPOT
Ceiling | Partition | Lighting - Mob 98220 41177
Quotation for: Studio Nine Interiors Date: 09/10/2026
Particulars Qty Rate Amount
Gypsum Board 12.5mm 8ft x 4ft 120 452 54,240
GI Channel for ceiling 3 mtr 200 104 20,800
Ceiling Tile Mineral Fibre 2'x2' 300 97 29,100
LED Panel 36W 2x2 40 1,290 51,600
Wall Putty 40 Kg 25 760 19,000
Acrylic Emulsion 20 Ltr 12 3,880 46,560
Total 221,300
Transport 4,000
* GST 18% extra
* Installation charges extra @ Rs 18 per sq ft
* Payment 100% advance
* Rates valid 7 days only`;

const csv = fs.readFileSync(new URL('../samples/buildmart-traders.csv', import.meta.url), 'utf8');
const rows = csv.trim().split('\n').map((l) => l.match(/("([^"]|"")*"|[^,]*)(,|$)/g).slice(0, -1).map((c) => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"')));

const A = parseQuoteText(apexText);
const B = parseQuoteRows(rows, 'BuildMart Traders');
const C = parseQuoteText(shreeText);
for (const q of [A, B, C]) {
  console.log('\n==', q.supplier, q.currency, 'items', q.items.length, 'itemsTotal', q.itemsTotal);
  q.items.forEach((i) => console.log('  ', i.description, '|', i.qty, i.unit, i.rate, i.amount, i.check));
  console.log('  charges', q.charges, 'taxes', q.taxes, 'sub', q.subtotal, 'grand', q.grandTotal);
  console.log('  flags', q.flags.map((f) => f.level + ':' + f.text));
}
const groups = matchItems([A, B, C]);
console.log('\nGROUPS');
groups.forEach((g) => console.log(' ', g.name, JSON.stringify(g.members)));
const cmp = compare([A, B, C], groups);
console.log('\nSUPPLIERS');
cmp.suppliers.forEach((s) => console.log(' ', s.name, Math.round(s.items), Math.round(s.charges), Math.round(s.tax), s.taxNote, 'landed', Math.round(s.landed), 'missing', s.missing, 'complete', Math.round(s.completeCost)));
console.log('cheapest complete', cmp.cheapestComplete?.name, 'split', Math.round(cmp.split.total), cmp.split.lines.map((l) => l.qi));
console.log('sim', similarity('Ceiling tiles mineral fiber 600x600', 'Mineral Fibre Ceiling Tile 2x2 ft'));
