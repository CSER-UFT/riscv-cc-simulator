/**
 * Interface: editor de MiniC, fases do compilador (tokens, árvore, símbolos, IR e RISC-V, pilha), execução,
 * idioma, tema e ajuda.
 */
import { compile } from './cc/compile.js';
import { interpret } from './cc/irinterp.js';
import { runAsm } from './cc/run.js';
import { str } from './cc/types.js';
import { EXAMPLES } from './examples.js';
import { minicLines, irLine, asmLine, esc } from './ui/highlight.js';
import { layoutTree, astSvg } from './ui/ast-svg.js';
import { frameSvg } from './ui/frame-svg.js';
import { tokensTex, symbolsTex, frameTex } from './ui/latex.js';
import { standaloneSvg } from './ui/svg-export.js';
import { Help } from './ui/help.js';
import { LANGUAGES, getLanguage, setLanguage, t } from './i18n/index.js';

const $ = (id) => document.getElementById(id);
const CPU_URL = 'https://cser-uft.github.io/riscv-cpu-simulator/';
const RUN_LIMIT = 2000000;
const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* só nesta visita */ } },
};

let last = null;                 // resultado da última compilação (com a execução)
let exampleId = EXAMPLES[0].id;  // exemplo carregado (null quando o texto foi editado)
let tab = store.get('cc.tab') || 'code';
let selection = { from: null, src: null, ir: null, asm: null };
let mark = null;                 // trecho do fonte em destaque: {start, end}
let errorLines = new Set();

// Editor -----------------------------------------------------------------------------------------------------

const code = $('src');

function refreshEditor() {
    const lines = code.value.split('\n');
    let g = '';
    for (let i = 1; i <= lines.length; i++) g += errorLines.has(i) ? `<span class="err">${i}</span>\n` : `${i}\n`;
    $('gutter').innerHTML = `<div class="code-inner">${g}</div>`;
    const hl = minicLines(code.value).map((h, i) => (errorLines.has(i + 1) ? `<span class="hl-err">${h || ' '}</span>` : h));
    $('highlight').innerHTML = `<div class="code-inner">${hl.join('\n')}\n</div>`;
    refreshMarks();
}

/** Camada de fundo: linha selecionada e trecho em destaque (token ou nó da árvore). */
function refreshMarks() {
    const lines = code.value.split('\n');
    let pos = 0;
    const html = lines.map((l, i) => {
        const a = pos, b = pos + l.length;
        pos = b + 1;
        let inner = esc(l);
        if (mark && mark.start < b + 1 && mark.end > a) {
            const s = Math.max(0, mark.start - a), e = Math.min(l.length, mark.end - a);
            inner = `${esc(l.slice(0, s))}<span class="mk">${esc(l.slice(s, e)) || ' '}</span>${esc(l.slice(e))}`;
        }
        return `<div class="ml${selection.src === i + 1 ? ' sel' : ''}">${inner || ' '}</div>`;
    }).join('');
    $('marks').innerHTML = `<div class="code-inner">${html}</div>`;
    syncScroll();
}

function syncScroll() {
    const x = code.scrollLeft, y = code.scrollTop;
    const g = $('gutter').firstElementChild;
    if (g) g.style.transform = `translateY(${-y}px)`;
    for (const id of ['highlight', 'marks']) {
        const h = $(id).firstElementChild;
        if (h) h.style.transform = `translate(${-x}px, ${-y}px)`;
    }
}

function caretLine() {
    return code.value.slice(0, code.selectionStart).split('\n').length;
}

function revealOffset(offset) {
    const line = code.value.slice(0, offset).split('\n').length;
    const top = (line - 1) * 20, h = code.clientHeight;
    if (top < code.scrollTop + 20 || top > code.scrollTop + h - 40) code.scrollTop = Math.max(0, top - h / 2);
    syncScroll();
}

let compileTimer = null;
code.addEventListener('scroll', syncScroll);
code.addEventListener('input', () => {
    exampleId = null;
    $('example').value = '';
    store.set('cc.code', code.value);
    store.set('cc.example', '');
    mark = null;
    refreshEditor();
    clearTimeout(compileTimer);
    compileTimer = setTimeout(() => runCompile(), 350);
});
code.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
        e.preventDefault();
        const { selectionStart: a, selectionEnd: b, value } = code;
        code.value = value.slice(0, a) + '    ' + value.slice(b);
        code.selectionStart = code.selectionEnd = a + 4;
        code.dispatchEvent(new Event('input'));
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        runCompile();
    }
});
for (const ev of ['click', 'keyup']) {
    code.addEventListener(ev, (e) => {
        if (ev === 'keyup' && !e.key.startsWith('Arrow') && !['Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) return;
        const l = caretLine();
        if (selection.from !== 'src' || selection.src !== l) select({ from: 'src', src: l });
    });
}

function goToLine(n) {
    const lines = code.value.split('\n');
    const start = lines.slice(0, n - 1).reduce((s, l) => s + l.length + 1, 0);
    code.focus();
    code.setSelectionRange(start, start + (lines[n - 1]?.length ?? 0));
    revealOffset(start);
    select({ from: 'src', src: n });
}
$('errors').addEventListener('click', (e) => { const li = e.target.closest('li[data-line]'); if (li) goToLine(+li.dataset.line); });

// Exemplos ---------------------------------------------------------------------------------------------------

const pickName = (e) => e.name[getLanguage()] ?? e.name.pt;
function fillExamples() {
    $('example').innerHTML = `<option value="">${t('cfg.own')}</option>` + EXAMPLES.map((e) => `<option value="${e.id}">${esc(pickName(e))}</option>`).join('');
    $('example').value = exampleId ?? '';
}
function loadExample(id) {
    const ex = EXAMPLES.find((e) => e.id === id);
    if (!ex) return;
    exampleId = id;
    code.value = ex.code;
    code.scrollTop = 0;
    store.set('cc.example', id);
    store.set('cc.code', ex.code);
    selection = { from: null, src: null, ir: null, asm: null };
    mark = null;
    astChoice = null;
}
$('example').onchange = () => { if ($('example').value) { loadExample($('example').value); runCompile(); } };

// Compilação e execução --------------------------------------------------------------------------------------

function runCompile() {
    clearTimeout(compileTimer);
    stop();
    const c = compile(code.value, { irComments: $('optIr').checked, srcComments: $('optSrc').checked, tr: t });
    if (c.phase === 'done') {
        c.interp = interpret(c.module, { maxSteps: RUN_LIMIT });
        c.run = runAsm(c, { maxInstructions: RUN_LIMIT });
    }
    last = c;
    errorLines = new Set(c.errors.map((e) => e.line));
    $('errors').innerHTML = c.errors.map((e) => `<li data-line="${e.line}">${esc(t('msg.line', { line: e.line, msg: e.message }))}</li>`).join('')
        + c.warnings.map((w) => `<li data-line="${w.line}" class="warn">${esc(t('msg.warn', { line: w.line, msg: w.message }))}</li>`).join('');
    refreshEditor();
    steppers.tokens.reset(c.tokens.filter((k) => k.kind !== 'eof').length);
    buildAst();
    renderPhases();
    renderTokens();
    renderSymbols();
    renderCode();
    renderFrames();
    renderRun();
    showTab(tab);
    renderSelection();
}

function renderPhases() {
    const order = ['lex', 'parse', 'sema', 'ir', 'asm', 'run'];
    const failed = last.errors.length ? last.phase : null;
    const reached = failed ? order.indexOf(failed) : order.length - 1;
    const runState = last.run ? (last.run.errors.length ? 'err' : last.run.reason === 'end' ? 'ok' : 'warn') : 'pending';
    const tabOf = { lex: 'tokens', parse: 'ast', sema: 'symbols', ir: 'code', asm: 'code', run: null };
    $('phases').innerHTML = order.map((p, k) => {
        let s = k < reached ? 'ok' : k === reached ? (failed ? 'err' : 'ok') : 'pending';
        if (p === 'run') s = failed ? 'pending' : runState;
        const tb = tabOf[p];
        return `<li class="ph ${s}"${tb ? ` data-tab="${tb}"` : ''}>${t(`phase.${p}`)}</li>`;
    }).join('');
}
$('phases').addEventListener('click', (e) => { const li = e.target.closest('li[data-tab]'); if (li) showTab(li.dataset.tab); });

function renderRun() {
    const box = $('runBox');
    if (!last.run) { box.innerHTML = `<p class="note">${t('run.none')}</p>`; return; }
    const r = last.run;
    if (r.errors.length) { box.innerHTML = `<ul class="errors">${r.errors.map((e) => `<li>${esc(e.message)}</li>`).join('')}</ul>`; return; }
    const fmt = (v) => (last.mainFloat ? String(v) : String(v));
    const reg = last.mainFloat ? 'fa0' : 'a0';
    const limit = r.reason !== 'end';
    const mismatch = !limit && last.interp.reason === 'end' && !Object.is(last.interp.ret, r.ret) && !(Number.isNaN(last.interp.ret) && Number.isNaN(r.ret));
    let h = '<table class="kv">';
    h += `<tr><th>${t('run.ret')}</th><td class="mono big">${limit ? '-' : esc(fmt(r.ret))} <span class="note">(${reg})</span></td></tr>`;
    h += `<tr><th>${t('run.asmExec')}</th><td>${r.executed}</td></tr>`;
    h += `<tr><th>${t('run.irExec')}</th><td>${last.interp.steps}</td></tr>`;
    h += `<tr><th>${t('run.static')}</th><td>${r.program.instructions.length}</td></tr>`;
    h += '</table>';
    if (limit) h += `<p class="note warn">${t('run.limit', { n: RUN_LIMIT })}</p>`;
    if (mismatch) h += `<p class="note warn">${t('run.mismatch')}</p>`;
    if (r.globals.size) {
        h += `<p class="note" style="margin:10px 0 4px">${t('run.globals')}</p><table><tr><th>${t('th.var')}</th><th>${t('th.values')}</th></tr>`;
        for (const [name, vals] of r.globals) h += `<tr><td class="mono">${esc(name)}</td><td class="mono left">${esc(vals.join(', '))}</td></tr>`;
        h += '</table>';
    }
    box.innerHTML = h;
}

// Passo a passo (tokens e árvore) ----------------------------------------------------------------------------

class Stepper {
    constructor(name, onShow) {
        this.root = document.querySelector(`[data-stepper="${name}"]`);
        this.onShow = onShow;
        this.n = 0;
        this.cur = 0;
        this.root.innerHTML = `
            <button type="button" class="btn icon-btn" data-k="first" data-i18n-title="ctl.start"><span class="icon i-skip-back" aria-hidden="true"></span></button>
            <button type="button" class="btn icon-btn" data-k="prev" data-i18n-title="ctl.back"><span class="icon i-step-back" aria-hidden="true"></span></button>
            <button type="button" class="btn outline" data-k="play"></button>
            <button type="button" class="btn icon-btn" data-k="next" data-i18n-title="ctl.fwd"><span class="icon i-step-fwd" aria-hidden="true"></span></button>
            <button type="button" class="btn icon-btn" data-k="last" data-i18n-title="ctl.end"><span class="icon i-skip-fwd" aria-hidden="true"></span></button>
            <input type="range" min="0" max="0" value="0" style="flex:1;min-width:120px" />
            <span class="note pos"></span>`;
        this.slider = this.root.querySelector('input');
        this.root.addEventListener('click', (e) => {
            const b = e.target.closest('button[data-k]');
            if (!b) return;
            const k = b.dataset.k;
            if (k === 'play') { play(); return; }
            stop();
            this.show({ first: 0, prev: this.cur - 1, next: this.cur + 1, last: this.n }[k]);
        });
        this.slider.addEventListener('input', () => { stop(); this.show(+this.slider.value); });
    }

    reset(n) {
        this.n = n;
        this.slider.max = n;
        this.cur = n;
        this.slider.value = n;
    }

    show(i) {
        this.cur = Math.max(0, Math.min(i, this.n));
        this.slider.value = this.cur;
        this.root.querySelector('.pos').textContent = t('step.pos', { i: this.cur, n: this.n });
        this.onShow(this.cur);
    }

    playLabel(on) {
        this.root.querySelector('[data-k="play"]').textContent = on ? `⏸ ${t('ctl.pause')}` : `▶ ${t('ctl.play')}`;
    }
}

const steppers = {
    tokens: new Stepper('tokens', (i) => showToken(i)),
    ast: new Stepper('ast', (i) => showAst(i)),
};
let timer = null;
const activeStepper = () => steppers[tab] ?? null;
function stop() {
    if (timer) { clearInterval(timer); timer = null; }
    for (const s of Object.values(steppers)) s.playLabel(false);
}
function play() {
    const s = activeStepper();
    if (!s) return;
    if (timer) { stop(); return; }
    if (s.cur >= s.n) s.show(0);
    timer = setInterval(() => { if (s.cur >= s.n) stop(); else s.show(s.cur + 1); }, tab === 'tokens' ? 450 : 600);
    s.playLabel(true);
}

// Tokens -----------------------------------------------------------------------------------------------------

function renderTokens() {
    const toks = last.tokens.filter((k) => k.kind !== 'eof');
    $('tokTable').innerHTML = `<tr><th>#</th><th>${t('th.tokKind')}</th><th>${t('th.lexeme')}</th><th>${t('th.pos')}</th><th>${t('th.value')}</th></tr>`
        + toks.map((k, i) => `<tr data-i="${i + 1}"><td>${i + 1}</td><td class="tk-${k.kind}">${t(`tok.${k.kind}`)}</td><td class="mono">${esc(k.text)}</td><td>${k.line}:${k.col}</td><td class="mono">${k.value !== undefined ? esc(String(k.value)) : ''}</td></tr>`).join('');
}
$('tokTable').addEventListener('click', (e) => { const tr = e.target.closest('tr[data-i]'); if (tr) { stop(); steppers.tokens.show(+tr.dataset.i); } });

function showToken(i) {
    const toks = last.tokens.filter((k) => k.kind !== 'eof');
    for (const tr of $('tokTable').querySelectorAll('tr[data-i]')) {
        const k = +tr.dataset.i;
        tr.classList.toggle('cur', k === i);
        tr.classList.toggle('future', k > i);
    }
    const tok = i > 0 ? toks[i - 1] : null;
    mark = tok && i < toks.length ? { start: tok.start, end: tok.end } : null;
    if (tok && i < toks.length) revealOffset(tok.start);
    refreshMarks();
    scrollRow($('tokBox'), $('tokTable').querySelector('tr.cur'));
}

function scrollRow(box, row) {
    if (!row) return;
    const top = row.offsetTop;
    if (top < box.scrollTop + 30 || top > box.scrollTop + box.clientHeight - 30) box.scrollTop = top - box.clientHeight / 2;
}

// Árvore sintática -------------------------------------------------------------------------------------------

let astView = null;   // {layout, order}
let astChoice = null; // função escolhida em Mostrar (null: padrão)
function buildAst() {
    const sel = $('astFn');
    if (!last.ast) {
        sel.innerHTML = '';
        astView = null;
        steppers.ast.reset(0);
        return;
    }
    const fns = last.ast.items.filter((n) => n.kind === 'Func' && n.body);
    sel.innerHTML = `<option value="">${t('ast.all')}</option>` + fns.map((f) => `<option value="${esc(f.name)}">${esc(t('ast.fn', { name: f.name }))}</option>`).join('');
    // Sem escolha do usuário, programas com várias funções começam pela última (em geral, main).
    const exists = (v) => [...sel.options].some((o) => o.value === v);
    sel.value = astChoice !== null && exists(astChoice) ? astChoice : (fns.length > 1 ? fns[fns.length - 1].name : '');
    layoutAst();
}
function layoutAst() {
    const id = $('astFn').value;
    const root = id === '' ? last.ast : last.ast.items.find((n) => n.kind === 'Func' && n.body && n.name === id);
    const layout = layoutTree(root, t);
    const order = layout.items.map((it) => it.n.id).sort((a, b) => (a === -1) - (b === -1) || a - b);
    astView = { layout, order };
    steppers.ast.reset(order.length);
}
$('astFn').onchange = () => { astChoice = $('astFn').value; stop(); layoutAst(); steppers.ast.show(steppers.ast.n); };

let astSelected = null;
function showAst(i) {
    if (!astView) { $('astFig').innerHTML = ''; return; }
    const shown = new Set(astView.order.slice(0, i));
    const current = i > 0 && i < astView.order.length ? astView.order[i - 1] : null;
    $('astFig').innerHTML = astSvg(astView.layout, shown, current, astSelected);
    const n = current !== null ? last.nodes[current] : null;
    if (n && tab === 'ast') {
        const tok = last.tokens.find((k) => k.line === n.line && k.col === n.col);
        mark = tok ? { start: tok.start, end: tok.end } : null;
        if (tok) revealOffset(tok.start);
        refreshMarks();
        const el = $('astFig').querySelector('.nd.cur');
        if (el) {
            const box = $('astFig'), r = el.getBoundingClientRect(), b = box.getBoundingClientRect();
            if (r.left < b.left || r.right > b.right) box.scrollLeft += r.left - b.left - b.width / 2;
        }
    } else if (tab === 'ast') { mark = null; refreshMarks(); }
}
$('astFig').addEventListener('click', (e) => {
    const g = e.target.closest('g.node');
    if (!g) return;
    astSelected = +g.dataset.id;
    select({ from: 'src', src: +g.dataset.line });
    showAst(steppers.ast.cur);
});

// Tabela de símbolos -----------------------------------------------------------------------------------------

function symbolRows() {
    if (!last.sema) return [];
    const rows = [];
    const slotOf = new Map();
    for (const f of last.frames ?? []) for (const s of f.slots) if (s.sym !== undefined) slotOf.set(s.sym, s);
    const scopeName = (sc) => {
        if (sc.kind === 'global') return t('scope.global');
        if (sc.kind === 'function') return t('scope.function', { name: sc.name });
        return t(sc.name === 'for' ? 'scope.for' : 'scope.block', { line: sc.line });
    };
    const walk = (sc, depth) => {
        for (const s of sc.symbols) {
            let type = str(s.type), where = '';
            if (s.kind === 'func') {
                type = `${str(s.fn.ret)} (${s.fn.params.map((p) => str(p.type)).join(', ')})`;
                where = s.fn.defined ? `${s.name}:` : '';
            } else if (s.kind === 'global') where = `${s.name} (.data)`;
            else if (slotOf.has(s.id)) where = `${slotOf.get(s.id).off}(s0)`;
            rows.push({ name: s.name, cat: t(`cat.${s.kind}`), type, scope: scopeName(sc), line: s.line, uses: s.uses, where, depth });
        }
        for (const c of sc.children) walk(c, depth + 1);
    };
    walk(last.sema.scopes, 0);
    return rows;
}
function renderSymbols() {
    const rows = symbolRows();
    $('symTable').innerHTML = `<tr><th>${t('th.name')}</th><th>${t('th.cat')}</th><th>${t('th.type')}</th><th>${t('th.scope')}</th><th>${t('th.line')}</th><th>${t('th.uses')}</th><th>${t('th.where')}</th></tr>`
        + rows.map((r) => `<tr data-line="${r.line}"><td class="mono left" style="padding-left:${6 + 14 * r.depth}px">${esc(r.name)}</td><td>${esc(r.cat)}</td><td class="mono">${esc(r.type)}</td><td>${esc(r.scope)}</td><td>${r.line}</td><td>${r.uses}</td><td class="mono">${esc(r.where)}</td></tr>`).join('');
}
$('symTable').addEventListener('click', (e) => { const tr = e.target.closest('tr[data-line]'); if (tr) goToLine(+tr.dataset.line); });

// IR e RISC-V ------------------------------------------------------------------------------------------------

function renderCode() {
    if (last.phase !== 'done') { $('irView').innerHTML = ''; $('asmView').innerHTML = ''; $('codeStats').textContent = ''; return; }
    const view = (text, fn) => text.replace(/\n$/, '').split('\n').map((l, i) => `<div class="cl" data-i="${i}"><span class="ln">${i + 1}</span><span class="tx">${fn(l) || ' '}</span></div>`).join('');
    $('irView').innerHTML = view(last.ir.text, irLine);
    $('asmView').innerHTML = view(last.asm.text, asmLine);
    let nIr = 0;
    for (const F of last.module.functions) for (const b of F.blocks) nIr += b.insts.length;
    $('codeStats').textContent = t('code.stats', { ir: nIr, asm: last.run?.program?.instructions.length ?? 0 });
}

function select(sel) {
    selection = { from: null, src: null, ir: null, asm: null, ...sel };
    if (sel.from !== 'src') mark = null;
    renderSelection();
}

function renderSelection() {
    refreshMarks();
    if (!last || last.phase !== 'done') return;
    const { from } = selection;
    const irL = last.ir.lines, asmL = last.asm.lines;
    let irSet = new Set(), asmSet = new Set();
    if (from === 'ir') {
        irSet.add(selection.ir);
        asmL.forEach((l, j) => { if (l.ir === selection.ir || l.ir2 === selection.ir) asmSet.add(j); });
    } else if (from === 'asm') {
        const a = asmL[selection.asm];
        if (a.ir !== null) irSet.add(a.ir);
        if (a.ir2 !== null) irSet.add(a.ir2);
        asmL.forEach((l, j) => { if (j === selection.asm || (a.ir !== null && l.ir === a.ir)) asmSet.add(j); });
    } else if (selection.src) {
        irL.forEach((l, i) => { if (l.src === selection.src) irSet.add(i); });
        asmL.forEach((l, j) => { if (l.src === selection.src) asmSet.add(j); });
    }
    const paint = (box, set, cur) => {
        let first = null;
        for (const row of box.children) {
            const i = +row.dataset.i;
            row.classList.toggle('sel', set.has(i));
            row.classList.toggle('cur', i === cur);
            if (set.has(i) && first === null) first = row;
        }
        return first;
    };
    const fi = paint($('irView'), irSet, from === 'ir' ? selection.ir : null);
    const fa = paint($('asmView'), asmSet, from === 'asm' ? selection.asm : null);
    if (from !== 'ir') scrollRow($('irView'), fi);
    if (from !== 'asm') scrollRow($('asmView'), fa);
}

for (const [id, kind] of [['irView', 'ir'], ['asmView', 'asm']]) {
    $(id).addEventListener('click', (e) => {
        const row = e.target.closest('.cl');
        if (!row) return;
        const i = +row.dataset.i;
        const src = (kind === 'ir' ? last.ir.lines : last.asm.lines)[i]?.src ?? null;
        select({ from: kind, [kind]: i, src });
        if (src) {
            const lines = code.value.split('\n');
            revealOffset(lines.slice(0, src - 1).reduce((s, l) => s + l.length + 1, 0));
        }
    });
}

// Pilha ------------------------------------------------------------------------------------------------------

function renderFrames() {
    const sel = $('frameFn');
    const prev = sel.value;
    if (!last.frames) { sel.innerHTML = ''; $('frameFig').innerHTML = ''; return; }
    sel.innerHTML = last.frames.map((f) => `<option value="${esc(f.fn)}">${esc(f.fn)}</option>`).join('');
    sel.value = last.frames.some((f) => f.fn === prev) ? prev : last.frames[0].fn;
    drawFrame();
}
function currentFrame() { return last.frames?.find((f) => f.fn === $('frameFn').value) ?? null; }
function drawFrame() {
    const f = currentFrame();
    $('frameFig').innerHTML = f ? frameSvg(f, t) : '';
}
$('frameFn').onchange = drawFrame;

// Abas -------------------------------------------------------------------------------------------------------

function available(name) {
    if (!last) return false;
    switch (name) {
        case 'tokens': return true;
        case 'ast': return !!last.ast;
        case 'symbols': return !!last.sema;
        default: return last.phase === 'done';
    }
}

function showTab(name) {
    stop();
    tab = name;
    store.set('cc.tab', name);
    for (const b of $('tabs').querySelectorAll('[data-tab]')) b.classList.toggle('sel', b.dataset.tab === name);
    const ok = available(name);
    for (const p of document.querySelectorAll('.pane')) p.classList.toggle('hidden', !ok || p.id !== `pane-${name}`);
    $('pending').classList.toggle('hidden', ok);
    mark = null;
    if (ok && steppers[name]) steppers[name].show(steppers[name].cur);
    else refreshMarks();
}
$('tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) showTab(b.dataset.tab); });

// Exportações ------------------------------------------------------------------------------------------------

function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const baseName = () => exampleId ?? 'programa';
$('tokTex').onclick = () => last && download(`${baseName()}-tokens.tex`, tokensTex(last.tokens), 'application/x-tex');
$('symTex').onclick = () => last?.sema && download(`${baseName()}-${getLanguage() === 'en' ? 'symbols' : 'simbolos'}.tex`, symbolsTex(symbolRows()), 'application/x-tex');
$('frameTex').onclick = () => { const f = currentFrame(); if (f) download(`${f.fn}-${getLanguage() === 'en' ? 'frame' : 'quadro'}.tex`, frameTex(f), 'application/x-tex'); };
$('dlLl').onclick = () => last?.ir && download(`${baseName()}.ll`, last.ir.text, 'text/plain');
$('dlS').onclick = () => last?.asm && download(`${baseName()}.s`, last.asm.text, 'text/plain');
$('astSvg').onclick = () => {
    const svg = $('astFig').querySelector('svg');
    if (svg) download(`${baseName()}-${getLanguage() === 'en' ? 'tree' : 'arvore'}-${steppers.ast.cur}.svg`, standaloneSvg(svg), 'image/svg+xml');
};
$('frameSvg').onclick = () => {
    const svg = $('frameFig').querySelector('svg');
    if (svg) download(`${$('frameFn').value}-${getLanguage() === 'en' ? 'frame' : 'quadro'}.svg`, standaloneSvg(svg), 'image/svg+xml');
};

function encodeShare(obj) {
    const bytes = new TextEncoder().encode(JSON.stringify(obj));
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
$('cpu').onclick = () => {
    if (!last || last.phase !== 'done') return;
    const payload = { code: last.asm.text, config: { mode: 'pipeline', xlen: 32, exampleValues: false, maxCycles: 100000 }, view: 'sim' };
    window.open(`${CPU_URL}#s=${encodeShare(payload)}`, '_blank', 'noopener');
};

$('run').onclick = () => runCompile();
$('optIr').onchange = () => runCompile();
$('optSrc').onchange = () => runCompile();

// Teclado: setas avançam e voltam o passo a passo da aba aberta (tokens ou árvore).
document.addEventListener('keydown', (e) => {
    // Botões não bloqueiam as setas (o foco fica neles depois de um clique); a barra de espaço num botão é o clique.
    if (help.isOverlay() || e.target.closest('textarea, input, select') || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    if (e.key === ' ' && e.target.closest('button')) return;
    const s = activeStepper();
    if (!s || !available(tab)) return;
    const keys = { ArrowRight: () => s.show(s.cur + 1), ArrowLeft: () => s.show(s.cur - 1), Home: () => s.show(0), End: () => s.show(s.n) };
    if (keys[e.key]) { e.preventDefault(); stop(); keys[e.key](); } else if (e.key === ' ') { e.preventDefault(); play(); }
});

// Tema, idioma e ajuda ---------------------------------------------------------------------------------------

const themeButton = $('theme-toggle');
function updateThemeIcon() {
    const dark = document.documentElement.dataset.theme === 'dark';
    themeButton.querySelector('.icon').className = `icon ${dark ? 'i-sun' : 'i-moon'}`;
    themeButton.setAttribute('aria-pressed', String(dark));
}
themeButton.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    store.set('cc.theme', next);
    updateThemeIcon();
});
updateThemeIcon();

const help = new Help($('readme'));
$('open-ajuda').addEventListener('click', () => (help.isOverlay() ? help.close() : help.open()));
document.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-help]');
    if (a) { e.preventDefault(); help.open(a.dataset.help); }
});

const langSelect = $('lang-select');
langSelect.innerHTML = Object.entries(LANGUAGES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
langSelect.value = getLanguage();
function applyDomTranslations() {
    document.documentElement.lang = getLanguage() === 'en' ? 'en' : 'pt-BR';
    document.title = t('ui.docTitle');
    for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
    for (const el of document.querySelectorAll('[data-i18n-html]')) el.innerHTML = t(el.dataset.i18nHtml);
    for (const el of document.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
    stop();
    help.render();
}
langSelect.addEventListener('change', () => {
    setLanguage(langSelect.value);
    applyDomTranslations();
    fillExamples();
    const cur = { tokens: steppers.tokens.cur, ast: steppers.ast.cur };
    runCompile();
    steppers.tokens.cur = Math.min(cur.tokens, steppers.tokens.n);
    steppers.ast.cur = Math.min(cur.ast, steppers.ast.n);
    showTab(tab);
});

// Início -----------------------------------------------------------------------------------------------------

applyDomTranslations();
const savedEx = store.get('cc.example');
const savedCode = store.get('cc.code');
if (savedEx === '' && savedCode) { exampleId = null; code.value = savedCode; } else loadExample(EXAMPLES.some((e) => e.id === savedEx) ? savedEx : EXAMPLES[0].id);
fillExamples();
runCompile();
