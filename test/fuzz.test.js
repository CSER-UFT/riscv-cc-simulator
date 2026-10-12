import { test } from 'node:test';
import assert from 'node:assert/strict';
import { both } from './helpers.js';

/** Gerador congruencial simples, para que os programas sorteados sejam sempre os mesmos. */
function rng(seed) {
    let s = seed >>> 0;
    return (n) => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s % n; };
}

/** Expressão aleatória sobre as variáveis a, b, c (int), x, y (float), o vetor v e a função f. */
function expr(r, depth) {
    if (depth <= 0 || r(4) === 0) {
        return ['a', 'b', 'c', 'x', 'y', `${r(20) - 5}`, `${r(9)}.5`, 'v[1]', '*p', 'p[2]'][r(10)];
    }
    const e = () => expr(r, depth - 1);
    switch (r(9)) {
        case 0: return `(${e()} ${['+', '-', '*'][r(3)]} ${e()})`;
        case 1: return `(${e()} ${['<', '<=', '>', '>=', '==', '!='][r(6)]} ${e()})`;
        case 2: return `(${e()} ${['&&', '||'][r(2)]} ${e()})`;
        case 3: return `f(${e()}, ${e()})`;
        case 4: return `(a ${['+', '-', '*', '/', '%', '&', '|', '^', '<<', '>>'][r(10)]} (b | 1))`;
        case 5: return `(- ${e()})`;
        case 6: return `(!${e()})`;
        case 7: return `(${e()} / (y + 0.25))`;
        default: return `(${e()} + ${e()} * ${e()})`;
    }
}

test('programas sorteados: assembly igual à IR', () => {
    const r = rng(2026);
    for (let k = 0; k < 150; k++) {
        const src = `
int v[4] = {3, -4, 5, 7};
int f(int m, float n) { return m * 2 + n; }
int main() {
    int a = ${r(30) - 10}, b = ${r(30) - 10}, c = ${r(7)};
    float x = ${r(40) - 20}.25, y = ${r(10)}.5;
    int *p = v;
    int t = ${expr(r, 4)};
    float u = ${expr(r, 3)};
    if (${expr(r, 2)}) t = t + ${expr(r, 3)};
    for (int k = 0; k < ${r(4)}; k++) {
        int w = a; a = b; b = w + ${expr(r, 1)};
        if (${expr(r, 1)}) { x = x + y; continue; }
        if (b > ${r(50)}) break;
        y = u;
    }
    return t + u + a + b + x + y;
}`;
        const res = both(src);
        assert.equal(res.asm.ret, res.ir.ret, src);
        assert.equal(res.ssaIr.ret, res.ir.ret, src);
        assert.equal(res.ssaAsm.ret, res.ir.ret, src);
        assert.equal(res.optIr.ret, res.ir.ret, src);
        assert.equal(res.optAsm.ret, res.ir.ret, src);
    }
});
