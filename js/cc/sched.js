/**
 * Escalonamento de instruções do assembly gerado, por lista (list scheduling), dentro de cada trecho reto do
 * código (entre rótulos, desvios, saltos e chamadas).
 *
 * Cada instrução depende das anteriores que escrevem um registrador que ela lê (leitura depois de escrita, com
 * a latência de quem produz), que leem um registrador que ela escreve, ou que escrevem o mesmo registrador; e
 * os acessos à memória mantêm a ordem quando podem ser no mesmo endereço (mesma base e deslocamentos que se
 * cruzam, ou bases diferentes). Entre as instruções prontas, sai primeiro a de maior altura: o caminho mais longo,
 * em ciclos, até o fim do trecho.
 *
 *   pipeline  uma instrução por ciclo; afasta o uso do resultado de um load (que custaria uma bolha) e de
 *             operações longas (multiplicação, divisão, ponto flutuante);
 *   dual      pacotes de duas instruções, como a emissão dupla estática do livro (seção 4.10): uma de ALU ou
 *             desvio e um load ou store, independentes entre si, lado a lado no código.
 */
import { assemble } from '../vendor/cpu/riscv/parser.js';

const LAT = { load: 2, mul: 4, div: 10, fadd: 2, fmul: 5, fdiv: 10 };
const CONTROL = /^(j|jal|jalr|jr|ret|call|tail|beq|bne|blt|bge|bltu|bgeu|beqz|bnez|blez|bgez|bltz|bgtz|bgt|ble|bgtu|bleu|ecall|ebreak)$/;

/** Registradores lidos e escritos, classe e acesso à memória de uma linha de assembly. */
function decode(text) {
    const t = text.trim();
    const mn = t.split(/\s+/)[0];
    if (CONTROL.test(mn)) return null;
    if (mn === 'la') {
        const rd = t.split(/\s+/)[1].replace(',', '');
        const r = assemble(`li ${rd}, 0`);
        return { defs: [r.instructions[0].rd], uses: [], cls: 'alu', mem: null };
    }
    const p = assemble(t);
    if (p.errors.length || !p.instructions.length) return null;
    const defs = new Set(), uses = new Set();
    let cls = 'alu', mem = null;
    for (const i of p.instructions) {
        for (const r of [i.rs1, i.rs2, i.rs3]) if (r && r !== 'x0' && !defs.has(r)) uses.add(r);
        if (i.rd && i.rd !== 'x0') defs.add(i.rd);
        const c = i.def.cls;
        if (c === 'load' || c === 'store') { cls = c; mem = { base: i.rs1, off: i.imm, size: i.def.mem.size, write: c === 'store' }; }
        else if (c !== 'alu') cls = c;
    }
    return { defs: [...defs], uses: [...uses], cls, mem };
}

const slot = (n) => (n.cls === 'load' || n.cls === 'store' ? 1 : 0);

/** Escalona um trecho reto; devolve a nova ordem dos índices. */
function scheduleRegion(nodes, mode) {
    const n = nodes.length;
    const preds = nodes.map(() => []);
    const lastWrite = new Map(), reads = new Map();
    for (let j = 0; j < n; j++) {
        const b = nodes[j];
        const add = (i, w, kind) => { if (!preds[j].some((x) => x.i === i && x.w >= w)) preds[j].push({ i, w, kind }); };
        for (const r of b.uses) if (lastWrite.has(r)) { const i = lastWrite.get(r); add(i, LAT[nodes[i].cls] ?? 1, 'raw'); }
        for (const r of b.defs) {
            if (lastWrite.has(r)) add(lastWrite.get(r), 0, 'waw');
            for (const i of reads.get(r) ?? []) if (i !== j) add(i, 0, 'war');
        }
        if (b.mem) {
            // A base precisa ser o mesmo valor: nenhuma escrita na base entre os dois acessos.
            for (let i = 0; i < j; i++) {
                const a = nodes[i];
                if (!a.mem || (!a.mem.write && !b.mem.write)) continue;
                const sameBase = a.mem.base === b.mem.base && !nodes.slice(i + 1, j).some((x) => x.defs.includes(a.mem.base)) && !a.defs.includes(a.mem.base);
                const disjoint = sameBase && (a.mem.off + a.mem.size <= b.mem.off || b.mem.off + b.mem.size <= a.mem.off);
                if (!disjoint) add(i, 0, 'mem');
            }
        }
        for (const r of b.defs) { lastWrite.set(r, j); reads.set(r, []); }
        for (const r of b.uses) { if (!reads.has(r)) reads.set(r, []); reads.get(r).push(j); }
    }
    const succs = nodes.map(() => []);
    preds.forEach((ps, j) => ps.forEach((p) => succs[p.i].push({ j, w: p.w })));
    const height = new Array(n).fill(0);
    for (let i = n - 1; i >= 0; i--) height[i] = Math.max(LAT[nodes[i].cls] ?? 1, ...succs[i].map((s) => s.w + height[s.j]));
    const done = new Array(n).fill(null);
    const order = [];
    let cycle = 0;
    const ready = () => [...Array(n).keys()].filter((j) => done[j] === null && preds[j].every((p) => done[p.i] !== null));
    const earliest = (j) => Math.max(0, ...preds[j].map((p) => done[p.i] + p.w));
    const better = (a, b) => height[b] - height[a] || a - b;
    while (order.length < n) {
        const r = ready();
        let now = r.filter((j) => earliest(j) <= cycle).sort(better);
        if (!now.length) { cycle = Math.min(...r.map(earliest)); now = r.filter((j) => earliest(j) <= cycle).sort(better); }
        const a = now[0];
        done[a] = cycle;
        order.push(a);
        if (mode === 'dual') {
            // Par: a melhor instrução pronta do outro slot, sem depender da primeira por registrador.
            const b = ready().filter((j) => earliest(j) <= cycle && slot(nodes[j]) !== slot(nodes[a])
                && !preds[j].some((p) => p.i === a && (p.kind === 'raw' || p.kind === 'waw' || p.kind === 'mem'))).sort(better)[0];
            if (b !== undefined) { done[b] = cycle; order.push(b); }
        }
        cycle++;
    }
    return order;
}

/**
 * Reordena as linhas de assembly (registros de generateAsm) de cada trecho reto.
 * @param {Array} out linhas com {text, ...}
 * @param {'pipeline'|'dual'} mode
 * @returns {{out: Array, moved: number}}
 */
export function scheduleLines(out, mode) {
    const res = [];
    let moved = 0;
    let region = [];          // [{lines: [registros], node}]
    let pendingComments = [];
    const flush = () => {
        if (region.length > 1) {
            const order = scheduleRegion(region.map((g) => g.node), mode);
            order.forEach((k, pos) => { if (k !== pos) moved++; });
            for (const k of order) res.push(...region[k].lines);
        } else for (const g of region) res.push(...g.lines);
        region = [];
    };
    for (const l of out) {
        const text = l.text;
        const isInst = /^ {4}\S/.test(text) && !text.trim().startsWith('.') && !l.prologue && !l.epilogue;
        if (l.isSrc) { pendingComments.push(l); continue; }
        const node = isInst ? decode(text) : null;
        if (node) {
            region.push({ lines: [...pendingComments, l], node });
            pendingComments = [];
            continue;
        }
        flush();
        res.push(...pendingComments, l);
        pendingComments = [];
    }
    flush();
    res.push(...pendingComments);
    return { out: res, moved };
}
