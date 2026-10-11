/**
 * Tipos do MiniC: int e float de 32 bits, void, ponteiro para int ou float e vetor de int ou float.
 */

export const INT = { k: 'int' };
export const FLOAT = { k: 'float' };
export const VOID = { k: 'void' };
export const ERROR = { k: 'error' };
export const ptr = (to) => ({ k: 'ptr', to });
export const array = (of, len) => ({ k: 'array', of, len });

/** Tipo a partir da especificação do analisador sintático ({base, ptr}). */
export const fromSpec = (spec) => (spec.ptr ? ptr(spec.base) : spec.base === 'int' ? INT : spec.base === 'float' ? FLOAT : VOID);

export const isNum = (t) => t.k === 'int' || t.k === 'float';
export const isScalar = (t) => isNum(t) || t.k === 'ptr';
export const isErr = (t) => t.k === 'error';

/** Tipo de um valor depois da conversão de vetor em ponteiro (decay). */
export const decay = (t) => (t.k === 'array' ? ptr(t.of) : t);

export function same(a, b) {
    if (a.k !== b.k) return false;
    if (a.k === 'ptr') return a.to === b.to;
    if (a.k === 'array') return a.of === b.of && a.len === b.len;
    return true;
}

/** Texto do tipo, como no C: int, float*, int[10]. */
export function str(t) {
    switch (t.k) {
        case 'ptr': return `${t.to}*`;
        case 'array': return `${t.of}[${t.len}]`;
        default: return t.k;
    }
}

/** Tamanho em bytes no RV32. */
export function size(t) {
    if (t.k === 'array') return 4 * t.len;
    return t.k === 'void' ? 0 : 4;
}

/** Tipo na IR (no formato do LLVM). */
export function irType(t) {
    switch (t.k) {
        case 'int': return 'i32';
        case 'float': return 'float';
        case 'ptr': return 'ptr';
        case 'void': return 'void';
        case 'array': return `[${t.len} x ${t.of === 'int' ? 'i32' : 'float'}]`;
        default: return '?';
    }
}

/** Tipo do elemento apontado (na IR): i32 ou float. */
export const elemIr = (base) => (base === 'int' ? 'i32' : 'float');
