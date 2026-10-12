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
    <li>Explore as abas: <strong>Tokens</strong> e <strong>Árvore</strong> têm passo a passo (setas do teclado ou <strong>Animar</strong>); <strong>Símbolos</strong> mostra a tabela de símbolos; <strong>IR e RISC-V</strong> mostra o código gerado lado a lado; <strong>Pilha</strong> desenha o registro de ativação de cada função; <strong>Fluxo de controle</strong> e <strong>Fluxo de dados</strong> mostram os grafos e as análises do estilo do LLVM.</li>
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
    <dt>Copiar link</dt><dd>Copia um link que reabre o programa do editor, com a aba aberta, o nível de IR e as escolhas da aba Otimizações. Bom para a turma inteira começar do mesmo exemplo.</dd>
    <dt>Opções</dt><dd><strong>Comentários com a IR</strong> coloca, ao lado de cada trecho do assembly, a instrução da IR que o gerou; <strong>Linhas do código fonte</strong> intercala as linhas do programa como comentários.</dd>
    <dt>IR</dt><dd>Escolhe a IR mostrada nas abas de código e de grafos: sem otimização (como <code>clang -O0</code>) depois da mem2reg, na forma SSA, ou com as otimizações escolhidas na aba Otimizações.</dd>
    <dt>Execução</dt><dd>O assembly é montado e executado pelo mesmo simulador funcional do Simulador de Processadores. A IR também é interpretada, e os dois resultados precisam coincidir (o quadro avisa se não coincidirem). O limite é de dois milhões de instruções.</dd>
    <dt>Fases</dt><dd>Clique em uma fase para abrir a aba correspondente.</dd>
    <dt>Ligação entre as visões</dt><dd>Uma linha clicada no editor, na IR ou no assembly fica destacada, junto com as linhas correspondentes nas outras duas visões.</dd>
    <dt>Laços infinitos</dt><dd>Enquanto você digita, a execução para em 100 mil instruções, para o editor não travar; o botão Compilar e executar usa o limite cheio, de dois milhões.</dd>
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
            id: 'ssa',
            title: 'mem2reg e a forma SSA',
            html: `
<p>O seletor <strong>IR</strong>, abaixo do editor, troca a IR sem otimização pela IR depois da passagem <strong>mem2reg</strong> do LLVM (<code>opt -passes=mem2reg</code>). A troca vale para as abas IR e RISC-V, Pilha, Fluxo de controle e Fluxo de dados.</p>
<p>Na forma SSA (atribuição estática única), cada valor tem uma só definição. A mem2reg leva a IR para essa forma tirando da memória as variáveis que só são lidas e escritas por <code>load</code> e <code>store</code>:</p>
<ol>
    <li>os blocos com <code>store</code> na variável são as suas definições;</li>
    <li>uma <code>phi</code> é posta em cada bloco da <strong>fronteira de dominância iterada</strong> dessas definições, mas só onde a variável está viva na entrada (SSA podada, como no LLVM);</li>
    <li>um percurso da árvore de dominadores troca cada <code>load</code> pelo valor que chega até ali, e cada <code>phi</code> recebe o valor que sai de cada predecessor.</li>
</ol>
<p>As <code>phi</code> recebem o nome da variável com um número de versão (<code>%i.0</code>), como no LLVM. Vetores e variáveis com o endereço tomado (<code>&amp;x</code>) continuam na memória; a nota acima do código lista quais foram promovidas. Um <code>load</code> sem nenhum <code>store</code> antes lê <code>undef</code>, um valor indefinido.</p>
<p>O quadro Execução mostra as duas versões lado a lado. A mem2reg corta pela metade as instruções da IR, mas o assembly quase não muda: o gerador de código ainda guarda no quadro da pilha todo valor que passa de um bloco para outro, e as <code>phi</code> viram cópias. Aproveitar a forma SSA exige um alocador de registradores para a função inteira.</p>`,
        },
        {
            id: 'cfg',
            title: 'Fluxo de controle e dominadores',
            html: `
<p>A aba <strong>Fluxo de controle</strong> desenha o <strong>grafo de fluxo de controle</strong> (CFG) de uma função: cada caixa é um bloco básico e cada seta, um desvio possível (V e F nos desvios condicionais). As arestas que pulam camadas descem pela esquerda; as <strong>arestas de retorno</strong>, que fecham os laços, sobem pela direita. A cor de fundo mostra a profundidade dos laços.</p>
<dl>
    <dt>Dominador</dt><dd>O bloco A domina B quando todo caminho da entrada até B passa por A. O dominador imediato é o mais próximo de B, e as ligações de cada bloco ao seu dominador imediato formam a <strong>árvore de dominadores</strong>, desenhada ao lado.</dd>
    <dt>Fronteira de dominância</dt><dd>Os blocos em que o domínio de A termina: A domina um predecessor deles, mas não domina o bloco em si. São as junções onde valores diferentes se encontram, e é ali que a mem2reg coloca as <code>phi</code>.</dd>
    <dt>Laço natural</dt><dd>Uma aresta de retorno vai de um bloco para um cabeçalho que o domina. O laço é o cabeçalho mais os blocos que chegam à origem da aresta sem passar pelo cabeçalho. Laços dentro de laços aumentam a profundidade.</dd>
</dl>
<p>Clique num bloco (no grafo, na árvore ou na tabela) para destacar os seus dominadores e a sua fronteira de dominância. Os dominadores são calculados pelo algoritmo iterativo de Cooper, Harvey e Kennedy sobre a ordem pós-fixa reversa, o mesmo princípio do LLVM. A tabela e a lista de laços trazem os mesmos dados em texto.</p>
<p>O botão <strong>CFG (DOT)</strong> gera o arquivo no formato do Graphviz, como <code>opt -passes=dot-cfg</code>: <code>dot -Tpdf ordena-cfg.dot -o cfg.pdf</code>.</p>`,
        },
        {
            id: 'dfg',
            title: 'Fluxo de dados e caminho crítico',
            html: `
<p>A aba <strong>Fluxo de dados</strong> desenha o <strong>grafo de fluxo de dados</strong> (DFG) de um bloco básico. Cada instrução é um nó; uma seta cheia liga quem define um valor a quem o usa, e uma seta tracejada mantém a ordem entre acessos à memória que podem ser no mesmo endereço (um <code>load</code> não passa à frente de um <code>store</code> anterior, e uma chamada pode ler ou escrever qualquer variável cujo endereço escapou). Valores que vêm de outros blocos aparecem como elipses no alto.</p>
<p>O desenho está em escala de tempo: cada instrução começa no primeiro ciclo em que todos os seus operandos estão prontos (<strong>escalonamento ASAP</strong>, com unidades funcionais à vontade), e a altura da caixa é a sua latência, a mesma do simulador de processadores. O <strong>caminho crítico</strong>, destacado, é a cadeia mais longa: nenhum processador termina o bloco em menos ciclos que isso. A tabela traz também o início mais tarde possível sem atrasar o bloco (<strong>ALAP</strong>) e a <strong>folga</strong> de cada instrução; as instruções sem folga são as do caminho crítico.</p>
<p>A razão entre a soma das latências e o caminho crítico é o paralelismo disponível no bloco, o limite do que um processador superescalar ou com despacho duplo pode aproveitar. Compare o mesmo bloco com e sem a mem2reg: os <code>load</code> e <code>store</code> das variáveis somem, e o caminho crítico encurta.</p>
<p>A tabela de definições e usos lista, para cada valor da função, onde ele é definido e onde é usado (para uma <code>phi</code>, também de qual bloco o valor vem).</p>`,
        },
        {
            id: 'heat',
            title: 'Mapa de calor',
            html: `
<p>A aba <strong>Mapa de calor</strong> mostra onde o programa passa o tempo, colorindo o código fonte (no editor), a IR, o assembly e o grafo de fluxo de controle. A <strong>Medida</strong> escolhe a cor:</p>
<dl>
    <dt>Frequência estimada (estática)</dt><dd>Quantas vezes cada bloco deve executar por chamada da função, sem rodar o programa, como a análise BlockFrequencyInfo do LLVM. Cada desvio recebe uma probabilidade: num laço, 31/32 para continuar e 1/32 para sair (a heurística de laço do LLVM, que supõe cerca de 32 voltas); nos demais desvios, metade para cada lado. As frequências resolvem o sistema em que a frequência de um bloco é a soma, sobre os predecessores, da frequência de cada um vezes a probabilidade da aresta.</dd>
    <dt>Execuções da IR e execuções RISC-V</dt><dd>Quantas vezes cada instrução executou de fato, no interpretador da IR e no processador.</dd>
    <dt>Ciclos</dt><dd>Os ciclos que cada instrução custou no processador escolhido (monociclo, pipeline de 5 estágios ou emissão dupla, com as configurações padrão do simulador de processadores e, se marcado, as caches). Cada instrução fica com os ciclos desde a conclusão da anterior: a soma dá o total, e as bolhas, as faltas na cache e os desvios mal previstos aparecem na instrução que os sofreu.</dd>
    <dt>Ciclos de bolha</dt><dd>Os ciclos em que a instrução ficou parada esperando um operando ou um recurso.</dd>
</dl>
<p>A tabela de blocos compara a frequência estimada com a medida, por chamada. A diferença mostra o limite das heurísticas: nos laços curtos da multiplicação de matrizes, de 3 voltas, a estimativa supõe 32. É por isso que compiladores aceitam um perfil de execução real (otimização guiada por perfil, PGO).</p>
<p>A escala logarítmica ajuda quando os valores variam muito. Os botões de CSV trazem os números por linha do fonte e por instrução RISC-V, para análise em planilha ou Python.</p>`,
        },
        {
            id: 'opt',
            title: 'Otimizações clássicas e aproximadas',
            html: `
<p>A aba <strong>Otimizações</strong> aplica passagens sobre a IR em SSA, como o <code>opt</code> do LLVM, e mostra cada transformação na lista <em>Transformações aplicadas</em>. Para ver o resultado nas outras abas (código, grafos, pilha e mapa de calor), escolha <strong>otimizada</strong> no seletor IR.</p>
<h3>Clássicas</h3>
<dl>
    <dt>Propagação de constantes</dt><dd>Uma instrução com todos os operandos constantes é calculada na compilação; um desvio com condição constante vira desvio incondicional, os blocos que ficam inalcançáveis saem e um bloco com um único predecessor que só desvia para ele é juntado a esse predecessor (como <code>sccp</code> e <code>simplifycfg</code>).</dd>
    <dt>Simplificação</dt><dd>Identidades algébricas (<code>x + 0</code>, <code>x * 1</code>, <code>x * 0</code>, <code>x - x</code>) e redução de força: multiplicar por uma potência de 2 vira deslocamento (<code>instcombine</code>).</dd>
    <dt>Subexpressões comuns</dt><dd>Uma instrução igual a outra que a domina é trocada por ela, com a árvore de dominadores; um <code>load</code> repetido no mesmo bloco, sem <code>store</code> ou chamada no meio, reaproveita o anterior (<code>gvn</code>, <code>early-cse</code>).</dd>
    <dt>Código invariante (LICM)</dt><dd>Uma instrução sem efeito colateral cujos operandos vêm de fora do laço é levada para o bloco antes dele, do laço mais interno para o mais externo. Na multiplicação de matrizes, <code>i * n</code> sai do laço de <code>k</code> e depois do de <code>j</code>.</dd>
    <dt>Código morto</dt><dd>Instruções sem efeito colateral cujo valor ninguém usa (<code>dce</code>).</dd>
</dl>
<p>Os testes do simulador conferem que as clássicas nunca mudam o resultado, em todos os exemplos e em programas sorteados.</p>
<h3>Aproximadas</h3>
<p>A <strong>computação aproximada</strong> aceita um erro controlado nas saídas em troca de desempenho ou energia. As técnicas daqui não mexem no que calcula endereços (<code>getelementptr</code>) nem nas condições de desvio, para que o programa continue lendo a memória certa e terminando.</p>
<dl>
    <dt>Perfuração de laço</dt><dd>A variável de indução avança <em>k</em> passos de cada vez, e o laço executa só uma de cada <em>k</em> iterações (Sidiroglou e colegas, 2011). Só é aplicada a laços com saída por comparação de ordem (<code>&lt;</code>, <code>&lt;=</code>, <code>&gt;</code>, <code>&gt;=</code>), para não pular o valor de parada.</dd>
    <dt>Precisão do float</dt><dd>O resultado de cada operação float tem a mantissa truncada para <em>m</em> bits, com <code>bitcast</code> e <code>and</code>, simulando uma unidade de ponto flutuante mais estreita.</dd>
    <dt>Multiplicação aproximada</dt><dd>Os <em>k</em> bits menos significativos dos operandos de cada multiplicação inteira de dados são zerados, como num multiplicador truncado.</dd>
</dl>
<p>A tabela compara as versões em instruções, ciclos no pipeline, aceleração, resultado de <code>main</code> e erro. O <strong>erro relativo médio</strong> é a média, sobre o retorno de <code>main</code> e todos os elementos das variáveis globais, de |aproximado − exato| / |exato| (limitado a 100% por elemento). O botão <strong>Varrer</strong> repete a medida para vários valores do parâmetro e desenha a curva de erro contra ganho, exportável em SVG e CSV.</p>
<p class="tip">A redução de precisão e a multiplicação aproximada são emuladas em software, com instruções a mais, e por isso aqui ficam mais lentas: o ganho real delas vem de uma unidade aproximada em hardware, com menos área e energia. A perfuração de laço, ao contrário, ganha tempo já em software.</p>`,
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
    <li><strong>Exportar figura (SVG)</strong> e os botões <strong>(SVG)</strong>: a árvore (no passo atual), o registro de ativação, o CFG, a árvore de dominadores e o DFG, com as cores do tema claro, prontos para slides e textos.</li>
    <li><strong>Tabela em LaTeX</strong>: tokens, tabela de símbolos e quadro da pilha, com cabeçalho na cor <code>tabAzul</code> e linhas com <code>\\hline</code>. Requer <code>\\usepackage[table]{xcolor}</code>.</li>
    <li><strong>CFG (DOT)</strong>, <strong>Dominadores (DOT)</strong> e <strong>DFG (DOT)</strong>: os grafos no formato do Graphviz, como o <code>opt</code> do LLVM gera; tabelas em LaTeX dos dominadores e do escalonamento do bloco.</li>
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
