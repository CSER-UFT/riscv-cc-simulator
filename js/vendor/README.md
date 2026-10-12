# Código copiado

`cpu/` é uma cópia de `js/riscv/`, `js/core/`, `js/models/` e `js/simulator.js` do
[riscv-cpu-simulator](https://github.com/CSER-UFT/riscv-cpu-simulator): montador, conjunto de instruções, simulador
funcional de referência e os modelos de processador (monociclo, pipeline, emissão dupla e Tomasulo), com a mesma
estrutura de pastas. O riscv-cc-simulator usa esses arquivos para montar o assembly gerado, executá-lo no navegador e
nos testes e medir os ciclos de cada instrução no mapa de calor. Para atualizar, copie de novo essas pastas.
`cpu/i18n/index.js` substitui o módulo de idioma que esses arquivos importam (as mensagens dos passos não são usadas).
