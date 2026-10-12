/**
 * Exportação dos grafos no formato DOT do Graphviz, como o opt do LLVM faz (-passes=dot-cfg, dot-dom).
 * Os arquivos abrem no Graphviz (dot -Tpdf cfg.dot -o cfg.pdf), no xdot e em editores online.
 */
import { instText } from '../cc/irgen.js';

const rec = (s) => s.replace(/[\\{}<>|"]/g, (c) => `\\${c}`);
const q = (s) => `"${String(s).replace(/"/g, '\\"')}"`;

export function cfgDot(F, cfg, showInsts = true) {
    const id = new Map(cfg.blocks.map((b, k) => [b, `Node${k}`]));
    const out = [`digraph ${q(`CFG for '${F.name}' function`)} {`, `\tlabel=${q(`CFG for '${F.name}' function`)};`, ''];
    for (const b of F.blocks) {
        const succ = cfg.succ.get(b.label);
        let body = `${rec(b.label)}:\\l`;
        if (showInsts) body += b.insts.map((i) => `  ${rec(instText(i))}\\l`).join('');
        const ports = succ.length === 2 ? `|{<s0>T|<s1>F}` : '';
        out.push(`\t${id.get(b.label)} [shape=record,color="#3d50c3ff",style=filled,fillcolor="#f7f7f7ff",fontname="Courier",label="{${body}${ports}}"];`);
        succ.forEach((s, k) => out.push(`\t${id.get(b.label)}${succ.length === 2 ? `:s${k}` : ''} -> ${id.get(s.to)};`));
    }
    out.push('}', '');
    return out.join('\n');
}

export function domDot(F, cfg) {
    const id = new Map(cfg.blocks.map((b, k) => [b, `Node${k}`]));
    const out = [`digraph ${q(`Dominator tree for '${F.name}' function`)} {`, `\tlabel=${q(`Dominator tree for '${F.name}' function`)};`, ''];
    for (const b of cfg.rpo) {
        out.push(`\t${id.get(b)} [shape=record,fontname="Courier",label="{${rec(b)}}"];`);
        for (const c of cfg.children.get(b)) out.push(`\t${id.get(b)} -> ${id.get(c)};`);
    }
    out.push('}', '');
    return out.join('\n');
}

export function dfgDot(F, g) {
    const out = [`digraph ${q(`DFG for block '${g.label}' of '${F.name}'`)} {`, `\tlabel=${q(`DFG for block '${g.label}' of '${F.name}': critical path ${g.length} cycles`)};`, '\tnode [fontname="Courier"];', ''];
    g.inputs.forEach((inp, k) => {
        out.push(`\tIn${k} [shape=ellipse,label=${q(inp.text)}];`);
        for (const t of inp.to) out.push(`\tIn${k} -> N${t} [style=dotted];`);
    });
    for (const n of g.nodes) {
        const style = n.critical ? ',color="#c0392b",penwidth=2' : '';
        out.push(`\tN${n.id} [shape=box${style},label=${q(`${instText(n.inst)}\\n[${n.start}, ${n.start + n.lat})`)}];`);
    }
    for (const e of g.edges) {
        const st = [e.kind === 'mem' ? 'style=dashed' : '', e.critical ? 'color="#c0392b",penwidth=2' : ''].filter(Boolean).join(',');
        out.push(`\tN${e.from} -> N${e.to}${st ? ` [${st}]` : ''};`);
    }
    out.push('}', '');
    return out.join('\n');
}
