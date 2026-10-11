/**
 * Memória endereçável por byte, esparsa e little-endian.
 * A memória é um Map<bigint, number> (endereço -> byte), para que possa ser copiada com structuredClone
 * a cada passo da simulação. Posições nunca escritas valem zero.
 */
import { signed, unsigned, f32ToBits, bitsToF32, f64ToBits, bitsToF64 } from './bits.js';

/** Lê `size` bytes a partir de `addr` como inteiro sem sinal. */
export function readRaw(mem, addr, size) {
    let v = 0n;
    for (let i = size - 1; i >= 0; i--)
        v = (v << 8n) | BigInt(mem.get(addr + BigInt(i)) ?? 0);
    return v;
}

/** Escreve os `size` bytes menos significativos de `value` a partir de `addr`. */
export function writeRaw(mem, addr, size, value) {
    let v = unsigned(value, size * 8);
    for (let i = 0; i < size; i++) {
        mem.set(addr + BigInt(i), Number(v & 0xffn));
        v >>= 8n;
    }
}

/**
 * Lê um valor conforme a especificação de acesso de uma instrução de load.
 * @param {Map<bigint, number>} mem
 * @param {bigint} addr
 * @param {{size:number, signed:boolean, fp:string|null}} spec
 * @param {number} xlen
 */
export function load(mem, addr, spec, xlen) {
    const raw = readRaw(mem, addr, spec.size);
    if (spec.fp === 's')
        return bitsToF32(raw);
    if (spec.fp === 'd')
        return bitsToF64(raw);
    const v = spec.signed ? signed(raw, spec.size * 8) : raw;
    return signed(v, xlen);
}

/**
 * Escreve um valor conforme a especificação de acesso de uma instrução de store.
 */
export function store(mem, addr, spec, value) {
    let raw;
    if (spec.fp === 's')
        raw = f32ToBits(value);
    else if (spec.fp === 'd')
        raw = f64ToBits(value);
    else
        raw = BigInt(value);
    writeRaw(mem, addr, spec.size, raw);
}

/** Verdadeiro se os intervalos [a, a+sa) e [b, b+sb) se sobrepõem. */
export function overlaps(a, sa, b, sb) {
    return a < b + BigInt(sb) && b < a + BigInt(sa);
}

/**
 * Agrupa os bytes escritos em palavras alinhadas, para exibição.
 * @returns {{addr: bigint, raw: bigint}[]}
 */
export function words(mem, wordSize = 4) {
    const bases = new Set();
    const ws = BigInt(wordSize);
    for (const addr of mem.keys())
        bases.add(addr - (addr % ws));
    return [...bases]
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
        .map((addr) => ({ addr, raw: readRaw(mem, addr, wordSize) }));
}
