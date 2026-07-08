# Auditoria Visual dos Diagramas do Notebook

Data: 06/07/2026

> **Update 06/07/2026 — Escopo preservado:** a rodada mais recente focou a
> tela inicial da biblioteca, a sidebar esquerda e o painel `Detalhes`. Não
> houve alteração em `data-athenaeum-block="diagram"`, parser, previews SVG,
> modo limpo, persistência, autosave, seleção/range ou tokens específicos dos
> diagramas do Notebook. Este documento continua válido sem mudanças de
> comportamento.

Escopo desta fase: auditoria técnica e visual dos blocos
`data-athenaeum-block="diagram"` no editor de Cadernos. Este documento nao
altera comportamento, persistencia, autosave, selecao/range, paste, clipboard,
assets, anexos, equacoes, callouts ou toolbars.

## Arquivos Mapeados

| Arquivo                                               | Papel atual                                                                                                                 | Observacoes                                                                                                                    |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `src/features/notebooks/notebookEditorDiagramDom.ts`  | Normalizacao DOM, leitura da fonte textual, render runtime do preview e migracao de figuras antigas para o bloco unificado. | Contem o ponto mais sensivel: decide entre SVG runtime, fallback textual e estados vazio/invalido.                             |
| `src/features/notebooks/notebookDiagramParser.ts`     | Parsers puros: `parseDiagramSource` (relacoes `A -> B`) e `parseGraphSource` (`A -> B` e `A -- B` com direcao explicita).   | `parseDiagramSource` segue compartilhado por `diagram` e `flowchart`; `graph` usa `parseGraphSource`. Ambos com testes Vitest. |
| `src/features/notebooks/notebookGraphAnalysis.ts`     | Deteccao pura de ciclo simples nao direcionado (`detectSimpleCycle`) com ordem deterministica de percurso.                  | Usado apenas pelo preview de `graph`; possui testes dedicados.                                                                 |
| `src/features/notebooks/NotebookDiagramPreview.tsx`   | Preview SVG runtime para `data-diagram-kind="diagram"`.                                                                     | Layout horizontal deterministico, sem biblioteca externa.                                                                      |
| `src/features/notebooks/NotebookGraphPreview.tsx`     | Preview SVG runtime para `data-diagram-kind="graph"`.                                                                       | Layout em grade deterministica, sem force-directed, canvas ou biblioteca externa.                                              |
| `src/features/notebooks/NotebookFlowchartPreview.tsx` | Preview SVG runtime para `data-diagram-kind="flowchart"`.                                                                   | Layout vertical deterministico, com tratamento visual simples para inicio/fim.                                                 |
| `src/features/notebooks/NotebookDiagramFrame.tsx`     | Frame escalavel compartilhado: mede dimensoes naturais (ResizeObserver), aplica `transform: scale` uniforme, reserva `natural x escala` no fluxo, hospeda os quatro handles de canto e a acessibilidade. | Nao contem parser nem layout especifico; expoe `useDiagramFrameWidth` para responsividade de layout por janela.               |
| `src/features/notebooks/notebookDiagramScale.ts`      | Helpers puros de escala (`parseDiagramScale`, `clampDiagramScale`, `stepDiagramScale`), aplicacao no DOM (`applyDiagramScale`, `clearDiagramScaleRuntimeStyles`) e leitura do legado `data-diagram-width`. | Persistencia via `data-diagram-scale`; testes dedicados em Vitest.                                                            |
| `src/features/notebooks/notebookEditorUtils.ts`       | Tipos, labels, fontes default, previews vazios e type guards.                                                               | Define `DiagramKind`, `diagramKindLabels`, `diagramDefaultSources`, `diagramEmptyPreviews` e `isDiagramKind`.                  |
| `src/features/notebooks/NotebookPageEditor.tsx`       | Integracao com insercao, toolbar contextual, serializacao, autosave e handlers de teclado.                                  | Deve continuar sendo tocado com muito cuidado; os pontos de diagrama estao bem localizados.                                    |
| `src/styles/index.css`                                | Visual dos blocos ricos e do SVG runtime.                                                                                   | Concentra a maior parte dos tokens CSS e tambem varios tamanhos/espacamentos hardcoded.                                        |

## Registro de Fases

| Fase        | Status    | Escopo                                                                                                               | Resultado                                                                                                                                                                                                                                                                                                                                                                                                                                                | Validacao                                                                       |
| ----------- | --------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Diagrama 1  | Concluida | Base unificada `data-athenaeum-block="diagram"` com `data-diagram-kind`, fonte textual e preview textual.            | Criou a estrutura persistida leve para `diagram`, `graph` e `flowchart`.                                                                                                                                                                                                                                                                                                                                                                                 | Validacao manual de insercao, edicao e persistencia.                            |
| Diagrama 2  | Concluida | Preview SVG runtime para `data-diagram-kind="diagram"` usando relacoes `A -> B`.                                     | `diagram` passou a renderizar nos e setas em SVG sem persistir SVG no HTML salvo.                                                                                                                                                                                                                                                                                                                                                                        | `npm run typecheck` e validacao visual dos cenarios principais.                 |
| Diagrama 2B | Concluida | Refinamento do SVG de `diagram`: linha da aresta visivel, multiplas relacoes no mesmo bloco e fonte unica multiline. | Corrigiu casos como `Entrada -> Saida` e cadeias com varias linhas.                                                                                                                                                                                                                                                                                                                                                                                      | `npm run typecheck` e `git diff --check`.                                       |
| Diagrama 2C | Concluida | Estados de UX para fonte vazia ou sem relacoes validas em `diagram`.                                                 | Preview passou a orientar o usuario sem alterar a fonte textual nem a persistencia.                                                                                                                                                                                                                                                                                                                                                                      | `npm run typecheck` e `git diff --check`.                                       |
| Diagrama 3  | Concluida | Preview SVG runtime para `data-diagram-kind="flowchart"` com a mesma sintaxe `A -> B`.                               | Fluxogramas passaram a renderizar etapas e setas em SVG; `graph` permaneceu textual.                                                                                                                                                                                                                                                                                                                                                                     | `npm run typecheck`, `git diff --check` e validacao visual.                     |
| Fase 5A     | Concluida | Testes unitarios para `parseDiagramSource` com Vitest.                                                               | Cobertura minima para texto vazio, linhas invalidas, multiplas relacoes, Unicode e nos malformados.                                                                                                                                                                                                                                                                                                                                                      | `npm test -- --run` e `npm run typecheck`.                                      |
| Fase 6A     | Concluida | Auditoria tecnica e visual sem alterar comportamento.                                                                | Este documento mapeou arquitetura, riscos, hardcoded visual, limitacoes e matriz trabalho x resultado.                                                                                                                                                                                                                                                                                                                                                   | Apenas documentacao.                                                            |
| Fase 6B     | Concluida | Tokens visuais de diagramas e ajustes nao destrutivos nos previews SVG.                                              | `src/styles/index.css` recebeu tokens para card, preview, nos, linhas, setas, textos, fonte e estados discretos.                                                                                                                                                                                                                                                                                                                                         | `npm run typecheck`, `npm test -- --run` e `git diff --check`.                  |
| Fase 6C     | Concluida | Ajuste de escala, responsividade e legibilidade dos previews SVG existentes.                                         | `diagram` ganhou truncamento menos agressivo em diagramas pequenos; `flowchart` ganhou nos mais largos e altura runtime proporcional com teto seguro.                                                                                                                                                                                                                                                                                                    | `npm run typecheck`, `npm test -- --run` e `git diff --check`.                  |
| Fase 6D     | Concluida | Preview SVG runtime para `data-diagram-kind="graph"`.                                                                | `graph` passou a renderizar relacoes `A -> B` em grade deterministica, usando os mesmos tokens visuais de diagramas; fontes invalidas ou legadas seguem no fallback textual.                                                                                                                                                                                                                                                                             | `npm run typecheck`, `npm test -- --run` e `git diff --check`.                  |
| Fase 6E     | Concluida | Polimento visual conjunto e modo limpo runtime.                                                                      | Bordas, fonte, titulos internos, labels SVG e espacamentos foram suavizados; a toolbar contextual ganhou `Modo limpo`, que oculta `Fonte` apenas em runtime sem salvar estado no bloco.                                                                                                                                                                                                                                                                  | `npm run typecheck`, `npm test -- --run` e `git diff --check`.                  |
| Fase 6E.1   | Concluida | Hotfix do modo limpo e cadeias em linha unica.                                                                       | O botao `Modo limpo` foi movido da toolbar de callout para a toolbar contextual de diagrama, e `parseDiagramSource` passou a aceitar cadeias como `Elemento A -> Elemento B -> Elemento C`.                                                                                                                                                                                                                                                              | `npm run typecheck`, `npm test -- --run` e `git diff --check`.                  |
| Fase 6E.2   | Concluida | Refinamento minimalista do modo limpo.                                                                               | No modo limpo, o titulo interno do preview e ocultado, a moldura principal do preview e removida e o bloco fica mais editorial, mantendo nos, setas e conexoes visiveis.                                                                                                                                                                                                                                                                                 | `npm run typecheck`, `npm test -- --run` e `git diff --check`.                  |
| Fase 6E.3   | Concluida | Compactacao vertical do modo limpo.                                                                                  | O modo limpo reduziu margem, padding e altura visual runtime dos previews para que diagramas parecam figuras editoriais embutidas no texto.                                                                                                                                                                                                                                                                                                              | `npm run typecheck`, `npm test -- --run` e `git diff --check`.                  |
| Fase 6E.4   | Concluida | Ajuste fino da altura do modo limpo.                                                                                 | O modo limpo passou a limitar diretamente a altura visual dos SVGs, reduzindo espaco residual abaixo de diagramas pequenos sem alterar o layout logico.                                                                                                                                                                                                                                                                                                  | `npm run typecheck`, `npm test -- --run` e `git diff --check`.                  |
| Macrofase 7 | Concluida | Grafo nao direcionado, deteccao de ciclo simples e descricao matematica runtime para `graph`.                        | `graph` ganhou parser proprio (`parseGraphSource`) com arestas `A -- B` e direcao explicita por aresta; ciclos simples nao direcionados sao detectados (`detectSimpleCycle`) e renderizados em layout circular deterministico com descricao matematica (`Cn`, `V`, `E`) gerada em runtime; grafos nao direcionados fora de ciclo mantem a grade, sem setas. `diagram` e `flowchart` nao mudaram.                                                         | `npm run typecheck`, `npm test -- --run` e `git diff --check`.                  |
| Fase 7.1    | Concluida | Labels completos em `V`/`E` do Cycle Graph, separados do label truncado do SVG.                                      | `V` e `E` passaram a renderizar sempre o label original (nunca truncado) por vertice/aresta, via helpers puros (`buildCycleVertexItems`, `buildCycleEdgeItems`) e elementos `<span>` por item, permitindo quebra de linha natural sem overflow horizontal; o truncamento de 16 caracteres continua exclusivo do desenho SVG, com `<title>` completo por vertice. `diagram`, `flowchart`, a grade de `graph`, o parser e a deteccao de ciclo nao mudaram. | `npm run typecheck`, `npm test -- --run`, `npm run build` e `git diff --check`. |
| Macrofase 8 | Concluida | Correcao do modo limpo, tipografia unificada e redimensionamento manual por largura. | A causa da reducao aparente no modo limpo era o teto de `height` dos SVGs (o desenho inteiro escala pelo viewBox); os tetos foram removidos e o modo limpo passou a alterar apenas cromo. Tokens `--diagram-font-ui/math/source` e `--diagram-math-font-size` centralizaram a tipografia (sans para diagram/grade/flowchart, serif Lora para Cycle Graph e descricao matematica, mono para a fonte). Os tres previews foram envolvidos por `NotebookDiagramFrame`, que mede a largura disponivel, controla o handle de resize (Pointer Events, rAF, teclado, `role="slider"`) e persiste `data-diagram-width` (inteiro 40..100) uma unica vez por interacao; a grade de `graph` recalcula colunas pela largura real do frame. | `npm run typecheck`, `npm test -- --run`, `npm run build` e `git diff --check`. |
| Fase 8.1 | Concluida | Redimensionamento proporcional real (escala) no lugar do controle de largura. | O controle anterior so estreitava o conteiner responsivo (reflow: grade recalculava colunas, ciclo empilhava). Agora o conteudo tem layout natural fixo (`width: max-content`, medido por ResizeObserver, que ignora transforms) e a escala e um `transform: scale()` uniforme sobre nos, vertices, linhas, setas, labels, espacamentos e descricao matematica; uma box intermediaria reserva `natural x escala` no fluxo. Persistencia em `data-diagram-scale` (inteiro 50..160; 100/ausente = natural); quando nao cabe na largura do editor, a escala EFETIVA e limitada em runtime preservando a preferencia. Quatro handles de canto com ancora no canto oposto, teclado completo (setas 5%, Shift 10%, Home/End, Escape) e duplo clique para 100%. `data-diagram-width` (Macrofase 8, nao lancado) foi migrado em `normalizeDiagrams` para escala aproximada e removido. | `npm run typecheck`, `npm test -- --run`, `npm run build` e `git diff --check`. |
| Fase 8.2 | Concluida | Refinamento tipografico da descricao matematica do Cycle Graph. | `C`/`Cn`, `V` e `E` passaram a ter uma classe propria (`notebook-graph-cycle-math-variable`, italico serifado, peso 600) separada dos glifos (`=`, `{`, `}`) e dos valores dos conjuntos, aproximando a notacao de escrita matematica academica; o indice de `Cn` (`<sub>`) permanece ereto, seguindo a convencao tipografica de variavel italica com digito reto. Titulo do bloco passou a italico leve (peso 500) para casar com as letras de conjunto. Labels dos vertices no SVG do ciclo ficaram no peso 600 (antes 650, herdado da UI) para ler mais leve em serif sem perder legibilidade. Nenhum token novo foi criado — reuso de `--diagram-font-math`. | `npm run typecheck`, `npm test -- --run`, `npm run build` e `git diff --check`. |
| Fase 8.3 | Concluida | Refino tipografico final do Cycle Graph. | A descricao matematica do Cycle Graph passou a usar Lora de forma mais editorial, com peso 500 em `Cn`, `V`, `E`, glifos e itens dos conjuntos. O texto descritivo (`grafo ciclo com n vertices`) deixou de ser italico; apenas as variaveis matematicas continuam em serif italico. A cor da descricao matematica foi isolada em `--diagram-math-text`, preto no modo claro e branco no modo escuro, e os labels dos vertices do ciclo tambem passaram a usar Lora com peso 500. Nenhuma logica, parser, resize, persistencia ou atributo `data-*` foi alterado. | `npm run typecheck`, `npm test -- --run`, `npm run build` e `git diff --check`. |
| Fase 8.4 | Concluida | Refinamento cromatico academico do Cycle Graph. | A estrutura normal do Cycle Graph deixou de herdar o cobre/terracota de `--diagram-edge` e `--diagram-node-border`: arestas, contorno dos vertices, labels e descricao matematica agora usam tokens neutros especificos (`--diagram-cycle-*`) apontando para `--color-text-primary`, ficando preto/quase preto no modo claro e branco/quase branco no modo escuro. O preenchimento dos vertices segue integrado ao fundo do preview por `--diagram-cycle-vertex-fill`. A tipografia Lora do ciclo foi reduzida para peso normal (`400`) no CSS para aliviar `Cn`, `V`, `E`, conjuntos e labels. Terracota permanece reservada aos estados de interacao globais (selecao, foco, hover, resize e toolbar). `diagram`, grade de `graph`, `flowchart`, parser, resize e persistencia nao mudaram. | `npm run typecheck`, `npm test -- --run`, `npm run build` e `git diff --check`. |
| Fase 7.2 | Concluida | QA final e encerramento funcional dos diagramas. | Revisao tecnica confirmou a separacao entre parser, analise, previews, frame escalavel e serializacao. Foram corrigidas duas falhas reais: o estado ativo do `NotebookDiagramFrame` agora e limpo ao focar fora do bloco ou quando a janela perde foco, evitando handles presos; e o paste interno de diagramas reconstrui somente blocos `data-athenaeum-block="diagram"` sanitizados, preservando `data-diagram-kind`, `data-diagram-source` e `data-diagram-scale` valido sem colar HTML arbitrario. `parseGraphSource` tambem passou a rejeitar separadores malformados como `A --- B`/`A --> B`, coberto por teste unitario. Diagram, Graph, Cycle Graph e Flowchart ficam funcionalmente concluidos para o escopo atual. | `npm run typecheck`, `npm test -- --run`, `npm run build` e `git diff --check`. |

Ressalvas mantidas apos a Fase 7.2:

- `graph` agora tem preview SVG runtime para relacoes `A -> B` e `A -- B`;
  fontes de `graph` com `A -- B` deixaram de cair no fallback textual. Em
  `diagram` e `flowchart`, linhas `A -- B` continuam invalidas por decisao de
  escopo (parser compartilhado inalterado).
- O `Modo limpo` e global do editor enquanto a pagina esta aberta; ele nao e
  persistido em `data-*`, `app_settings` ou HTML salvo.
- No modo limpo, o titulo interno e a area `Fonte` somem visualmente, mas a
  fonte textual segue no DOM editavel e volta ao desativar o modo.
- Desde a Macrofase 8, o modo limpo NAO limita mais a altura visual dos SVGs:
  ele altera apenas cromo (titulo, `Fonte`, bordas, fundos e padding externo),
  e o tamanho do desenho e da tipografia e identico ao modo normal.
- A escala manual dos blocos e persistida em `data-diagram-scale` (inteiro
  50..160, % do tamanho natural); transform, dimensoes medidas, box e handles
  sao apenas runtime e nao aparecem no HTML salvo. Ausencia do atributo (ou
  100) = tamanho natural; valores invalidos sao removidos na normalizacao.
- Copy/paste interno de diagramas preserva tipo, fonte textual e escala
  persistida quando o clipboard contem HTML de bloco `diagram`; o paste segue
  sanitizado e nao importa HTML arbitrario.
- O atributo legado `data-diagram-width` (Macrofase 8) nao e mais criado;
  blocos que ainda o possuem sao migrados em `normalizeDiagrams` para uma
  escala aproximada (largura NN% vira escala NN% com clamp 50..160) e o
  atributo e removido. Nao existem dois controles persistentes concorrentes.
- Diferenca conceitual documentada: largura disponivel (antigo) muda o espaco
  do conteiner e provoca reflow do layout interno; escala (novo) mantem o
  layout natural fixo e amplia/reduz o desenho inteiro uniformemente. A
  responsividade por janela continua existindo, mas via limite da escala
  efetiva (nunca por reflow durante o drag).
- Cadeias em linha unica no formato `A -> B -> C` sao expandidas em relacoes
  consecutivas; em `graph`, cadeias `A -- B -- C` e mistas `A -> B -- C`
  tambem sao expandidas.
- Separadores malformados como `A --- B` e `A --> B` sao rejeitados por
  `parseGraphSource`, sem criar labels residuais como `- B` ou `> B`.
- Em `graph`, ciclos simples nao direcionados (>= 3 vertices, conectado, grau
  2 em todos os vertices, |E| = |V|, sem self-loop, sem aresta direcionada)
  ganham layout circular e descricao matematica runtime (`Cn`, `V`, `E`).
  Grafos que nao satisfazem essas condicoes mantem a grade deterministica;
  arestas nao direcionadas na grade sao desenhadas sem seta.
- A descricao matematica usa HTML semantico com `<sub>`; KaTeX nao foi usado
  aqui para nao ampliar o escopo (labels arbitrarios exigiriam escaping para
  `\text{}` e render fora do fluxo React atual).
- Em `V` e `E` do Cycle Graph, o label usado e sempre o original completo
  (nunca o truncado do desenho SVG); cada item de `V`/`E` e um `<span>`
  separado, o que permite quebra de linha natural entre itens e evita que
  labels com o mesmo prefixo virem ambiguos na descricao.
- `flowchart` ficou mais legivel em fluxos de 4 a 8 etapas, mas fluxos muito
  longos ainda precisam reduzir escala para caber no card.
- Labels longos truncam de forma menos agressiva, mas continuam truncados para
  proteger o layout.
- Nao ha auto-layout avancado para ciclos, bifurcacoes complexas ou arestas
  cruzadas.
- O SVG continua sendo runtime; a decisao de nao persistir SVG no HTML salvo
  permanece obrigatoria.
- Encerramento funcional: `Diagram`, `Graph`, `Cycle Graph` e `Flowchart`
  estao concluidos para o escopo atual.

## Arquitetura Atual

O Notebook usa uma base unica para diagramas:

- bloco persistido como `figure[data-athenaeum-block="diagram"]`;
- tipo definido por `data-diagram-kind="diagram" | "graph" | "flowchart"`;
- escala manual opcional em `data-diagram-scale` (inteiro 50..160; 100 nao e
  persistido);
- preview marcado por `data-diagram-preview="true"`;
- fonte textual editavel em `data-diagram-source="true"`;
- HTML salvo leve, sem SVG runtime persistido.
- modo limpo aplicado por classe runtime no editor, sem atributo persistido no
  bloco.

`NotebookPageEditor.tsx` ainda coordena a insercao, toolbar contextual,
remocao, eventos de teclado e chamada de `normalizeDiagrams`. A logica DOM
especifica fica em `notebookEditorDiagramDom.ts`, que:

- localiza blocos e fontes de diagrama;
- normaliza blocos antigos ou incompletos;
- junta multiplas fontes diretas em uma fonte unica;
- preserva quebras de linha da fonte;
- renderiza SVG runtime apenas quando o preview esta no DOM real;
- usa fallback textual quando a normalizacao roda sobre clone de serializacao.

Essa guarda e importante: durante a serializacao, `normalizeDiagrams(clone)`
nao deve montar React root nem SVG. Assim, o HTML persistido continua baseado
na fonte textual e em um preview leve derivado dela.

## Tipos Suportados

| Tipo        | Fonte esperada                                                                       | Preview atual                                                                                                         | Estado vazio/invalido                                        |
| ----------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `diagram`   | Relacoes `A -> B`, uma por linha.                                                    | SVG runtime horizontal com caixas e setas.                                                                            | Mensagens orientativas quando vazio ou sem relacoes validas. |
| `flowchart` | Relacoes `A -> B`, uma por linha.                                                    | SVG runtime vertical com caixas, setas e terminais simples.                                                           | Ainda usa fallback textual quando nao ha relacoes validas.   |
| `graph`     | Relacoes `A -> B` (direcionada) e `A -- B` (nao direcionada), uma ou mais por linha. | SVG runtime em grade deterministica; ciclos simples nao direcionados ganham layout circular com descricao matematica. | Fallback textual quando nao ha relacoes validas.             |

`diagram` e `flowchart` compartilham `parseDiagramSource`; `graph` usa o
parser proprio `parseGraphSource`, que aceita `->` e `--` e marca a direcao em
cada aresta. Os dois parsers ignoram linhas vazias, linhas invalidas, relacoes
malformadas e nos vazios. Nos sao deduplicados preservando a ordem de
aparicao; arestas direcionadas repetidas sao deduplicadas por sentido, e
arestas nao direcionadas tratam `A -- B` e `B -- A` como a mesma aresta. A
deteccao de ciclo simples vive em `notebookGraphAnalysis.ts`
(`detectSimpleCycle`) e e coberta por testes dedicados. A sintaxe completa
esta documentada em `docs/notebook-diagram-syntax.md`.

## Persistencia Leve

O HTML salvo deve conter apenas a estrutura do bloco, preview textual leve e
fonte editavel. O SVG existe apenas em runtime.

Pontos que preservam essa decisao:

- `serializeNotebookEditorHtml` clona o editor antes de normalizar;
- `renderReactDiagramPreview` so monta React quando `document.body.contains`
  confirma que o preview pertence ao DOM real;
- em clone de serializacao, o preview volta para texto derivado da fonte;
- imagens, anexos, equacoes e outros blocos ricos nao participam desse fluxo.

Risco principal: uma alteracao futura que renderize React/SVG sem respeitar a
guarda de DOM real pode persistir SVG pesado no HTML salvo.

## Tokens e Estilos Atuais

Tokens e variaveis ja usados no visual dos diagramas:

- `--notebook-diagram-accent`;
- `--color-primary`;
- `--primary`;
- `--color-border-subtle`;
- `--color-surface-card`;
- `--color-surface-muted`;
- `--color-text-primary`;
- `--color-text-secondary`;
- `--color-text-subtle`;
- `--notebook-editor-paragraph-gap`;
- a familia `--diagram-*` (card, preview, nos, arestas, setas, fonte).

Tipografia (Macrofase 8): as regras de diagrama nao usam mais `--font-body`
(que nunca foi definido) nem `font-family` hardcoded; a tipografia vem de:

- `--diagram-font-ui` (= `--font-sans`): nos de `diagram`, grade de `graph`,
  `flowchart`, titulos internos e placeholders;
- `--diagram-font-math` (= `--font-serif`, Lora): labels dos vertices do
  Cycle Graph e a descricao matematica (`Cn`, `V`, `E`);
- `--diagram-font-source` (IBM Plex Mono/Consolas/monospace): fonte editavel,
  exemplos de sintaxe e fallbacks textuais;
- `--diagram-node-font-size` e `--diagram-math-font-size`: tamanhos base dos
  labels SVG e da descricao matematica.

Cromia do Cycle Graph (Fase 8.4): a estrutura normal do ciclo usa tokens
neutros dedicados, todos centralizados em `src/styles/index.css`:

- `--diagram-cycle-ink` (= `--color-text-primary`);
- `--diagram-cycle-edge`;
- `--diagram-cycle-vertex-stroke`;
- `--diagram-cycle-vertex-fill`;
- `--diagram-cycle-vertex-label`;
- `--diagram-cycle-math-text`.

Esses tokens afetam apenas o Cycle Graph detectado em `graph`; `diagram`,
`flowchart` e a grade de `graph` continuam usando os tokens visuais gerais.

Escala manual (Fase 8.1): `data-diagram-scale` vira `transform: scale()`
inline no conteudo do frame React (nunca persistido); o bloco em si mantem
`width: min(100%, 52rem)`. A antiga `--notebook-diagram-width` foi aposentada
e e limpa pela normalizacao/serializacao.

## Estilos Hardcoded Encontrados

Em `src/styles/index.css`:

- largura do bloco: `min(100%, 52rem)`;
- `gap: 0.55em`;
- `border-radius: 8px`, `7px` e `5px`;
- paddings como `0.8em`, `0.75em 0.85em`, `0.5em 0.7em 0.6em`;
- alturas de preview: `min-height: 4.25rem`, SVG de diagrama com `5.25rem`,
  SVG de fluxograma com `height: min(15rem, 40vh)`;
- opacidades de linhas/setas entre `0.78` e `0.88`;
- `stroke-width: 2` para arestas e `1.5` para nos;
- texto SVG em `12px`;
- `letter-spacing: 0.08em`;
- sombra interna com `#FFFFFF`.

Em `NotebookDiagramPreview.tsx`:

- largura minima/maxima do no: `132` / `176`;
- altura do no: `44`;
- distancia entre nos: `56`;
- padding horizontal/vertical do SVG: `24` / `18`;
- limite de label: `20` caracteres;
- largura estimada de caractere: `7.2`;
- padding horizontal interno do no: `32`;
- inset da seta: `5`.

Em `NotebookFlowchartPreview.tsx`:

- largura minima/maxima do no: `156` / `220`;
- altura do no: `38`;
- distancia entre nos: `28`;
- padding horizontal/vertical do SVG: `30` / `16`;
- limite de label: `24` caracteres;
- largura estimada de caractere: `7`;
- padding horizontal interno do no: `34`;
- inset da seta: `5`;
- rota lateral simples com deslocamento fixo para arestas nao adjacentes.

Em `NotebookGraphPreview.tsx` (grade):

- layout em grade com ate 3 colunas;
- largura minima do no: `136`;
- altura do no: `42`;
- distancia entre colunas/linhas: `44` / `42`;
- padding horizontal/vertical do SVG: `28` / `20`;
- limite de label por quantidade de nos: `30`, `24` ou `20` caracteres;
- largura estimada de caractere: `7.1`;
- padding horizontal interno do no: `38`;
- inset da seta: `5`;
- altura visual maxima: `320`.

Em `NotebookGraphPreview.tsx` (layout circular de ciclo):

- raio do vertice (ponto): `5`;
- distancia entre vertice e label: `12` (+`4` para labels do topo/base);
- limite de label: `16` caracteres;
- corda minima entre vertices: `46`; raio do circulo derivado dela e limitado
  entre `64` e `168`;
- padding do viewBox: `18`;
- viewBox calculado a partir do raio, extensao dos labels e padding;
- altura visual maxima compartilhada com a grade: `320`;
- limite de `16` caracteres se aplica apenas ao label desenhado no SVG; o
  label completo (sem limite) e usado em `V`, `E` e no `<title>` de cada
  vertice.

Esses valores nao sao necessariamente errados; eles apenas ainda nao estao
centralizados como tokens de diagrama.

## Limitacoes Visuais Conhecidas

- `diagram` usa linha horizontal unica. Cadeias longas tendem a comprimir o
  desenho dentro do card.
- `flowchart` fica funcional, mas visualmente pequeno em fluxos com varias
  etapas por causa da altura limitada do SVG.
- Labels longos sao truncados corretamente, mas o truncamento ainda e
  agressivo.
- Ciclos, arestas cruzadas e relacoes nao adjacentes sao tratados de forma
  simples. O resultado e previsivel, mas nao tenta auto-layout.
- Arestas de um no para ele mesmo sao ignoradas no preview visual.
- `graph` usa grade deterministica simples; relacoes cruzadas e grafos densos
  continuam sem layout force-directed. A unica excecao e o ciclo simples nao
  direcionado, que ganha layout circular; ciclos direcionados, ciclos com
  cordas e ciclos parciais permanecem na grade.
- O layout circular foi pensado para 3 a ~12 vertices; acima disso o circulo
  continua correto, mas labels podem ficar densos.
- Diagram nao quebra automaticamente em multiplas linhas.
- Nao ha edicao visual de nos, drag and drop do bloco, rotacao ou resize livre
  por eixo.
- Nao ha suporte especializado para pesos, multigrafos, self-loops ou citacoes
  automaticas nesta fase.
- Estados vazio/invalido estao mais orientativos em `diagram` do que em
  `flowchart` e `graph`.
- Parte da legibilidade depende de `color-mix`; e bom manter validacao visual
  em claro/escuro antes de qualquer ajuste de contraste.
- Nao ha teste visual automatizado garantindo que o SVG nunca seja persistido,
  embora a implementacao atual tenha uma guarda clara para isso.

## Riscos Tecnicos de Alteracao

- **Serializacao:** qualquer mudanca em `renderReactDiagramPreview`,
  `normalizeDiagrams` ou `serializeNotebookEditorHtml` pode afetar a garantia
  de HTML leve.
- **Selecao e edicao da fonte:** `Shift + Enter`, entrada/saida do bloco e
  leitura de quebras de linha dependem da estrutura atual de
  `data-diagram-source`.
- **Toolbar contextual:** a toolbar depende de `findClosestDiagram`,
  `getDiagramKind` e `setDiagramKind`; mudancas no DOM podem quebrar o alvo
  atual da toolbar.
- **Parser compartilhado:** alteracoes em `parseDiagramSource` afetam
  simultaneamente `diagram` e `flowchart`.
- **Lifecycle React:** roots sao guardados em `WeakMap`; montar/desmontar
  previews fora desse fluxo pode gerar preview obsoleto ou custo desnecessario.
- **CSS por seletor data-\*:** renomear classes ou atributos quebra o estilo e
  tambem pode afetar serializacao.
- **Dark mode:** ajustes com hex direto podem criar divergencia entre temas e
  dificultar manutencao dos tokens.

## Matriz Trabalho x Resultado

| Melhoria avaliada                             | Trabalho | Resultado  | Risco | Prioridade | Observacao                                                                        |
| --------------------------------------------- | -------- | ---------- | ----- | ---------- | --------------------------------------------------------------------------------- |
| Tokens CSS especificos para diagramas         | baixo    | alto       | baixo | P0         | Centraliza cores, raios, strokes e alturas antes de mexer em detalhes visuais.    |
| Evitar persistir SVG no HTML salvo            | baixo    | muito alto | medio | P0         | Ja funciona; vale documentar/validar melhor para impedir regressao futura.        |
| Melhorar contraste das linhas/setas           | baixo    | alto       | baixo | P1         | Ajuste localizado em CSS, principalmente opacidade/stroke via token.              |
| Preparar dark mode sem duplicar hex           | baixo    | alto       | baixo | P1         | Deve aproveitar tokens existentes e evitar novos valores hardcoded.               |
| Melhorar espacamento interno dos cards        | baixo    | medio      | baixo | P1         | Pode melhorar leitura sem tocar parser nem persistencia.                          |
| Melhorar tipografia dos nos                   | baixo    | medio      | baixo | P1         | Ajustes de peso/tamanho precisam manter texto dentro das caixas.                  |
| Padronizar estados vazio/invalido             | baixo    | medio      | baixo | P1         | Bom candidato para alinhar `flowchart` e, depois, `graph` ao estado de `diagram`. |
| Melhorar responsividade do SVG dentro do card | medio    | alto       | medio | P1         | Exige cuidado com viewBox, altura e escala para nao piorar fluxos longos.         |
| Reduzir truncamento agressivo de labels       | medio    | alto       | medio | P1         | Pode envolver largura de no, limite por tipo e tooltip/titulo acessivel.          |
| Melhorar escala do flowchart em fluxos longos | medio    | alto       | medio | P1         | Candidato forte depois dos tokens; precisa preservar previsibilidade.             |
| Criar preview visual para `graph`             | alto     | muito alto | alto  | P2         | Concluido na Fase 6D com sintaxe `A -> B` e layout em grade deterministica.       |

Prioridade sugerida:

- **P0:** proteger decisoes estruturais ja validadas e criar base de tokens.
- **P1:** ajustes visuais pequenos, reversiveis e sem mudanca de persistencia.
- **P2:** novos previews ou mudancas de layout mais amplas.
- **P3:** refinamentos cosmeticos sem impacto claro na leitura.

## Recomendacao

A recomendacao original da auditoria era executar a **Fase 6B - Tokens visuais
de diagramas e ajustes nao destrutivos no preview SVG**. Depois dela, a
**Fase 6C - Ajustes responsivos e estados consistentes para diagramas** foi
parcialmente executada no eixo de escala e legibilidade, e a **Fase 6D -
Preview visual runtime para graph** adicionou SVG runtime para `graph`. A
**Fase 6E - Polimento visual e modo limpo runtime** suavizou o bloco e adicionou
um toggle visual temporario na toolbar contextual. O escopo seguro foi mantido:

- tokens CSS de diagrama foram adicionados no tema global;
- `diagram`, `graph` e `flowchart` passaram a usar tokens para card, preview, nos,
  bordas, linhas, setas, textos e fonte;
- `diagram` passou a ajustar limite de label e largura maxima por quantidade
  de nos;
- `flowchart` passou a usar altura SVG runtime proporcional ao conteudo, com
  teto para manter o card contido;
- `graph` passou a usar `parseGraphSource`, com `A -> B` direcionado, `A -- B`
  nao direcionado, grade deterministica para grafos fora do ciclo e layout
  circular para ciclos simples nao direcionados;
- o modo limpo oculta a fonte visualmente e suaviza bordas internas apenas em
  runtime;
- o HTML persistido permanece leve, sem SVG runtime; o paste interno de
  diagramas e sanitizado e preserva tipo, fonte e escala;
- fontes de `graph` sem relacoes validas continuam no fallback textual.

Encerramento da Fase 7.2: `Diagram`, `Graph`, `Cycle Graph` e `Flowchart`
estao funcionalmente concluidos para o escopo atual.

Observacoes para manutencao futura:

- qualquer evolucao de parser deve preservar `parseDiagramSource` como contrato
  compartilhado de `diagram` e `flowchart`;
- qualquer evolucao de layout deve manter SVG runtime fora do HTML persistido;
- novos recursos como force-directed, edicao visual, drag and drop, rotacao,
  resize por eixo, pesos, multigrafos, self-loops especializados ou citacoes
  automaticas devem ser tratados como fases novas, nao como continuidade deste
  encerramento.
