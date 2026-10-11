/**
 * Substituto mínimo do módulo de idioma do riscv-cpu-simulator, usado pelo montador copiado em ../riscv.
 * O código gerado pelo compilador não deve produzir erros de montagem; se produzir, a mensagem mostra a chave.
 */
export function t(key, params = {}) {
    const extra = Object.entries(params).map(([k, v]) => `${k}=${v}`).join(', ');
    return extra ? `${key} (${extra})` : key;
}
