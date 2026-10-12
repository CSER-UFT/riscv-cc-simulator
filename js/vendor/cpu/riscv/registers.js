/**
 * Nomes de registradores do RISC-V (nomes numéricos e nomes da ABI).
 * Internamente todo registrador é identificado de forma canônica: 'x0'..'x31' e 'f0'..'f31'.
 */

export const X_ABI = [
    'zero', 'ra', 'sp', 'gp', 'tp', 't0', 't1', 't2',
    's0', 's1', 'a0', 'a1', 'a2', 'a3', 'a4', 'a5',
    'a6', 'a7', 's2', 's3', 's4', 's5', 's6', 's7',
    's8', 's9', 's10', 's11', 't3', 't4', 't5', 't6',
];

export const F_ABI = [
    'ft0', 'ft1', 'ft2', 'ft3', 'ft4', 'ft5', 'ft6', 'ft7',
    'fs0', 'fs1', 'fa0', 'fa1', 'fa2', 'fa3', 'fa4', 'fa5',
    'fa6', 'fa7', 'fs2', 'fs3', 'fs4', 'fs5', 'fs6', 'fs7',
    'fs8', 'fs9', 'fs10', 'fs11', 'ft8', 'ft9', 'ft10', 'ft11',
];

const ALIASES = new Map();
for (let i = 0; i < 32; i++) {
    ALIASES.set(`x${i}`, `x${i}`);
    ALIASES.set(X_ABI[i], `x${i}`);
    ALIASES.set(`f${i}`, `f${i}`);
    ALIASES.set(F_ABI[i], `f${i}`);
}
ALIASES.set('fp', 'x8');

/**
 * Converte um nome de registrador digitado no nome canônico, ou null se não for um registrador.
 * @param {string} name
 * @returns {string|null}
 */
export function canonical(name) {
    return ALIASES.get(String(name).toLowerCase()) ?? null;
}

/** Banco do registrador canônico: 'x' (inteiro) ou 'f' (ponto flutuante). */
export function bank(reg) {
    return reg[0];
}

/** Índice numérico do registrador canônico. */
export function index(reg) {
    return parseInt(reg.slice(1));
}

/** Nome da ABI do registrador canônico. */
export function abiName(reg) {
    const i = index(reg);
    return bank(reg) === 'x' ? X_ABI[i] : F_ABI[i];
}

/** Rótulo para exibição, por exemplo "x10 (a0)". */
export function label(reg) {
    return `${reg} (${abiName(reg)})`;
}

/** Ordenação natural: inteiros antes de ponto flutuante, depois pelo índice. */
export function compare(a, b) {
    if (bank(a) !== bank(b))
        return bank(a) === 'x' ? -1 : 1;
    return index(a) - index(b);
}
