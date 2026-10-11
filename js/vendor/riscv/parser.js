/**
 * Montador (assembler) RISC-V em duas passagens.
 *
 * Aceita:
 *   instruções reais descritas em isa.js e as pseudoinstruções usuais (li, la, mv, j, call, ret, beqz, ...);
 *   rótulos (labels), nomes de registradores numéricos e da ABI;
 *   imediatos decimais, hexadecimais (0x), binários (0b), caracteres ('a'), símbolos, sym+N, %hi(sym) e %lo(sym);
 *   seções .text e .data, com as diretivas .byte, .half, .word, .dword, .float, .double, .space, .zero,
 *   .align, .balign, .string, .asciz, .ascii, .equ e .set;
 *   valores iniciais de registradores em comentários no formato "# reg = valor".
 *
 * Erros são acumulados com o número da linha, em vez de interromper a montagem na primeira falha.
 */
import { lookup } from './isa.js';
import { canonical, bank } from './registers.js';
import { signed, unsigned, f32ToBits, f64ToBits } from './bits.js';
import { writeRaw } from './memory.js';
import { t } from '../i18n/index.js';

export const TEXT_BASE = 0x0;
export const DATA_BASE = 0x10000;
export const STACK_TOP = 0x7fff0;

const ROUNDING_MODES = new Set(['rne', 'rtz', 'rdn', 'rup', 'rmm', 'dyn']);

class AsmError extends Error { }

const fail = (msg) => { throw new AsmError(msg); };

/** Posição do início de um comentário (#), ignorando '#' dentro de strings e caracteres. */
function commentStart(line) {
    let quote = null;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (quote) {
            if (c === '\\') i++;
            else if (c === quote) quote = null;
        } else if (c === '"' || c === '\'') {
            quote = c;
        } else if (c === '#') {
            return i;
        }
    }
    return -1;
}

/** Divide a lista de operandos, aceitando vírgulas ou espaços como separadores. */
function splitOperands(text) {
    const t = text.replace(/\s*\(\s*/g, '(').replace(/\s*\)/g, ')').trim();
    if (t.length === 0)
        return [];
    return t.split(/\s*,\s*|\s+/).filter((s) => s.length > 0);
}

/** Divide uma lista separada por vírgulas, respeitando strings. */
function splitList(text) {
    const out = [];
    let cur = '', quote = null;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (quote) {
            cur += c;
            if (c === '\\') { cur += text[++i] ?? ''; continue; }
            if (c === quote) quote = null;
        } else if (c === '"' || c === '\'') {
            quote = c; cur += c;
        } else if (c === ',') {
            out.push(cur.trim()); cur = '';
        } else {
            cur += c;
        }
    }
    if (cur.trim().length > 0) out.push(cur.trim());
    return out;
}

function parseString(tok) {
    const m = /^"((?:[^"\\]|\\.)*)"$/.exec(tok.trim());
    if (!m) fail(t('asm.badString', { tok }));
    return m[1].replace(/\\(.)/g, (_, c) => ({ n: '\n', t: '\t', r: '\r', 0: '\0', '\\': '\\', '"': '"', '\'': '\'' })[c] ?? c);
}

/** Converte um literal numérico inteiro, ou retorna null. */
function parseIntLiteral(tok) {
    const t = tok.trim();
    let m;
    if ((m = /^([+-]?)(0x[0-9a-f_]+|0b[01_]+|\d+)$/i.exec(t))) {
        const v = BigInt(m[2].replace(/_/g, ''));
        return m[1] === '-' ? -v : v;
    }
    if ((m = /^'(\\?.)'$/.exec(t))) {
        const c = m[1].length === 2 ? ({ n: '\n', t: '\t', 0: '\0' }[m[1][1]] ?? m[1][1]) : m[1];
        return BigInt(c.charCodeAt(0));
    }
    return null;
}

function isSymbolName(tok) {
    return /^[A-Za-z_.$][\w.$]*$/.test(tok);
}

/**
 * Monta o programa.
 * @param {string} source código assembly
 * @param {{xlen?: number}} options
 */
/**
 * Mensagem didática para uma instrução que só existe no RV64: explica o motivo (registradores de 64 bits) e,
 * quando há, sugere a instrução equivalente do RV32.
 */
export function rv64Message(name) {
    const fp = { ld: 'fld', sd: 'fsd' }[name];
    let alt = { ld: 'lw', sd: 'sw', lwu: 'lw' }[name] ?? null;
    if (!alt && /^fcvt\.[a-z]+\.lu?$|^fcvt\.lu?\./.test(name)) alt = name.replace(/\.l(u?)(?=\.|$)/, '.w$1');
    else if (!alt && /w$/.test(name)) alt = name.slice(0, -1);
    const hint = !alt ? '' : fp ? t('asm.rv64AltFp', { alt, fp }) : t('asm.rv64Alt', { alt });
    return t('asm.needRv64', { name, hint });
}

export function assemble(source, { xlen = 32 } = {}) {
    const errors = [];
    const symbols = new Map();
    const init = { x: new Map(), f: new Map() };
    const data = new Map();
    const dataLabels = [];
    const textItems = [];
    const dataFixups = [];
    const lines = source.split(/\r?\n/);

    let section = 'text';
    let pc = TEXT_BASE;
    let dp = DATA_BASE;
    let pendingLabels = [];

    const report = (lineNo, msg) => errors.push({ line: lineNo, message: msg });

    const placeLabels = (addr) => {
        for (const { name, lineNo } of pendingLabels) {
            if (symbols.has(name))
                report(lineNo, t('asm.labelTwice', { name }));
            else
                symbols.set(name, { value: BigInt(addr), kind: 'label', section });
            if (section === 'data')
                dataLabels.push({ name, addr: BigInt(addr) });
        }
        pendingLabels = [];
    };

    const alignData = (n) => {
        if (dp % n !== 0)
            dp += n - (dp % n);
    };

    /** Avalia uma expressão de imediato. `allowForward` permite símbolos ainda não definidos (retorna null). */
    const evalImm = (tok, ctx = {}) => {
        if (typeof tok === 'object') {
            const target = evalImm(tok.sym, ctx);
            const anchor = BigInt(ctx.pc - (tok.anchor ?? 0));
            const delta = target - anchor;
            const hi = (delta + 0x800n) >> 12n;
            return tok.part === 'hi' ? unsigned(hi, 20) : delta - (hi << 12n);
        }
        let m;
        if ((m = /^%(hi|lo)\((.+)\)$/i.exec(tok))) {
            const v = unsigned(evalImm(m[2], ctx), 32);
            const hi = (v + 0x800n) >> 12n;
            return m[1].toLowerCase() === 'hi' ? unsigned(hi, 20) : signed(v - (hi << 12n), 12);
        }
        const lit = parseIntLiteral(tok);
        if (lit !== null)
            return lit;
        if ((m = /^([A-Za-z_.$][\w.$]*)\s*([+-])\s*(\S+)$/.exec(tok))) {
            const base = evalImm(m[1], ctx);
            const off = parseIntLiteral(m[3]);
            if (off === null) fail(t('asm.badOffsetIn', { tok }));
            return m[2] === '+' ? base + off : base - off;
        }
        if (isSymbolName(tok)) {
            if (symbols.has(tok))
                return symbols.get(tok).value;
            if (ctx.allowForward)
                return null;
            fail(t('asm.undefinedSymbol', { tok }));
        }
        fail(t('asm.badImmediate', { tok }));
    };

    // Expansão de pseudoinstruções. Retorna uma lista de [mnemônico, operandos].
    const liSequence = (rd, value) => {
        let v = BigInt.asIntN(xlen, value);
        const fits = (x, bits) => x >= -(1n << BigInt(bits - 1)) && x < (1n << BigInt(bits - 1));
        if (fits(v, 12))
            return [['addi', [rd, 'zero', `${v}`]]];
        if (xlen === 32 || fits(v, 32)) {
            const lo = signed(v, 12);
            const hi = unsigned((v - lo) >> 12n, 20);
            const seq = [['lui', [rd, `0x${hi.toString(16)}`]]];
            if (lo !== 0n)
                seq.push([xlen === 64 ? 'addiw' : 'addi', [rd, rd, `${lo}`]]);
            return seq;
        }
        // XLEN = 64 e valor maior que 32 bits: carrega a parte alta recursivamente, desloca e soma a parte baixa.
        const lo = signed(v, 12);
        let hi = (v - lo) >> 12n;
        let shift = 12n;
        while ((hi & 1n) === 0n) { hi >>= 1n; shift++; }
        const seq = liSequence(rd, hi);
        seq.push(['slli', [rd, rd, `${shift}`]]);
        if (lo !== 0n)
            seq.push(['addi', [rd, rd, `${lo}`]]);
        return seq;
    };

    const expand = (mn, ops) => {
        const need = (n) => { if (ops.length !== n) fail(t('asm.operandCount', { name: mn, n, got: ops.length })); };
        const p = mn.endsWith('.d') ? 'd' : 's';
        switch (mn) {
            case 'nop': need(0); return [['addi', ['zero', 'zero', '0']]];
            case 'li': {
                need(2);
                const v = evalImm(ops[1]);
                const lim = 1n << BigInt(xlen);
                if (v < -(lim >> 1n) || v >= lim) fail(t('asm.valueTooBig', { v, xlen }));
                return liSequence(ops[0], v);
            }
            case 'la': need(2); return [
                ['auipc', [ops[0], { part: 'hi', sym: ops[1], anchor: 0 }]],
                ['addi', [ops[0], ops[0], { part: 'lo', sym: ops[1], anchor: 4 }]],
            ];
            case 'mv': need(2); return [['addi', [ops[0], ops[1], '0']]];
            case 'not': need(2); return [['xori', [ops[0], ops[1], '-1']]];
            case 'neg': need(2); return [['sub', [ops[0], 'zero', ops[1]]]];
            case 'negw': need(2); return [['subw', [ops[0], 'zero', ops[1]]]];
            case 'sext.w': need(2); return [['addiw', [ops[0], ops[1], '0']]];
            case 'seqz': need(2); return [['sltiu', [ops[0], ops[1], '1']]];
            case 'snez': need(2); return [['sltu', [ops[0], 'zero', ops[1]]]];
            case 'sltz': need(2); return [['slt', [ops[0], ops[1], 'zero']]];
            case 'sgtz': need(2); return [['slt', [ops[0], 'zero', ops[1]]]];
            case 'beqz': need(2); return [['beq', [ops[0], 'zero', ops[1]]]];
            case 'bnez': need(2); return [['bne', [ops[0], 'zero', ops[1]]]];
            case 'blez': need(2); return [['bge', ['zero', ops[0], ops[1]]]];
            case 'bgez': need(2); return [['bge', [ops[0], 'zero', ops[1]]]];
            case 'bltz': need(2); return [['blt', [ops[0], 'zero', ops[1]]]];
            case 'bgtz': need(2); return [['blt', ['zero', ops[0], ops[1]]]];
            case 'bgt': need(3); return [['blt', [ops[1], ops[0], ops[2]]]];
            case 'ble': need(3); return [['bge', [ops[1], ops[0], ops[2]]]];
            case 'bgtu': need(3); return [['bltu', [ops[1], ops[0], ops[2]]]];
            case 'bleu': need(3); return [['bgeu', [ops[1], ops[0], ops[2]]]];
            case 'j': need(1); return [['jal', ['zero', ops[0]]]];
            case 'tail': need(1); return [['jal', ['zero', ops[0]]]];
            case 'call': need(1); return [['jal', ['ra', ops[0]]]];
            case 'jal': return ops.length === 1 ? [['jal', ['ra', ops[0]]]] : [['jal', ops]];
            case 'jr': need(1); return [['jalr', ['zero', `0(${ops[0]})`]]];
            case 'jalr': return ops.length === 1 ? [['jalr', ['ra', `0(${ops[0]})`]]] : [['jalr', ops]];
            case 'ret': need(0); return [['jalr', ['zero', '0(ra)']]];
            case 'fmv.s': case 'fmv.d': need(2); return [[`fsgnj.${p}`, [ops[0], ops[1], ops[1]]]];
            case 'fabs.s': case 'fabs.d': need(2); return [[`fsgnjx.${p}`, [ops[0], ops[1], ops[1]]]];
            case 'fneg.s': case 'fneg.d': need(2); return [[`fsgnjn.${p}`, [ops[0], ops[1], ops[1]]]];
        }
        const d = lookup(mn);
        // Load com rótulo: lw rd, simbolo  ->  auipc rd, %pcrel_hi; lw rd, %pcrel_lo(rd)
        if (d && d.fmt === 'L' && ops.length >= 2 && !ops[1].includes('(') && canonical(ops[1]) === null) {
            const tmp = ops.length === 3 ? ops[2] : ops[0];
            if (ops.length === 2 && d.rd !== 'x') fail(t('asm.needTemp', { inst: `${mn} ${ops[0]}, ${ops[1]}` }));
            return [
                ['auipc', [tmp, { part: 'hi', sym: ops[1], anchor: 0 }]],
                [mn, [ops[0], { mem: { part: 'lo', sym: ops[1], anchor: 4 }, reg: tmp }]],
            ];
        }
        return [[mn, ops]];
    };

    // Primeira passagem: rótulos, tamanho de cada linha de código e dados -------------------------------------
    for (let li = 0; li < lines.length; li++) {
        const lineNo = li + 1;
        const raw = lines[li];
        const cpos = commentStart(raw);
        let code = cpos >= 0 ? raw.slice(0, cpos) : raw;
        const comment = cpos >= 0 ? raw.slice(cpos + 1) : '';

        // Valores iniciais: "# reg = valor", sozinho na linha e com um valor numérico. Comentários depois de
        // uma instrução, ou com texto depois do "=", são apenas comentários (por exemplo "# a1 = n").
        const im = code.trim() === '' ? /^\s*([A-Za-z][\w]*)\s*=\s*(\S+)\s*$/.exec(comment) : null;
        if (im && canonical(im[1]) !== null && /^[+-]?(\d|\.\d|inf|nan)/i.test(im[2])) {
            const reg = canonical(im[1]);
            if (reg === 'x0') {
                report(lineNo, t('asm.initX0'));
            } else if (bank(reg) === 'x') {
                const v = parseIntLiteral(im[2]);
                if (v === null) report(lineNo, t('asm.badInitInt', { reg: im[1], value: im[2] }));
                else init.x.set(reg, signed(v, xlen));
            } else {
                const v = Number(im[2]);
                if (Number.isNaN(v) && im[2].toLowerCase() !== 'nan') report(lineNo, t('asm.badInit', { reg: im[1], value: im[2] }));
                else init.f.set(reg, v);
            }
        }

        try {
            let m;
            code = code.trim();
            while ((m = /^([A-Za-z_.$][\w.$]*)\s*:\s*/.exec(code))) {
                pendingLabels.push({ name: m[1], lineNo });
                code = code.slice(m[0].length);
            }
            if (code.length === 0)
                continue;

            const sp = code.search(/\s/);
            const head = (sp < 0 ? code : code.slice(0, sp)).toLowerCase();
            const rest = sp < 0 ? '' : code.slice(sp + 1).trim();

            if (head.startsWith('.')) {
                handleDirective(head, rest, lineNo);
                continue;
            }

            if (section !== 'text')
                fail(t('asm.outsideText', { name: head }));

            placeLabels(pc);
            const ops = splitOperands(rest);
            const seq = expand(head, ops);
            textItems.push({ lineNo, source: code, mnemonic: head, ops, pc, count: seq.length });
            pc += 4 * seq.length;
        } catch (e) {
            if (!(e instanceof AsmError)) throw e;
            report(lineNo, e.message);
        }
    }
    placeLabels(section === 'text' ? pc : dp);

    function handleDirective(dir, rest, lineNo) {
        const args = splitList(rest);
        const dataOnly = () => { if (section !== 'data') fail(t('asm.dataOnly', { dir })); };
        const emitInts = (size) => {
            dataOnly();
            alignData(size);
            placeLabels(dp);
            for (const a of args) {
                const v = evalImm(a, { allowForward: true });
                if (v === null) dataFixups.push({ addr: dp, size, tok: a, lineNo });
                else writeRaw(data, BigInt(dp), size, v);
                dp += size;
            }
        };
        switch (dir) {
            case '.text': placeLabels(section === 'text' ? pc : dp); section = 'text'; return;
            case '.data': case '.rodata': case '.bss': case '.sdata': placeLabels(section === 'text' ? pc : dp); section = 'data'; return;
            case '.section': {
                placeLabels(section === 'text' ? pc : dp);
                section = /text/.test(args[0] ?? '') ? 'text' : 'data';
                return;
            }
            case '.globl': case '.global': case '.type': case '.size': case '.file': case '.ident': case '.option': case '.local':
                return;
            case '.equ': case '.set': {
                if (args.length !== 2 || !isSymbolName(args[0])) fail(t('asm.equUsage', { dir }));
                symbols.set(args[0], { value: evalImm(args[1]), kind: 'const' });
                return;
            }
            case '.byte': return emitInts(1);
            case '.half': case '.short': return emitInts(2);
            case '.word': case '.long': return emitInts(4);
            case '.dword': case '.quad': return emitInts(8);
            case '.float': case '.double': {
                dataOnly();
                const size = dir === '.float' ? 4 : 8;
                alignData(size);
                placeLabels(dp);
                for (const a of args) {
                    const v = Number(a);
                    if (Number.isNaN(v) && a.toLowerCase() !== 'nan') fail(t('asm.badFloat', { value: a }));
                    writeRaw(data, BigInt(dp), size, size === 4 ? f32ToBits(v) : f64ToBits(v));
                    dp += size;
                }
                return;
            }
            case '.space': case '.zero': case '.skip': {
                dataOnly();
                placeLabels(dp);
                const n = Number(evalImm(args[0] ?? ''));
                if (n < 0) fail(t('asm.negativeSize'));
                for (let i = 0; i < n; i++) data.set(BigInt(dp + i), 0);
                dp += n;
                return;
            }
            case '.align': case '.p2align': case '.balign': {
                const n = Number(evalImm(args[0] ?? ''));
                const bytes = dir === '.balign' ? n : 2 ** n;
                if (section === 'data') alignData(bytes);
                return;
            }
            case '.string': case '.asciz': case '.ascii': {
                dataOnly();
                placeLabels(dp);
                for (const a of args) {
                    const s = parseString(a);
                    for (const ch of s) data.set(BigInt(dp++), ch.charCodeAt(0) & 0xff);
                    if (dir !== '.ascii') data.set(BigInt(dp++), 0);
                }
                return;
            }
        }
        fail(t('asm.unknownDirective', { dir }));
    }

    if (pc > DATA_BASE)
        report(lines.length, t('asm.codeTooBig', { addr: `0x${DATA_BASE.toString(16)}` }));

    // Segunda passagem: gera as instruções com símbolos resolvidos -------------------------------------------
    for (const fx of dataFixups) {
        try {
            writeRaw(data, BigInt(fx.addr), fx.size, evalImm(fx.tok));
        } catch (e) {
            if (!(e instanceof AsmError)) throw e;
            report(fx.lineNo, e.message);
        }
    }

    const instructions = [];
    for (const item of textItems) {
        try {
            const seq = expand(item.mnemonic, item.ops);
            const isPseudo = seq.length > 1 || seq[0][0] !== item.mnemonic;
            seq.forEach(([name, ops], k) => {
                const ipc = item.pc + 4 * k;
                const inst = buildInstruction(name, ops, ipc);
                inst.line = item.lineNo;
                inst.source = item.source;
                inst.pseudo = isPseudo ? item.mnemonic : null;
                inst.index = instructions.length;
                instructions.push(inst);
            });
        } catch (e) {
            if (!(e instanceof AsmError)) throw e;
            report(item.lineNo, e.message);
        }
    }

    function regOperand(tok, expectedBank, what) {
        if (typeof tok !== 'string') fail(t('asm.expectedReg', { what: t(what) }));
        const r = canonical(tok);
        if (r === null) fail(t('asm.badReg', { tok, what: t(what) }));
        if (bank(r) !== expectedBank)
            fail(t(expectedBank === 'x' ? 'asm.needIntReg' : 'asm.needFloatReg', { what: t(what), tok }));
        return { reg: r, name: tok };
    }

    function immOperand(tok, pcHere, lo, hi, what) {
        const v = evalImm(tok, { pc: pcHere });
        if (v < lo || v > hi) fail(t('asm.outOfRange', { what: t(what), v, lo, hi }));
        return v;
    }

    function memOperand(tok, pcHere) {
        if (typeof tok === 'object' && tok.mem) {
            const off = evalImm(tok.mem, { pc: pcHere });
            return { off, base: tok.reg, offText: `${off}` };
        }
        const m = /^(.*)\(([^()]+)\)$/.exec(tok);
        if (!m) fail(t('asm.badMem', { tok }));
        const off = m[1].length === 0 ? 0n : evalImm(m[1], { pc: pcHere });
        if (off < -2048n || off > 2047n) fail(t('asm.outOfRange', { what: t('asm.what.offset'), v: off, lo: -2048, hi: 2047 }));
        return { off, base: m[2], offText: m[1].length === 0 ? '0' : `${off}` };
    }

    function targetOperand(tok, pcHere, range) {
        let target, label = null;
        const lit = parseIntLiteral(tok);
        if (lit !== null) {
            target = pcHere + Number(lit);
        } else {
            target = Number(evalImm(tok, { pc: pcHere }));
            label = tok;
        }
        const off = target - pcHere;
        if (off % 2 !== 0) fail(t('asm.misaligned', { tok }));
        if (off < -range || off >= range) fail(t('asm.targetRange', { tok }));
        return { target, text: label ?? `${off}` };
    }

    function buildInstruction(name, ops, ipc) {
        const d = lookup(name);
        if (!d) fail(t('asm.unknownInstruction', { name }));
        if (d.rv64 && xlen !== 64) fail(rv64Message(name));

        const inst = { name, def: d, pc: ipc, rd: null, rs1: null, rs2: null, rs3: null, imm: 0, target: null, rm: null };
        const opsText = [];
        let rest = ops;

        if (d.rm && rest.length > 0 && typeof rest[rest.length - 1] === 'string' && ROUNDING_MODES.has(rest[rest.length - 1].toLowerCase())) {
            inst.rm = rest[rest.length - 1].toLowerCase();
            if (inst.rm === 'dyn') inst.rm = null;
            rest = rest.slice(0, -1);
        }
        const need = (n) => { if (rest.length !== n) fail(t('asm.operandCount', { name, n, got: rest.length })); };
        const setReg = (field, tok, what) => {
            const r = regOperand(tok, d[field], what);
            inst[field] = r.reg;
            opsText.push(r.name);
        };

        switch (d.fmt) {
            case 'R':
                need(3);
                setReg('rd', rest[0], 'asm.what.dest');
                setReg('rs1', rest[1], 'asm.what.rs1');
                setReg('rs2', rest[2], 'asm.what.rs2');
                break;
            case 'R4':
                need(4);
                setReg('rd', rest[0], 'asm.what.dest');
                setReg('rs1', rest[1], 'asm.what.rs1');
                setReg('rs2', rest[2], 'asm.what.rs2');
                setReg('rs3', rest[3], 'asm.what.rs3');
                break;
            case 'R2':
                need(2);
                setReg('rd', rest[0], 'asm.what.dest');
                setReg('rs1', rest[1], 'asm.what.src');
                break;
            case 'I':
                need(3);
                setReg('rd', rest[0], 'asm.what.dest');
                setReg('rs1', rest[1], 'asm.what.rs1');
                inst.imm = Number(immOperand(rest[2], ipc, -2048n, 2047n, 'asm.what.imm'));
                opsText.push(`${inst.imm}`);
                break;
            case 'SH': {
                need(3);
                setReg('rd', rest[0], 'asm.what.dest');
                setReg('rs1', rest[1], 'asm.what.rs1');
                const bits = d.shamtBits ?? (xlen === 64 ? 6 : 5);
                inst.imm = Number(immOperand(rest[2], ipc, 0n, BigInt((1 << bits) - 1), 'asm.what.shamt'));
                opsText.push(`${inst.imm}`);
                break;
            }
            case 'U':
                need(2);
                setReg('rd', rest[0], 'asm.what.dest');
                inst.imm = Number(unsigned(immOperand(rest[1], ipc, -(1n << 19n), (1n << 20n) - 1n, 'asm.what.imm'), 20));
                opsText.push(`0x${inst.imm.toString(16)}`);
                break;
            case 'L': case 'S': {
                need(2);
                if (d.fmt === 'L') setReg('rd', rest[0], 'asm.what.dest');
                else setReg('rs2', rest[0], 'asm.what.storeValue');
                const m = memOperand(rest[1], ipc);
                const r = regOperand(m.base, 'x', 'asm.what.base');
                inst.rs1 = r.reg;
                inst.imm = Number(m.off);
                opsText.push(`${m.offText}(${r.name})`);
                break;
            }
            case 'B': {
                need(3);
                setReg('rs1', rest[0], 'asm.what.rs1');
                setReg('rs2', rest[1], 'asm.what.rs2');
                const t = targetOperand(rest[2], ipc, 4096);
                inst.target = t.target;
                inst.imm = t.target - ipc;
                opsText.push(t.text);
                break;
            }
            case 'J': {
                need(2);
                setReg('rd', rest[0], 'asm.what.dest');
                const t = targetOperand(rest[1], ipc, 1 << 20);
                inst.target = t.target;
                inst.imm = t.target - ipc;
                opsText.push(t.text);
                break;
            }
            case 'JR': {
                if (rest.length === 3) {
                    setReg('rd', rest[0], 'asm.what.dest');
                    setReg('rs1', rest[1], 'asm.what.base');
                    inst.imm = Number(immOperand(rest[2], ipc, -2048n, 2047n, 'asm.what.imm'));
                    opsText.push(`${inst.imm}`);
                } else {
                    need(2);
                    setReg('rd', rest[0], 'asm.what.dest');
                    if (canonical(rest[1]) !== null) {
                        setReg('rs1', rest[1], 'asm.what.base');
                    } else {
                        const m = memOperand(rest[1], ipc);
                        const r = regOperand(m.base, 'x', 'asm.what.base');
                        inst.rs1 = r.reg;
                        inst.imm = Number(m.off);
                        opsText.push(`${m.offText}(${r.name})`);
                    }
                }
                break;
            }
            case 'SYS':
                need(0);
                break;
            default:
                fail(t('asm.unknownFormat', { name }));
        }
        if (inst.rm) opsText.push(inst.rm);
        inst.text = opsText.length > 0 ? `${name} ${opsText.join(', ')}` : name;
        return inst;
    }

    errors.sort((a, b) => a.line - b.line);
    if (errors.length === 0 && instructions.length === 0)
        errors.push({ line: 1, message: t('asm.empty') });

    const labels = new Map();
    for (const [name, s] of symbols)
        if (s.kind === 'label') labels.set(name, s.value);

    return { instructions, labels, dataLabels, data, init, errors, xlen };
}
