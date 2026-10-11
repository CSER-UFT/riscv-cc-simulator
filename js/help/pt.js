/**
 * Ajuda do simulador, em português. Cada seção vira um item do índice.
 * O texto evita hífens e travessões por padrão de estilo do projeto (exceto em nomes como RISC-V e opções de linha de comando).
 */
export default {
    title: 'Simulador de Compilador RISC-V',
    lead: 'Simulador didático de compilador: um programa em MiniC, um subconjunto do C com ponteiros, passa pelas análises léxica, sintática e semântica, vira uma representação intermediária no formato do LLVM e, por fim, assembly RISC-V, que é executado aqui mesmo ou aberto no Simulador de Processadores. Tudo roda no navegador, sem instalação.',
    searchPlaceholder: 'Buscar na ajuda',
    noResults: 'Nenhuma seção contém esse termo.',
    tocTitle: 'Conteúdo',
    close: 'Fechar ajuda',
    sections: [
        {
            id: 'start',
            title: 'Primeiros passos',
            html: `
<ol>
    <li>Escolha um <strong>exemplo</strong> ou escreva o seu programa no editor. O código é compilado enquanto você digita; os erros aparecem abaixo do editor, com o número da linha (clique em um erro para ir até ela).</li>
    <li>Acompanhe as <strong>fases</strong> na faixa acima das abas: cada fase concluída ganha um ✓; a fase com erro fica marcada com ✗ e as seguintes ficam esperando.</li>
    <li>Explore as abas: <strong>Tokens</strong> e <strong>Árvore</strong> têm passo a passo (setas do teclado ou <strong>Animar</strong>); <strong>Símbolos</strong> mostra a tabela de símbolos; <strong>IR e RISC-V</strong> mostra o código gerado lado a lado; <strong>Pilha</strong> desenha o registro de ativação de cada função.</li>
    <li>O resultado da execução (valor de retorno de <code>main</code>, instruções executadas e variáveis globais) aparece no quadro <strong>Execução</strong>.</li>
    <li>Para ver o mesmo código passando pelo pipeline, use <strong>Abrir no simulador de processadores</strong>.</li>
</ol>
<p class="tip">Sugestão para começar: o exemplo <em>Soma de vetor</em> na aba IR e RISC-V. Clique na linha <code>s = s + v[i];</code> do editor e veja quais instruções da IR e do assembly ela gerou.</p>`,
        },
        {
            id: 'screen',
            title: 'A tela',
            html: `
<dl>
    <dt>Código MiniC</dt><dd>Editor com destaque de sintaxe. <kbd>Ctrl</kbd> + <kbd>Enter</kbd> compila e executa de novo; <kbd>Tab</kbd> insere quatro espaços. O texto fica guardado no navegador para a próxima visita.</dd>
    <dt>Opções</dt><dd><strong>Comentários com a IR</strong> coloca, ao lado de cada trecho do assembly, a instrução da IR que o gerou; <strong>Linhas do código fonte</strong> intercala as linhas do programa como comentários.</dd>
    <dt>Execução</dt><dd>O assembly é montado e executado pelo mesmo simulador funcional do Simulador de Processadores. A IR também é interpretada, e os dois resultados precisam coincidir (o quadro avisa se não coincidirem). O limite é de dois milhões de instruções.</dd>
    <dt>Fases</dt><dd>Clique em uma fase para abrir a aba correspondente.</dd>
    <dt>Ligação entre as visões</dt><dd>Uma linha clicada no editor, na IR ou no assembly fica destacada, junto com as linhas correspondentes nas outras duas visões.</dd>
</dl>`,
        },
        {
            id: 'minic',
            title: 'A linguagem MiniC',
            html: `
<p>O MiniC é um subconjunto do C pensado para caber em uma aula de compiladores ou de organização de computadores.</p>
<h3>O que existe</h3>
<ul>
    <li>Tipos <code>int</code> e <code>float</code> de 32 bits, <code>void</code> para funções, ponteiros <code>int *</code> e <code>float *</code> e vetores de uma dimensão (<code>int v[10]</code>), globais ou locais.</li>
    <li>Variáveis globais com valor inicial constante, inclusive listas: <code>int v[3] = {1, 2, 3};</code>. Variáveis locais com qualquer expressão como valor inicial.</li>
    <li>Funções com até 8 parâmetros, recursão e protótipos (<code>int f(int x);</code>). Vetores são passados como ponteiros: <code>int soma(int v[], int n)</code> é o mesmo que <code>int soma(int *v, int n)</code>.</li>
    <li>Comandos <code>if</code>, <code>else</code>, <code>while</code>, <code>for</code> (com declaração no início), <code>return</code>, <code>break</code>, <code>continue</code> e blocos com escopo próprio.</li>
    <li>Operadores aritméticos, de comparação, lógicos com curto circuito (<code>&amp;&amp;</code>, <code>||</code>, <code>!</code>), de bits (<code>&amp; | ^ ~ &lt;&lt; &gt;&gt;</code>), atribuições compostas (<code>+=</code> e semelhantes), incremento e decremento prefixo e posfixo.</li>
    <li>Ponteiros: <code>&amp;x</code>, <code>&amp;v[i]</code>, <code>*p</code>, <code>p[i]</code>, <code>p + i</code>, <code>p - q</code> (número de elementos), comparações entre ponteiros e <code>p++</code>.</li>
    <li>Conversões implícitas entre <code>int</code> e <code>float</code>, como no C (a conversão para <code>int</code> trunca).</li>
    <li><code>main</code> não tem parâmetros e retorna <code>int</code> (resultado em <code>a0</code>) ou <code>float</code> (em <code>fa0</code>).</li>
</ul>
<h3>O que fica de fora</h3>
<p>Conversões explícitas (<em>casts</em>), <code>struct</code>, ponteiro para ponteiro, ponteiro para função, alocação dinâmica, <code>char</code> e cadeias de caracteres, vetores de várias dimensões (use <code>A[i * n + j]</code>), <code>switch</code>, <code>do while</code> e o operador ternário.</p>
<h3>Gramática</h3>
<pre><code>programa   = { declaracao | funcao }
tipo       = ("int" | "float" | "void") ["*"]
declaracao = tipo declarador { "," ["*"] declarador } ";"
declarador = ident ["[" inteiro "]"] ["=" (expr | "{" expr {"," expr} "}")]
funcao     = tipo ident "(" [param {"," param}] ")" (bloco | ";")
param      = tipo ident ["[" "]"]
bloco      = "{" { declaracao | comando } "}"
comando    = bloco | if | while | for | "return" [expr] ";"
           | "break" ";" | "continue" ";" | [expr] ";"</code></pre>
<p>As expressões seguem a precedência do C, da menor para a maior: atribuição, <code>||</code>, <code>&amp;&amp;</code>, <code>|</code>, <code>^</code>, <code>&amp;</code>, igualdade, relacionais, deslocamentos, soma, produto, unários e posfixos (índice, chamada, <code>++</code> e <code>--</code>).</p>`,
        },
        {
            id: 'lex',
            title: 'Análise léxica',
            html: `
<p>A análise léxica transforma a sequência de caracteres em uma sequência de <strong>tokens</strong>: palavras reservadas, identificadores, constantes inteiras e float, operadores e pontuação. Espaços e comentários são descartados aqui e não chegam às fases seguintes.</p>
<p>O reconhecedor é um autômato finito escrito à mão: o primeiro caractere decide o estado (letra: identificador; dígito: número; símbolo: operador) e o laço consome caracteres enquanto o estado aceitar. Vale sempre o <strong>lexema mais longo</strong>: <code>&lt;=</code> é um token só, e não <code>&lt;</code> seguido de <code>=</code>; <code>x++</code> é <code>x</code> seguido de <code>++</code>. Uma palavra reconhecida como identificador vira palavra reservada se estiver na lista (<code>int</code>, <code>if</code>, <code>while</code>...).</p>
<p>Na aba <strong>Tokens</strong>, o passo a passo destaca no editor o trecho de cada token. A coluna <em>Valor</em> mostra o número já convertido (as constantes float são arredondadas para 32 bits).</p>
<p>Erros desta fase: caractere desconhecido (como <code>@</code> ou <code>"</code>), número malformado (<code>12abc</code>), inteiro maior que 32 bits e comentário <code>/*</code> sem fim.</p>`,
        },
        {
            id: 'parse',
            title: 'Análise sintática',
            html: `
<p>A análise sintática confere se a sequência de tokens segue a gramática e constrói a <strong>árvore sintática abstrata</strong> (AST). O método é a <strong>descida recursiva</strong>: cada regra da gramática é uma função, e cada nível de precedência dos operadores também. Assim, em <code>a + b * c</code>, a função do nível da soma chama a do produto, que consome <code>b * c</code> inteiro antes de a soma ser montada.</p>
<p>A árvore é <em>abstrata</em> porque guarda só o que importa para o significado: parênteses, vírgulas e ponto e vírgula não viram nós. O passo a passo da aba <strong>Árvore</strong> mostra os nós na ordem em que são criados. Uma função, um bloco ou um <code>for</code> é criado logo no início, e os comandos entram nele um a um; já uma expressão só é criada depois das suas partes: em <code>s + v[i]</code>, aparecem <code>s</code>, <code>v</code>, <code>i</code>, depois <code>[ ]</code> e por último <code>+</code>, exatamente na ordem em que as chamadas recursivas retornam. Use <strong>Mostrar</strong> para ver uma função de cada vez.</p>
<p>A análise para no primeiro erro, com a linha, a coluna e o token encontrado (por exemplo, <em>esperava ";", encontrou "}"</em>).</p>`,
        },
        {
            id: 'sema',
            title: 'Análise semântica',
            html: `
<p>A análise semântica percorre a árvore e verifica o que a gramática não consegue expressar: nomes declarados, tipos compatíveis, número de argumentos, <code>break</code> fora de laço e assim por diante. Ela produz a <strong>tabela de símbolos</strong> e anota em cada expressão o seu tipo (o texto pequeno abaixo dos nós na aba Árvore).</p>
<h3>Escopos</h3>
<p>O escopo global contém as variáveis globais e as funções; cada função abre um escopo para os parâmetros, e cada bloco <code>{ }</code> (e cada <code>for</code>) abre um escopo novo. Um nome é procurado do escopo mais interno para o mais externo, por isso uma variável local pode esconder uma global de mesmo nome. Declarar o mesmo nome duas vezes no mesmo escopo é erro.</p>
<h3>Tipos e conversões</h3>
<ul>
    <li>Em uma operação entre <code>int</code> e <code>float</code>, o <code>int</code> é convertido para <code>float</code>. Na atribuição, o valor é convertido para o tipo da variável.</li>
    <li>Um vetor usado em uma expressão vira ponteiro para o primeiro elemento (<em>decaimento</em>): <code>v</code> vale <code>&amp;v[0]</code>.</li>
    <li><code>p + i</code> avança <code>i</code> elementos (4 bytes cada), e <code>p - q</code> dá o número de elementos entre os dois ponteiros.</li>
    <li>Atribuir um ponteiro de um tipo a outro (<code>float *</code> recebendo <code>int *</code>) é erro, porque o MiniC não tem conversão explícita.</li>
</ul>
<p>A tabela de símbolos mostra, para cada nome, a categoria, o tipo, o escopo, a linha da declaração, o número de usos e onde o código gerado o guarda. Variáveis locais nunca usadas geram um aviso.</p>`,
        },
        {
            id: 'ir',
            title: 'A representação intermediária',
            html: `
<p>A IR segue o formato textual do LLVM, como o <code>clang -O0</code> produz: assim, o que se aprende aqui vale para ler a saída de um compilador real e para os projetos de pesquisa que usam o LLVM.</p>
<ul>
    <li>O módulo tem as variáveis globais (<code>@v = global [5 x i32] [...]</code>) e as funções (<code>define i32 @soma(ptr %p, i32 %n)</code>).</li>
    <li>Cada função é um conjunto de <strong>blocos básicos</strong>: sequências de instruções sem desvios no meio, que terminam com <code>br</code> ou <code>ret</code>. O comentário <code>; preds =</code> lista os blocos que desviam para cada bloco: é o grafo de fluxo de controle.</li>
    <li>Os valores <code>%0</code>, <code>%1</code>... são atribuídos uma única vez (forma SSA). As variáveis do programa, que mudam de valor, ficam na memória: cada uma ganha um <code>alloca</code> no bloco <code>entry</code> e é lida com <code>load</code> e escrita com <code>store</code>. Os parâmetros são copiados para a memória logo na entrada.</li>
    <li><code>getelementptr inbounds i32, ptr %p, i32 %i</code> calcula o endereço do elemento <code>i</code>: <code>p + 4 * i</code>.</li>
    <li><code>icmp slt</code> compara inteiros com sinal; <code>fcmp olt</code> compara floats. O resultado é <code>i1</code>, convertido para <code>i32</code> com <code>zext</code> quando usado como número.</li>
    <li><code>&amp;&amp;</code> e <code>||</code> criam blocos (<code>land.rhs</code>, <code>land.end</code>) e uma função <code>phi</code>, que escolhe o valor conforme o bloco de onde o controle veio.</li>
    <li>As flags <code>nsw</code> (sem estouro com sinal) e <code>exact</code> são as mesmas que o clang coloca.</li>
</ul>
<p>Diferenças em relação ao clang, para deixar o texto mais curto: não há <code>align 4</code> nem atributos, e um <code>return</code> no meio da função vira <code>ret</code> direto, sem a variável <code>%retval</code>.</p>
<p>Para comparar com o clang: <code>clang --target=riscv32 -march=rv32imf -mabi=ilp32f -O0 -S -emit-llvm prog.c</code> (a IR) e o mesmo sem <code>-emit-llvm</code> (o assembly).</p>`,
        },
        {
            id: 'codegen',
            title: 'Geração de código RISC-V',
            html: `
<p>O assembly usa as extensões I, M e F do RV32 e a convenção de chamada do RISC-V (ABI ilp32f), como no livro de Patterson e Hennessy:</p>
<table>
    <tr><th>Registradores</th><th>Uso no código gerado</th></tr>
    <tr><td><code>a0</code> a <code>a7</code></td><td>argumentos inteiros e ponteiros; <code>a0</code> também leva o resultado</td></tr>
    <tr><td><code>fa0</code> a <code>fa7</code></td><td>argumentos float; <code>fa0</code> também leva o resultado</td></tr>
    <tr><td><code>t0</code> a <code>t5</code>, <code>ft0</code> a <code>ft7</code></td><td>valores temporários da IR, salvos por quem chama</td></tr>
    <tr><td><code>t6</code></td><td>endereços auxiliares (constantes float, deslocamentos grandes)</td></tr>
    <tr><td><code>s0</code></td><td>ponteiro do quadro (topo do registro de ativação)</td></tr>
    <tr><td><code>sp</code>, <code>ra</code></td><td>topo da pilha e endereço de retorno</td></tr>
</table>
<h3>Seleção de instruções</h3>
<p>Cada instrução da IR vira uma ou poucas instruções RISC-V: <code>load</code> e <code>store</code> viram <code>lw</code>, <code>sw</code>, <code>flw</code> e <code>fsw</code> com deslocamento em relação a <code>s0</code>; <code>add</code> com constante pequena vira <code>addi</code>; <code>getelementptr</code> vira <code>slli</code> (multiplica o índice por 4) e <code>add</code>; <code>sitofp</code> vira <code>fcvt.s.w</code>; <code>fptosi</code> vira <code>fcvt.w.s</code> com arredondamento em direção ao zero (<code>rtz</code>), como o C exige.</p>
<p>Uma comparação inteira seguida do desvio que a usa vira um único desvio condicional, como no livro: <code>for (i = 0; i &lt; n; i++)</code> gera <code>bge t0, t1, for.end</code>, com a condição invertida para que o corpo do laço venha logo em seguida. Um desvio para o bloco seguinte não gera instrução.</p>
<h3>Registradores e valores guardados</h3>
<p>Os temporários usados no mesmo bloco ficam em registradores <code>t</code> e <code>ft</code>, escolhidos na ordem e liberados no último uso. Um valor que precisa sobreviver a um desvio (como o resultado de uma <code>phi</code>) ou a uma chamada de função (os registradores <code>t</code> não são preservados) é guardado em uma posição do quadro. A <code>phi</code> vira cópias para essa posição no fim de cada bloco predecessor.</p>
<h3>Início do programa</h3>
<p>As duas primeiras instruções chamam <code>main</code> (<code>jal ra, main</code>) e encerram a execução (<code>ecall</code>), com o resultado em <code>a0</code> ou <code>fa0</code>. As globais e as constantes float (<code>.LC0</code>...) ficam na seção <code>.data</code>.</p>`,
        },
        {
            id: 'frame',
            title: 'Registro de ativação',
            html: `
<p>Cada chamada de função reserva na pilha um <strong>registro de ativação</strong> (quadro). O prólogo faz:</p>
<pre><code>addi sp, sp, -32     # reserva o quadro
sw   ra, 28(sp)      # salva o endereço de retorno
sw   s0, 24(sp)      # salva o s0 de quem chamou
addi s0, sp, 32      # s0 aponta para o topo do quadro</code></pre>
<p>Abaixo de <code>s0</code> ficam <code>ra</code>, o <code>s0</code> anterior, os parâmetros copiados dos registradores, as variáveis locais (cada <code>alloca</code> da IR vira uma posição fixa) e os valores guardados. O epílogo restaura <code>ra</code> e <code>s0</code>, libera o quadro e retorna com <code>ret</code>. O tamanho é arredondado para múltiplo de 16 bytes, como pede a ABI.</p>
<p>A aba <strong>Pilha</strong> desenha o quadro de cada função, com o deslocamento de cada posição em relação a <code>s0</code> (o que aparece no assembly) e em relação a <code>sp</code>. No exemplo <em>Fatorial recursivo</em>, cada chamada empilha um quadro igual a esse.</p>`,
        },
        {
            id: 'cpu',
            title: 'Execução e simulador de processadores',
            html: `
<p>O quadro <strong>Execução</strong> mostra o valor de retorno de <code>main</code>, quantas instruções RISC-V e quantas instruções da IR foram executadas, o tamanho do código gerado e o valor final das variáveis globais. A razão entre instruções executadas e instruções da IR mostra o custo de compilar sem otimização.</p>
<p><strong>Abrir no simulador de processadores</strong> abre, em uma nova aba, o Simulador de Processadores RISC-V com o assembly gerado, no modelo com pipeline. Lá é possível ver os conflitos, os adiantamentos, as bolhas e o efeito das cópias de e para a pilha no tempo de execução.</p>`,
        },
        {
            id: 'export',
            title: 'Exportações',
            html: `
<ul>
    <li><strong>Exportar figura (SVG)</strong>: a árvore (no passo atual) e o registro de ativação, com as cores do tema claro, prontos para slides e textos.</li>
    <li><strong>Tabela em LaTeX</strong>: tokens, tabela de símbolos e quadro da pilha, com cabeçalho na cor <code>tabAzul</code> e linhas com <code>\\hline</code>. Requer <code>\\usepackage[table]{xcolor}</code>.</li>
    <li><strong>Baixar IR (.ll)</strong> e <strong>Baixar assembly (.s)</strong>: o texto gerado, para comparar com outras ferramentas.</li>
</ul>`,
        },
        {
            id: 'keys',
            title: 'Atalhos de teclado',
            html: `
<table>
    <tr><th>Tecla</th><th>Ação</th></tr>
    <tr><td><kbd>Ctrl</kbd> + <kbd>Enter</kbd></td><td>compila e executa (no editor)</td></tr>
    <tr><td><kbd>→</kbd> e <kbd>←</kbd></td><td>próximo passo e passo anterior (abas Tokens e Árvore)</td></tr>
    <tr><td><kbd>Home</kbd> e <kbd>End</kbd></td><td>início e fim do passo a passo</td></tr>
    <tr><td><kbd>Espaço</kbd></td><td>anima ou pausa</td></tr>
    <tr><td><kbd>Esc</kbd></td><td>fecha a ajuda</td></tr>
</table>`,
        },
    ],
};
