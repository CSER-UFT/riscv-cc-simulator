/**
 * Monta o assembly gerado e executa no simulador funcional de referência (o mesmo do simulador de processadores).
 */
import { assemble } from '../vendor/cpu/riscv/parser.js';
import { runReference } from '../vendor/cpu/riscv/machine.js';
import { readRaw } from '../vendor/cpu/riscv/memory.js';
import { bitsToF32 } from '../vendor/cpu/riscv/bits.js';

/**
 * @param {object} compiled saída de compile()
 * @returns {{errors: Array, ret?: number, globals?: Map<string, number[]>, executed?: number, reason?: string,
 *            program?: object, state?: object, counts?: number[]}}
 */
export function runAsm(compiled, { maxInstructions = 2000000 } = {}) {
    const program = assemble(compiled.asm.text);
    if (program.errors.length) return { errors: program.errors };
    const st = runReference(program, { exampleValues: false, maxInstructions });
    const ret = compiled.mainFloat ? st.f[10] : Number(BigInt.asIntN(32, st.x[10]));
    const globals = new Map();
    for (const g of compiled.module.globals) {
        const base = program.labels.get(g.name);
        const n = g.type.k === 'array' ? g.type.len : 1;
        globals.set(g.name, Array.from({ length: n }, (_, k) => {
            const raw = readRaw(st.mem, base + BigInt(4 * k), 4);
            return g.elem === 'float' ? bitsToF32(raw) : Number(BigInt.asIntN(32, raw));
        }));
    }
    return { errors: [], ret, globals, executed: st.executed, reason: st.reason === 'ecall' ? 'end' : 'limit', program, state: st };
}
