# Sintaxe dos Blocos de Diagrama do Notebook

Ultima atualizacao: 07/07/2026 (Fase 8.4)

Os blocos `data-athenaeum-block="diagram"` guardam apenas texto na fonte
(`data-diagram-source`). O SVG do preview e a descricao matematica sao gerados
somente em runtime e nunca sao persistidos no HTML salvo.

## Sintaxe por tipo

| Tipo (`data-diagram-kind`) | Sintaxe aceita |
| --- | --- |
| `diagram` | `A -> B`, uma ou mais relacoes por linha (cadeias `A -> B -> C`). |
| `flowchart` | `A -> B`, uma ou mais relacoes por linha (cadeias `A -> B -> C`). |
| `graph` | `A -> B` (direcionada) e `A -- B` (nao direcionada), incluindo cadeias e mistura dos dois separadores. |

## Regras gerais

- Uma relacao por linha; cadeias em linha unica sao expandidas em relacoes
  consecutivas (`A -> B -> C` vira `A -> B` e `B -> C`; em `graph`,
  `A -- B -- C` e `A -> B -- C` tambem funcionam).
- Linhas vazias, linhas sem separador e relacoes com nos vazios sao ignoradas
  com seguranca — o restante da fonte continua valido.
- Nos sao deduplicados por label, preservando a ordem de aparicao.
- Arestas direcionadas repetidas sao deduplicadas por sentido (`A -> B` e
  `B -> A` sao arestas diferentes).
- Arestas nao direcionadas tratam `A -- B` e `B -- A` como a mesma aresta.
- Labels aceitam Unicode (acentos, emoji etc.).

## Deteccao automatica de ciclo (`graph`)

Um grafo e reconhecido como ciclo simples nao direcionado quando **todas** as
condicoes valem:

- pelo menos 3 vertices;
- grafo conectado;
- todo vertice com grau exatamente 2;
- quantidade de arestas igual a quantidade de vertices;
- nenhum self-loop (`A -- A`);
- nenhuma aresta direcionada na fonte.

Nesse caso o preview usa layout circular deterministico (primeiro vertice no
topo, percurso horario, ordem independente da ordem das linhas da fonte) e
mostra a descricao matematica ao lado ou abaixo do desenho:

```
1 -- 2
2 -- 3
3 -- 4
4 -- 5
5 -- 1
```

gera um Cycle Graph C5 com:

- cinco vertices distribuidos em circulo, sem setas;
- `C₅: grafo ciclo com 5 vertices`;
- `V = {1, 2, 3, 4, 5}`;
- `E = {{1, 2}, {2, 3}, {3, 4}, {4, 5}, {5, 1}}`.

`V` e `E` sempre usam o label completo de cada vertice, mesmo quando o desenho
SVG trunca o label visualmente (ver "Labels longos" abaixo). Por exemplo:

Tipografia e cromia (Fase 8.4): a descricao matematica do Cycle Graph usa a
fonte serif ja usada no app (`--diagram-font-math` = `--font-serif`/Lora), com
peso normal no CSS para reduzir o peso visual. `C` (com o indice `n`), `V` e
`E` permanecem em italico serifado para ler como variavel/conjunto matematico.
O texto descritivo (`grafo ciclo com n vertices`) fica reto, sem italico;
glifos `=`, `{`, `}` e valores dos conjuntos tambem ficam em serif reto.
Arestas, contorno dos vertices, labels e descricao matematica usam tokens
neutros do ciclo (`--diagram-cycle-*`) apontando para `--color-text-primary`,
sem herdar a cor terracota da interface no estado normal.

```
ProcessamentoInicial -- ProcessamentoInterno
ProcessamentoInterno -- ProcessamentoFinal
ProcessamentoFinal -- ProcessamentoInicial
```

gera `V = {ProcessamentoInicial, ProcessamentoInterno, ProcessamentoFinal}` e
`E` com os tres pares completos — nunca os prefixos truncados que aparecem no
desenho, o que evitaria confundir vertices diferentes com o mesmo prefixo.

Grafos nao direcionados que nao formam ciclo simples (caminho aberto, grafo
ramificado, desconectado, com self-loop ou misto direcionado/nao direcionado)
permanecem no layout de grade deterministica, com linhas sem seta para as
arestas `--` e setas preservadas para as arestas `->`.

## Escala manual (`data-diagram-scale`)

Todos os blocos de diagrama podem ser redimensionados proporcionalmente,
como um objeto no Word: nos, vertices, linhas, setas, labels, espacamentos e
a descricao matematica aumentam ou diminuem juntos, sem mudar o layout
interno.

- com o bloco selecionado/focado, quatro handles aparecem nos cantos do
  preview; arrastar qualquer canto escala o conteudo uniformemente usando o
  canto oposto como ancora (largura e altura mudam na mesma proporcao);
- os handles sao acessiveis por teclado (`role="slider"`): setas
  direita/cima aumentam 5%, setas esquerda/baixo reduzem 5%, com Shift o
  passo e 10%, Home vai ao minimo (50%), End ao maximo (160%) e Escape sai
  do estado ativo sem alterar o tamanho;
- duplo clique em um handle volta a 100% (tamanho natural);
- a escala e persistida como `data-diagram-scale` (inteiro entre 50 e 160,
  em % do tamanho natural); ausencia do atributo ou 100 significam tamanho
  natural (100 nao e persistido);
- valores invalidos (fracoes, texto, fora do intervalo) sao removidos na
  normalizacao, voltando ao tamanho natural;
- quando a escala pedida nao cabe na largura do editor, a escala efetiva e
  limitada em runtime (sem overflow horizontal), preservando a preferencia
  persistida — o tamanho pleno volta quando houver espaco;
- a escala e preservada ao salvar/reabrir, ao copiar/colar o bloco e ao
  trocar entre `diagram`, `graph` e `flowchart`; o Modo limpo usa exatamente
  a mesma escala do modo normal;
- handles, contorno de selecao, transform e dimensoes medidas sao apenas
  runtime — nunca aparecem no HTML salvo nem em impressao;
- o atributo legado `data-diagram-width` (fase anterior, nao lancado) e
  migrado automaticamente para uma escala aproximada e removido.

## Limitacoes conhecidas

- `A -- B` so e valido em `graph`; em `diagram` e `flowchart` a linha e
  ignorada como invalida.
- O layout circular foi dimensionado para 3 a ~12 vertices; acima disso os
  labels podem ficar densos.
- Labels sao truncados apenas no desenho SVG do ciclo (16 caracteres) para
  proteger o layout; o texto completo permanece na fonte, no `<title>`
  acessivel de cada vertice e nos conjuntos `V`/`E` da descricao matematica,
  que nunca truncam.
- A descricao matematica quebra linha naturalmente entre itens de `V`/`E` (e,
  se necessario, dentro de um label muito longo) para evitar overflow
  horizontal; ela nao e persistida e nao afeta a fonte textual.
- Ciclos direcionados (`1 -> 2 -> 3 -> 1`) e ciclos com cordas nao recebem
  layout circular — apenas o ciclo simples nao direcionado.
- Nao ha layout force-directed, edicao visual nem persistencia de SVG.
- O redimensionamento e sempre proporcional (uniforme); nao ha resize
  horizontal/vertical independente, rotacao nem drag and drop do bloco.
- Quando o conteudo natural e mais largo que o editor (cadeias longas de
  `diagram`, ciclos com descricao extensa), o bloco inteiro e reduzido
  uniformemente para caber — o layout interno nao reflui. A grade de `graph`
  ainda recalcula colunas quando a JANELA muda de largura (responsividade de
  layout), mas nunca durante um arrasto de escala.
- O Cycle Graph mantem desenho e descricao lado a lado como um unico objeto
  escalavel; ele nao empilha por causa de reducao manual.
- A descricao matematica usa HTML semantico (subscrito e simbolos Unicode),
  nao KaTeX, e e derivada do parser em runtime — nada e salvo na fonte ou no
  HTML persistido.
