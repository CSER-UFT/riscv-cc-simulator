/**
 * Utilitários de manipulação de bits.
 *
 * Valores inteiros dos registradores são representados como BigInt com sinal, já truncados para XLEN bits
 * (complemento de dois). Valores de ponto flutuante são representados como Number; instruções de precisão
 * simples arredondam o resultado com Math.fround.
 */

/** Interpreta `v` como inteiro com sinal de `bits` bits. */
export function signed(v, bits) {
    return BigInt.asIntN(bits, BigInt(v));
}

/** Interpreta `v` como inteiro sem sinal de `bits` bits. */
export function unsigned(v, bits) {
    return BigInt.asUintN(bits, BigInt(v));
}

const view = new DataView(new ArrayBuffer(8));

/** Padrão de bits (BigInt, 32 bits sem sinal) de um float de precisão simples. */
export function f32ToBits(f) {
    view.setFloat32(0, f, true);
    return BigInt(view.getUint32(0, true));
}

/** Converte um padrão de 32 bits em float de precisão simples. */
export function bitsToF32(b) {
    view.setUint32(0, Number(BigInt.asUintN(32, BigInt(b))), true);
    return view.getFloat32(0, true);
}

/** Padrão de bits (BigInt, 64 bits sem sinal) de um double. */
export function f64ToBits(f) {
    view.setFloat64(0, f, true);
    return view.getBigUint64(0, true);
}

/** Converte um padrão de 64 bits em double. */
export function bitsToF64(b) {
    view.setBigUint64(0, BigInt.asUintN(64, BigInt(b)), true);
    return view.getFloat64(0, true);
}

/** Arredondamento para o par mais próximo (modo RNE do RISC-V). */
export function roundEven(x) {
    const r = Math.round(x);
    if (Math.abs(x % 1) === 0.5 && r % 2 !== 0)
        return r - 1;
    return r;
}

/**
 * Converte um ponto flutuante em inteiro, com saturação conforme a especificação RISC-V.
 * @param {number} f valor
 * @param {number} bits largura do inteiro destino
 * @param {boolean} isSigned destino com sinal
 * @param {string} rm modo de arredondamento (rne, rtz, rdn, rup, rmm)
 * @returns {bigint}
 */
export function floatToInt(f, bits, isSigned, rm = 'rne') {
    const min = isSigned ? -(1n << BigInt(bits - 1)) : 0n;
    const max = isSigned ? (1n << BigInt(bits - 1)) - 1n : (1n << BigInt(bits)) - 1n;
    if (Number.isNaN(f))
        return max;
    let r;
    switch (rm) {
        case 'rtz': r = Math.trunc(f); break;
        case 'rdn': r = Math.floor(f); break;
        case 'rup': r = Math.ceil(f); break;
        case 'rmm': r = Math.sign(f) * Math.round(Math.abs(f)); break;
        default: r = roundEven(f); break;
    }
    if (r === Infinity || r > Number(max))
        return max;
    if (r === -Infinity || r < Number(min))
        return min;
    const v = BigInt(r);
    return v > max ? max : (v < min ? min : v);
}

/** Formata um inteiro como hexadecimal com prefixo. */
export function hex(v, bits = 32) {
    return '0x' + unsigned(v, bits).toString(16);
}

/** Decompõe um double finito em [mantissa inteira (BigInt), expoente], com valor = mantissa * 2^expoente. */
function decompose(x) {
    const bits = f64ToBits(x);
    const neg = bits >> 63n === 1n;
    const e = Number((bits >> 52n) & 0x7ffn);
    let m = bits & 0xfffffffffffffn;
    let exp;
    if (e === 0) {
        exp = -1074;
    } else {
        m |= 1n << 52n;
        exp = e - 1075;
    }
    return [neg ? -m : m, exp];
}

/** Multiplica por 2^e sem estouro intermediário. */
function scale(v, e) {
    while (e > 1000) { v *= 2 ** 1000; e -= 1000; }
    while (e < -1000) { v *= 2 ** -1000; e += 1000; }
    return v * 2 ** e;
}

/**
 * Multiplicação e soma fundidas (a * b + c com um único arredondamento), para `prec` bits de significando
 * (24 para precisão simples, 53 para dupla). Resultados subnormais podem sofrer um segundo arredondamento.
 */
export function fusedMulAdd(a, b, c, prec) {
    if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c))
        return a * b + c;
    const [ma, ea] = decompose(a);
    const [mb, eb] = decompose(b);
    const [mc, ec] = decompose(c);
    const mp = ma * mb, ep = ea + eb;
    const emin = Math.min(ep, ec);
    const sum = (mp << BigInt(ep - emin)) + (mc << BigInt(ec - emin));
    if (sum === 0n)
        return a * b + c;
    const neg = sum < 0n;
    let m = neg ? -sum : sum;
    let exp = emin;
    const len = m.toString(2).length;
    if (len > prec) {
        const sh = BigInt(len - prec);
        const rem = m & ((1n << sh) - 1n);
        const half = 1n << (sh - 1n);
        m >>= sh;
        exp += Number(sh);
        if (rem > half || (rem === half && (m & 1n) === 1n))
            m += 1n;
    }
    const v = scale(Number(m), exp);
    return neg ? -v : v;
}
