/**
 * Figura da árvore sintática abstrata. A posição de cada nó é calculada uma vez, para a árvore completa
 * (folhas da esquerda para a direita, cada pai centrado sobre os filhos); o passo a passo mostra apenas os
 * nós já criados pelo analisador sintático, na ordem de criação, de modo que a árvore cresce como na
 * descida recursiva: as folhas e subexpressões aparecem antes do nó que as reúne.
 */
import { esc } from './highlight.js';
import { str } from '../cc/types.js';

/** Filhos de um nó, na ordem do código. */
export function children(n) {
    switch (n.kind) {
        case 'Program': return n.items;
        case 'Func': return [...n.params, ...(n.body ? [n.body] : [])];
        case 'VarDecl': return n.init ? [n.init] : [];
        case 'InitList': return n.items;
        case 'Block': return n.items;
        case 'If': return [n.cond, n.then, n.else].filter(Boolean);
        case 'While': return [n.cond, n.body];
        case 'For': return [...(Array.isArray(n.init) ? n.init : n.init ? [n.init] : []), n.cond, n.step, n.body].filter(Boolean);
        case 'Return': return n.value ? [n.value] : [];
        case 'ExprStmt': return [n.expr];
        case 'Assign': return [n.target, n.value];
        case 'Binary': case 'Logical': return [n.left, n.right];
        case 'Unary': return [n.operand];
        case 'IncDec': return [n.target];
        case 'Index': return [n.base, n.index];
        case 'Call': return [n.nameNode, ...n.args];
        default: return [];
    }
}

const typeText = (t) => (t.ptr ? `${t.base} *` : t.base);
const declText = (t, name) => (t.ptr ? `${t.base} *${name}` : `${t.base} ${name}`);

/** Rótulo principal e subtítulo (tipo calculado na análise semântica) de um nó. */
export function nodeLabel(n, tr) {
    const ty = n.ty && n.ty.k !== 'error' ? str(n.ty) : '';
    switch (n.kind) {
        case 'Program': return [tr('ast.program'), ''];
        case 'Func': return [`${n.name}()`, typeText(n.retType)];
        case 'Param': return [`${n.isArray ? `${n.type.base} ${n.name}[]` : declText(n.type, n.name)}`, tr('ast.param')];
        case 'VarDecl': return [`${declText(n.type, n.name)}${n.arrayLen !== null ? `[${n.arrayLen}]` : ''}`, tr(n.global ? 'ast.global' : 'ast.decl')];
        case 'InitList': return ['{ , }', ''];
        case 'Block': return ['{ }', tr('ast.block')];
        case 'If': return ['if', ''];
        case 'While': return ['while', ''];
        case 'For': return ['for', ''];
        case 'Return': return ['return', ''];
        case 'Break': return ['break', ''];
        case 'Continue': return ['continue', ''];
        case 'Empty': return [';', ''];
        case 'ExprStmt': return ['expr ;', ''];
        case 'Assign': return [n.op, ty];
        case 'Binary': case 'Logical': return [n.op, ty];
        case 'Unary': return [n.op === '-' ? '− (un.)' : n.op === '*' ? '* (deref)' : n.op, ty];
        case 'IncDec': return [n.prefix ? `${n.op} x` : `x ${n.op}`, ty];
        case 'Index': return ['[ ]', ty];
        case 'Call': return [`${n.name}( )`, ty];
        case 'Ident': return [n.name, ty];
        case 'IntLit': return [String(n.value), ty];
        case 'FloatLit': return [String(n.value), ty];
        default: return [n.kind, ''];
    }
}

const CH = 7.4;      // largura média de um caractere (12 px, fonte mono)
const H = 34, VGAP = 30, HGAP = 10, PAD = 12;

/**
 * Calcula o desenho da árvore com raiz em root.
 * @returns {{nodes: Array<{n, x, y, w, depth, label, sub}>, edges: Array<[object, object]>, width, height}}
 */
export function layoutTree(root, tr) {
    const items = [], edges = [];
    let nextX = PAD, maxDepth = 0;
    function place(n, depth) {
        const [label, sub] = nodeLabel(n, tr);
        const w = Math.max(40, Math.max(label.length, sub.length * 0.85) * CH + 16);
        const ch = children(n);
        const item = { n, depth, label, sub, w, y: PAD + depth * (H + VGAP) };
        maxDepth = Math.max(maxDepth, depth);
        if (!ch.length) {
            item.x = nextX + w / 2;
            nextX += w + HGAP;
        } else {
            const startX = nextX;
            const kids = ch.map((c) => place(c, depth + 1));
            for (const k of kids) edges.push([item, k]);
            const mid = (kids[0].x + kids[kids.length - 1].x) / 2;
            // Um pai mais largo que os filhos empurra a própria subárvore para a direita.
            const left = mid - w / 2;
            if (left < startX) {
                const shift = startX - left;
                shiftSubtree(kids, shift);
                nextX += shift;
                item.x = mid + shift;
            } else item.x = mid;
            nextX = Math.max(nextX, item.x + w / 2 + HGAP);
        }
        items.push(item);
        return item;
    }
    function shiftSubtree(kids, dx) {
        const stack = [...kids];
        const seen = new Set();
        while (stack.length) {
            const k = stack.pop();
            if (seen.has(k)) continue;
            seen.add(k);
            k.x += dx;
            for (const [p, c] of edges) if (p === k) stack.push(c);
        }
    }
    place(root, 0);
    return { items, edges, width: Math.ceil(nextX - HGAP + PAD), height: PAD * 2 + (maxDepth + 1) * H + maxDepth * VGAP };
}

/**
 * SVG da árvore com os nós já criados.
 * @param {object} layout saída de layoutTree
 * @param {Set<number>} shown ids dos nós visíveis (a raiz Program tem id -1)
 * @param {number|null} current id do nó criado no passo atual
 * @param {number|null} selected id de nó selecionado com clique
 */
export function astSvg(layout, shown, current = null, selected = null) {
    const visible = (n) => shown.has(n.id);
    let s = `<svg class="fig-svg ast" xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}" role="img">`;
    for (const [p, c] of layout.edges) {
        if (!visible(p.n) || !visible(c.n)) continue;
        s += `<line class="edge" x1="${p.x}" y1="${p.y + H}" x2="${c.x}" y2="${c.y}"/>`;
    }
    for (const it of layout.items) {
        const n = it.n;
        if (!visible(n)) continue;
        const cls = ['nd', `k-${cat(n.kind)}`, n.id === current ? 'cur' : '', n.id === selected ? 'sel' : ''].filter(Boolean).join(' ');
        s += `<g class="node" data-id="${n.id}" data-line="${n.line}"><rect class="${cls}" x="${it.x - it.w / 2}" y="${it.y}" width="${it.w}" height="${H}" rx="6"/>`;
        s += `<text class="mono bold" x="${it.x}" y="${it.y + (it.sub ? 14 : 21)}" text-anchor="middle">${esc(it.label)}</text>`;
        if (it.sub) s += `<text class="small muted" x="${it.x}" y="${it.y + 28}" text-anchor="middle">${esc(it.sub)}</text>`;
        s += '</g>';
    }
    return `${s}</svg>`;
}

/** Categoria do nó, para a cor: declaração, comando, expressão ou folha. */
function cat(kind) {
    if (['Program', 'Func', 'Param', 'VarDecl', 'InitList'].includes(kind)) return 'decl';
    if (['Block', 'If', 'While', 'For', 'Return', 'Break', 'Continue', 'Empty', 'ExprStmt'].includes(kind)) return 'stmt';
    if (['Ident', 'IntLit', 'FloatLit'].includes(kind)) return 'leaf';
    return 'expr';
}
