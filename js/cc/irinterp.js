/**
 * Interpretador da IR. Serve de oráculo nos testes (o assembly gerado precisa produzir o mesmo resultado) e,
 * na interface, para contar quantas vezes cada instrução da IR executa.
 *
 * As operações inteiras seguem o RISC-V nos casos que o C deixa indefinidos (divisão por zero, deslocamento
 * maior que 31, conversão de float fora da faixa), para que o resultado seja comparável com o do processador.
 */
import { DATA_BASE, STACK_TOP } from '../vendor/riscv/parser.js';

const INT_MIN = -2147483648;
const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);
const toBits = (v) => { f32[0] = v; return u32[0] | 0; };
const fromBits = (b) => { u32[0] = b >>> 0; return f32[0]; };

function fptosi(v) {
    if (Number.isNaN(v)) return 2147483647;
    if (v >= 2147483648) return 2147483647;
    if (v < -2147483648) return INT_MIN;
    return Math.trunc(v) | 0;
}

function sdiv(a, b) {
    if (b === 0) return -1;
    if (a === INT_MIN && b === -1) return INT_MIN;
    return Math.trunc(a / b) | 0;
}

function srem(a, b) {
    if (b === 0) return a;
    if (a === INT_MIN && b === -1) return 0;
    return (a % b) | 0;
}

/**
 * @param {object} module saída de generateIR
 * @returns {{ret: number, globals: Map<string, number[]>, steps: number, counts: Map<object, number>, reason: string}}
 */
export function interpret(module, { maxSteps = 1000000 } = {}) {
    const mem = new Map();               // endereço (múltiplo de 4) -> palavra de 32 bits
    const globalAddr = new Map();
    let addr = DATA_BASE;
    for (const g of module.globals) {
        globalAddr.set(g.name, addr);
        const n = g.type.k === 'array' ? g.type.len : 1;
        for (let k = 0; k < n; k++) {
            const v = g.values?.[k] ?? 0;
            mem.set(addr + 4 * k, g.elem === 'float' ? toBits(v) : v | 0);
        }
        addr += 4 * n;
    }
    const fns = new Map(module.functions.map((F) => [F.name, F]));
    const counts = new Map();
    let steps = 0;
    let sp = STACK_TOP;

    const loadW = (a) => mem.get(a >>> 0) ?? 0;
    const read = (ty, a) => (ty === 'float' ? fromBits(loadW(a)) : loadW(a));
    const write = (ty, a, v) => mem.set(a >>> 0, ty === 'float' ? toBits(v) : v | 0);

    class Stop extends Error { }

    function call(F, args) {
        const env = new Map();
        const val = (v) => {
            switch (v.vk) {
                case 'const': return v.v;
                case 'global': return globalAddr.get(v.name);
                case 'undef': return 0;
                default: return env.get(v);
            }
        };
        F.params.forEach((p, k) => env.set(p.value, args[k]));
        const spIn = sp;
        const blocks = new Map(F.blocks.map((b) => [b.label, b]));
        let prev = null, b = F.blocks[0];
        for (;;) {
            // Phi avaliadas juntas na entrada do bloco.
            const phis = b.insts.filter((i) => i.op === 'phi');
            const pv = phis.map((i) => val(i.incoming.find(([, l]) => l === prev)[0]));
            phis.forEach((i, k) => { env.set(i.dst, pv[k]); counts.set(i, (counts.get(i) ?? 0) + 1); });
            let next = null;
            for (const i of b.insts) {
                if (i.op === 'phi') continue;
                if (++steps > maxSteps) throw new Stop();
                counts.set(i, (counts.get(i) ?? 0) + 1);
                const a = i.a ? val(i.a) : null, c = i.b ? val(i.b) : null;
                let r;
                switch (i.op) {
                    case 'alloca': sp -= i.bytes; r = sp; break;
                    case 'load': r = read(i.ty, val(i.ptr)); break;
                    case 'store': write(i.ty, val(i.ptr), val(i.val)); break;
                    case 'add': r = (a + c) | 0; break;
                    case 'sub': r = (a - c) | 0; break;
                    case 'mul': r = Math.imul(a, c); break;
                    case 'sdiv': r = sdiv(a, c); break;
                    case 'srem': r = srem(a, c); break;
                    case 'and': r = a & c; break;
                    case 'or': r = a | c; break;
                    case 'xor': r = i.ty === 'i1' ? (a ^ c) & 1 : a ^ c; break;
                    case 'shl': r = a << (c & 31); break;
                    case 'ashr': r = a >> (c & 31); break;
                    case 'fadd': r = Math.fround(a + c); break;
                    case 'fsub': r = Math.fround(a - c); break;
                    case 'fmul': r = Math.fround(a * c); break;
                    case 'fdiv': r = Math.fround(a / c); break;
                    case 'fneg': r = -a; break;
                    case 'icmp': {
                        const [x, y] = i.ty === 'ptr' ? [a >>> 0, c >>> 0] : [a, c];
                        r = { eq: x === y, ne: x !== y, slt: x < y, sle: x <= y, sgt: x > y, sge: x >= y, ult: x < y, ule: x <= y, ugt: x > y, uge: x >= y }[i.cond] ? 1 : 0;
                        break;
                    }
                    case 'fcmp':
                        r = { oeq: a === c, une: !(a === c), olt: a < c, ole: a <= c, ogt: a > c, oge: a >= c }[i.cond] ? 1 : 0;
                        break;
                    case 'zext': case 'ptrtoint': r = a; break;
                    case 'sitofp': r = Math.fround(a); break;
                    case 'fptosi': r = fptosi(a); break;
                    case 'gep': r = (val(i.base) + 4 * val(i.index)) | 0; break;
                    case 'call': r = call(fns.get(i.fn), i.args.map((x) => val(x.val))); break;
                    case 'br': next = i.target; break;
                    case 'condbr': next = val(i.cond) ? i.t : i.f; break;
                    case 'ret': sp = spIn; return i.val ? val(i.val) : 0;
                    default: throw new Error(`irinterp: ${i.op}`);
                }
                if (i.dst) env.set(i.dst, r);
                if (next) break;
            }
            prev = b.label;
            b = blocks.get(next);
        }
    }

    const globalsOut = () => {
        const out = new Map();
        for (const g of module.globals) {
            const n = g.type.k === 'array' ? g.type.len : 1;
            const base = globalAddr.get(g.name);
            out.set(g.name, Array.from({ length: n }, (_, k) => read(g.elem === 'float' ? 'float' : 'i32', base + 4 * k)));
        }
        return out;
    };
    try {
        const ret = call(fns.get('main'), []);
        return { ret, globals: globalsOut(), steps, counts, reason: 'end' };
    } catch (e) {
        if (!(e instanceof Stop)) throw e;
        return { ret: null, globals: globalsOut(), steps, counts, reason: 'limit' };
    }
}
