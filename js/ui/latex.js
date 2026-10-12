/**
 * Tabelas em LaTeX (cabeçalho tabAzul, \hline, sem booktabs): tokens, tabela de símbolos e quadro da pilha.
 */
import { t } from '../i18n/index.js';

const texEsc = (s) => String(s).replace(/[\\{}&%$#_^~]/g, (c) => ({ '\\': '\\textbackslash{}', '^': '\\^{}', '~': '\\~{}' })[c] ?? `\\${c}`);
const tt = (s) => `\\texttt{${texEsc(s)}}`;

function table(head, rows, caption, align = null) {
    return ['% Requer \\usepackage[table]{xcolor}; tabAzul definida abaixo se ainda não existir.', '\\providecolor{tabAzul}{HTML}{1F4E79}',
        '\\begin{table}[htbp]', '\\centering', `\\begin{tabular}{|${align ?? 'c|'.repeat(head.length)}}`, '\\hline',
        `\\rowcolor{tabAzul}${head.map((h) => `\\color{white}\\textbf{${h}}`).join(' & ')} \\\\ \\hline`,
        ...rows.map((r) => `${r.join(' & ')} \\\\ \\hline`),
        '\\end{tabular}', `\\caption{${caption}}`, '\\end{table}', ''].join('\n');
}

export function tokensTex(tokens) {
    const rows = tokens.filter((k) => k.kind !== 'eof').map((k, i) => [i + 1, t(`tok.${k.kind}`), tt(k.text), `${k.line}:${k.col}`]);
    return table(['\\#', t('th.tokKind'), t('th.lexeme'), t('th.pos')], rows, t('tex.tokens'));
}

export function symbolsTex(rows) {
    return table([t('th.name'), t('th.cat'), t('th.type'), t('th.scope'), t('th.line'), t('th.uses'), t('th.where')],
        rows.map((r) => [tt(r.name), r.cat, tt(r.type), texEsc(r.scope), r.line, r.uses, tt(r.where)]), t('tex.symbols'));
}

export function frameTex(frame) {
    const rows = [...frame.slots].sort((a, b) => b.off - a.off).map((s) => [tt(`${s.off}(s0)`), tt(`${s.off + frame.size}(sp)`), s.size, tt(s.name), texEsc(t(`frame.k.${s.kind}`, { name: s.name, n: s.size, ty: s.ty ?? '' }))]);
    return table([t('th.offS0'), t('th.offSp'), t('th.bytes'), t('th.name'), t('th.content')], rows, t('tex.frame', { fn: texEsc(frame.fn), n: frame.size }));
}

export function domTex(F, cfg) {
    const rows = cfg.rpo.map((b) => [tt(b), cfg.pred.get(b).map(tt).join(', ') || '-', b === cfg.rpo[0] ? '-' : tt(cfg.idom.get(b)),
        cfg.doms.get(b).map(tt).join(', '), [...cfg.df.get(b)].map(tt).join(', ') || '-', cfg.depth.get(b)]);
    return table([t('th.block'), t('th.preds'), t('th.idom'), t('th.doms'), t('th.df'), t('th.loop')], rows, t('tex.dom', { fn: texEsc(F.name) }));
}

export function dfgTex(F, g) {
    const rows = g.nodes.map((n) => [n.id, tt(n.text), t(`cls.${n.cls}`), n.lat, n.start, n.alap, n.slack === 0 ? '\\textbf{0}' : n.slack]);
    return table(['\\#', t('th.inst'), t('th.cls'), t('th.lat'), t('th.asap'), t('th.alap'), t('th.slack')], rows, t('tex.dfg', { b: texEsc(g.label), fn: texEsc(F.name), n: g.length }));
}
