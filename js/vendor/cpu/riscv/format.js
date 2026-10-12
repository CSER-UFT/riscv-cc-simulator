/**
 * Formatação de valores para exibição.
 */

/** Formata um valor de registrador: BigInt em decimal, Number como ponto flutuante. */
export function value(v) {
    if (v === null || v === undefined)
        return '';
    if (typeof v === 'string')
        return v;
    if (typeof v === 'bigint')
        return v.toString();
    if (typeof v === 'boolean')
        return v ? 'tomado' : 'não tomado';
    if (Number.isNaN(v))
        return 'NaN';
    if (!Number.isFinite(v))
        return v > 0 ? '+Inf' : '-Inf';
    if (Object.is(v, -0))
        return '-0.0';
    if (Number.isInteger(v) && Math.abs(v) < 1e15)
        return v.toFixed(1);
    const s = v.toPrecision(7);
    return s.includes('e') ? s : s.replace(/0+$/, '').replace(/\.$/, '.0');
}

/** Formata um endereço em hexadecimal. */
export function address(a) {
    if (a === null || a === undefined)
        return '';
    return '0x' + BigInt(a).toString(16);
}
