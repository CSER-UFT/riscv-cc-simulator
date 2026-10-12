import { test } from 'node:test';
import assert from 'node:assert/strict';
import { both } from './helpers.js';
import { compile } from '../js/cc/compile.js';
import { EXAMPLES } from '../js/examples.js';

const same = (r) => {
    assert.equal(r.asm.reason, 'end');
    assert.equal(r.asm.ret, r.ir.ret);
    for (const [k, v] of r.ir.globals) assert.deepEqual(r.asm.globals.get(k), v, `global ${k}`);
    assert.equal(r.ssaIr.ret, r.ir.ret, 'IR em SSA');
    assert.equal(r.ssaAsm.reason, 'end');
    assert.equal(r.ssaAsm.ret, r.ir.ret, 'assembly da SSA');
    for (const [k, v] of r.ir.globals) assert.deepEqual(r.ssaAsm.globals.get(k), v, `global ${k} (SSA)`);
    assert.equal(r.optIr.ret, r.ir.ret, 'IR otimizada');
    assert.equal(r.optAsm.ret, r.ir.ret, 'assembly otimizado');
    for (const [k, v] of r.ir.globals) assert.deepEqual(r.optAsm.globals.get(k), v, `global ${k} (otimizado)`);
};

for (const e of EXAMPLES) {
    test(`exemplo ${e.id}: IR e assembly dão ${e.expect}`, () => {
        const r = both(e.code);
        same(r);
        assert.equal(r.ir.ret, e.expect);
        assert.equal(r.c.warnings.length, 0);
    });
}

const cases = {
    'muitos temporários (falta de registradores)': [`
int f(int x) { return x; }
int main() {
    int a = 1, b = 2, c = 3, d = 4, e = 5, g = 6, h = 7;
    return (a + (b + (c + (d + (e + (g + (h + (a * b + (c * d + (e * g)))))))))) * 2;
}`, 2 * (1 + 2 + 3 + 4 + 5 + 6 + 7 + 2 + 12 + 30)],
    'valor vivo durante a chamada': [`
int dobro(int x) { return 2 * x; }
float meio(float x) { return x / 2; }
int main() {
    int a = 5;
    float y = 3.0;
    return a + dobro(a + 1) * 10 + (y + meio(y)) * 2;
}`, 5 + 120 + 9],
    'quadro grande (vetor local de 1000)': [`
int main() {
    int v[1000];
    int x = 7;
    for (int i = 0; i < 1000; i++) v[i] = i;
    int s = 0;
    for (int i = 0; i < 1000; i += 100) s += v[i];
    return s + x;
}`, 4500 + 7],
    'inteiros: divisão, resto, deslocamentos e bits': [`
int main() {
    int a = -17, b = 5;
    int r = a / b * 1000 + a % b * 100;
    r = r + (a >> 1) + (b << 3) + (a & 255) + (a | 1) + (a ^ b) + ~b;
    return r;
}`, null],
    'divisão por zero segue o RISC-V': [`
int main() { int z = 0; int a = 7; return (a / z) * 100 + a % z; }`, -93],
    'conversões int e float': [`
float h = 2.75;
int main() {
    int i = h;          // 2
    float f = i + 0.5;  // 2.5
    int j = -7.9;       // -7
    float g = 1 / 3;    // 0
    return i * 1000 + f * 100 + j + g;
}`, 2000 + 250 - 7],
    'ponteiros: aritmética, diferença e comparação': [`
int v[8] = {1, 2, 3, 4, 5, 6, 7, 8};
int *gp;
int main() {
    int *p = v, *q = &v[6];
    p += 2;
    q -= 1;
    gp = q;
    int d = q - p;
    int k = 0;
    if (p < q) k = k + 1;
    if (p != q) k = k + 10;
    if (p == &v[2]) k = k + 100;
    p++;
    --q;
    return d * 1000 + k * 10 + *p + *q + *gp;
}`, 3000 + 1110 + 4 + 5 + 6],
    'ponteiro para float e incrementos de float': [`
float a[3] = {1.5, 2.5, 3.5};
int main() {
    float *p = a + 1;
    float x = *p;
    x++;
    ++x;
    *p = *p * 2;
    p[1] -= 0.5;
    float y = x--;
    return x * 100 + a[1] * 10 + a[2] + y;
}`, null],
    'operadores lógicos e ! em vários tipos': [`
int main() {
    int a = 0, b = 3;
    float f = 0.0, g = 1.5;
    int *p = 0;
    int r = 0;
    if (!a) r += 1;
    if (!f && g) r += 10;
    if (a || b > 2 && g < 2) r += 100;
    if (!p) r += 1000;
    r += (a < b) + (f == 0) * 2 + !b * 4 + (g >= 1.5) * 8;
    return r;
}`, 1111 + 1 + 2 + 8],
    'oito parâmetros misturados': [`
float f(int a, float b, int c, float d, int e, float g, int h, float i) {
    return a + b * 10 + c * 100 + d * 1000 + e + g + h + i;
}
int main() { return f(1, 2.0, 3, 4.0, 5, 6.0, 7, 8.0); }`, 1 + 20 + 300 + 4000 + 5 + 6 + 7 + 8],
    'recursão com float e break, continue': [`
float pot(float b, int e) { if (e == 0) return 1; return b * pot(b, e - 1); }
int main() {
    int s = 0;
    for (int i = 0; i < 100; i++) {
        if (i % 2 == 0) continue;
        if (i > 9) break;
        s += i;
    }
    int k = 0;
    while (1) { k++; if (k == 4) break; }
    return pot(1.5, 4) * 16 + s * 100 + k;
}`, 81 + 2500 + 4],
    'atribuição como expressão e sombra de nomes': [`
int x = 5;
int main() {
    int a, b;
    a = b = 3;
    int r = (a += 2) * 10;
    {
        int x = 100;
        r = r + x;
    }
    return r + x + a + b;
}`, 50 + 100 + 5 + 5 + 3],
    'troca de variáveis no laço (cópias paralelas das phi)': [`
int main() {
    int a = 1, b = 2, c = 3;
    float x = 1.5, y = 2.5;
    for (int i = 0; i < 7; i++) {
        int t = a; a = b; b = c; c = t;
        float u = x; x = y; y = u;
    }
    return a * 100 + b * 10 + c + x * 1000;
}`, 231 + 2500],
    'argumentos usados depois de chamadas': [`
int g(int x) { return x + 1; }
float h(float a, int k, float b) { float r = g(k) * a; return r + g(k) + b; }
int main() { return h(2.0, 4, 0.5) * 10; }`, 155],
    'variável sem valor inicial e laços aninhados': [`
int main() {
    int s;
    s = 0;
    int k;
    for (int i = 0; i < 4; i++) {
        for (int j = 0; j < 4; j++) {
            if (j == i) continue;
            if (j > 2) break;
            s += i * j;
        }
        k = i;
    }
    while (s > 100) s -= 100;
    return s + k;
}`, null],
    'menos unário e constantes negativas': [`
int g = -5;
float h = -2.5;
int main() { int a = 3; float b = 1.5; return -a * 10 + g - h * 2 + (-b) * 2; }`, -30 - 5 + 5 - 3],
};

for (const [name, [src, expect]] of Object.entries(cases)) {
    test(name, () => {
        const r = both(src);
        same(r);
        if (expect !== null) assert.equal(r.ir.ret, expect);
    });
}

test('erros de cada fase', () => {
    const err = (s) => { const c = compile(s); assert.ok(c.errors.length > 0, s); return c; };
    assert.equal(err('int main() { int a = 3 @ 2; }').phase, 'lex');
    assert.equal(err('int main() { int a = ; }').phase, 'parse');
    assert.equal(err('int main() { return b; }').phase, 'sema');
    assert.equal(err('int main() { int **p; }').phase, 'parse');
    assert.equal(err('int main() { float *p; int x; p = &x; return 0; }').phase, 'sema');
    assert.equal(err('int f(int a) { return a; } int main() { return f(1, 2); }').phase, 'sema');
    assert.equal(err('int main() { break; }').phase, 'sema');
    assert.equal(err('int f() { return 1; }').phase, 'sema');
    assert.equal(err('void main() { }').phase, 'sema');
    assert.equal(err('int main() { int v[3]; v = 0; return 0; }').phase, 'sema');
    assert.equal(err('int main() { int x; int *p = &x; int *q = &p; return 0; }').phase, 'sema');
});

test('aviso de variável sem uso', () => {
    const c = compile('int main() { int nada; return 0; }');
    assert.equal(c.errors.length, 0);
    assert.equal(c.warnings.length, 1);
});

test('IR no formato do LLVM', () => {
    const c = compile(EXAMPLES.find((e) => e.id === 'logica').code);
    const t = c.ir.text;
    assert.match(t, /@chamadas = global i32 0/);
    assert.match(t, /define i32 @positivo\(i32 %x\) \{/);
    assert.match(t, /%x\.addr = alloca i32/);
    assert.match(t, /phi i1 \[ false, %entry \], \[ %\d+, %land\.rhs \]/);
    assert.match(t, /phi i1 \[ true, %if\.end \], \[ %\d+, %lor\.rhs \]/);
    assert.match(t, /zext i1 %\d+ to i32/);
    const p = compile(EXAMPLES.find((e) => e.id === 'ponteiro').code).ir.text;
    assert.match(p, /getelementptr inbounds i32, ptr %\d+, i32 1/);
});

test('o mapa de linhas liga fonte, IR e assembly', () => {
    const c = compile(EXAMPLES[0].code);
    assert.equal(c.ir.lines.length, c.ir.text.split('\n').length - 1);
    assert.equal(c.asm.lines.length, c.asm.text.split('\n').length - 1);
    const irLines = c.asm.lines.filter((l) => l.ir !== null);
    assert.ok(irLines.length > 10);
    for (const l of irLines) assert.equal(c.ir.lines[l.ir].src !== undefined, true);
});
