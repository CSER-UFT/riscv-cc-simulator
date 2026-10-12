/**
 * Interface: editor de MiniC, fases do compilador (tokens, árvore, símbolos, IR e RISC-V, pilha), execução,
 * idioma, tema e ajuda.
 */
import { compile, compileLL } from './cc/compile.js';
import { interpret } from './cc/irinterp.js';
import { runAsm } from './cc/run.js';
import { str } from './cc/types.js';
import { EXAMPLES, exampleCode } from './examples.js';
import { EXAMPLES_LL } from './examples-ll.js';
import { minicLines, irLine, asmLine, esc } from './ui/highlight.js';
import { layoutTree, astSvg } from './ui/ast-svg.js';
import { frameSvg } from './ui/frame-svg.js';
import { analyzeCfg } from './cc/cfg.js';
import { blockDfg, defUse, LATENCY, listSchedule, alapSchedule, UNITS } from './cc/dfg.js';
import { valueText } from './cc/irgen.js';
import { layoutCfg, cfgSvg, domTreeSvg } from './ui/cfg-svg.js';
import { layoutDfg, dfgSvg, shortText } from './ui/dfg-svg.js';
import { cfgDot, domDot, dfgDot } from './ui/dot.js';
import { tokensTex, symbolsTex, frameTex, domTex, dfgTex, blocksTex } from './ui/latex.js';
import { blockFrequencies, blockCounts, simulateProfile } from './cc/profile.js';
import { buildVariant } from './cc/compile.js';
import { optimize, CLASSIC, perforableLoops, outputError } from './cc/opt.js';
import { sweep as sweepPoint, SWEEPS } from './cc/experiment.js';
import { optChartSvg } from './ui/opt-chart.js';
import { standaloneSvg } from './ui/svg-export.js';
import { Help } from './ui/help.js';
import { LANGUAGES, getLanguage, setLanguage, t } from './i18n/index.js';

const $ = (id) => document.getElementById(id);
const CPU_URL = 'https://cser-uft.github.io/riscv-cpu-simulator/';
const RUN_LIMIT = 2000000;
// Enquanto se digita, um limite menor: um laço infinito não trava o editor. O botão Compilar usa o limite cheio.
const LIVE_LIMIT = 100000;
let runLimit = RUN_LIMIT;
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
// Linguagem do editor: MiniC ou IR do LLVM importada (.ll); cada uma guarda o seu texto.
let srcLang = store.get('cc.srcLang') === 'll' ? 'll' : 'c';
const codeKey = () => (srcLang === 'll' ? 'cc.code.ll' : 'cc.code');
const exKey = () => (srcLang === 'll' ? 'cc.example.ll' : 'cc.example');
const SRC_TABS = ['tokens', 'ast', 'symbols'];
let level = ['ssa', 'opt'].includes(store.get('cc.level')) ? store.get('cc.level') : 'O0';   // IR mostrada

/** IR, assembly e quadros do nível escolhido: sem otimização, depois da mem2reg ou com as otimizações escolhidas. */
function V() {
    if (level === 'opt') return getOpt();
    return level === 'ssa' ? { ...last.ssa, key: 'ssa', interp: last.ssaInterp, run: last.ssaRun }
        : { module: last.module, ir: last.ir, asm: last.asm, frames: last.frames, report: null, key: 'O0', interp: last.interp, run: last.run };
}
const irTitleKey = () => ({ O0: 'code.ir', ssa: 'code.irSsa', opt: 'code.irOpt' })[level];

// Editor -----------------------------------------------------------------------------------------------------

const code = $('src');

function refreshEditor() {
    const lines = code.value.split('\n');
    let g = '';
    for (let i = 1; i <= lines.length; i++) g += errorLines.has(i) ? `<span class="err">${i}</span>\n` : `${i}\n`;
    $('gutter').innerHTML = `<div class="code-inner">${g}</div>`;
    const hl = (srcLang === 'll' ? code.value.split('\n').map(irLine) : minicLines(code.value)).map((h, i) => (errorLines.has(i + 1) ? `<span class="hl-err">${h || ' '}</span>` : h));
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
        const h = tab === 'heat' && heatView ? heatView.srcI.get(i + 1) : undefined;
        const style = h !== undefined && selection.src !== i + 1 ? ` style="${heatBg(h)}"` : '';
        return `<div class="ml${selection.src === i + 1 ? ' sel' : ''}"${style}>${inner || ' '}</div>`;
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
    store.set(codeKey(), code.value);
    store.set(exKey(), '');
    mark = null;
    refreshEditor();
    clearTimeout(compileTimer);
    compileTimer = setTimeout(() => runCompile(false), 350);
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
    code.value = srcLang === 'll' ? EXAMPLES_LL[id] : exampleCode(ex, getLanguage());
    code.scrollTop = 0;
    store.set(exKey(), id);
    store.set(codeKey(), code.value);
    selection = { from: null, src: null, ir: null, asm: null };
    mark = null;
    astChoice = null;
}
$('example').onchange = () => { if ($('example').value) { loadExample($('example').value); runCompile(); } };

// Compilação e execução --------------------------------------------------------------------------------------

function runCompile(full = true) {
    runLimit = full ? RUN_LIMIT : LIVE_LIMIT;
    clearTimeout(compileTimer);
    stop();
    const opts = { irComments: $('optIr').checked, srcComments: $('optSrc').checked, tr: t, regalloc: $('optRA').checked, schedule: $('optSched').value };
    const c = (srcLang === 'll' ? compileLL : compile)(code.value, opts);
    if (c.phase === 'done') {
        c.interp = interpret(c.module, { maxSteps: runLimit });
        c.run = runAsm(c, { maxInstructions: runLimit });
        c.ssaInterp = interpret(c.ssa.module, { maxSteps: runLimit });
        c.ssaRun = runAsm({ ...c, module: c.ssa.module, asm: c.ssa.asm }, { maxInstructions: runLimit });
    }
    last = c;
    errorLines = new Set(c.errors.map((e) => e.line));
    $('errors').innerHTML = c.errors.map((e) => `<li data-line="${e.line}">${esc(t('msg.line', { line: e.line, msg: e.message }))}</li>`).join('')
        + c.warnings.map((w) => `<li data-line="${w.line}" class="warn">${esc(t('msg.warn', { line: w.line, msg: w.message }))}</li>`).join('');
    refreshEditor();
    steppers.tokens.reset((c.tokens ?? []).filter((k) => k.kind !== 'eof').length);
    buildAst();
    renderPhases();
    renderTokens();
    renderSymbols();
    renderCode();
    renderFrames();
    renderRun();
    fillOptLoops();
    if (c.phase === 'done' && level === 'opt') getOpt();
    renderCfg();
    renderDfg();
    heatView = null;
    optView = null;
    showTab(tab);
    renderSelection();
}

function renderPhases() {
    const order = ['lex', 'parse', 'sema', 'ir', 'asm', 'run'];
    // Com um .ll importado, as três primeiras fases não existem; a importação é a fase da IR.
    const imported = last.lang === 'll';
    const failed = last.errors.length ? (last.phase === 'll' ? 'ir' : last.phase) : null;
    const reached = failed ? order.indexOf(failed) : order.length - 1;
    const runState = last.run ? (last.run.errors.length ? 'err' : last.run.reason === 'end' ? 'ok' : 'warn') : 'pending';
    const tabOf = { lex: 'tokens', parse: 'ast', sema: 'symbols', ir: 'code', asm: 'code', run: null };
    $('phases').innerHTML = order.map((p, k) => {
        let s = k < reached ? 'ok' : k === reached ? (failed ? 'err' : 'ok') : 'pending';
        if (p === 'run') s = failed ? 'pending' : runState;
        if (imported && k < 3) s = 'skip';
        const tb = imported && k < 3 ? null : tabOf[p];
        const label = imported && p === 'ir' ? t('phase.llImport') : t(`phase.${p}`);
        return `<li class="ph ${s}"${tb ? ` data-tab="${tb}"` : ''}${s === 'skip' ? ` title="${esc(t('phase.skipLl'))}"` : ''}>${label}</li>`;
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
    const q = last.ssaRun;
    let h = '<table class="kv">';
    h += `<tr><th>${t('run.ret')}</th><td class="mono big" colspan="2">${limit ? '-' : esc(fmt(r.ret))} <span class="note">(${reg})</span></td></tr>`;
    h += `<tr><th></th><td class="note">${t('run.colO0')}</td><td class="note">${t('run.colSsa')}</td></tr>`;
    h += `<tr><th>${t('run.asmExec')}</th><td>${fmtNum(r.executed)}</td><td>${q.errors.length ? '-' : fmtNum(q.executed)}</td></tr>`;
    h += `<tr><th>${t('run.irExec')}</th><td>${fmtNum(last.interp.steps)}</td><td>${fmtNum(last.ssaInterp.steps)}</td></tr>`;
    h += `<tr><th>${t('run.static')}</th><td>${r.program.instructions.length}</td><td>${q.errors.length ? '-' : q.program.instructions.length}</td></tr>`;
    // Ciclos nos modelos do simulador de processadores (o efeito da alocação e do escalonamento aparece aqui).
    const cyc = (v, model) => {
        const p = profileOf(v, model);
        if (p.errors?.length) return '-';
        return p.finished ? fmtNum(p.cycles) : `> ${fmtNum(p.cycles)}`;
    };
    const vO0 = { key: 'O0', asm: last.asm }, vSsa = { key: 'ssa', asm: last.ssa.asm };
    for (const model of ['pipeline', 'dual'])
        h += `<tr><th>${t(`run.cycles.${model}`)}</th><td>${cyc(vO0, model)}</td><td>${q.errors.length ? '-' : cyc(vSsa, model)}</td></tr>`;
    h += '</table>';
    h += `<p class="note">${t(last.genOpts?.regalloc ? 'run.ssaNoteRA' : 'run.ssaNote')}</p>`;
    if (limit) h += `<p class="note warn">${t('run.limit', { n: fmtNum(runLimit) })}${runLimit < RUN_LIMIT ? ` ${t('run.liveLimit')}` : ''}</p>`;
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
    const toks = (last.tokens ?? []).filter((k) => k.kind !== 'eof');
    $('tokTable').innerHTML = `<tr><th>#</th><th>${t('th.tokKind')}</th><th>${t('th.lexeme')}</th><th>${t('th.pos')}</th><th>${t('th.value')}</th></tr>`
        + toks.map((k, i) => `<tr data-i="${i + 1}"><td>${i + 1}</td><td class="tk-${k.kind}">${t(`tok.${k.kind}`)}</td><td class="mono">${esc(k.text)}</td><td>${k.line}:${k.col}</td><td class="mono">${k.value !== undefined ? esc(String(k.value)) : ''}</td></tr>`).join('');
}
$('tokTable').addEventListener('click', (e) => { const tr = e.target.closest('tr[data-i]'); if (tr) { stop(); steppers.tokens.show(+tr.dataset.i); } });

function showToken(i) {
    if (!last.tokens) return;
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
    const v = V();
    $('irView').innerHTML = view(v.ir.text, irLine);
    $('asmView').innerHTML = view(v.asm.text, asmLine);
    $('irTitle').textContent = t(irTitleKey());
    let nIr = 0;
    for (const F of v.module.functions) for (const b of F.blocks) nIr += b.insts.length;
    const run = v.run;
    let stats = t('code.stats', { ir: nIr, asm: run?.program?.instructions.length ?? 0 });
    if (level === 'ssa') {
        const prom = [], kept = [];
        let phis = 0;
        for (const r of v.report) {
            for (const x of r.promoted) { prom.push(x.name); phis += x.phis.length; }
            kept.push(...r.kept);
        }
        const list = (a) => (a.length ? [...new Set(a)].join(', ') : t('code.none'));
        stats += ` ${t('code.m2r', { promoted: list(prom), phis, kept: list(kept) })}`;
    }
    if (level === 'opt') stats += ` ${t('code.optStats', { n: v.log.length })}`;
    $('codeStats').textContent = stats;
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
    const irL = V().ir.lines, asmL = V().asm.lines;
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
        const src = (kind === 'ir' ? V().ir.lines : V().asm.lines)[i]?.src ?? null;
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
    const frames = V().frames;
    sel.innerHTML = frames.map((f) => `<option value="${esc(f.fn)}">${esc(f.fn)}</option>`).join('');
    sel.value = frames.some((f) => f.fn === prev) ? prev : frames[0].fn;
    drawFrame();
}
function currentFrame() { return last.frames ? V().frames.find((f) => f.fn === $('frameFn').value) ?? null : null; }
function drawFrame() {
    const f = currentFrame();
    $('frameFig').innerHTML = f ? frameSvg(f, t) : '';
    // Com a alocação de registradores: o intervalo de vida de cada valor e o registrador (ou o quadro).
    $('raBox').classList.toggle('hidden', !f?.regalloc);
    if (!f?.regalloc) return;
    const rows = [...f.regalloc].sort((a, b) => a.start - b.start || a.end - b.end);
    $('raTable').innerHTML = `<tr><th>${t('ra.value')}</th><th>${t('ra.interval')}</th><th>${t('ra.reg')}</th><th>${t('ra.cross')}</th></tr>`
        + rows.map((r) => `<tr><td class="mono">${esc(r.value)}</td><td>${r.start}…${r.end}</td><td class="mono">${r.spilled ? esc(t('ra.spilled')) : esc(r.reg ?? '-')}</td><td>${r.cross ? t('ra.yes') : ''}</td></tr>`).join('');
}
$('frameFn').onchange = drawFrame;

// Fluxo de controle ------------------------------------------------------------------------------------------

let cfgChoice = null, cfgBlock = null;
/** Função mais interessante para os grafos: a que tem mais blocos. */
const defaultFn = (fns) => [...fns].sort((a, b) => b.blocks.length - a.blocks.length)[0]?.name ?? '';
function fillFnSelect(sel, choice) {
    const fns = V().module.functions;
    sel.innerHTML = fns.map((F) => `<option value="${esc(F.name)}">${esc(F.name)}</option>`).join('');
    sel.value = fns.some((F) => F.name === choice) ? choice : defaultFn(fns);
    return fns.find((F) => F.name === sel.value);
}
let cfgView = null;   // {F, cfg, layout}
function renderCfg() {
    if (last.phase !== 'done') { cfgView = null; return; }
    const F = fillFnSelect($('cfgFn'), cfgChoice);
    const cfg = analyzeCfg(F);
    if (cfgBlock && !cfg.blocks.includes(cfgBlock)) cfgBlock = null;
    cfgView = { F, cfg, layout: layoutCfg(F, cfg, $('cfgInsts').checked, t) };
    drawCfg();
    const list = (a) => a.map((x) => `<code>${esc(x)}</code>`).join(', ') || '-';
    $('cfgTable').innerHTML = `<tr><th>${t('th.block')}</th><th>${t('th.preds')}</th><th>${t('th.succs')}</th><th>${t('th.idom')}</th><th>${t('th.doms')}</th><th>${t('th.df')}</th><th>${t('th.loop')}</th></tr>`
        + cfg.rpo.map((b) => `<tr data-block="${esc(b)}"${b === cfgBlock ? ' class="cur"' : ''}><td class="mono left">${esc(b)}</td><td class="left">${list(cfg.pred.get(b))}</td><td class="left">${list(cfg.succ.get(b).map((x) => x.to))}</td>`
            + `<td class="mono">${b === cfg.rpo[0] ? '-' : esc(cfg.idom.get(b))}</td><td class="left">${list(cfg.doms.get(b))}</td><td class="left">${list([...cfg.df.get(b)])}</td><td>${cfg.depth.get(b) || '-'}</td></tr>`).join('');
    $('loopList').innerHTML = (cfg.loops.length
        ? `<ul>${cfg.loops.map((l) => `<li>${t('cfg.loop', { header: `<code>${esc(l.header)}</code>`, depth: l.depth, blocks: list(l.blocks), latches: list(l.latches), exits: list(l.exits) })}</li>`).join('')}</ul>`
        : `<p>${t('cfg.noLoops')}</p>`) + `<p>${t('cfg.iter', { n: cfg.iterations, rpo: cfg.rpo.join(', ') })}</p>`;
}
function drawCfg() {
    if (!cfgView) return;
    $('cfgFig').innerHTML = cfgSvg(cfgView.layout, cfgView.cfg, { selected: cfgBlock, tr: t });
    $('domFig').innerHTML = domTreeSvg(cfgView.cfg, { selected: cfgBlock });
    for (const tr of $('cfgTable').querySelectorAll('tr[data-block]')) tr.classList.toggle('cur', tr.dataset.block === cfgBlock);
}
function chooseBlock(b) {
    cfgBlock = cfgBlock === b ? null : b;
    drawCfg();
    // O bloco escolhido também passa a ser o do grafo de fluxo de dados.
    if (cfgBlock && $('dfgFn').value === cfgView.F.name) { dfgBlockChoice = cfgBlock; renderDfg(); }
    const first = cfgView.F.blocks.find((x) => x.label === b)?.insts.find((i) => i.line);
    if (cfgBlock && first) select({ from: 'src', src: first.line });
}
for (const id of ['cfgFig', 'domFig']) {
    $(id).addEventListener('click', (e) => { const g = e.target.closest('g.node[data-block]'); if (g) chooseBlock(g.dataset.block); });
}
$('cfgTable').addEventListener('click', (e) => { const tr = e.target.closest('tr[data-block]'); if (tr) chooseBlock(tr.dataset.block); });
$('cfgFn').onchange = () => { cfgChoice = $('cfgFn').value; cfgBlock = null; renderCfg(); };
$('cfgInsts').onchange = () => { store.set('cc.cfgInsts', $('cfgInsts').checked ? '1' : ''); renderCfg(); };
$('cfgInsts').checked = store.get('cc.cfgInsts') === '1';

// Fluxo de dados ---------------------------------------------------------------------------------------------

let dfgFnChoice = null, dfgBlockChoice = null, dfgSel = null, dfgView = null;
function renderDfg() {
    if (last.phase !== 'done') { dfgView = null; return; }
    const F = fillFnSelect($('dfgFn'), dfgFnChoice ?? cfgView?.F.name);
    const cfg = analyzeCfg(F);
    const bsel = $('dfgBlock');
    bsel.innerHTML = F.blocks.map((b) => `<option value="${esc(b.label)}">${esc(b.label)}</option>`).join('');
    // Sem escolha, o bloco mais aninhado em laços, e entre eles o de mais instruções.
    const best = [...F.blocks].sort((a, b) => (cfg.depth.get(b.label) - cfg.depth.get(a.label)) || (b.insts.length - a.insts.length))[0].label;
    bsel.value = F.blocks.some((b) => b.label === dfgBlockChoice) ? dfgBlockChoice : best;
    const g = blockDfg(F, bsel.value);
    if (dfgSel !== null && dfgSel >= g.nodes.length) dfgSel = null;
    // Escalonamento mostrado: ASAP, ALAP ou por lista com recursos limitados (estilo HLS).
    const mode = $('dfgSched').value;
    $('hlsRes').classList.toggle('hidden', mode !== 'list');
    const res = Object.fromEntries(UNITS.map((u) => [u, Math.max(1, Math.min(16, +$(`res-${u}`).value || 1))]));
    const shown = mode === 'list' ? listSchedule(g, res, { pipelined: $('resPipe').checked }) : mode === 'alap' ? alapSchedule(g) : g;
    let summary = null;
    if (mode === 'list') {
        summary = t('dfg.listSummary', { len: shown.length, asap: g.length, use: UNITS.filter((u) => shown.nodes.some((n) => n.unit?.startsWith(u))).map((u) => `${t(`unit.${u}`)} ${Math.round(100 * shown.use[u])}%`).join(', ') });
    }
    dfgView = { F, g, shown, summary, layout: layoutDfg(shown, (summary ?? t('dfg.summary', { len: g.length, sum: g.seqSum, ilp: '0.00' })).length) };
    drawDfg();
    $('dfgLat').innerHTML = `${t('dfg.latencies')} ${Object.entries(LATENCY).map(([k, v]) => `${esc(t(`cls.${k}`))} ${v}`).join('; ')}.`;
    const isList = mode === 'list';
    $('dfgTable').innerHTML = `<tr><th>#</th><th>${t('th.inst')}</th><th>${t('th.lat')}</th><th>${t('th.asap')}</th><th>${t('th.alap')}</th><th>${t('th.slack')}</th>${isList ? `<th>${t('th.listStart')}</th><th>${t('th.unit')}</th>` : ''}</tr>`
        + g.nodes.map((n) => `<tr data-id="${n.id}" class="${n.critical ? 'crit' : ''}"><td>${n.id}</td><td class="mono left" title="${esc(n.text)}">${esc(shortText(n.inst))}</td><td>${n.lat}</td><td>${n.start}</td><td>${n.alap}</td><td>${n.slack}</td>`
            + `${isList ? `<td>${shown.nodes[n.id].start}</td><td class="mono">${shown.nodes[n.id].unit ?? '-'}</td>` : ''}</tr>`).join('');
    const du = defUse(F);
    const where = (u) => `${esc(u.block)}: ${esc(shortText(u.inst))}${u.from ? ` (${esc(u.from)})` : ''}`;
    $('duTable').innerHTML = `<tr><th>${t('th.valueCol')}</th><th>${t('th.def')}</th><th>${t('th.usesCol')}</th></tr>`
        + du.map((r) => `<tr data-line="${r.def.inst?.line ?? ''}"><td class="mono">${esc(valueText(r.value))}</td><td class="mono left">${r.def.inst ? `${esc(r.def.block)}: ${esc(shortText(r.def.inst))}` : t('du.param')}</td>`
            + `<td class="mono left">${r.uses.length ? r.uses.map(where).join('<br>') : `<span class="note">${t('du.none')}</span>`}</td></tr>`).join('');
}
function drawDfg() {
    if (!dfgView) return;
    $('dfgFig').innerHTML = dfgSvg(dfgView.shown, dfgView.layout, { selected: dfgSel, tr: t, summary: dfgView.summary });
    for (const tr of $('dfgTable').querySelectorAll('tr[data-id]')) tr.classList.toggle('cur', +tr.dataset.id === dfgSel);
}
function chooseNode(id) {
    dfgSel = dfgSel === id ? null : id;
    drawDfg();
    const line = dfgSel !== null ? dfgView.g.nodes[dfgSel].inst.line : null;
    if (line) select({ from: 'src', src: line });
}
$('dfgFig').addEventListener('click', (e) => { const g = e.target.closest('g.node[data-id]'); if (g) chooseNode(+g.dataset.id); });
$('dfgTable').addEventListener('click', (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) chooseNode(+tr.dataset.id); });
$('duTable').addEventListener('click', (e) => { const tr = e.target.closest('tr[data-line]'); if (tr && tr.dataset.line) select({ from: 'src', src: +tr.dataset.line }); });
$('dfgFn').onchange = () => { dfgFnChoice = $('dfgFn').value; dfgBlockChoice = null; dfgSel = null; renderDfg(); };
$('dfgBlock').onchange = () => { dfgBlockChoice = $('dfgBlock').value; dfgSel = null; renderDfg(); };
for (const id of ['dfgSched', 'resPipe', ...UNITS.map((u) => `res-${u}`)]) $(id).addEventListener('change', () => renderDfg());

$('irLevel').value = level;
$('irLevel').onchange = () => {
    level = $('irLevel').value;
    store.set('cc.level', level);
    if (!last || last.phase !== 'done') return;
    renderCode();
    renderFrames();
    renderCfg();
    renderDfg();
    heatView = null;
    if (tab === 'heat') renderHeat();
    select({ from: selection.src ? 'src' : null, src: selection.src });
}
/** Mudança nas otimizações: refaz o que depende do nível otimizado. */
function optChanged() {
    if (!last || last.phase !== 'done') return;
    renderOpt();
    if (level !== 'opt') return;
    renderCode();
    renderFrames();
    renderCfg();
    renderDfg();
    heatView = null;
    if (tab === 'heat') renderHeat();
    renderSelection();
};

// Mapa de calor ----------------------------------------------------------------------------------------------

let heatView = null, heatFnChoice = null;
const heatBg = (i) => `background: color-mix(in srgb, var(--heat) ${Math.round(4 + 76 * i)}%, transparent)`;
const SUM_METRICS = new Set(['cycles', 'stalls']);
const fmtNum = (v) => (Number.isInteger(v) ? v.toLocaleString(getLanguage() === 'en' ? 'en' : 'pt-BR') : v.toLocaleString(getLanguage() === 'en' ? 'en' : 'pt-BR', { maximumFractionDigits: v < 10 ? 2 : 1 }));

/** Perfil de uma versão do programa num modelo de processador, guardado para não simular de novo. */
function profileOf(v, model, caches = false) {
    // Enquanto se digita, a simulação de ciclos também tem limite menor.
    const maxCycles = runLimit < RUN_LIMIT ? 5000 : 100000;
    const key = `${v.key}|${model}|${caches}|${maxCycles}`;
    last.profiles ??= new Map();
    if (!last.profiles.has(key)) last.profiles.set(key, simulateProfile(v.asm.text, { model, caches, maxCycles }));
    return last.profiles.get(key);
}

/** Perfil do processador escolhido, guardado por nível de IR, modelo e caches. */
function heatProfile() {
    return profileOf(V(), $('heatModel').value, $('heatCache').checked);
}

/** Valor da medida para cada linha da IR, do assembly e do fonte, e para cada bloco. */
function heatValues(metric, prof) {
    const v = V();
    const irL = v.ir.lines, asmL = v.asm.lines;
    const sum = SUM_METRICS.has(metric);
    const ir = new Float64Array(irL.length), asm = new Float64Array(asmL.length);
    const interp = v.interp;
    if (metric === 'static' || metric === 'irExec') {
        for (const F of v.module.functions) {
            const freq = metric === 'static' ? blockFrequencies(F).freq : null;
            for (const b of F.blocks) {
                for (const i of b.insts) {
                    if (i.irLine === undefined) continue;
                    ir[i.irLine] = metric === 'static' ? freq.get(b.label) ?? 0 : interp.counts.get(i) ?? 0;
                }
            }
        }
        asmL.forEach((l, j) => { if (l.ir !== null) asm[j] = ir[l.ir]; });
    } else {
        prof.program.instructions.forEach((inst, k) => {
            const p = prof.per[k];
            const x = metric === 'asmExec' ? p.exec : metric === 'cycles' ? p.cycles : p.stalls;
            const j = inst.line - 1;
            asm[j] = metric === 'asmExec' ? Math.max(asm[j], x) : asm[j] + x;
        });
        asmL.forEach((l, j) => {
            for (const i of [l.ir, l.ir2]) if (i !== null && i !== undefined) ir[i] = sum ? ir[i] + asm[j] : Math.max(ir[i], asm[j]);
        });
    }
    // Linhas do fonte: soma (ciclos) pelas instruções RISC-V, ou o máximo (execuções) pela IR.
    const src = new Map();
    const add = (line, x) => { if (!line) return; src.set(line, sum ? (src.get(line) ?? 0) + x : Math.max(src.get(line) ?? 0, x)); };
    if (sum) asmL.forEach((l, j) => { if (!l.isSrc) add(l.src, asm[j]); });
    else irL.forEach((l, i) => add(l.src, ir[i]));
    const blocks = new Map();
    for (const F of v.module.functions) {
        const m = new Map();
        for (const b of F.blocks) {
            const vals = b.insts.filter((i) => i.irLine !== undefined).map((i) => ir[i.irLine]);
            m.set(b.label, sum ? vals.reduce((s2, x) => s2 + x, 0) : Math.max(0, ...vals));
        }
        blocks.set(F.name, m);
    }
    return { ir, asm, src, blocks, sum };
}

function renderHeat() {
    if (!last || last.phase !== 'done') return;
    const metric = $('heatMetric').value;
    const simBased = !['static', 'irExec'].includes(metric);
    const prof = heatProfile();
    const vals = heatValues(metric, prof);
    const log = $('heatLog').checked;
    const all = [...vals.ir, ...vals.asm, ...vals.src.values()];
    const max = Math.max(1e-9, ...all);
    const inten = (x) => (x <= 0 ? 0 : log ? Math.log1p(x) / Math.log1p(max) : x / max);
    const srcI = new Map([...vals.src].map(([l, x]) => [l, inten(x)]));
    heatView = { metric, vals, srcI, prof, inten };

    // Resumo da simulação no processador escolhido.
    if (prof.errors?.length) $('heatSummary').textContent = prof.errors.map((e) => e.message).join('; ');
    else {
        const st = prof.stats;
        let txt = t('heat.summary', {
            model: t(`heat.${prof.model}`), cycles: fmtNum(prof.cycles), inst: fmtNum(prof.instructions), cpi: (prof.cycles / Math.max(1, prof.instructions)).toFixed(2),
            dstall: fmtNum(st.dataStalls ?? 0), sstall: fmtNum(st.structStalls ?? 0), mis: fmtNum(st.mispredicts ?? 0), br: fmtNum(st.branches ?? 0), sq: fmtNum(prof.squashed),
        });
        const l1d = st.memory?.levels?.L1D;
        if (l1d && (l1d.hits !== undefined)) txt += t('heat.summaryCache', { hits: fmtNum(l1d.hits), misses: fmtNum(l1d.misses) });
        if (!prof.finished) txt += ` ${t('heat.limit', { n: fmtNum(prof.stats.cycles) })}`;
        $('heatSummary').textContent = txt;
    }
    $('heatModel').disabled = !simBased && metric !== 'cycles';
    $('heatIrTitle').textContent = t(irTitleKey());

    const unit = (x) => (x ? fmtNum(Math.round(x * 100) / 100) : '');
    const view = (text, arr, fn) => text.replace(/\n$/, '').split('\n').map((l, i) => {
        const x = arr[i] ?? 0;
        return `<div class="cl" data-i="${i}"${x > 0 ? ` style="${heatBg(inten(x))}"` : ''}><span class="ln">${i + 1}</span><span class="hv">${unit(x)}</span><span class="tx">${fn(l) || ' '}</span></div>`;
    }).join('');
    const v = V();
    $('heatIr').innerHTML = view(v.ir.text, vals.ir, irLine);
    $('heatAsm').innerHTML = view(v.asm.text, vals.asm, asmLine);

    // Linhas mais quentes.
    const lines = code.value.split('\n');
    const total = [...vals.src.values()].reduce((a, b) => a + b, 0);
    const top = [...vals.src].filter(([, x]) => x > 0).sort((a, b) => b[1] - a[1]).slice(0, 10);
    $('heatTop').innerHTML = `<tr><th>${t('th.srcLine')}</th><th>${t('th.code')}</th><th>${t(`heat.m.${metric}`)}</th>${vals.sum ? `<th>${t('th.share')}</th>` : ''}</tr>`
        + top.map(([l, x]) => `<tr data-line="${l}" style="${heatBg(inten(x))}"><td>${l}</td><td class="mono left">${esc((lines[l - 1] ?? '').trim())}</td><td>${unit(x)}</td>${vals.sum ? `<td>${(100 * x / Math.max(1, total)).toFixed(1)}%</td>` : ''}</tr>`).join('');

    // Blocos de uma função: estimado e medido.
    const fns = v.module.functions;
    const sel = $('heatFn');
    sel.innerHTML = fns.map((F) => `<option value="${esc(F.name)}">${esc(F.name)}</option>`).join('');
    sel.value = fns.some((F) => F.name === heatFnChoice) ? heatFnChoice : defaultFn(fns);
    const F = fns.find((x) => x.name === sel.value);
    const cfg = analyzeCfg(F);
    const { freq } = blockFrequencies(F, cfg);
    const cnt = blockCounts(F, v.interp.counts);
    const calls = cnt.get(F.blocks[0].label) || 0;
    const cyc = heatValues('cycles', prof).blocks.get(F.name);
    heatView.blockRows = cfg.rpo.map((b) => ({ b, est: freq.get(b), meas: calls ? cnt.get(b) / calls : 0, execs: cnt.get(b), cycles: cyc.get(b) }));
    $('heatBlocks').innerHTML = `<tr><th>${t('th.block')}</th><th>${t('th.est')}</th><th>${t('th.meas')}</th><th>${t('th.execs')}</th><th>${t('th.cycles')}</th></tr>`
        + heatView.blockRows.map((r) => `<tr><td class="mono left">${esc(r.b)}</td><td>${fmtNum(Math.round(r.est * 100) / 100)}</td><td>${calls ? fmtNum(Math.round(r.meas * 100) / 100) : t('heat.notRun')}</td><td>${fmtNum(r.execs)}</td><td>${fmtNum(r.cycles)}</td></tr>`).join('')
        + `<tr><td colspan="5" class="note left">${t('heat.calls', { fn: esc(F.name), n: calls })}</td></tr>`;

    // CFG colorido pela medida.
    const bv = vals.blocks.get(F.name);
    const texts = new Map([...bv].map(([b, x]) => [b, metric === 'static' || metric.endsWith('Exec') ? t(metric === 'static' ? 'heat.unit.static' : 'heat.unit.exec', { v: unit(x) || 0 }) : t(`heat.unit.${metric}`, { v: unit(x) || 0 })]));
    const heat = new Map([...bv].map(([b, x]) => [b, { i: inten(x), text: texts.get(b) }]));
    heatView.F = F;
    $('heatCfg').innerHTML = cfgSvg(layoutCfg(F, cfg, false, t, texts), cfg, { tr: t, heat });
    refreshMarks();
}
for (const id of ['heatMetric', 'heatModel', 'heatCache', 'heatLog']) $(id).addEventListener('change', () => { store.set(`cc.${id}`, $(id).type === 'checkbox' ? ($(id).checked ? '1' : '0') : $(id).value); renderHeat(); });
for (const id of ['heatMetric', 'heatModel']) { const v = store.get(`cc.${id}`); if (v && [...$(id).options].some((o) => o.value === v)) $(id).value = v; }
if (!store.get('cc.heatMetric')) $('heatMetric').value = 'cycles';
if (!store.get('cc.heatModel')) $('heatModel').value = 'pipeline';
for (const id of ['heatCache', 'heatLog']) { const v = store.get(`cc.${id}`); if (v) $(id).checked = v === '1'; }
$('heatFn').onchange = () => { heatFnChoice = $('heatFn').value; renderHeat(); };
$('heatTop').addEventListener('click', (e) => { const tr = e.target.closest('tr[data-line]'); if (tr) goToLine(+tr.dataset.line); });
for (const [id, kind] of [['heatIr', 'ir'], ['heatAsm', 'asm']]) {
    $(id).addEventListener('click', (e) => {
        const row = e.target.closest('.cl');
        if (!row) return;
        const src = (kind === 'ir' ? V().ir.lines : V().asm.lines)[+row.dataset.i]?.src;
        if (src) goToLine(src);
    });
}

// Otimizações -----------------------------------------------------------------------------------------------

let optView = null, sweepRes = null, sweepRun = 0;
function optState() {
    return {
        classic: CLASSIC.filter((k) => $(`opt-${k}`).checked), loop: $('optLoop').value, k: +$('optK').value,
        bits: +$('optBits').value, mul: +$('optMul').value,
    };
}
function optOptions(st, approx = true) {
    const [fn, header] = st.loop ? st.loop.split('|') : [null, null];
    return {
        classic: st.classic,
        perforate: approx && fn ? { fn, header, k: st.k } : null,
        fprec: approx ? st.bits : null,
        amul: approx ? st.mul : null,
    };
}
/** Versão otimizada (com as escolhas atuais), guardada pela assinatura das escolhas. */
function getOpt(approx = true) {
    const st = optState();
    const sig = JSON.stringify([approx, st]);
    last.optCache ??= new Map();
    if (!last.optCache.has(sig)) {
        const { module, log } = optimize(last.ssa.module, optOptions(st, approx));
        const v = buildVariant(last, module);
        const interp = interpret(module, { maxSteps: runLimit });
        const run = runAsm({ ...last, module, asm: v.asm }, { maxInstructions: runLimit });
        last.optCache.set(sig, { ...v, key: `opt${sig}`, log, interp, run, report: null });
    }
    return last.optCache.get(sig);
}
const approxActive = (st) => (st.loop && st.k > 1) || st.bits < 23 || st.mul > 0;

function fillOptLoops() {
    const sel = $('optLoop');
    const prev = sel.value;
    const loops = last.ssa ? perforableLoops(last.ssa.module) : [];
    sel.innerHTML = `<option value="">${t('opt.noLoop')}</option>` + loops.map((l) => `<option value="${esc(`${l.fn}|${l.header}`)}">${esc(t('opt.loopItem', { fn: l.fn, v: l.name, line: l.line ?? '?', h: l.header }))}</option>`).join('');
    sel.value = [...sel.options].some((o) => o.value === prev) ? prev : '';
    $('sweepLoopNote').textContent = loops.length ? '' : t('opt.noPerforable');
}

function renderOpt() {
    if (!last || last.phase !== 'done') return;
    const st = optState();
    const fmtR = (v) => (v === null || v === undefined ? '-' : Number.isInteger(v) ? String(v) : String(Math.fround(v)));
    const rows = [
        [t('opt.v.O0'), { key: 'O0', asm: last.asm, interp: last.interp, run: last.run }],
        [t('opt.v.ssa'), { key: 'ssa', asm: last.ssa.asm, interp: last.ssaInterp, run: last.ssaRun }],
        [t('opt.v.classic', { n: st.classic.length }), getOpt(false)],
    ];
    if (approxActive(st)) rows.push([t('opt.v.approx'), getOpt(true)]);
    const base = profileOf(rows[0][1], 'pipeline').cycles;
    $('optTable').innerHTML = `<tr><th>${t('th.version')}</th><th>${t('run.irExec')}</th><th>${t('run.asmExec')}</th><th>${t('th.cyclesPipe')}</th><th>${t('th.speedup')}</th><th>${t('run.ret')}</th><th>${t('th.mre')}</th><th>${t('th.maxAbs')}</th></tr>`
        + rows.map(([name, v]) => {
            const prof = profileOf(v, 'pipeline');
            const e = outputError(last.interp, v.interp);
            const err = !e.finished ? t('opt.notEnd') : e.same ? t('opt.same') : `${(100 * e.mre).toFixed(3)}%`;
            return `<tr><th class="left">${esc(name)}</th><td>${fmtNum(v.interp.steps)}</td><td>${v.run.errors.length ? '-' : fmtNum(v.run.executed)}</td><td>${prof.errors?.length ? '-' : fmtNum(prof.cycles)}</td>`
                + `<td>${prof.cycles ? `${(base / prof.cycles).toFixed(2)}×` : '-'}</td><td class="mono">${esc(fmtR(v.run.ret))}</td><td>${err}</td><td>${e.finished && !e.same ? fmtNum(+e.maxAbs.toPrecision(4)) : '-'}</td></tr>`;
        }).join('');
    const opt = getOpt(true);
    const byPass = new Map();
    for (const l of opt.log) byPass.set(l.pass, (byPass.get(l.pass) ?? 0) + 1);
    $('optLogTitle').textContent = t('opt.logTitle', { n: opt.log.length, list: [...byPass].map(([p, n]) => `${t(`opt.pass.${p}`)} ${n}`).join(', ') || t('code.none') });
    $('optLog').innerHTML = opt.log.slice(0, 400).map((l) => `<li><span class="tag">${esc(t(`opt.pass.${l.pass}`))}</span> ${esc(t(l.key, l.p))}</li>`).join('')
        + (opt.log.length > 400 ? `<li>${t('opt.more', { n: opt.log.length - 400 })}</li>` : '');
    optView = { rows };
    drawSweep();
}

function drawSweep() {
    const tech = $('sweepTech').value;
    if (!sweepRes || sweepRes.tech !== tech || !sweepRes.pts.length) { $('optChart').innerHTML = ''; $('optSweep').innerHTML = ''; return; }
    const xKey = tech === 'perforate' ? 'speedup' : 'x';
    const pLabel = (p) => t(`opt.p.${tech}`, { v: p.x });
    $('optChart').innerHTML = optChartSvg(sweepRes.pts, {
        xKey, pLabel, title: t(`opt.chart.${tech}`), xLabel: t(xKey === 'speedup' ? 'opt.axis.speedup' : `opt.axis.${tech}`), yLabel: t('opt.axis.mre'),
    });
    $('optSweep').innerHTML = `<tr><th>${t(`opt.param.${tech}`)}</th><th>${t('th.cyclesPipe')}</th><th>${t('th.speedup')}</th><th>${t('run.ret')}</th><th>${t('th.mre')}</th><th>${t('th.maxAbs')}</th></tr>`
        + sweepRes.pts.map((p) => `<tr><td>${esc(pLabel(p))}</td><td>${p.cycles === null ? '-' : fmtNum(p.cycles)}</td><td>${p.speedup ? `${p.speedup.toFixed(2)}×` : '-'}</td><td class="mono">${p.finished ? esc(String(p.ret)) : t('opt.notEnd')}</td>`
            + `<td>${p.finished ? `${(100 * p.mre).toFixed(3)}%` : '-'}</td><td>${p.finished && !p.same ? fmtNum(+p.maxAbs.toPrecision(4)) : '-'}</td></tr>`).join('');
}

$('sweepBtn').onclick = () => {
    if (!last || last.phase !== 'done') return;
    const tech = $('sweepTech').value;
    const st = optState();
    const loop = st.loop ? { fn: st.loop.split('|')[0], header: st.loop.split('|')[1] } : null;
    if (tech === 'perforate' && !loop) { $('sweepStatus').textContent = t('opt.chooseLoop'); return; }
    const run = ++sweepRun;
    const values = SWEEPS[tech];
    sweepRes = { tech, pts: [] };
    const c = last;
    let k = 0;
    const step = () => {
        if (run !== sweepRun || c !== last) return;
        if (k >= values.length) { $('sweepStatus').textContent = t('opt.sweepDone', { n: values.length }); return; }
        $('sweepStatus').textContent = t('opt.sweeping', { i: k + 1, n: values.length });
        sweepRes.pts.push(...sweepPoint(c, tech, { classic: st.classic, loop }, { values: [values[k]] }));
        k++;
        drawSweep();
        setTimeout(step, 0);
    };
    setTimeout(step, 0);
};
$('sweepTech').onchange = drawSweep;
for (const id of [...CLASSIC.map((k) => `opt-${k}`), 'optLoop', 'optK', 'optBits', 'optMul']) $(id).addEventListener('change', optChanged);

// Abas -------------------------------------------------------------------------------------------------------

function available(name) {
    if (!last) return false;
    switch (name) {
        case 'tokens': return !!last.tokens;
        case 'ast': return !!last.ast;
        case 'symbols': return !!last.sema;
        default: return last.phase === 'done';
    }
}

function showTab(name) {
    stop();
    if (srcLang === 'll' && SRC_TABS.includes(name)) name = 'code';
    tab = name;
    store.set('cc.tab', name);
    for (const b of $('tabs').querySelectorAll('[data-tab]')) b.classList.toggle('sel', b.dataset.tab === name);
    const ok = available(name);
    for (const p of document.querySelectorAll('.pane')) p.classList.toggle('hidden', !ok || p.id !== `pane-${name}`);
    $('pending').classList.toggle('hidden', ok);
    mark = null;
    if (ok && name === 'heat' && !heatView) renderHeat();
    if (ok && name === 'opt' && !optView) renderOpt();
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
$('tokTex').onclick = () => last?.tokens && download(`${baseName()}-tokens.tex`, tokensTex(last.tokens), 'application/x-tex');
$('symTex').onclick = () => last?.sema && download(`${baseName()}-${getLanguage() === 'en' ? 'symbols' : 'simbolos'}.tex`, symbolsTex(symbolRows()), 'application/x-tex');
$('frameTex').onclick = () => { const f = currentFrame(); if (f) download(`${f.fn}-${getLanguage() === 'en' ? 'frame' : 'quadro'}.tex`, frameTex(f), 'application/x-tex'); };
const lvlSuffix = () => ({ O0: '', ssa: '-mem2reg', opt: '-opt' })[level];
$('dlLl').onclick = () => last?.ir && download(`${baseName()}${lvlSuffix()}.ll`, V().ir.text, 'text/plain');
$('dlS').onclick = () => last?.asm && download(`${baseName()}${lvlSuffix()}.s`, V().asm.text, 'text/plain');
$('astSvg').onclick = () => {
    const svg = $('astFig').querySelector('svg');
    if (svg) download(`${baseName()}-${getLanguage() === 'en' ? 'tree' : 'arvore'}-${steppers.ast.cur}.svg`, standaloneSvg(svg), 'image/svg+xml');
};
const svgOf = (id) => $(id).querySelector('svg');
const fnName = () => cfgView?.F.name ?? 'f';
$('cfgSvgBtn').onclick = () => { const s = svgOf('cfgFig'); if (s) download(`${fnName()}-cfg${lvlSuffix()}.svg`, standaloneSvg(s), 'image/svg+xml'); };
$('domSvgBtn').onclick = () => { const s = svgOf('domFig'); if (s) download(`${fnName()}-dom.svg`, standaloneSvg(s), 'image/svg+xml'); };
$('cfgDotBtn').onclick = () => cfgView && download(`${fnName()}-cfg${lvlSuffix()}.dot`, cfgDot(cfgView.F, cfgView.cfg, true), 'text/vnd.graphviz');
$('domDotBtn').onclick = () => cfgView && download(`${fnName()}-dom.dot`, domDot(cfgView.F, cfgView.cfg), 'text/vnd.graphviz');
$('domTexBtn').onclick = () => cfgView && download(`${fnName()}-${getLanguage() === 'en' ? 'dominators' : 'dominadores'}.tex`, domTex(cfgView.F, cfgView.cfg), 'application/x-tex');
const dfgName = () => `${dfgView?.F.name}-${dfgView?.g.label}-dfg${lvlSuffix()}`;
$('dfgSvgBtn').onclick = () => { const s = svgOf('dfgFig'); if (s) download(`${dfgName()}.svg`, standaloneSvg(s), 'image/svg+xml'); };
$('dfgDotBtn').onclick = () => dfgView && download(`${dfgName()}.dot`, dfgDot(dfgView.F, dfgView.g), 'text/vnd.graphviz');
$('dfgTexBtn').onclick = () => dfgView && download(`${dfgName()}.tex`, dfgTex(dfgView.F, dfgView.g), 'application/x-tex');
$('heatSvgBtn').onclick = () => { const s2 = svgOf('heatCfg'); if (s2 && heatView) download(`${heatView.F.name}-${getLanguage() === 'en' ? 'heat' : 'calor'}-${heatView.metric}.svg`, standaloneSvg(s2), 'image/svg+xml'); };
const csv = (rows) => rows.map((r) => r.map((x) => (typeof x === 'string' && /[",\n;]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x)).join(',')).join('\n') + '\n';
$('heatCsvSrc').onclick = () => {
    if (!heatView) return;
    const prof = heatView.prof;
    const m = Object.fromEntries(['static', 'irExec', 'asmExec', 'cycles', 'stalls'].map((k) => [k, heatValues(k, prof).src]));
    const lines = code.value.split('\n');
    const rows = [['line', 'source', 'static_frequency', 'ir_executions', 'riscv_executions', 'cycles', 'stall_cycles']];
    lines.forEach((l, i) => rows.push([i + 1, l.trim(), ...['static', 'irExec', 'asmExec', 'cycles', 'stalls'].map((k) => +(m[k].get(i + 1) ?? 0).toFixed(4))]));
    download(`${baseName()}${lvlSuffix()}-${prof.model}-source.csv`, csv(rows), 'text/csv');
};
$('heatCsvAsm').onclick = () => {
    if (!heatView) return;
    const prof = heatView.prof, v = V();
    const irText = v.ir.text.split('\n');
    const rows = [['index', 'pc', 'asm_line', 'instruction', 'source_line', 'ir', 'executions', 'cycles', 'stall_cycles', 'squashed']];
    prof.program.instructions.forEach((inst, k) => {
        const l = v.asm.lines[inst.line - 1];
        const p = prof.per[k];
        rows.push([k, `0x${inst.pc.toString(16)}`, inst.line, inst.text, l?.src ?? '', l?.ir !== null && l?.ir !== undefined ? irText[l.ir].trim() : '', p.exec, p.cycles, p.stalls, p.squashed]);
    });
    download(`${baseName()}${lvlSuffix()}-${prof.model}-riscv.csv`, csv(rows), 'text/csv');
};
$('heatTex').onclick = () => { if (heatView?.blockRows) download(`${heatView.F.name}-${getLanguage() === 'en' ? 'blocks' : 'blocos'}.tex`, blocksTex(heatView.F, heatView.blockRows), 'application/x-tex'); };
$('optSvgBtn').onclick = () => { const s2 = svgOf('optChart'); if (s2) download(`${baseName()}-${sweepRes.tech}.svg`, standaloneSvg(s2), 'image/svg+xml'); };
$('optCsvBtn').onclick = () => {
    if (!sweepRes?.pts.length) return;
    const rows = [['technique', 'parameter', 'cycles_pipeline', 'speedup', 'main_result', 'mean_relative_error', 'max_abs_error', 'finished']];
    for (const p of sweepRes.pts) rows.push([sweepRes.tech, p.x, p.cycles ?? '', p.speedup ?? '', p.ret ?? '', p.mre, p.maxAbs, p.finished]);
    download(`${baseName()}-${sweepRes.tech}.csv`, csv(rows), 'text/csv');
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
    const payload = { code: V().asm.text, config: { mode: 'pipeline', xlen: 32, exampleValues: false, maxCycles: 100000 }, view: 'sim' };
    window.open(`${CPU_URL}#s=${encodeShare(payload)}`, '_blank', 'noopener');
};

function decodeShare(str) {
    const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0))));
}
function flash(el, text) {
    const old = el.textContent;
    el.textContent = text;
    setTimeout(() => { el.textContent = old; }, 1500);
}
// Link de compartilhamento: o código, a aba, o nível de IR e as escolhas da aba Otimizações.
$('shareLink').onclick = async () => {
    const payload = { code: code.value, lang: srcLang, tab, level, opt: optState(), ra: $('optRA').checked, sched: $('optSched').value };
    const url = `${location.origin}${location.pathname}#s=${encodeShare(payload)}`;
    try {
        await navigator.clipboard.writeText(url);
        flash($('shareLink'), t('ui.linkCopied'));
    } catch {
        window.prompt(t('ui.copyThisLink'), url);
    }
};
function applyShared(p) {
    if (typeof p.code !== 'string') return false;
    setSrcLang(p.lang === 'll' ? 'll' : 'c');
    code.value = p.code;
    exampleId = null;
    $('example').value = '';
    if (typeof p.ra === 'boolean') $('optRA').checked = p.ra;
    if (['none', 'pipeline', 'dual'].includes(p.sched)) $('optSched').value = p.sched;
    if (['O0', 'ssa', 'opt'].includes(p.level)) { level = p.level; $('irLevel').value = level; }
    if (typeof p.tab === 'string' && document.querySelector(`#tabs [data-tab="${p.tab}"]`)) tab = p.tab;
    runCompile();
    const o = p.opt;
    if (o) {
        for (const k of CLASSIC) $(`opt-${k}`).checked = (o.classic ?? CLASSIC).includes(k);
        for (const [id, v] of [['optLoop', o.loop], ['optK', o.k], ['optBits', o.bits], ['optMul', o.mul]]) {
            if (v !== undefined && [...$(id).options].some((x) => x.value === String(v))) $(id).value = String(v);
        }
        optChanged();
    }
    return true;
}

$('run').onclick = () => runCompile();
$('optIr').onchange = () => runCompile();
$('optSrc').onchange = () => runCompile();
$('optRA').checked = store.get('cc.ra') === '1';
$('optSched').value = ['pipeline', 'dual'].includes(store.get('cc.sched')) ? store.get('cc.sched') : 'none';
$('optRA').onchange = () => { store.set('cc.ra', $('optRA').checked ? '1' : '0'); runCompile(); };
$('optSched').onchange = () => { store.set('cc.sched', $('optSched').value); runCompile(); };

/** Troca a linguagem do editor (sem carregar texto): título, abas das fases do MiniC e destaque. */
function setSrcLang(lang) {
    srcLang = lang;
    store.set('cc.srcLang', lang);
    $('srcLang').value = lang;
    $('srcTitle').textContent = t(lang === 'll' ? 'src.titleLl' : 'src.title');
    for (const b of $('tabs').querySelectorAll('[data-tab]')) b.hidden = lang === 'll' && SRC_TABS.includes(b.dataset.tab);
    if (lang === 'll' && SRC_TABS.includes(tab)) tab = 'code';
}
$('srcLang').value = srcLang;
$('srcLang').onchange = () => {
    // O exemplo aberto continua o mesmo na outra linguagem; texto editado fica guardado na sua linguagem.
    const keepEx = exampleId;
    setSrcLang($('srcLang').value);
    selection = { from: null, src: null, ir: null, asm: null };
    mark = null;
    const saved = store.get(codeKey());
    const ex = store.get(exKey());
    if (ex === '' && saved) { exampleId = null; code.value = saved; }
    else loadExample(keepEx ?? (EXAMPLES.some((e) => e.id === ex) ? ex : EXAMPLES[0].id));
    $('example').value = exampleId ?? '';
    runCompile();
};

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
    $('srcTitle').textContent = t(srcLang === 'll' ? 'src.titleLl' : 'src.title');
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
    // Um exemplo carregado troca de idioma junto (só os comentários mudam); texto editado fica como está.
    if (exampleId) { const top = code.scrollTop; loadExample(exampleId); code.scrollTop = top; }
    const cur = { tokens: steppers.tokens.cur, ast: steppers.ast.cur };
    runCompile();
    steppers.tokens.cur = Math.min(cur.tokens, steppers.tokens.n);
    steppers.ast.cur = Math.min(cur.ast, steppers.ast.n);
    showTab(tab);
});

// Início -----------------------------------------------------------------------------------------------------

applyDomTranslations();
setSrcLang(srcLang);
const savedEx = store.get(exKey());
const savedCode = store.get(codeKey());
let shared = null;
if (location.hash.startsWith('#s=')) {
    try { shared = decodeShare(location.hash.slice(3)); } catch { shared = null; }
    history.replaceState(null, '', location.pathname + location.search);
}
if (shared) {
    fillExamples();
    if (!applyShared(shared)) { loadExample(EXAMPLES[0].id); runCompile(); }
} else {
    if (savedEx === '' && savedCode) { exampleId = null; code.value = savedCode; } else loadExample(EXAMPLES.some((e) => e.id === savedEx) ? savedEx : EXAMPLES[0].id);
    fillExamples();
    runCompile();
}
