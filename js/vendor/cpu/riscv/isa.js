/**
 * Descrição declarativa do conjunto de instruções RISC-V suportado.
 *
 * Cada instrução é descrita por uma entrada com:
 *   fmt   formato da sintaxe de operandos (ver OPERAND_FORMATS em parser.js)
 *   cls   classe de operação, usada para escolher estação de reserva e latência
 *   rd, rs1, rs2, rs3   banco de cada operando ('x', 'f' ou null)
 *   exec  semântica: (a, b, inst, xlen, c) => resultado (c é o terceiro operando, usado só no formato R4)
 *   cond  (desvios) semântica: (a, b, xlen) => booleano
 *   mem   (loads/stores) { size, signed, fp }
 *   rv64  instrução disponível apenas com XLEN = 64
 *
 * Para acrescentar uma instrução basta acrescentar uma entrada aqui; parser, simulador de referência e
 * motor de Tomasulo são genéricos e usam apenas esta tabela.
 */
import { signed, unsigned, f32ToBits, bitsToF32, f64ToBits, bitsToF64, floatToInt, fusedMulAdd } from './bits.js';

/** Classes de operação. A ordem define a ordem de exibição na configuração. */
export const CLASSES = {
    alu: 'Inteiro (ALU)',
    mul: 'Multiplicação inteira',
    div: 'Divisão inteira',
    branch: 'Desvio condicional',
    jump: 'Salto (jal/jalr)',
    load: 'Load',
    store: 'Store',
    fadd: 'PF: soma, comparação, conversão',
    fmul: 'PF: multiplicação',
    fdiv: 'PF: divisão e raiz',
    system: 'Sistema (ecall/ebreak)',
};

const ISA = new Map();

function def(name, props) {
    ISA.set(name, { name, rd: null, rs1: null, rs2: null, rs3: null, ...props });
}

const fr = Math.fround;
const bool = (c) => (c ? 1n : 0n);
const imm = (inst) => BigInt(inst.imm);
const shamt = (v, xlen) => unsigned(v, xlen) & BigInt(xlen - 1);
const w = (v) => signed(v, 32);

// RV32I / RV64I: inteiros ----------------------------------------------------------------------------------

def('lui', { fmt: 'U', cls: 'alu', rd: 'x', exec: (a, b, i, xlen) => signed(w(imm(i) << 12n), xlen) });
def('auipc', { fmt: 'U', cls: 'alu', rd: 'x', exec: (a, b, i, xlen) => signed(BigInt(i.pc) + w(imm(i) << 12n), xlen) });

const R = (name, cls, fn, extra = {}) =>
    def(name, { fmt: 'R', cls, rd: 'x', rs1: 'x', rs2: 'x', exec: fn, ...extra });
const I = (name, fn, extra = {}) =>
    def(name, { fmt: 'I', cls: 'alu', rd: 'x', rs1: 'x', exec: fn, ...extra });
const SH = (name, fn, extra = {}) =>
    def(name, { fmt: 'SH', cls: 'alu', rd: 'x', rs1: 'x', exec: fn, ...extra });

R('add', 'alu', (a, b, i, x) => signed(a + b, x));
R('sub', 'alu', (a, b, i, x) => signed(a - b, x));
R('sll', 'alu', (a, b, i, x) => signed(a << shamt(b, x), x));
R('slt', 'alu', (a, b) => bool(a < b));
R('sltu', 'alu', (a, b, i, x) => bool(unsigned(a, x) < unsigned(b, x)));
R('xor', 'alu', (a, b, i, x) => signed(a ^ b, x));
R('srl', 'alu', (a, b, i, x) => signed(unsigned(a, x) >> shamt(b, x), x));
R('sra', 'alu', (a, b, i, x) => signed(a >> shamt(b, x), x));
R('or', 'alu', (a, b, i, x) => signed(a | b, x));
R('and', 'alu', (a, b, i, x) => signed(a & b, x));

I('addi', (a, b, i, x) => signed(a + imm(i), x));
I('slti', (a, b, i) => bool(a < imm(i)));
I('sltiu', (a, b, i, x) => bool(unsigned(a, x) < unsigned(imm(i), x)));
I('xori', (a, b, i, x) => signed(a ^ imm(i), x));
I('ori', (a, b, i, x) => signed(a | imm(i), x));
I('andi', (a, b, i, x) => signed(a & imm(i), x));
SH('slli', (a, b, i, x) => signed(a << imm(i), x));
SH('srli', (a, b, i, x) => signed(unsigned(a, x) >> imm(i), x));
SH('srai', (a, b, i, x) => signed(a >> imm(i), x));

// Variantes de 32 bits do RV64I
R('addw', 'alu', (a, b) => w(a + b), { rv64: true });
R('subw', 'alu', (a, b) => w(a - b), { rv64: true });
R('sllw', 'alu', (a, b) => w(unsigned(a, 32) << (unsigned(b, 32) & 31n)), { rv64: true });
R('srlw', 'alu', (a, b) => w(unsigned(a, 32) >> (unsigned(b, 32) & 31n)), { rv64: true });
R('sraw', 'alu', (a, b) => w(w(a) >> (unsigned(b, 32) & 31n)), { rv64: true });
I('addiw', (a, b, i) => w(a + imm(i)), { rv64: true });
SH('slliw', (a, b, i) => w(unsigned(a, 32) << imm(i)), { rv64: true, shamtBits: 5 });
SH('srliw', (a, b, i) => w(unsigned(a, 32) >> imm(i)), { rv64: true, shamtBits: 5 });
SH('sraiw', (a, b, i) => w(w(a) >> imm(i)), { rv64: true, shamtBits: 5 });

// Loads e stores
const L = (name, size, sgn, extra = {}) =>
    def(name, { fmt: 'L', cls: 'load', rd: 'x', rs1: 'x', mem: { size, signed: sgn, fp: null }, ...extra });
const S = (name, size, extra = {}) =>
    def(name, { fmt: 'S', cls: 'store', rs1: 'x', rs2: 'x', mem: { size, fp: null }, ...extra });
L('lb', 1, true);
L('lh', 2, true);
L('lw', 4, true);
L('lbu', 1, false);
L('lhu', 2, false);
L('lwu', 4, false, { rv64: true });
L('ld', 8, true, { rv64: true });
S('sb', 1);
S('sh', 2);
S('sw', 4);
S('sd', 8, { rv64: true });

// Desvios e saltos
const B = (name, cond) => def(name, { fmt: 'B', cls: 'branch', rs1: 'x', rs2: 'x', cond });
B('beq', (a, b) => a === b);
B('bne', (a, b) => a !== b);
B('blt', (a, b) => a < b);
B('bge', (a, b) => a >= b);
B('bltu', (a, b, x) => unsigned(a, x) < unsigned(b, x));
B('bgeu', (a, b, x) => unsigned(a, x) >= unsigned(b, x));

def('jal', { fmt: 'J', cls: 'jump', rd: 'x', exec: (a, b, i, x) => signed(BigInt(i.pc + 4), x) });
def('jalr', {
    fmt: 'JR', cls: 'jump', rd: 'x', rs1: 'x',
    exec: (a, b, i, x) => signed(BigInt(i.pc + 4), x),
    jumpTarget: (a, i, x) => Number(unsigned(a + imm(i), x) & ~1n),
});

def('ecall', { fmt: 'SYS', cls: 'system' });
def('ebreak', { fmt: 'SYS', cls: 'system' });

// Extensão M ------------------------------------------------------------------------------------------------

function divS(a, b, bits) {
    if (b === 0n) return -1n;
    return signed(a / b, bits);
}
function divU(a, b, bits) {
    const ua = unsigned(a, bits), ub = unsigned(b, bits);
    if (ub === 0n) return -1n;
    return signed(ua / ub, bits);
}
function remS(a, b, bits) {
    if (b === 0n) return signed(a, bits);
    return signed(a % b, bits);
}
function remU(a, b, bits) {
    const ua = unsigned(a, bits), ub = unsigned(b, bits);
    if (ub === 0n) return signed(ua, bits);
    return signed(ua % ub, bits);
}

R('mul', 'mul', (a, b, i, x) => signed(a * b, x));
R('mulh', 'mul', (a, b, i, x) => signed((a * b) >> BigInt(x), x));
R('mulhsu', 'mul', (a, b, i, x) => signed((a * unsigned(b, x)) >> BigInt(x), x));
R('mulhu', 'mul', (a, b, i, x) => signed((unsigned(a, x) * unsigned(b, x)) >> BigInt(x), x));
R('div', 'div', (a, b, i, x) => divS(a, b, x));
R('divu', 'div', (a, b, i, x) => divU(a, b, x));
R('rem', 'div', (a, b, i, x) => remS(a, b, x));
R('remu', 'div', (a, b, i, x) => remU(a, b, x));
R('mulw', 'mul', (a, b) => w(w(a) * w(b)), { rv64: true });
R('divw', 'div', (a, b) => w(divS(w(a), w(b), 32)), { rv64: true });
R('divuw', 'div', (a, b) => w(divU(a, b, 32)), { rv64: true });
R('remw', 'div', (a, b) => w(remS(w(a), w(b), 32)), { rv64: true });
R('remuw', 'div', (a, b) => w(remU(a, b, 32)), { rv64: true });

// Extensões F e D -------------------------------------------------------------------------------------------

/** Gera as instruções de ponto flutuante para uma precisão. */
function floatOps(p) {
    const single = p === 's';
    const round = single ? fr : (v) => v;
    const toBits = single ? f32ToBits : f64ToBits;
    const fromBits = single ? bitsToF32 : bitsToF64;
    const signBit = single ? 0x80000000n : 0x8000000000000000n;
    const size = single ? 4 : 8;

    def(single ? 'flw' : 'fld', { fmt: 'L', cls: 'load', rd: 'f', rs1: 'x', mem: { size, signed: false, fp: p } });
    def(single ? 'fsw' : 'fsd', { fmt: 'S', cls: 'store', rs1: 'x', rs2: 'f', mem: { size, fp: p } });

    const FR = (name, cls, fn) => def(`${name}.${p}`, { fmt: 'R', cls, rd: 'f', rs1: 'f', rs2: 'f', exec: fn, rm: true });
    FR('fadd', 'fadd', (a, b) => round(a + b));
    FR('fsub', 'fadd', (a, b) => round(a - b));
    FR('fmul', 'fmul', (a, b) => round(a * b));
    FR('fdiv', 'fdiv', (a, b) => round(a / b));

    const pick = (a, b, wantMin) => {
        if (Number.isNaN(a)) return Number.isNaN(b) ? NaN : b;
        if (Number.isNaN(b)) return a;
        if (a === 0 && b === 0) {
            const aNeg = Object.is(a, -0), bNeg = Object.is(b, -0);
            return wantMin ? (aNeg || bNeg ? -0 : 0) : (aNeg && bNeg ? -0 : 0);
        }
        return wantMin ? Math.min(a, b) : Math.max(a, b);
    };
    def(`fmin.${p}`, { fmt: 'R', cls: 'fadd', rd: 'f', rs1: 'f', rs2: 'f', exec: (a, b) => pick(a, b, true) });
    def(`fmax.${p}`, { fmt: 'R', cls: 'fadd', rd: 'f', rs1: 'f', rs2: 'f', exec: (a, b) => pick(a, b, false) });

    const sgnj = (a, b, mode) => {
        const mag = toBits(a) & ~signBit;
        const sa = toBits(a) & signBit, sb = toBits(b) & signBit;
        const s = mode === 'j' ? sb : (mode === 'n' ? (sb ^ signBit) : (sa ^ sb));
        return fromBits(mag | s);
    };
    def(`fsgnj.${p}`, { fmt: 'R', cls: 'fadd', rd: 'f', rs1: 'f', rs2: 'f', exec: (a, b) => sgnj(a, b, 'j') });
    def(`fsgnjn.${p}`, { fmt: 'R', cls: 'fadd', rd: 'f', rs1: 'f', rs2: 'f', exec: (a, b) => sgnj(a, b, 'n') });
    def(`fsgnjx.${p}`, { fmt: 'R', cls: 'fadd', rd: 'f', rs1: 'f', rs2: 'f', exec: (a, b) => sgnj(a, b, 'x') });

    def(`feq.${p}`, { fmt: 'R', cls: 'fadd', rd: 'x', rs1: 'f', rs2: 'f', exec: (a, b) => bool(a === b) });
    def(`flt.${p}`, { fmt: 'R', cls: 'fadd', rd: 'x', rs1: 'f', rs2: 'f', exec: (a, b) => bool(a < b) });
    def(`fle.${p}`, { fmt: 'R', cls: 'fadd', rd: 'x', rs1: 'f', rs2: 'f', exec: (a, b) => bool(a <= b) });

    // Multiplicação e soma fundidas (formato R4: três operandos fonte), executadas no multiplicador
    const prec = single ? 24 : 53;
    const R4 = (name, fn) => def(`${name}.${p}`, { fmt: 'R4', cls: 'fmul', rd: 'f', rs1: 'f', rs2: 'f', rs3: 'f', rm: true, exec: fn });
    R4('fmadd', (a, b, i, x, c) => round(fusedMulAdd(a, b, c, prec)));
    R4('fmsub', (a, b, i, x, c) => round(fusedMulAdd(a, b, -c, prec)));
    R4('fnmsub', (a, b, i, x, c) => round(fusedMulAdd(-a, b, c, prec)));
    R4('fnmadd', (a, b, i, x, c) => round(fusedMulAdd(-a, b, -c, prec)));

    def(`fsqrt.${p}`, { fmt: 'R2', cls: 'fdiv', rd: 'f', rs1: 'f', rm: true, exec: (a) => round(Math.sqrt(a)) });

    // Conversões entre inteiro e ponto flutuante
    const toInt = (bits, sgn) => (a, b, i, x) => signed(signed(floatToInt(a, bits, sgn, i.rm || 'rne'), bits), x);
    def(`fcvt.w.${p}`, { fmt: 'R2', cls: 'fadd', rd: 'x', rs1: 'f', rm: true, exec: toInt(32, true) });
    def(`fcvt.wu.${p}`, { fmt: 'R2', cls: 'fadd', rd: 'x', rs1: 'f', rm: true, exec: toInt(32, false) });
    def(`fcvt.l.${p}`, { fmt: 'R2', cls: 'fadd', rd: 'x', rs1: 'f', rm: true, exec: toInt(64, true), rv64: true });
    def(`fcvt.lu.${p}`, { fmt: 'R2', cls: 'fadd', rd: 'x', rs1: 'f', rm: true, exec: toInt(64, false), rv64: true });
    def(`fcvt.${p}.w`, { fmt: 'R2', cls: 'fadd', rd: 'f', rs1: 'x', rm: true, exec: (a) => round(Number(signed(a, 32))) });
    def(`fcvt.${p}.wu`, { fmt: 'R2', cls: 'fadd', rd: 'f', rs1: 'x', rm: true, exec: (a) => round(Number(unsigned(a, 32))) });
    def(`fcvt.${p}.l`, { fmt: 'R2', cls: 'fadd', rd: 'f', rs1: 'x', rm: true, exec: (a) => round(Number(signed(a, 64))), rv64: true });
    def(`fcvt.${p}.lu`, { fmt: 'R2', cls: 'fadd', rd: 'f', rs1: 'x', rm: true, exec: (a) => round(Number(unsigned(a, 64))), rv64: true });

    // Movimentação de bits entre bancos
    if (single) {
        def('fmv.x.w', { fmt: 'R2', cls: 'fadd', rd: 'x', rs1: 'f', exec: (a, b, i, x) => signed(w(f32ToBits(a)), x) });
        def('fmv.w.x', { fmt: 'R2', cls: 'fadd', rd: 'f', rs1: 'x', exec: (a) => bitsToF32(a) });
    } else {
        def('fmv.x.d', { fmt: 'R2', cls: 'fadd', rd: 'x', rs1: 'f', exec: (a) => signed(f64ToBits(a), 64), rv64: true });
        def('fmv.d.x', { fmt: 'R2', cls: 'fadd', rd: 'f', rs1: 'x', exec: (a) => bitsToF64(a), rv64: true });
    }
}
floatOps('s');
floatOps('d');
def('fcvt.s.d', { fmt: 'R2', cls: 'fadd', rd: 'f', rs1: 'f', rm: true, exec: (a) => fr(a) });
def('fcvt.d.s', { fmt: 'R2', cls: 'fadd', rd: 'f', rs1: 'f', rm: true, exec: (a) => a });

/**
 * Busca a definição de uma instrução.
 * @param {string} name mnemônico
 */
export function lookup(name) {
    return ISA.get(name.toLowerCase()) ?? null;
}

/** Lista todas as instruções (para documentação). */
export function allInstructions() {
    return [...ISA.values()];
}

/**
 * Pseudoinstruções aceitas pelo montador (expandidas em parser.js), para documentação.
 */
export const PSEUDO_INSTRUCTIONS = [
    'nop', 'li', 'la', 'mv', 'not', 'neg', 'negw', 'sext.w', 'seqz', 'snez', 'sltz', 'sgtz',
    'beqz', 'bnez', 'blez', 'bgez', 'bltz', 'bgtz', 'bgt', 'ble', 'bgtu', 'bleu',
    'j', 'jal', 'jr', 'jalr', 'ret', 'call', 'tail',
    'fmv.s', 'fabs.s', 'fneg.s', 'fmv.d', 'fabs.d', 'fneg.d',
];
