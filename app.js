import { parseQuoteText, parseQuoteRows, fromAI, matchItems, compare, inferTaxRate, itemTokens, AI_SCHEMA, AI_PROMPT } from './parse.js';

const $ = (id) => document.getElementById(id);
const state = { quotes: [], taxRate: null, overrides: new Map() };
const SAMPLES = ['samples/apex-building-supplies.pdf', 'samples/buildmart-traders.csv', 'samples/shree-interiors-photo.jpg'];

// ---------- lazy library loading ----------
const loaded = {};
function loadScript(src) {
  if (!loaded[src]) loaded[src] = new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src)); document.head.appendChild(s); });
  return loaded[src];
}
let pdfjsP;
function pdfjs() {
  if (!pdfjsP) pdfjsP = import('./vendor/pdf.min.mjs').then((m) => { m.GlobalWorkerOptions.workerSrc = new URL('vendor/pdf.worker.min.mjs', location.href).href; return m; });
  return pdfjsP;
}
let ocrWorkerP;
async function ocrWorker(onProgress) {
  await loadScript('vendor/tesseract.min.js');
  if (!ocrWorkerP) {
    const base = new URL('vendor/', location.href).href;
    ocrWorkerP = window.Tesseract.createWorker('eng', 1, {
      workerPath: base + 'ocr-worker.js', workerBlobURL: false, corePath: base + 'tess', langPath: base + 'lang', gzip: true, cacheMethod: 'none',
      logger: (m) => { if (m.status === 'recognizing text' && ocrProgress) ocrProgress(m.progress); },
    }).then(async (w) => { await w.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' }); return w; });
  }
  ocrProgress = onProgress;
  return ocrWorkerP;
}
let ocrProgress = null;

// ---------- on-device AI (Chrome built-in Gemini Nano) ----------
const ai = { status: 'unavailable', session: null };
const AI_OPTS = { expectedInputs: [{ type: 'text', languages: ['en'] }, { type: 'image' }], expectedOutputs: [{ type: 'text', languages: ['en'] }] };
async function checkAI() {
  try {
    if (typeof LanguageModel === 'undefined') return setEngine('unavailable');
    const a = await LanguageModel.availability(AI_OPTS);
    setEngine(a);
  } catch { setEngine('unavailable'); }
}
function setEngine(status) {
  ai.status = status;
  const el = $('engine'), t = $('engineText');
  el.classList.toggle('ai', status === 'available');
  if (status === 'available') t.textContent = 'On-device AI ready (Gemini Nano)';
  else if (status === 'downloadable' || status === 'downloading') {
    t.innerHTML = 'On-device AI available. <button type="button" id="getAI">Turn on</button>';
    $('getAI').onclick = enableAI;
  } else t.textContent = 'Reading with on-device text recognition';
}
async function enableAI() {
  try {
    $('engineText').textContent = 'Downloading on-device AI… 0%';
    ai.session = await LanguageModel.create({ ...AI_OPTS, monitor(m) { m.addEventListener('downloadprogress', (e) => { $('engineText').textContent = `Downloading on-device AI… ${Math.round(e.loaded * 100)}%`; }); } });
    setEngine('available');
  } catch (e) { setEngine('unavailable'); toast('On-device AI could not start on this computer. Text recognition will be used instead.'); }
}
async function aiExtract(content) {
  if (!ai.session) ai.session = await LanguageModel.create(AI_OPTS);
  const s = await ai.session.clone();
  try {
    const parts = [{ type: 'text', value: AI_PROMPT }];
    if (content.image) parts.push({ type: 'image', value: content.image });
    if (content.text) parts.push({ type: 'text', value: 'Quotation text:\n' + content.text.slice(0, 6000) });
    const out = await s.prompt([{ role: 'user', content: parts }], { responseConstraint: AI_SCHEMA });
    return JSON.parse(out);
  } finally { s.destroy?.(); }
}

// ---------- reading files ----------
async function pdfToText(buf, progress) {
  const lib = await pdfjs();
  const doc = await lib.getDocument({ data: buf }).promise;
  const pages = [];
  for (let p = 1; p <= Math.min(doc.numPages, 15); p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const rows = [];
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const y = it.transform[5], x = it.transform[4];
      let row = rows.find((r) => Math.abs(r.y - y) < 3);
      if (!row) rows.push(row = { y, parts: [] });
      row.parts.push({ x, s: it.str });
    }
    rows.sort((a, b) => b.y - a.y);
    pages.push({ page, text: rows.map((r) => r.parts.sort((a, b) => a.x - b.x).map((p) => p.s).join(' ')).join('\n') });
    progress(p / doc.numPages * 0.5);
  }
  return pages;
}
async function renderPdfPage(page) {
  const vp = page.getViewport({ scale: 2.2 });
  const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
  await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
  return c;
}
async function prepImage(src) {
  const bmp = await createImageBitmap(src);
  const scale = Math.min(2.5, Math.max(1, 1800 / Math.max(bmp.width, bmp.height)));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  const g = c.getContext('2d'); g.filter = 'grayscale(1) contrast(1.25)'; g.drawImage(bmp, 0, 0, c.width, c.height);
  return c;
}
async function ocr(canvas, progress) {
  const w = await ocrWorker(progress);
  const { data } = await w.recognize(canvas);
  return data.text;
}

async function readQuote(file, q) {
  const name = file.name.toLowerCase();
  const nice = prettyName(file.name);
  const setP = (v) => { q.progress = v; renderProgress(q); };
  if (/\.(xlsx|xls|csv)$/.test(name)) {
    await loadScript('vendor/xlsx.full.min.js');
    const wb = window.XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const rows = window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' });
    return { ...named(parseQuoteRows(rows, ''), nice), engine: 'Spreadsheet' };
  }
  if (/\.txt$/.test(name)) return { ...named(parseQuoteText(await file.text(), ''), nice), engine: 'Text' };
  if (/\.pdf$/.test(name)) {
    const pages = await pdfToText(await file.arrayBuffer(), setP);
    const text = pages.map((p) => p.text).join('\n');
    if (text.replace(/\s/g, '').length > 40 * pages.length) {
      const parsed = named(parseQuoteText(text, ''), nice);
      if (parsed.items.length >= 1 || ai.status !== 'available') return { ...parsed, engine: 'PDF text' };
      return { ...fromAI(await aiExtract({ text }), nice), engine: 'On-device AI' };
    }
    // scanned PDF
    let all = '';
    for (let i = 0; i < pages.length; i++) {
      const canvas = await renderPdfPage(pages[i].page);
      if (ai.status === 'available') {
        try { const blob = await new Promise((r) => canvas.toBlob(r)); return { ...fromAI(await aiExtract({ image: blob }), nice), engine: 'On-device AI' }; } catch {}
      }
      all += await ocr(canvas, (v) => setP(0.5 + (i + v) / pages.length * 0.5)) + '\n';
    }
    return { ...named(parseQuoteText(all, ''), nice), engine: 'Text recognition' };
  }
  if (file.type.startsWith('image/') || /\.(jpe?g|png|webp|heic)$/.test(name)) {
    if (ai.status === 'available') {
      try { setP(0.3); const r = fromAI(await aiExtract({ image: file }), nice); if (r.items.length) return { ...r, engine: 'On-device AI' }; } catch (e) { console.warn('AI read failed, falling back to OCR', e); }
    }
    const canvas = await prepImage(file);
    const text = await ocr(canvas, setP);
    return { ...named(parseQuoteText(text, ''), nice), engine: 'Text recognition' };
  }
  throw new Error('This file type is not supported. Use PDF, Excel, CSV or an image.');
}

function named(q, fallback) { if (!q.supplier || q.supplier === 'Supplier') q.supplier = fallback; return q; }
function prettyName(fn) {
  return fn.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').replace(/\b(photo|quote|quotation|scan|img|image|final|copy)\b/gi, '').replace(/\s+/g, ' ').trim().replace(/\b[a-z]/g, (c) => c.toUpperCase()) || 'Supplier';
}

// ---------- flow ----------
async function addFiles(files) {
  files = [...files].slice(0, 10 - state.quotes.length);
  if (!files.length) return;
  $('reviewStep').hidden = false;
  const fresh = files.map((f) => ({ id: crypto.randomUUID(), file: f.name, status: 'reading', progress: 0.05, supplier: prettyName(f.name), items: [], charges: [], taxes: [], flags: [], notes: [] }));
  state.quotes.push(...fresh);
  renderCards();
  $('reviewStep').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  // images through OCR one at a time (shared worker); others in parallel
  for (let i = 0; i < files.length; i++) {
    const q = fresh[i];
    try {
      const r = await readQuote(files[i], q);
      Object.assign(q, r, { status: 'done', progress: 1 });
    } catch (e) {
      console.error(e);
      Object.assign(q, { status: 'error', error: e.message || 'Could not read this file' });
    }
    renderCards(); update();
  }
}

function update() {
  const ready = state.quotes.filter((q) => q.status === 'done' && q.items.length);
  $('compareStep').hidden = ready.length < 2;
  if (ready.length < 2) return;
  for (const q of ready) q.itemsTotal = q.items.reduce((s, i) => s + i.amount, 0);
  if (state.taxRate == null) { state.taxRate = inferTaxRate(ready); $('taxRate').value = state.taxRate; }
  let groups = matchItems(ready);
  groups = applyOverrides(groups, ready);
  state.groups = groups;
  state.result = compare(ready, groups, { taxRate: state.taxRate });
  state.ready = ready;
  renderCompare();
  renderMatchSelects();
}

// manual "compare as" choices
function applyOverrides(groups, quotes) {
  quotes.forEach((q, qi) => q.items.forEach((it, ii) => {
    const want = it.forceGroup; if (!want) return;
    const target = groups.find((g) => g.name === want);
    const current = groups.find((g) => g.members[qi] === ii);
    if (!target || target === current) return;
    if (current) delete current.members[qi];
    const displaced = target.members[qi];
    target.members[qi] = ii;
    if (displaced != null) groups.push({ id: 'g' + groups.length, name: q.items[displaced].description, tokens: itemTokens(q.items[displaced].description), members: { [qi]: displaced } });
  }));
  return groups.filter((g) => Object.keys(g.members).length);
}

// ---------- rendering: review cards ----------
function money(n, q) {
  if (n == null || isNaN(n)) return '–';
  const cur = q?.currency ?? state.ready?.[0]?.currency ?? '';
  const loc = cur === '₹' ? 'en-IN' : 'en-US';
  return cur + n.toLocaleString(loc, { maximumFractionDigits: Math.abs(n) < 100 && n % 1 ? 2 : 0 });
}
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function renderCards() {
  $('cards').innerHTML = state.quotes.map((q, qi) => `
    <article class="card" data-q="${qi}">
      <div class="card-top">
        <input class="name" value="${esc(q.supplier)}" aria-label="Supplier name" data-f="supplier">
        <div class="src"><span>${esc(q.file)}</span>${q.engine ? `<span class="badge ${q.engine === 'On-device AI' ? 'ai' : ''}">${esc(q.engine)}</span>` : ''}</div>
        ${q.status === 'reading' ? `<div class="progress" aria-label="Reading"><i style="width:${Math.round(q.progress * 100)}%"></i></div>` : ''}
      </div>
      ${q.status === 'reading' ? `<div class="empty-card">Reading this quote…</div>` : q.status === 'error' ? `<div class="empty-card">${esc(q.error)}</div>` : `
      <ul class="items">
        ${q.items.map((it, ii) => `<li class="${it.check ? 'check' : ''}" data-i="${ii}">
          <div class="row1"><input class="desc" value="${esc(it.description)}" data-f="description" aria-label="Item"><button class="x" data-del="${ii}" aria-label="Remove line" title="Remove line">✕</button></div>
          <div class="row2"><label>Qty <input class="n" inputmode="decimal" value="${it.qty}" data-f="qty"></label><label>Rate <input class="n" inputmode="decimal" value="${it.rate}" data-f="rate"></label><span class="amt">= ${money(it.amount, q)}</span></div>
          ${it.check ? `<div class="why">${esc(it.check)}</div>` : ''}
          <label class="match-wrap" hidden><span>Compared as</span> <select class="match" data-f="forceGroup"></select></label>
        </li>`).join('')}
        ${q.items.length ? '' : `<li class="empty-card">No price lines found. Add them below, or try a clearer photo.</li>`}
      </ul>
      <button class="add" data-add="item">+ Add line</button>
      <div class="card-foot">
        ${q.charges.map((c, ci) => `<div class="kv"><span>${esc(c.label)}</span><b>${money(c.amount, q)} <button class="x" data-delc="${ci}" aria-label="Remove charge">✕</button></b></div>`).join('')}
        ${q.taxes.map((t) => `<div class="kv"><span>${esc(t.label)}</span><b>${money(t.amount, q)}</b></div>`).join('')}
        <form class="charge-form" data-chargeform hidden><input name="label" placeholder="Delivery" aria-label="Charge name" required><input name="amount" class="amt-in" inputmode="decimal" placeholder="Amount" aria-label="Charge amount" required><button class="btn" type="submit">Add</button></form>
        <button class="add" style="padding:0" data-add="charge" type="button">+ Add delivery or other charge</button>
        ${q.flags.length ? `<div class="flags">${q.flags.map((f) => `<span class="flag ${f.level}">${esc(f.text)}</span>`).join('')}</div>` : ''}
      </div>`}
    </article>`).join('');
}
function renderProgress(q) {
  const i = state.quotes.indexOf(q);
  const bar = document.querySelector(`.card[data-q="${i}"] .progress i`);
  if (bar) bar.style.width = Math.round(Math.max(0.05, q.progress) * 100) + '%';
}
function renderMatchSelects() {
  if (!state.groups) return;
  document.querySelectorAll('.card').forEach((card) => {
    const q = state.quotes[+card.dataset.q]; const qi = state.ready.indexOf(q);
    if (qi < 0) return;
    card.querySelectorAll('li[data-i]').forEach((tr) => {
      const ii = +tr.dataset.i, sel = tr.querySelector('select.match');
      const g = state.groups.find((g) => g.members[qi] === ii);
      sel.innerHTML = state.groups.map((x) => `<option ${x === g ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
      sel.closest('.match-wrap').hidden = !g || g.name === q.items[ii].description;
    });
  });
}

$('cards').addEventListener('input', (e) => {
  const card = e.target.closest('.card'); if (!card) return;
  const q = state.quotes[+card.dataset.q], f = e.target.dataset.f;
  if (f === 'supplier') { q.supplier = e.target.value; return update(); }
  const tr = e.target.closest('li[data-i]'); if (!tr) return;
  const it = q.items[+tr.dataset.i];
  if (f === 'description') it.description = e.target.value;
  if (f === 'qty' || f === 'rate') { const v = parseFloat(e.target.value.replace(/,/g, '')); if (!isNaN(v)) { it[f] = v; it.amount = it.qty * it.rate; it.check = ''; tr.classList.remove('check'); tr.querySelector('.amt').textContent = '= ' + money(it.amount, q); } }
  update();
});
$('cards').addEventListener('change', (e) => {
  if (!e.target.matches('select.match')) return;
  const card = e.target.closest('.card'), tr = e.target.closest('li[data-i]');
  state.quotes[+card.dataset.q].items[+tr.dataset.i].forceGroup = e.target.value;
  update();
});
$('cards').addEventListener('click', (e) => {
  const card = e.target.closest('.card'); if (!card) return;
  const q = state.quotes[+card.dataset.q];
  if (e.target.dataset.del != null) { q.items.splice(+e.target.dataset.del, 1); renderCards(); update(); }
  if (e.target.dataset.delc != null) { q.charges.splice(+e.target.dataset.delc, 1); renderCards(); update(); }
  if (e.target.dataset.add === 'item') { q.items.push({ description: 'New item', qty: 1, rate: 0, amount: 0, unit: '', check: '' }); renderCards(); update(); card.querySelector('li[data-i]:last-of-type input')?.select(); }
  if (e.target.dataset.add === 'charge') { const f = card.querySelector('[data-chargeform]'); f.hidden = false; e.target.hidden = true; f.label.focus(); }
});
$('cards').addEventListener('submit', (e) => {
  if (!e.target.matches('[data-chargeform]')) return;
  e.preventDefault();
  const q = state.quotes[+e.target.closest('.card').dataset.q];
  const amount = parseFloat(e.target.amount.value.replace(/,/g, ''));
  if (isNaN(amount)) { e.target.amount.focus(); return toast('Enter the charge amount as a number'); }
  q.charges.push({ label: e.target.label.value.trim() || 'Charge', amount }); renderCards(); update();
});

// ---------- rendering: comparison ----------
function renderCompare() {
  const { rows, suppliers, ranking, split, cheapestComplete, lowestHeadline } = state.result;
  const qs = state.ready;
  const m = (n) => money(n, qs[0]);
  // best option overall
  const options = suppliers.map((s, i) => ({ kind: 'single', i, total: s.missing.length ? s.completeCost : s.landed, s }));
  if (split.suppliers.length > 1) options.push({ kind: 'split', total: split.total });
  options.sort((a, b) => a.total - b.total);
  const best = options[0];
  const worst = Math.max(...suppliers.map((s) => s.missing.length ? s.completeCost : s.landed));
  let big;
  if (best.kind === 'split') big = `Splitting the order between ${split.suppliers.map((i) => esc(suppliers[i].name)).join(' and ')} is cheapest at <mark>${m(best.total)}</mark>.`;
  else if (best.s.missing.length) big = `${esc(best.s.name)} plus ${best.s.missing.length} item${best.s.missing.length > 1 ? 's' : ''} bought elsewhere is cheapest at <mark>${m(best.total)}</mark>.`;
  else big = `${esc(best.s.name)} is the cheapest complete quote at <mark>${m(best.total)}</mark>, including charges and tax.`;
  const ins = [];
  if (lowestHeadline && (best.kind !== 'single' || best.i !== lowestHeadline.i)) {
    const lh = lowestHeadline; const extra = [];
    if (lh.missing.length) extra.push(`doesn't quote ${lh.missing.length === 1 ? esc(lh.missing[0]) : lh.missing.length + ' items'}`);
    if (lh.charges) extra.push(`adds ${m(lh.charges)} in charges`);
    if (/added/.test(lh.taxNote)) extra.push('leaves tax out of its prices');
    ins.push(`<b>Lowest prices aren't the cheapest deal</b>${esc(lh.name)} has the lowest item prices (${m(lh.items)}), but it ${extra.join(', ') || 'costs more overall'}.`);
  }
  ins.push(`<b>Gap between quotes</b>You save ${m(worst - best.total)} compared with the most expensive option.`);
  const pick = best.kind === 'single' ? suppliers[best.i] : null;
  const pickWarn = pick ? pick.flags.filter((f) => f.level === 'warn' && f.kind !== 'tax-extra') : [];
  if (pickWarn.length) ins.push(`<b>Before you order from ${esc(pick.name)}</b>${pickWarn.map((f) => esc(f.text)).join('. ')}.`);
  const biggest = ins.length >= 3 ? null : rows.filter((r) => r.spread > 0).sort((a, b) => b.spread * (b.cells.find(Boolean)?.qty || 1) - a.spread * (a.cells.find(Boolean)?.qty || 1))[0];
  if (biggest) {
    const lo = biggest.cells.findIndex((c) => c && c.rate === biggest.minRate), hi = biggest.cells.findIndex((c) => c && c.rate === biggest.maxRate);
    ins.push(`<b>Biggest price difference</b>${esc(biggest.name)}: ${m(biggest.minRate)} at ${esc(suppliers[lo].name)} vs ${m(biggest.maxRate)} at ${esc(suppliers[hi].name)}.`);
  }
  const risky = suppliers.map((s) => ({ s, w: s.flags.filter((f) => f.level === 'warn' && f.kind !== 'tax-extra') })).filter((x) => x.w.length).sort((a, b) => b.w.length - a.w.length)[0];
  if (risky && ins.length < 3 && risky.s !== pick) ins.push(`<b>Read before you order</b>${esc(risky.s.name)}: ${risky.w.map((f) => esc(f.text.toLowerCase())).join('; ')}.`);
  $('verdict').innerHTML = `<p class="big">${big}</p><ul class="insights">${ins.slice(0, 3).map((x) => `<li>${x}</li>`).join('')}</ul>`;

  // matrix
  const order = suppliers.map((s, i) => i);
  const rankOf = (i) => ranking.findIndex((r) => r.i === i) + 1;
  let delay = 0;
  const head = `<thead><tr><th>Item</th>${order.map((i) => `<th>${esc(suppliers[i].name)}<span class="rank">${suppliers[i].missing.length ? `${suppliers[i].missing.length} missing` : rankOf(i) === 1 ? 'Cheapest' : '#' + rankOf(i)}</span></th>`).join('')}</tr></thead>`;
  const body = rows.map((r) => `<tr><td>${esc(r.name)}${r.qtyDiffers ? '<span class="sub">Quantities differ, compare the rate</span>' : ''}</td>${order.map((i) => {
    const c = r.cells[i];
    if (!c) return `<td><span class="missing">Not quoted</span></td>`;
    const isBest = r.cells.filter(Boolean).length > 1 && c.rate === r.minRate;
    return `<td>${isBest ? `<span class="best" style="--d:${(delay++ * 0.06).toFixed(2)}s">${m(c.rate)}</span>` : m(c.rate)}<span class="sub">${c.qty}${c.unit ? ' ' + esc(c.unit) : ''} → ${m(c.amount)}</span></td>`;
  }).join('')}</tr>`).join('');
  const line = (label, fn, cls = 'sum') => `<tr class="${cls}"><td>${label}</td>${order.map((i) => `<td>${fn(suppliers[i], i)}</td>`).join('')}</tr>`;
  const foot = line('Items', (s) => m(s.items))
    + line('Delivery &amp; other charges', (s) => s.charges ? m(s.charges) + (s.chargeList.length ? `<span class="sub">${s.chargeList.map((c) => esc(c.label)).join(', ')}</span>` : '') : (s.unpriced.length ? '<span class="sub">extra, not priced</span>' : '–'))
    + line('Tax', (s) => (s.tax ? m(s.tax) : '–') + (s.taxNote && s.taxNote !== 'as quoted' ? `<span class="sub">${esc(s.taxNote)}</span>` : ''))
    + line('Total to pay', (s) => s.missing.length ? `${m(s.landed)}<span class="sub">${m(s.completeCost)} with missing items bought elsewhere</span>` : (best.kind === 'single' && suppliers[best.i] === s ? `<span class="best">${m(s.landed)}</span>` : m(s.landed)), 'sum total');
  $('matrix').innerHTML = head + `<tbody>${body}${foot}</tbody>`;

  // fine print
  $('fine').innerHTML = suppliers.map((s, i) => {
    const notes = (qs[i].notes || []).filter((n) => !/^(terms|terms\s*(&|and)\s*conditions|notes?)\s*:?$/i.test(n.trim()));
    return `<div class="card"><h3>${esc(s.name)}</h3>${s.flags.length ? `<div class="flags">${s.flags.map((f) => `<span class="flag ${f.level}">${esc(f.text)}</span>`).join('')}</div>` : '<span class="flag">No conditions found</span>'}${notes.length ? `<ul>${notes.slice(0, 6).map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}</div>`;
  }).join('');
}

// ---------- export ----------
async function exportXlsx() {
  await loadScript('vendor/xlsx.full.min.js');
  const { rows, suppliers } = state.result; const X = window.XLSX;
  const aoa = [['Item', ...suppliers.flatMap((s) => [s.name + ' rate', s.name + ' total'])]];
  rows.forEach((r) => aoa.push([r.name, ...r.cells.flatMap((c) => (c ? [c.rate, c.amount] : ['Not quoted', '']))]));
  aoa.push([]);
  aoa.push(['Items', ...suppliers.flatMap((s) => ['', Math.round(s.items * 100) / 100])]);
  aoa.push(['Charges', ...suppliers.flatMap((s) => ['', s.charges])]);
  aoa.push(['Tax', ...suppliers.flatMap((s) => [s.taxNote, Math.round(s.tax)])]);
  aoa.push(['Total to pay', ...suppliers.flatMap((s) => [s.missing.length ? 'missing ' + s.missing.length : '', Math.round(s.landed)])]);
  const fine = [['Supplier', 'Condition']];
  suppliers.forEach((s, i) => { s.flags.forEach((f) => fine.push([s.name, f.text])); (state.ready[i].notes || []).forEach((n) => fine.push([s.name, n])); });
  const wb = X.utils.book_new();
  const ws = X.utils.aoa_to_sheet(aoa); ws['!cols'] = [{ wch: 36 }, ...suppliers.flatMap(() => [{ wch: 16 }, { wch: 16 }])];
  X.utils.book_append_sheet(wb, ws, 'Comparison');
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(fine), 'Fine print');
  const buf = X.write(wb, { type: 'array', bookType: 'xlsx' });
  const dl = await downloadsP;
  if (dl) {
    try { await dl.save({ filename: 'quote-comparison.xlsx', data: new Blob([buf]) }); } catch (e) { if (e?.code !== 'declined') toast('The file could not be saved here.'); }
    return;
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })); a.download = 'quote-comparison.xlsx'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
// when shown inside Claude, files are saved through the viewer; on a normal website, a plain download
const downloadsP = window.claude?.use ? window.claude.use('downloads').catch(() => null) : Promise.resolve(null);
function summaryText() {
  const v = $('verdict');
  const lines = [v.querySelector('.big').textContent, ''];
  v.querySelectorAll('li').forEach((li) => lines.push('• ' + li.textContent.replace(/^(.+?)([A-Z])/, '$1: $2')));
  lines.push('');
  state.result.suppliers.forEach((s) => lines.push(`${s.name}: ${money(s.landed, state.ready[0])}${s.missing.length ? ` (missing ${s.missing.join(', ')})` : ''}`));
  return lines.join('\n');
}
function toast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 3200); }

// ---------- wiring ----------
const drop = $('drop');
['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));
$('files').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
$('sample').addEventListener('click', async (e) => {
  e.target.disabled = true;
  const files = await Promise.all(SAMPLES.map(async (u) => { const b = await (await fetch(u)).blob(); return new File([b], u.split('/').pop(), { type: b.type }); }));
  await addFiles(files);
});
$('taxRate').addEventListener('input', (e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) { state.taxRate = v; update(); } });
$('xlsx').addEventListener('click', exportXlsx);
$('copy').addEventListener('click', async () => { try { await navigator.clipboard.writeText(summaryText()); toast('Summary copied'); } catch { toast('Copy not allowed here'); } });
$('reset').addEventListener('click', () => { state.quotes = []; state.taxRate = null; $('cards').innerHTML = ''; $('reviewStep').hidden = true; $('compareStep').hidden = true; $('sample').disabled = false; scrollTo({ top: 0 }); });

checkAI();
window.__quotelens = state; // for testing
