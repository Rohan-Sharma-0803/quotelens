// QuoteLens parsing + comparison engine. Pure functions, no DOM, so it can be unit-tested in node.

const CUR_RE = /(₹|rs\.?|inr|usd|us\$|\$|£|gbp|€|eur|aed|sar|sgd|a\$|aud|cad|c\$)/i;
const CHARGE_RE = /\b(transport(ation)?|freight|delivery|shipping|cartage|carriage|loading|unloading|installation|install|fitting|packing|packaging|handling|insurance|courier|labou?r|service charge|setup|set-up|mobili[sz]ation|hamali|octroi|fuel surcharge)\b/i;
const TAX_RE = /\b(gst|cgst|sgst|igst|utgst|vat|tax|sales tax|cess)\b/i;
const TOTAL_RE = /\b(sub[\s-]?total|grand\s*total|net\s*total|total\s*amount|amount\s*payable|total)\b/i;
const NOTE_RE = /\b(extra|excl|exclusive|excluding|ex[\s-]?godown|ex[\s-]?works|ex[\s-]?factory|advance|payment|valid|validity|warranty|guarantee|stock|lead\s*time|weeks?|days?|subject to|as applicable|terms|note|inclusive|including|free)\b/i;
const JUNK_RE = /\b(date|period|billing|registered office|capital|account|page \d|invoice (no|number|#)|order (no|number|#)|po (no|number)|customer (no|id)|kvk|siret|iban|bic|swift|vat\s*(no|number|id|reg)|tin\b|pan\b|cin\b|n[°o]\.?\s*(tva|vat|tax)\b|zip|postcode|street|road|nagar|floor|plot)\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+(19|20)\d\d\b|\b\d{1,2}[-/.]\d{1,2}[-/.](19|20)?\d\d\b/i;
const CONTACT_RE = /\b(mob(ile)?|phone|ph\.?|tel|fax|whatsapp|gstin|pan|pin\s*code|a\/c|ifsc|account no)\b|@[a-z]/i;
const UNIT_WORDS = new Set(['nos', 'no', 'no.', 'pcs', 'pc', 'pieces', 'piece', 'unit', 'units', 'each', 'ea', 'bag', 'bags', 'box', 'boxes', 'set', 'sets', 'sheet', 'sheets', 'bucket', 'buckets', 'kg', 'kgs', 'ltr', 'ltrs', 'litre', 'litres', 'liter', 'liters', 'l', 'mtr', 'mtrs', 'm', 'rmt', 'sqft', 'sq.ft', 'sft', 'sqm', 'roll', 'rolls', 'pkt', 'pack', 'packs', 'pair', 'pairs', 'dozen', 'doz', 'ton', 'tons', 'mt', 'lot', 'job', 'pce', 'stk', 'hrs', 'hr', 'hours', 'days']);

export function parseNumber(raw) {
  if (raw == null) return NaN;
  if (typeof raw === 'number') return raw;
  let s = String(raw).trim().replace(CUR_RE, '').replace(/[\s ]/g, '').replace(/[/=-]+$/, '').replace(/[):,;]+$/, '').replace(/^[(]/, '');
  if (!/^-?\d[\d,.]*$/.test(s)) return NaN;
  // European style 1.234,56
  if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  // single decimal comma: 12,5 / 60,00 / 9,9000 (3 digits after one comma stays a thousands separator: 1,234)
  else if (/^-?\d+,(\d{1,2}|\d{4,})$/.test(s)) s = s.replace(',', '.');
  else s = s.replace(/,/g, '');
  if ((s.match(/\./g) || []).length > 1) return NaN;
  return parseFloat(s);
}

export function detectCurrency(text) {
  const t = text || '';
  if (/₹|\brs\.?\s*\d|\binr\b|\bgst\b/i.test(t)) return '₹';
  if (/£|\bgbp\b/i.test(t)) return '£';
  if (/€|\beur\b/i.test(t)) return '€';
  if (/\baed\b|\bdirham/i.test(t)) return 'AED ';
  if (/\$|\busd\b/i.test(t)) return '$';
  return '';
}

const near = (a, b) => Math.abs(a - b) <= Math.max(1, Math.abs(b) * 0.012);

function tokensWithNumbers(line) {
  return line.trim().split(/\s+/).map((tok, i) => ({ tok, i, n: parseNumber(tok) }));
}

function cleanDescription(words) {
  const w = words.slice();
  // drop leading serial number like "1", "1.", "(1)", "01"
  if (w.length > 1 && /^\(?\d{1,3}[.)]?$/.test(w[0])) w.shift();
  return w.join(' ').replace(/^[-–:•*|]+\s*/, '').replace(/\s*[-–:|]+$/, '').trim();
}

// Try to read one line as an item: description ... qty [unit] rate [unit] amount
export function parseItemLine(line) {
  if (JUNK_RE.test(line) || CONTACT_RE.test(line)) return null;
  const toks = tokensWithNumbers(line);
  const nums = toks.filter((t) => !isNaN(t.n));
  if (nums.length < 2) return null;
  const words = toks.filter((t) => isNaN(t.n));
  if (!words.some((t) => /[a-z]{2,}/i.test(t.tok))) return null;
  const last = nums[nums.length - 1];
  const isPct = (t) => /^-?\d+(?:[.,]\d+)?\s*%$/.test(t.tok) || t.tok === '%';
  // amount must be the last number or be followed only by tax columns (18% 900 5900), currency or unit noise
  const tailOk = (k) => {
    const rest = toks.slice(nums[k].i + 1);
    if (rest.some((t) => isNaN(t.n) && /[a-z]{3,}/i.test(t.tok) && !CUR_RE.test(t.tok))) return false;
    return k === nums.length - 1 || rest.some(isPct);
  };
  if (!tailOk(nums.length - 1)) return null;

  // 1) find qty * rate = amount, preferring pairs closest to the end. The amount is the last number, or
  //    (for quotes with GST/VAT columns) a net amount followed by a tax % and tax/gross amounts.
  //    Exact matches win over rounding-tolerant ones, so "7,50 7,50 10% 8,25" takes the net 7,50, not the gross.
  const exact = (x, y) => Math.abs(x - y) <= Math.max(0.011, Math.abs(y) * 0.002);
  for (const close of [exact, near]) for (let k = nums.length - 1; k >= Math.max(2, nums.length - 4); k--) {
    if (!tailOk(k)) continue;
    const a = nums[k].n;
    for (let j = k - 1; j >= 1; j--) {
      for (let i = j - 1; i >= 0; i--) {
        const q = nums[i].n, r = nums[j].n;
        if (q > 0 && r > 0 && close(q * r, a)) {
          const prev = (toks[nums[i].i - 1] || {}).tok || '';
          const dec = (t) => /[.,]\d{2,4}$/.test(t);
          const qLooksLikePrice = CUR_RE.test(prev) || CUR_RE.test(nums[i].tok) || dec(nums[i].tok) && !dec(nums[j].tok);
          const swap = Number.isInteger(r) && (!Number.isInteger(q) || qLooksLikePrice);
          return build(toks, nums[i].i, { qty: swap ? r : q, rate: swap ? q : r, amount: a, ok: true, rateIndex: nums[j].i });
        }
      }
    }
  }
  // 2) qty * rate where amount missing: "LED panel 40 1290"
  if (nums.length >= 2) {
    const q = nums[nums.length - 2].n, r = last.n;
    const qtyTok = nums[nums.length - 2];
    const descWords = toks.slice(0, qtyTok.i).filter((t) => /[a-z]{2,}/i.test(t.tok));
    if (nums.length === 2 && descWords.length && Number.isInteger(q) && q > 0 && q < 100000 && r > 0 && !CHARGE_RE.test(line) && !TAX_RE.test(line) && !TOTAL_RE.test(line)) {
      // only accept if numbers are the last two numeric tokens with nothing descriptive between them
      const between = toks.slice(qtyTok.i + 1, last.i).filter((t) => !UNIT_WORDS.has(t.tok.toLowerCase()));
      if (!between.length) return build(toks, qtyTok.i, { qty: q, rate: r, amount: q * r, ok: false, note: 'No line total on the quote; calculated qty × rate' });
    }
  }
  // 3) three trailing numbers that don't multiply (often an OCR slip): keep but flag
  if (nums.length >= 3 && !CHARGE_RE.test(line) && !TAX_RE.test(line) && !TOTAL_RE.test(line)) {
    const [qT, rT, aT] = nums.slice(-3);
    const yearish = [qT, rT, aT].some((t) => /^(19|20)\d\d$/.test(t.tok));
    const descPart = toks.slice(0, qT.i).map((t) => t.tok).join(' ');
    if (!yearish && Number.isInteger(qT.n) && qT.n <= 10000 && !/:\s*$/.test(descPart) && qT.n > 0 && rT.n > 0 && aT.n > 0) {
      return build(toks, qT.i, { qty: qT.n, rate: rT.n, amount: aT.n, ok: false, note: `Qty × rate (${fmtPlain(qT.n * rT.n)}) doesn't match line total (${fmtPlain(aT.n)}). Check this line.` });
    }
  }
  return null;
}

function fmtPlain(n) { return (Math.round(n * 100) / 100).toLocaleString('en-US'); }

function build(toks, qtyIndex, v) {
  let desc = cleanDescription(toks.slice(0, qtyIndex).map((t) => t.tok));
  // quantity written first: "400,00 Balloons, assorted 19% 0,79 € 316,00 €"
  if ((!desc || !/[a-z]{2,}/i.test(desc)) && v.rateIndex > qtyIndex + 1) {
    desc = cleanDescription(toks.slice(qtyIndex + 1, v.rateIndex).filter((t) => !/%$/.test(t.tok) && !CUR_RE.test(t.tok) || /[a-z]{4,}/i.test(t.tok)).map((t) => t.tok));
  }
  const unitTok = toks.slice(qtyIndex + 1).find((t) => isNaN(t.n) && UNIT_WORDS.has(t.tok.toLowerCase().replace(/[.,]$/, '')));
  if (!desc || desc.length < 2 || desc.split(' ').every((w) => UNIT_WORDS.has(w.toLowerCase()))) return null;
  return { description: desc, qty: v.qty, unit: unitTok ? unitTok.tok : '', rate: v.rate, amount: v.amount, check: v.ok ? '' : (v.note || 'Check this line') };
}

function lastNumber(line) {
  const nums = tokensWithNumbers(line).filter((t) => !isNaN(t.n));
  return nums.length ? nums[nums.length - 1].n : NaN;
}

function pctIn(line) {
  const m = line.match(/(\d+(?:\.\d+)?)\s*%/);
  return m ? parseFloat(m[1]) : NaN;
}

// Classify fine-print lines into flags people care about
export function classifyNote(line) {
  const l = line.toLowerCase();
  const out = [];
  if (/(gst|vat|tax(es)?)[^.]{0,30}\b(extra|excl|exclusive|additional|as applicable|not included)|\+\s*(gst|vat|tax)|plus\s+(gst|vat|tax)|exclusive of (gst|vat|tax)/.test(l)) {
    out.push({ kind: 'tax-extra', level: 'warn', text: 'Tax not included in prices', rate: pctIn(l) });
  }
  const ch = l.match(CHARGE_RE);
  if (ch && /\b(extra|additional|not included|excluded|excluding|charged|@)\b/.test(l)) {
    out.push({ kind: 'charge-extra', level: 'warn', text: `${cap(ch[0])} charged extra` });
  }
  if (/ex[\s-]?(godown|works|factory|warehouse)/.test(l)) out.push({ kind: 'ex-works', level: 'warn', text: 'Ex-godown/ex-works: you pay to collect or ship' });
  const adv = l.match(/(\d{1,3})\s*%\s*(advance|payment before|before dispatch|upfront)/) || (/(100\s*%|full)\s*(payment|advance)|payment[^.]*before dispatch|advance payment/.test(l) ? [null, /100|full|before dispatch/.test(l) ? '100' : ''] : null);
  if (adv) out.push({ kind: 'advance', level: Number(adv[1]) >= 50 || adv[1] === '' ? 'warn' : 'info', text: adv[1] ? `${adv[1]}% payment in advance` : 'Advance payment required' });
  const val = l.match(/valid(?:ity)?[^.\d]{0,20}(\d{1,3})\s*days/);
  if (val) out.push({ kind: 'validity', level: Number(val[1]) <= 7 ? 'warn' : 'info', text: `Prices valid ${val[1]} days` });
  const lead = l.match(/(\d{1,2})\s*(?:-\s*\d{1,2}\s*)?(?:working\s+|business\s+)?(weeks?|days?)/);
  if (/(not in stock|out of stock|lead time|can source|available in|procure)/.test(l)) out.push({ kind: 'stock', level: 'warn', text: 'Some items not in stock' + (lead ? ` (${lead[0]})` : '') });
  else if (/deliver(y|ed|s)?\s*(:|in\b|within|time|period|schedule)/.test(l) && lead && !val) out.push({ kind: 'lead', level: 'info', text: `Delivery in ${lead[0]}` });
  if (/(inclusive of|including|incl\.?|free)\s+(delivery|transport|freight|shipping)|(delivery|transport|freight|shipping)\s+(free|included)/.test(l)) out.push({ kind: 'delivery-included', level: 'good', text: 'Delivery included' });
  if (/(inclusive of|including|incl\.?)\s+(gst|vat|tax)/.test(l)) out.push({ kind: 'tax-included', level: 'good', text: 'Prices include tax' });
  if (/warranty|guarantee/.test(l)) { const w = l.match(/(\d+)\s*(years?|months?)/); out.push({ kind: 'warranty', level: 'good', text: w ? `Warranty ${w[0]}` : 'Warranty mentioned' }); }
  return out;
}

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase(); }

// Main: turn text lines of a quote into structured data
export function parseQuoteText(text, name = '') {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.replace(/[|]/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
  const q = { supplier: name, items: [], charges: [], taxes: [], subtotal: NaN, grandTotal: NaN, notes: [], flags: [], currency: detectCurrency(text), raw: lines.join('\n') };
  for (const line of lines) {
    const isTax = TAX_RE.test(line) && !/gstin|vat\s*(no|reg)/i.test(line);
    const isTotal = TOTAL_RE.test(line);
    const isCharge = CHARGE_RE.test(line);
    const n = lastNumber(line);
    if (isTotal && !isNaN(n) && !isTax) {
      if (/grand|net|payable|amount/i.test(line)) q.grandTotal = n; else if (/sub/i.test(line) || isNaN(q.subtotal)) q.subtotal = n; else q.grandTotal = n;
      continue;
    }
    if (isTax && !isNaN(n) && n > 0 && !NOTE_RE.test(line.replace(/total/i, '')) && !/%\s*$/.test(line) && !/\b(tin|no\.?|number|id|reg\w*|#)\s*:?/i.test(line)) {
      q.taxes.push({ label: line.replace(/[\d,.]+\s*$/, '').trim() || 'Tax', rate: pctIn(line), amount: n });
      continue;
    }
    const endsWithNumber = !isNaN(parseNumber(line.split(' ').pop()));
    if (CONTACT_RE.test(line)) continue;
    if (isCharge && !isNaN(n) && n > 0 && endsWithNumber) {
      const item = parseItemLine(line);
      const label = line.replace(/[\d,.₹$£€]+\s*\/?-?\s*$/, '').replace(/[:\-–]+\s*$/, '').trim();
      if (!item || !/\b(qty|nos|pcs)\b/i.test(line)) {
        if (!/extra|@|per\s/i.test(line)) { q.charges.push({ label: label || 'Charge', amount: n }); continue; }
      }
    }
    const item = parseItemLine(line);
    if (item && !isTotal) { q.items.push(item); continue; }
    if (NOTE_RE.test(line) || isTax || isCharge) {
      const flags = classifyNote(line);
      if (/^(terms|terms\s*(&|and)\s*conditions|notes?|remarks)\s*:?$/i.test(line)) continue;
      if (flags.length || /note|term|\*|^\d+\./i.test(line)) { q.notes.push(line.replace(/^\s*(\*|note:?|\d+\.)\s*/i, '')); q.flags.push(...flags); }
    }
  }
  if (!q.supplier) q.supplier = guessSupplier(lines);
  return finalize(q);
}

function guessSupplier(lines) {
  for (const l of lines.slice(0, 5)) {
    if (/quotation|quote|invoice|receipt|date|to:|gstin|phone|mob|email|@|address|adres|account|bill(ing)?\b|:\s*$/i.test(l) && !/traders|supplies|depot|ltd|llc|inc|b\.v\.|gmbh|co\b/i.test(l)) continue;
    const s = l.replace(/[-–|].*(quotation|quote).*/i, '').trim();
    if (/[a-z]{3,}/i.test(s) && s.length <= 60) return titleCase(s);
  }
  return 'Supplier';
}

function titleCase(s) {
  if (s !== s.toUpperCase()) return s;
  return s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

// Spreadsheet rows (array of arrays) → quote
export function parseQuoteRows(rows, name = '') {
  const clean = rows.map((r) => (r || []).map((c) => (c == null ? '' : String(c).trim())));
  const headerIdx = clean.findIndex((r) => {
    const t = r.join(' ').toLowerCase();
    return /(item|description|particular|product|material)/.test(t) && /(qty|quantity)/.test(t) && /(rate|price|cost|amount|total)/.test(t);
  });
  if (headerIdx === -1) return parseQuoteText(clean.map((r) => r.filter(Boolean).join(' ')).join('\n'), name);
  const h = clean[headerIdx].map((c) => c.toLowerCase());
  const col = (re) => h.findIndex((c) => re.test(c));
  const cD = col(/item|desc|particular|product|material/), cQ = col(/qty|quantity/), cU = col(/^unit$|uom|^unit\b(?!.*(price|rate|cost))/);
  const cR = col(/rate|unit\s*price|price|cost/), cA = h.findIndex((c, i) => i !== cR && /amount|total|value/.test(c));
  const before = clean.slice(0, headerIdx).map((r) => r.filter(Boolean).join(' ')).filter(Boolean);
  const after = [];
  const q = { supplier: name, items: [], charges: [], taxes: [], subtotal: NaN, grandTotal: NaN, notes: [], flags: [], currency: detectCurrency(clean.flat().join(' ')), raw: clean.map((r) => r.join('\t')).join('\n') };
  for (const r of clean.slice(headerIdx + 1)) {
    const desc = r[cD] || '';
    const qty = parseNumber(r[cQ]), rate = parseNumber(r[cR]), amt = cA >= 0 ? parseNumber(r[cA]) : NaN;
    if (desc && qty > 0 && rate > 0 && !TOTAL_RE.test(desc) && !TAX_RE.test(desc)) {
      const amount = isNaN(amt) ? qty * rate : amt;
      q.items.push({ description: desc, qty, unit: cU >= 0 ? r[cU] : '', rate, amount, check: isNaN(amt) || near(qty * rate, amt) ? '' : `Qty × rate (${fmtPlain(qty * rate)}) doesn't match line total (${fmtPlain(amt)}). Check this line.` });
    } else {
      const t = r.filter(Boolean).join(' ');
      if (t) after.push(t);
    }
  }
  const tail = parseQuoteText(after.join('\n'), name);
  q.charges = tail.charges; q.taxes = tail.taxes; q.subtotal = tail.subtotal; q.grandTotal = tail.grandTotal;
  q.notes = tail.notes; q.flags = tail.flags;
  for (const l of before) { const f = classifyNote(l); if (f.length) { q.notes.push(l); q.flags.push(...f); } }
  q.supplier = name || guessSupplier(before) || 'Supplier';
  return finalize(q);
}

// Normalise output of the on-device AI into the same shape
export function fromAI(obj, name = '') {
  const q = { supplier: obj.supplier || name || 'Supplier', items: [], charges: [], taxes: [], subtotal: NaN, grandTotal: num(obj.grand_total), notes: [], flags: [], currency: obj.currency_symbol || '', raw: '' };
  for (const it of obj.items || []) {
    const qty = num(it.quantity), rate = num(it.unit_price); let amount = num(it.line_total);
    if (!(qty > 0) || !(rate > 0) || !it.description) continue;
    let check = '';
    if (isNaN(amount)) amount = qty * rate; else if (!near(qty * rate, amount)) check = `Qty × rate (${fmtPlain(qty * rate)}) doesn't match line total (${fmtPlain(amount)}). Check this line.`;
    q.items.push({ description: String(it.description).trim(), qty, unit: it.unit || '', rate, amount, check });
  }
  for (const c of obj.extra_charges || []) if (num(c.amount) > 0) q.charges.push({ label: c.label || 'Charge', amount: num(c.amount) });
  for (const t of obj.taxes || []) if (num(t.amount) > 0) q.taxes.push({ label: t.label || 'Tax', rate: num(t.rate_percent), amount: num(t.amount) });
  for (const n of obj.terms_and_notes || []) { q.notes.push(n); q.flags.push(...classifyNote(n)); }
  if (obj.prices_exclude_tax === true && !q.taxes.length && !q.flags.some((f) => f.kind === 'tax-extra')) q.flags.push({ kind: 'tax-extra', level: 'warn', text: 'Tax not included in prices', rate: num(obj.tax_rate_percent) });
  return finalize(q);
}
function num(v) { const n = parseNumber(v); return isNaN(n) ? NaN : n; }

function finalize(q) {
  // dedupe flags by kind+text
  const seen = new Set();
  q.flags = q.flags.filter((f) => { const k = f.kind + f.text; if (seen.has(k)) return false; seen.add(k); return true; });
  q.itemsTotal = q.items.reduce((s, i) => s + i.amount, 0);
  if (q.itemsTotal) q.taxes = q.taxes.filter((t) => t.amount < q.itemsTotal);
  if (!isNaN(q.subtotal) && q.items.length && !near(q.itemsTotal, q.subtotal)) q.flags.push({ kind: 'mismatch', level: 'warn', text: `Items add up to ${fmtPlain(q.itemsTotal)}, but the quote says ${fmtPlain(q.subtotal)}` });
  return q;
}

// ---------- Matching items across suppliers ----------
const SYN = [[/\bfiber\b/g, 'fibre'], [/\b(ltrs?|litres?|liters?)\b/g, 'l'], [/\b(mtrs?|metres?|meters?|mtr)\b/g, 'm'], [/\b(kgs?|kilograms?)\b/g, 'kg'], [/\b(feet|foot|ft)\b/g, 'ft'], [/\b(millimet(er|re)s?)\b/g, 'mm'], [/\b(watts?)\b/g, 'w'], [/\b(nos|pcs|pieces?|units?|each)\b/g, ' '], [/\bgalvani[sz]ed\s+iron\b/g, 'gi'], [/\bgl\b/g, 'gi']];
const STOP = new Set(['for', 'of', 'the', 'and', 'with', 'x', 'a', 'an', 'in', 'to', 'type', 'make', 'brand', 'size', 'qty', 'bag', 'bags', 'bucket', 'sheet', 'sheets']);

export function itemTokens(desc) {
  let s = ' ' + String(desc).toLowerCase() + ' ';
  s = s.replace(/(\d)'/g, '$1 ft ').replace(/(\d)"/g, '$1 in ');
  s = s.replace(/(\d)\s*[x×*]\s*(\d)/g, '$1 x $2');
  s = s.replace(/(\d)([a-z])/g, '$1 $2').replace(/([a-z])(\d)/g, '$1 $2');
  for (const [re, rep] of SYN) s = s.replace(re, rep);
  s = s.replace(/[^a-z0-9.\s]/g, ' ');
  const toks = s.split(/\s+/).filter(Boolean).map((t) => t.replace(/\.$/, '')).filter((t) => t && !STOP.has(t)).map((t) => (/^[a-z]{4,}s$/.test(t) && !/ss$/.test(t) ? t.slice(0, -1) : t));
  // 600 x 600 mm tiles ≈ 2 x 2 ft
  const out = new Set(toks);
  if (out.has('600') && (out.has('mm') || [...out].filter((t) => t === '600').length)) { out.add('2'); out.add('ft'); }
  return out;
}

export function similarity(a, b) {
  const A = a instanceof Set ? a : itemTokens(a), B = b instanceof Set ? b : itemTokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0, wInter = 0, wTot = 0;
  const w = (t) => (/^\d/.test(t) ? 1.5 : t.length <= 2 ? 0.6 : 1);
  for (const t of A) { wTot += w(t); if (B.has(t)) { inter++; wInter += w(t) * 2; } }
  for (const t of B) wTot += w(t);
  return wInter / wTot;
}

// Group items across quotes. Returns groups: [{id, name, members: {quoteIndex: itemIndex}}]
export function matchItems(quotes, threshold = 0.42) {
  const groups = [];
  const order = quotes.map((q, i) => i).sort((a, b) => quotes[b].items.length - quotes[a].items.length);
  for (const qi of order) {
    const q = quotes[qi];
    const toks = q.items.map((it) => itemTokens(it.description));
    const pairs = [];
    toks.forEach((t, ii) => groups.forEach((g, gi) => { if (g.members[qi] == null) pairs.push({ ii, gi, s: similarity(t, g.tokens) }); }));
    pairs.sort((a, b) => b.s - a.s);
    const usedI = new Set(), usedG = new Set();
    for (const p of pairs) {
      if (p.s < threshold || usedI.has(p.ii) || usedG.has(p.gi)) continue;
      groups[p.gi].members[qi] = p.ii; usedI.add(p.ii); usedG.add(p.gi);
    }
    toks.forEach((t, ii) => { if (!usedI.has(ii)) groups.push({ id: 'g' + groups.length, name: q.items[ii].description, tokens: t, members: { [qi]: ii } }); });
  }
  return groups;
}

// ---------- Comparison ----------
export function compare(quotes, groups, opts = {}) {
  const fallbackTax = opts.taxRate ?? inferTaxRate(quotes);
  const rows = groups.map((g) => {
    const cells = quotes.map((q, qi) => { const ii = g.members[qi]; return ii == null || !q.items[ii] ? null : { ...q.items[ii], index: ii }; });
    const present = cells.filter(Boolean);
    const minRate = present.length ? Math.min(...present.map((c) => c.rate)) : NaN;
    const maxRate = present.length ? Math.max(...present.map((c) => c.rate)) : NaN;
    const qtys = new Set(present.map((c) => c.qty));
    return { group: g, name: g.name, cells, minRate, maxRate, qtyDiffers: qtys.size > 1, spread: present.length > 1 ? maxRate - minRate : 0 };
  });
  const suppliers = quotes.map((q, qi) => {
    const items = rows.reduce((s, r) => s + (r.cells[qi] ? r.cells[qi].amount : 0), 0);
    const charges = q.charges.reduce((s, c) => s + c.amount, 0);
    let tax = q.taxes.reduce((s, t) => s + t.amount, 0), taxNote = tax ? 'as quoted' : '';
    const extraFlag = q.flags.find((f) => f.kind === 'tax-extra');
    const included = q.flags.some((f) => f.kind === 'tax-included');
    if (!tax && extraFlag && !included) {
      const rate = !isNaN(extraFlag.rate) ? extraFlag.rate : fallbackTax;
      tax = (items + charges) * rate / 100; taxNote = `${rate}% added (quote says tax extra)`;
    } else if (!tax && !included && fallbackTax > 0 && !extraFlag) {
      taxNote = 'no tax shown';
    }
    const missing = rows.filter((r) => !r.cells[qi]).map((r) => r.name);
    const landed = items + charges + tax;
    // cost to complete: buy missing items from the cheapest other supplier, paying that supplier's charges once
    const extraFrom = new Set();
    const fillItems = rows.filter((r) => !r.cells[qi] && r.cells.some(Boolean)).reduce((s, r) => {
      const best = r.cells.map((c, j) => (c ? { c, j } : null)).filter(Boolean).sort((a, b) => a.c.rate - b.c.rate)[0];
      extraFrom.add(best.j);
      return s + best.c.rate * (mostCommonQty(r) ?? best.c.qty);
    }, 0);
    const fillCharges = [...extraFrom].reduce((s, j) => s + quotes[j].charges.reduce((t, c) => t + c.amount, 0), 0);
    const fill = (fillItems + fillCharges) * (1 + fallbackTax / 100);
    const fillFrom = [...extraFrom];
    return { name: q.supplier, items, charges, tax, taxNote, landed, missing, completeCost: landed + fill, fillFrom, flags: q.flags, chargeList: q.charges, unpriced: q.flags.filter((f) => f.kind === 'charge-extra' || f.kind === 'ex-works') };
  });
  const complete = suppliers.map((s, i) => ({ ...s, i })).filter((s) => !s.missing.length);
  const cheapestComplete = complete.sort((a, b) => a.landed - b.landed)[0] || null;
  const byComplete = suppliers.map((s, i) => ({ ...s, i })).sort((a, b) => a.completeCost - b.completeCost);
  const lowestHeadline = suppliers.map((s, i) => ({ ...s, i })).sort((a, b) => a.items - b.items)[0];
  // best split ignoring each supplier's fixed charges
  const split = rows.map((r) => {
    const opts2 = r.cells.map((c, qi) => (c ? { qi, c } : null)).filter(Boolean).sort((a, b) => a.c.rate - b.c.rate);
    return opts2[0] ? { name: r.name, qi: opts2[0].qi, rate: opts2[0].c.rate, qty: mostCommonQty(r) ?? opts2[0].c.qty } : null;
  }).filter(Boolean);
  const splitSuppliers = [...new Set(split.map((s) => s.qi))];
  const splitItems = split.reduce((s, x) => s + x.rate * x.qty, 0);
  const splitCharges = splitSuppliers.reduce((s, qi) => s + suppliers[qi].charges, 0);
  const splitTotal = (splitItems + splitCharges) * (1 + fallbackTax / 100);
  return { rows, suppliers, cheapestComplete, ranking: byComplete, lowestHeadline, split: { lines: split, suppliers: splitSuppliers, total: splitTotal }, taxRate: fallbackTax };
}

function mostCommonQty(r) {
  const counts = new Map();
  r.cells.filter(Boolean).forEach((c) => counts.set(c.qty, (counts.get(c.qty) || 0) + 1));
  let best = null, n = 0;
  for (const [k, v] of counts) if (v > n) { best = k; n = v; }
  return best;
}

export function inferTaxRate(quotes) {
  for (const q of quotes) {
    for (const t of q.taxes) if (t.rate > 0) return t.rate;
    for (const f of q.flags) if (f.kind === 'tax-extra' && f.rate > 0) return f.rate;
  }
  for (const q of quotes) { const t = q.taxes[0]; const base = q.itemsTotal + q.charges.reduce((s, c) => s + c.amount, 0); if (t && base) return Math.round((t.amount / base) * 1000) / 10; }
  return 0;
}

// JSON schema for the on-device model
export const AI_SCHEMA = {
  type: 'object',
  properties: {
    supplier: { type: 'string' },
    currency_symbol: { type: 'string' },
    items: { type: 'array', items: { type: 'object', properties: { description: { type: 'string' }, quantity: { type: 'number' }, unit: { type: 'string' }, unit_price: { type: 'number' }, line_total: { type: 'number' } }, required: ['description', 'quantity', 'unit_price'] } },
    extra_charges: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, amount: { type: 'number' } }, required: ['label', 'amount'] } },
    taxes: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, rate_percent: { type: 'number' }, amount: { type: 'number' } }, required: ['label', 'amount'] } },
    prices_exclude_tax: { type: 'boolean' },
    tax_rate_percent: { type: 'number' },
    grand_total: { type: 'number' },
    terms_and_notes: { type: 'array', items: { type: 'string' } },
  },
  required: ['supplier', 'items'],
};

export const AI_PROMPT = `You are reading a supplier's price quotation. Extract it exactly as written.
- items: every product or service line with its quantity, unit, unit price and line total. Do not include totals, taxes or delivery/transport/installation/loading charges as items.
- extra_charges: transport, freight, delivery, loading, installation, packing or similar charges that have an amount.
- taxes: tax lines with an amount (GST, VAT, sales tax).
- prices_exclude_tax: true if the quote says tax is extra / excluded / "+ GST".
- terms_and_notes: every condition or note, word for word (payment terms, validity, stock, charges extra, delivery time).
Numbers must be plain numbers without currency symbols or thousand separators. If something is not on the quote, leave it out. Never invent values.`;
