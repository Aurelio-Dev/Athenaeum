# Auditoria Visual dos Diagramas do Notebook

Data: 06/07/2026

Escopo desta fase: auditoria técnica e visual dos blocos
`data-athenaeum-block="diagram"` no editor de Cadernos. Este documento nao
altera comportamento, persistencia, autosave, selecao/range, paste, clipboard,
assets, anexos, equacoes, callouts ou toolbars.

## Arquivos Mapeados

| Arquivo | Papel atual | Observacoes |
| --- | --- | --- |
| `src/features/notebooks/notebookEditorDiagramDom.ts` | Normalizacao DOM, leitura da fonte textual, render runtime do preview e migracao de figuras antigas para o bloco unificado. | Contem o ponto mais sensivel: decide entre SVG runtime, fallback textual e estados vazio/invalido. |
| `src/features/notebooks/notebookDiagramParser.ts` | Parser puro de relacoes `A -> B`. | Compartilhado por `diagram`, `graph` e `flowchart`; ja possui testes minimos com Vitest. |
| `src/features/notebooks/NotebookDiagramPreview.tsx` | Preview SVG runtime para `data-diagram-kind="diagram"`. | Layout horizontal deterministico, sem biblioteca externa. |
| `src/features/notebooks/NotebookGraphPreview.tsx` | Preview SVG runtime para `data-diagram-kind="graph"`. | Layout em grade deterministica, sem force-directed, canvas ou biblioteca externa. |
| `src/features/notebooks/NotebookFlowchartPreview.tsx` | Preview SVG runtime para `data-diagram-kind="flowchart"`. | Layout vertical deterministico, com tratamento visual simples para inicio/fim. |
| `src/features/notebooks/notebookEditorUtils.ts` | Tipos, labels, fontes default, previews vazios e type guards. | Define `DiagramKind`, `diagramKindLabels`, `diagramDefaultSources`, `diagramEmptyPreviews` e `isDiagramKind`. |
| `src/features/notebooks/NotebookPageEditor.tsx` | Integracao com insercao, toolbar contextual, serializacao, autosave e handlers de teclado. | Deve continuar sendo tocado com muito cuidado; os pontos de diagrama estao bem localizados. |
| `src/styles/index.css` | Visual dos blocos ricos e do SVG runtime. | Concentra a maior parte dos tokens CSS e tambem varios tamanhos/espacamentos hardcoded. |

## Registro de Fases

| Fase | Status | Escopo | Resultado | Validacao |
| --- | --- | --- | --- | --- |
| Diagrama 1 | Concluida | Base unificada `data-athenaeum-block="diagram"` com `data-diagram-kind`, fonte textual e preview textual. | Criou a estrutura persistida leve para `diagram`, `graph` e `flowchart`. | Validacao manual de insercao, edicao e persistencia. |
| Diagrama 2 | Concluida | Preview SVG runtime para `data-diagram-kind="diagram"` usando relacoes `A -> B`. | `diagram` passou a renderizar nos e setas em SVG sem persistir SVG no HTML salvo. | `npm run typecheck` e validacao visual dos cenarios principais. |
| Diagrama 2B | Concluida | Refinamento do SVG de `diagram`: linha da aresta visivel, multiplas relacoes no mesmo bloco e fonte unica multiline. | Corrigiu casos como `Entrada -> Saida` e cadeias com varias linhas. | `npm run typecheck` e `git diff --check`. |
| Diagrama 2C | Concluida | Estados de UX para fonte vazia ou sem relacoes validas em `diagram`. | Preview passou a orientar o usuario sem alterar a fonte textual nem a persistencia. | `npm run typecheck` e `git diff --check`. |
| Diagrama 3 | Concluida | Preview SVG runtime para `data-diagram-kind="flowchart"` com a mesma sintaxe `A -> B`. | Fluxogramas passaram a renderizar etapas e setas em SVG; `graph` permaneceu textual. | `npm run typecheck`, `git diff --check` e validacao visual. |
| Fase 5A | Concluida | Testes unitarios para `parseDiagramSource` com Vitest. | Cobertura minima para texto vazio, linhas invalidas, multiplas relacoes, Unicode e nos malformados. | `npm test -- --run` e `npm run typecheck`. |
| Fase 6A | Concluida | Auditoria tecnica e visual sem alterar comportamento. | Este documento mapeou arquitetura, riscos, hardcoded visual, limitacoes e matriz trabalho x resultado. | Apenas documentacao. |
| Fase 6B | Concluida | Tokens visuais de diagramas e ajustes nao destrutivos nos previews SVG. | `src/styles/index.css` recebeu tokens para card, preview, nos, linhas, setas, textos, fonte e estados discretos. | `npm run typecheck`, `npm test -- --run` e `git diff --check`. |
| Fase 6C | Concluida | Ajuste de escala, responsividade e legibilidade dos previews SVG existentes. | `diagram` ganhou truncamento menos agressivo em diagramas pequenos; `flowchart` ganhou nos mais largos e altura runtime proporcional com teto seguro. | `npm run typecheck`, `npm test -- --run` e `git diff --check`. |
| Fase 6D | Concluida | Preview SVG runtime para `data-diagram-kind="graph"`. | `graph` passou a renderizar relacoes `A -> B` em grade deterministica, usando os mesmos tokens visuais de diagramas; fontes invalidas ou legadas seguem no fallback textual. | `npm run typecheck`, `npm test -- --run` e `git diff --check`. |
| Fase 6E | Concluida | Polimento visual conjunto e modo limpo runtime. | Bordas, fonte, titulos internos, labels SVG e espacamentos foram suavizados; a toolbar contextual ganhou `Modo limpo`, que oculta `Fonte` apenas em runtime sem salvar estado no bloco. | `npm run typecheck`, `npm test -- --run` e `git diff --check`. |
| Fase 6E.1 | Concluida | Hotfix do modo limpo e cadeias em linha unica. | O botao `Modo limpo` foi movido da toolbar de callout para a toolbar contextual de diagrama, e `parseDiagramSource` passou a aceitar cadeias como `Elemento A -> Elemento B -> Elemento C`. | `npm run typecheck`, `npm test -- --run` e `git diff --check`. |
| Fase 6E.2 | Concluida | Refinamento minimalista do modo limpo. | No modo limpo, o titulo interno do preview e ocultado, a moldura principal do preview e removida e o bloco fica mais editorial, mantendo nos, setas e conexoes visiveis. | `npm run typecheck`, `npm test -- --run` e `git diff --check`. |

Ressalvas mantidas apos a Fase 6E.2:

- `graph` agora tem preview SVG runtime para relacoes `A -> B`, mas fontes
  legadas no formato textual antigo, como `A -- B`, seguem no fallback textual.
- O `Modo limpo` e global do editor enquanto a pagina esta aberta; ele nao e
  persistido em `data-*`, `app_settings` ou HTML salvo.
- No modo limpo, o titulo interno e a area `Fonte` somem visualmente, mas a
  fonte textual segue no DOM editavel e volta ao desativar o modo.
- Cadeias em linha unica no formato `A -> B -> C` sao expandidas em relacoes
  consecutivas; linhas legadas `A -- B` seguem no fallback textual/invalido.
- `flowchart` ficou mais legivel em fluxos de 4 a 8 etapas, mas fluxos muito
  longos ainda precisam reduzir escala para caber no card.
- Labels longos truncam de forma menos agressiva, mas continuam truncados para
  proteger o layout.
- Nao ha auto-layout avancado para ciclos, bifurcacoes complexas ou arestas
  cruzadas.
- O SVG continua sendo runtime; a decisao de nao persistir SVG no HTML salvo
  permanece obrigatoria.

## Arquitetura Atual

O Notebook usa uma base unica para diagramas:

- bloco persistido como `figure[data-athenaeum-block="diagram"]`;
- tipo definido por `data-diagram-kind="diagram" | "graph" | "flowchart"`;
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

| Tipo | Fonte esperada | Preview atual | Estado vazio/invalido |
| --- | --- | --- | --- |
| `diagram` | Relacoes `A -> B`, uma por linha. | SVG runtime horizontal com caixas e setas. | Mensagens orientativas quando vazio ou sem relacoes validas. |
| `flowchart` | Relacoes `A -> B`, uma por linha. | SVG runtime vertical com caixas, setas e terminais simples. | Ainda usa fallback textual quando nao ha relacoes validas. |
| `graph` | Relacoes `A -> B`, uma por linha. | SVG runtime em grade deterministica com caixas e setas. | Fallback textual quando nao ha relacoes validas. |

`diagram`, `graph` e `flowchart` compartilham `parseDiagramSource`. O parser
ignora linhas vazias, linhas invalidas, relacoes malformadas e nos vazios. Nos
sao deduplicados preservando a ordem de aparicao, e arestas repetidas tambem
sao deduplicadas.

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
- `--font-body`.

Hoje `--notebook-diagram-accent` e definido dentro do proprio bloco como
`var(--color-primary, var(--primary))`. Isso ajuda a herdar tema, mas ainda nao
ha uma camada de tokens especificos para:

- cor da linha/seta;
- fill do no;
- stroke do no;
- raio dos nos;
- altura do preview SVG;
- largura minima/maxima dos nos;
- truncamento de label;
- espacamento interno do card.

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

Em `NotebookGraphPreview.tsx`:

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
- `graph` usa grade deterministica simples; relacoes cruzadas, ciclos e
  grafos densos continuam sem layout force-directed.
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
- **CSS por seletor data-*:** renomear classes ou atributos quebra o estilo e
  tambem pode afetar serializacao.
- **Dark mode:** ajustes com hex direto podem criar divergencia entre temas e
  dificultar manutencao dos tokens.

## Matriz Trabalho x Resultado

| Melhoria avaliada | Trabalho | Resultado | Risco | Prioridade | Observacao |
| --- | --- | --- | --- | --- | --- |
| Tokens CSS especificos para diagramas | baixo | alto | baixo | P0 | Centraliza cores, raios, strokes e alturas antes de mexer em detalhes visuais. |
| Evitar persistir SVG no HTML salvo | baixo | muito alto | medio | P0 | Ja funciona; vale documentar/validar melhor para impedir regressao futura. |
| Melhorar contraste das linhas/setas | baixo | alto | baixo | P1 | Ajuste localizado em CSS, principalmente opacidade/stroke via token. |
| Preparar dark mode sem duplicar hex | baixo | alto | baixo | P1 | Deve aproveitar tokens existentes e evitar novos valores hardcoded. |
| Melhorar espacamento interno dos cards | baixo | medio | baixo | P1 | Pode melhorar leitura sem tocar parser nem persistencia. |
| Melhorar tipografia dos nos | baixo | medio | baixo | P1 | Ajustes de peso/tamanho precisam manter texto dentro das caixas. |
| Padronizar estados vazio/invalido | baixo | medio | baixo | P1 | Bom candidato para alinhar `flowchart` e, depois, `graph` ao estado de `diagram`. |
| Melhorar responsividade do SVG dentro do card | medio | alto | medio | P1 | Exige cuidado com viewBox, altura e escala para nao piorar fluxos longos. |
| Reduzir truncamento agressivo de labels | medio | alto | medio | P1 | Pode envolver largura de no, limite por tipo e tooltip/titulo acessivel. |
| Melhorar escala do flowchart em fluxos longos | medio | alto | medio | P1 | Candidato forte depois dos tokens; precisa preservar previsibilidade. |
| Criar preview visual para `graph` | alto | muito alto | alto | P2 | Concluido na Fase 6D com sintaxe `A -> B` e layout em grade deterministica. |

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
- `graph` passou a usar `parseDiagramSource` e layout em grade deterministica
  para relacoes `A -> B`;
- o modo limpo oculta a fonte visualmente e suaviza bordas internas apenas em
  runtime;
- o parser, o HTML persistido, o autosave, o paste, a selecao/range e a toolbar
  contextual nao foram alterados;
- fontes de `graph` sem relacoes validas continuam no fallback textual.

Proxima fase pequena sugerida:

**Fase 6F - Estados consistentes e validacao visual dos diagramas**

Escopo recomendado:

- padronizar estados vazio/invalido entre `diagram`, `flowchart` e `graph`;
- documentar exemplos curtos para cada tipo no proprio bloco ou na ajuda futura;
- validar visualmente `diagram`, `graph` e `flowchart` em claro/escuro;
- manter SVG runtime fora do HTML persistido;
- nao alterar parser, autosave, selecao/range, paste, assets ou toolbar.

Validacao minima da Fase 6F:

- `diagram` simples e com multiplas relacoes continua renderizando igual;
- `graph` com 2 a 8 nos continua contido no card;
- `flowchart` de 4 a 8 etapas continua legivel;
- modo limpo continua ocultando apenas a fonte, sem remover preview, nos,
  setas ou conexoes;
- conteudo invalido continua seguro e orientativo;
- HTML salvo continua sem SVG runtime;
- `npm run typecheck`, `npm test -- --run` e `git diff --check` passam.
