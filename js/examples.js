/**
 * Programas de exemplo em MiniC. O campo expect é o valor de retorno de main (conferido nos testes).
 */
export const EXAMPLES = [
    {
        id: 'soma',
        name: { pt: 'Soma de vetor', en: 'Array sum' },
        expect: 150,
        code: `// Soma dos elementos de um vetor global.
int v[5] = {10, 20, 30, 40, 50};

int main() {
    int s = 0;
    for (int i = 0; i < 5; i++)
        s = s + v[i];
    return s;
}
`,
    },
    {
        id: 'ponteiro',
        name: { pt: 'Soma com ponteiro', en: 'Sum with a pointer' },
        expect: 150,
        code: `// O vetor é passado como ponteiro para o primeiro elemento.
// p + n aponta para depois do último; *p++ lê e avança.
int v[5] = {10, 20, 30, 40, 50};

int soma(int *p, int n) {
    int *fim = p + n;
    int s = 0;
    while (p < fim)
        s += *p++;
    return s;
}

int main() {
    return soma(v, 5);
}
`,
    },
    {
        id: 'swap',
        name: { pt: 'Troca com ponteiros', en: 'Swap with pointers' },
        expect: 73,
        code: `// Passagem por referência: a função recebe os endereços.
void troca(int *a, int *b) {
    int t = *a;
    *a = *b;
    *b = t;
}

int main() {
    int x = 3, y = 7;
    troca(&x, &y);
    return 10 * x + y;   // 73
}
`,
    },
    {
        id: 'fatorial',
        name: { pt: 'Fatorial recursivo', en: 'Recursive factorial' },
        expect: 720,
        code: `// Cada chamada cria um registro de ativação na pilha.
int fat(int n) {
    if (n <= 1)
        return 1;
    return n * fat(n - 1);
}

int main() {
    return fat(6);
}
`,
    },
    {
        id: 'fib',
        name: { pt: 'Fibonacci iterativo', en: 'Iterative Fibonacci' },
        expect: 55,
        code: `int fib(int n) {
    int a = 0, b = 1;
    for (int i = 0; i < n; i++) {
        int t = a + b;
        a = b;
        b = t;
    }
    return a;
}

int main() {
    return fib(10);
}
`,
    },
    {
        id: 'mdc',
        name: { pt: 'MDC de Euclides', en: 'Euclid GCD' },
        expect: 21,
        code: `int mdc(int a, int b) {
    while (b != 0) {
        int r = a % b;
        a = b;
        b = r;
    }
    return a;
}

int main() {
    return mdc(1071, 462);
}
`,
    },
    {
        id: 'bubble',
        name: { pt: 'Ordenação (bolha)', en: 'Bubble sort' },
        expect: 123456,
        code: `// Ordena o vetor global e devolve os seis valores como dígitos.
int v[6] = {5, 2, 6, 1, 4, 3};

void troca(int *a, int *b) {
    int t = *a;
    *a = *b;
    *b = t;
}

void ordena(int *x, int n) {
    for (int i = 0; i < n - 1; i++)
        for (int j = 0; j < n - 1 - i; j++)
            if (x[j] > x[j + 1])
                troca(&x[j], &x[j + 1]);
}

int main() {
    ordena(v, 6);
    int r = 0;
    for (int i = 0; i < 6; i++)
        r = r * 10 + v[i];
    return r;
}
`,
    },
    {
        id: 'saxpy',
        name: { pt: 'SAXPY (float)', en: 'SAXPY (float)' },
        expect: 44,
        code: `// y = a * x + y, com vetores de float.
float x[4] = {1.0, 2.0, 3.0, 4.0};
float y[4] = {0.5, 0.5, 0.5, 0.5};

void saxpy(int n, float a, float *x, float *y) {
    for (int i = 0; i < n; i++)
        y[i] = a * x[i] + y[i];
}

int main() {
    saxpy(4, 2.0, x, y);
    float s = 0.0;
    for (int i = 0; i < 4; i++)
        s += y[i];
    return s * 2;   // (2.5 + 4.5 + 6.5 + 8.5) * 2 = 44
}
`,
    },
    {
        id: 'matriz',
        name: { pt: 'Multiplicação de matrizes', en: 'Matrix multiplication' },
        expect: 120,
        code: `// Matrizes 3x3 guardadas linha por linha em vetores: A[i][j] = A[i * N + j].
int A[9] = {1, 2, 3, 4, 5, 6, 7, 8, 9};
int B[9] = {9, 8, 7, 6, 5, 4, 3, 2, 1};
int C[9];

void matmul(int *a, int *b, int *c, int n) {
    for (int i = 0; i < n; i++)
        for (int j = 0; j < n; j++) {
            int s = 0;
            for (int k = 0; k < n; k++)
                s += a[i * n + k] * b[k * n + j];
            c[i * n + j] = s;
        }
}

int main() {
    matmul(A, B, C, 3);
    return C[0] + C[8];   // 30 + 90
}
`,
    },
    {
        id: 'logica',
        name: { pt: 'Curto circuito (&& e ||)', en: 'Short circuit (&& and ||)' },
        expect: 2,
        code: `// O lado direito de && só é avaliado se o esquerdo for verdadeiro.
// Na IR, o resultado vem de uma função phi.
int chamadas = 0;

int positivo(int x) {
    chamadas++;
    return x > 0;
}

int main() {
    int a = -1, b = 5;
    if (positivo(a) && positivo(b))
        return 100;
    if (positivo(b) || positivo(a))
        return chamadas;   // 2: o segundo positivo(a) não roda
    return 0;
}
`,
    },
    {
        id: 'media',
        name: { pt: 'Média e máximo (float)', en: 'Mean and maximum (float)' },
        expect: 7.5,
        code: `// main pode retornar float: o resultado fica em fa0.
float notas[6] = {7.0, 8.5, 6.0, 9.5, 5.0, 9.0};

float media(float *v, int n) {
    float s = 0;
    for (int i = 0; i < n; i++)
        s += v[i];
    return s / n;
}

float maximo(float *v, int n) {
    float m = v[0];
    for (int i = 1; i < n; i++)
        if (v[i] > m)
            m = v[i];
    return m;
}

float main() {
    return media(notas, 6);
}
`,
    },
    {
        id: 'busca',
        name: { pt: 'Busca binária', en: 'Binary search' },
        expect: 6,
        code: `int v[10] = {2, 3, 5, 7, 11, 13, 17, 19, 23, 29};

int busca(int *a, int n, int x) {
    int lo = 0, hi = n - 1;
    while (lo <= hi) {
        int m = (lo + hi) / 2;
        if (a[m] == x)
            return m;
        else if (a[m] < x)
            lo = m + 1;
        else
            hi = m - 1;
    }
    return -1;
}

int main() {
    return busca(v, 10, 17);
}
`,
    },
];
