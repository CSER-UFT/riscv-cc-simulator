/**
 * Estado arquitetural inicial e simulador funcional de referência (execução sequencial, uma instrução por vez).
 *
 * O simulador de referência serve como oráculo: o estado final produzido pelo motor de Tomasulo deve ser
 * idêntico ao produzido por ele, para qualquer programa e qualquer configuração de hardware.
 */
import { unsigned, signed } from './bits.js';
import { index } from './registers.js';
import * as memory from './memory.js';
import { TEXT_BASE, STACK_TOP } from './parser.js';

/** Hash determinístico simples de uma string. */
function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

/** Valor de exemplo determinístico para um registrador (inteiro pequeno ou número com uma casa decimal). */
export function exampleValue(reg) {
    const h = hash(reg);
    if (reg[0] === 'x')
        return BigInt(2 + (h % 98));
    return 1 + (h % 40) / 2;
}

/**
 * Registradores que recebem valores de exemplo: lidos pelo programa, nunca escritos por ele, não usados como
 * endereço base e sem valor inicial explícito.
 */
export function exampleRegisters(program) {
    const read = new Set(), written = new Set(), bases = new Set();
    for (const inst of program.instructions) {
        for (const r of [inst.rs1, inst.rs2, inst.rs3])
            if (r) read.add(r);
        if (inst.rd) written.add(inst.rd);
        if (inst.rs1 && (inst.def.mem || inst.name === 'jalr'))
            bases.add(inst.rs1);
    }
    return [...read].filter((r) => r !== 'x0' && r !== 'x2' && !written.has(r) && !bases.has(r) &&
        !program.init.x.has(r) && !program.init.f.has(r));
}

/**
 * Estado arquitetural inicial.
 * @param {object} program resultado de assemble()
 * @param {{exampleValues?: boolean}} options
 */
export function initialState(program, { exampleValues = true } = {}) {
    const x = new Array(32).fill(0n);
    const f = new Array(32).fill(0);
    x[2] = BigInt(STACK_TOP);
    if (exampleValues) {
        for (const r of exampleRegisters(program)) {
            if (r[0] === 'x') x[index(r)] = exampleValue(r);
            else f[index(r)] = exampleValue(r);
        }
    }
    for (const [r, v] of program.init.x) x[index(r)] = signed(v, program.xlen);
    for (const [r, v] of program.init.f) f[index(r)] = v;
    return { x, f, mem: new Map(program.data) };
}

/** Lê um registrador do estado arquitetural (x0 vale sempre zero). */
export function readReg(regs, reg) {
    if (reg === null) return null;
    if (reg === 'x0') return 0n;
    return reg[0] === 'x' ? regs.x[index(reg)] : regs.f[index(reg)];
}

/** Escreve um registrador do estado arquitetural (escritas em x0 são descartadas). */
export function writeReg(regs, reg, value) {
    if (reg === null || reg === 'x0') return;
    if (reg[0] === 'x') regs.x[index(reg)] = value;
    else regs.f[index(reg)] = value;
}

/** Endereço efetivo de um load/store (base + deslocamento, truncado em XLEN bits sem sinal). */
export function effectiveAddress(inst, base, xlen) {
    return unsigned(base + BigInt(inst.imm), xlen);
}

/** Índice da instrução no programa a partir do PC, ou -1 se o PC estiver fora do código. */
export function indexAt(program, pc) {
    const i = (pc - TEXT_BASE) / 4;
    return Number.isInteger(i) && i >= 0 && i < program.instructions.length ? i : -1;
}

/**
 * Executa uma instrução de controle e retorna o próximo PC e o valor de destino (se houver).
 * @returns {{next: number, value: bigint|null, taken: boolean}}
 */
export function resolveControl(inst, a, b, xlen) {
    const d = inst.def;
    if (d.cls === 'branch') {
        const taken = d.cond(a, b, xlen);
        return { next: taken ? inst.target : inst.pc + 4, value: null, taken };
    }
    if (inst.name === 'jal')
        return { next: inst.target, value: d.exec(a, b, inst, xlen), taken: true };
    return { next: d.jumpTarget(a, inst, xlen), value: d.exec(a, b, inst, xlen), taken: true };
}

/**
 * Simulador funcional de referência.
 * @returns {{x: bigint[], f: number[], mem: Map, executed: number, reason: string}}
 */
export function runReference(program, { exampleValues = true, maxInstructions = 100000 } = {}) {
    const xlen = program.xlen;
    const st = initialState(program, { exampleValues });
    let pc = TEXT_BASE;
    let executed = 0;
    let reason = 'fim do código';
    for (;;) {
        const i = indexAt(program, pc);
        if (i < 0) break;
        if (executed >= maxInstructions) { reason = 'limite de instruções'; break; }
        const inst = program.instructions[i];
        const d = inst.def;
        const a = readReg(st, inst.rs1);
        const b = readReg(st, inst.rs2);
        const c = readReg(st, inst.rs3);
        executed++;
        let next = pc + 4;
        switch (d.cls) {
            case 'system':
                reason = inst.name;
                return { ...st, executed, reason };
            case 'load':
                writeReg(st, inst.rd, memory.load(st.mem, effectiveAddress(inst, a, xlen), d.mem, xlen));
                break;
            case 'store':
                memory.store(st.mem, effectiveAddress(inst, a, xlen), d.mem, b);
                break;
            case 'branch': case 'jump': {
                const r = resolveControl(inst, a, b, xlen);
                if (r.value !== null) writeReg(st, inst.rd, r.value);
                next = r.next;
                break;
            }
            default:
                writeReg(st, inst.rd, d.exec(a, b, inst, xlen, c));
        }
        pc = next;
    }
    return { ...st, executed, reason };
}
