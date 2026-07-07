# Sintaxe dos Blocos de Diagrama do Notebook

Ultima atualizacao: 07/07/2026 (Fase 7.1)

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
- A descricao matematica usa HTML semantico (subscrito e simbolos Unicode),
  nao KaTeX, e e derivada do parser em runtime — nada e salvo na fonte ou no
  HTML persistido.
