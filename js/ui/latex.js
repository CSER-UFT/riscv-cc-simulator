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
