# Athenaeum — Tokens de Cor (Tags, Badges, Texto Secundário)

> **Changelog 07/07/2026 — Caderno, painel Detalhes e toolbar do editor:**
> a rodada de UI do Caderno deixou a sidebar `Detalhes` mais robusta, com
> status de leitura visual, descrição, campo de autor/disciplina reposicionado,
> `+ Tag` no mesmo padrão do painel de documentos, menu `Mais opções` fixo no
> rodapé e botão de opções também no cabeçalho. O menu ganhou ações reais para
> renomear, mover para coleção, fixar nos favoritos, contagem detalhada e mover
> para a lixeira, mantendo placeholders desabilitados onde ainda não há lógica.
> O editor também reorganizou a toolbar: `Link`, `Anexar` e `PDF` ficaram como
> botões diretos; `Inserir` concentra Tabela, Callout, Imagem, Equação,
> Separador e Diagramas; `Layout` concentra Alinhamento e Espaçamento; e `...`
> ficou restrito a manutenção de formatação (`Limpar formatação` e `Remover
> link`). Não houve alteração de tokens de cor, paleta de tags, tipografia,
> tema claro/escuro ou formato HTML persistido.
>
> **Changelog 06/07/2026 — Tela inicial e painel Detalhes:** a rodada de UI
> da Home ajustou tokens de texto e previews sem mudar o accent principal nem
> a paleta de tags. `sidebar-text` passou a usar `#2C1810` no modo claro e
> `#F0E8DF` no modo escuro, cobrindo o título `Athenaeum`, o nome da coleção
> ativa, o título da coleção aberta e itens selecionados da sidebar. O token
> `sidebar-muted` foi fechado em `#7A6558` no claro e `#9E8878` no escuro para
> itens não selecionados. No tema escuro, `foreground` e `card-foreground`
> também foram alinhados para `#F0E8DF` para manter consistência com os títulos
> fortes da biblioteca e do painel `Detalhes`. As miniaturas de documento
> deixaram de usar uma cor fixa pronta por documento e passaram a usar um hue
> determinístico com luminância por tema: capa clara em
> `hsl(hue 28% 74%)`, capa escura em `hsl(hue 30% 18%)`, com linhas internas
> derivadas do mesmo hue. Não houve mudança em `accent-interactive`, nos tokens
> de tag ou no mapeamento palavra-chave → cor.
>
> **Changelog técnico 06/07/2026 — Diagramas no Notebook:** as Fases
> 6A, 6B, 6C, 6D, 6E, 6E.1 e 6E.2 consolidaram a auditoria e o refinamento visual dos previews
> SVG runtime de `data-athenaeum-block="diagram"`. A Fase 6A criou
> `docs/diagram-visual-audit.md` com arquitetura, riscos, hardcoded visual,
> matriz trabalho x resultado e ressalvas. A Fase 6B adicionou tokens CSS
> específicos para diagramas em `src/styles/index.css`, cobrindo card,
> preview, nós, linhas, setas, textos, fonte e estados discretos sem criar
> paleta paralela. A Fase 6C ajustou escala e legibilidade dos previews:
> `diagram` passou a adaptar limite de label/largura máxima pela quantidade
> de nós, enquanto `flowchart` ganhou nós mais largos e altura runtime
> proporcional com teto seguro. A Fase 6D adicionou preview visual runtime
> para `data-diagram-kind="graph"` em `NotebookGraphPreview.tsx`, usando
> `parseDiagramSource` com relações `A -> B`, layout em grade determinística
> e os mesmos tokens visuais; fontes inválidas ou legadas continuam no
> fallback textual. A Fase 6E suavizou bordas, fonte, títulos internos,
> labels SVG e espaçamentos, além de adicionar `Modo limpo` runtime na toolbar
> contextual de diagrama para ocultar visualmente `Fonte` sem salvar estado no
> bloco. A Fase 6E.1 corrigiu o botão, que havia entrado na toolbar de Callout,
> e passou a aceitar cadeias em linha única como `A -> B -> C`, mantendo
> `A -- B` no fallback textual/inválido. A Fase 6E.2 refinou o Modo limpo para
> um visual mais editorial: o título interno do preview e a moldura principal
> somem visualmente, a área `Fonte` continua oculta e nós, setas e conexões
> permanecem legíveis. O SVG continua apenas runtime; o HTML salvo permanece
> leve e sem SVG persistido. Não foram alterados autosave, paste,
> seleção/range, backend, migrations ou dependências.
>
> **Update técnico 06/07/2026:** refatoração incremental do
> `NotebookPageEditor.tsx` sem mudança de comportamento. A Fase 1 extraiu
> ícones e metadata estática da toolbar/menu para
> `notebookEditorToolbar.tsx`; a Fase 2 extraiu constants, allowlists,
> type guards e formatadores puros para `notebookEditorUtils.ts`. Foram
> preservados handlers, seleção/range, autosave, paste, HTML persistido,
> atributos `data-*`, toolbars contextuais, imagens/assets, anexos, tabelas,
> callouts, equações e diagramas.
>
> **Update Fase 3A:** helpers DOM específicos de anexos foram isolados em
> `notebookEditorAttachmentDom.ts`, mantendo no editor os handlers e a ação
> assíncrona de remoção. A normalização do card, os controles `Abrir`,
> `Mostrar no sistema`/`Remover`, a limpeza dos controles antes da serialização
> e a localização segura do bloco de anexo seguem com o mesmo HTML persistido
> e os mesmos atributos `data-*`.
>
> **Update Fase 3B:** helpers DOM de `Diagrama/Grafo/Fluxograma` foram
> isolados em `notebookEditorDiagramDom.ts`. A normalização de blocos legados,
> a detecção de `data-athenaeum-block="diagram"`, a atualização de
> `data-diagram-kind`, a fonte editável e o preview textual continuam com o
> mesmo HTML persistido e sem renderizador visual novo. Inserção, seleção,
> autosave, paste, remoção e toolbar contextual permanecem no editor.
>
> **Update Fase 3C:** helpers DOM de `Callout` foram isolados em
> `notebookEditorCalloutDom.ts`. A detecção de
> `data-athenaeum-block="callout"`, a leitura/atualização de
> `data-callout-type`, a atualização do ícone e a normalização da estrutura
> interna (`data-callout-icon` e `data-callout-content`) seguem com os mesmos
> atributos e HTML persistido. Inserção, remoção, seleção, autosave, paste e
> toolbar contextual permanecem no editor.
>
> **Update Fase 3D:** helpers DOM de `Equação` foram isolados em
> `notebookEditorEquationDom.ts`. A detecção de
> `data-athenaeum-block="equation"`, a fonte `data-equation-source`, o preview
> `data-equation-preview`, a normalização de blocos incompletos e a limpeza do
> HTML renderizado antes da serialização seguem com os mesmos atributos e HTML
> persistido. A renderização KaTeX mantém `displayMode: true`,
> `throwOnError: false` e `trust: false`; inserção, remoção, seleção, autosave,
> paste e toolbar contextual permanecem no editor.
>
> **Update Fase 3E:** helpers DOM de `Figura/Imagem` foram isolados em
> `notebookEditorFigureDom.ts`. A hidratação runtime de
> `img[data-notebook-asset-id]` e a remoção do `src` antes da serialização
> seguem preservando o HTML salvo sem `data:image`, mantendo no editor os fluxos
> de clipboard, seletor de arquivo, `saveNotebookAsset`, `loadNotebookAssets`,
> seleção, autosave, paste e toolbars.
>
> **Update Diagrama SVG:** `data-diagram-kind="diagram"` ganhou preview visual
> runtime em SVG, sem dependência externa e sem alterar o HTML persistido. A
> fonte textual continua em `data-diagram-source`; relações `origem -> destino`
> são parseadas por `notebookDiagramParser.ts` e renderizadas por
> `NotebookDiagramPreview.tsx` como caixas conectadas por setas. Labels longos
> têm truncamento visual seguro, o SVG fica contido no card existente e casos
> inválidos continuam caindo no fallback textual. `graph` e `flowchart` seguem
> com o preview textual anterior.
>
> **Update Diagrama SVG multiline:** fontes com múltiplas relações no mesmo
> bloco agora são consolidadas como uma única área `data-diagram-source`, com
> suporte a `Shift+Enter` para quebra de linha dentro da fonte. O preview passa
> a renderizar todas as relações válidas do texto completo, por exemplo
> `Entrada -> Processamento -> Saída -> Revisão` como 4 nós e 3 setas. A linha
> da aresta usa `stroke` com token válido e `marker-end` para manter seta
> visível. Limitação conhecida: ciclos são aceitos pelo parser, mas ainda não
> são representados como curva/retorno visual.
>
> **Update Diagrama SVG estados:** o preview de
> `data-diagram-kind="diagram"` agora diferencia fonte vazia e fonte sem
> relações válidas, exibindo mensagens curtas com exemplo de sintaxe
> (`Entrada -> Processamento` / `Processamento -> Saída`). Quando há ao menos
> uma relação válida, o SVG runtime continua inalterado; linhas inválidas
> misturadas com válidas seguem sendo ignoradas com segurança. O HTML persistido
> permanece leve e `graph`/`flowchart` continuam com preview textual.
>
> **Update Diagrama 3:** `data-diagram-kind="flowchart"` ganhou preview visual
> runtime em SVG com sintaxe simples `A -> B`, reutilizando o parser de relações
> e mantendo `graph` no preview textual. O layout do fluxograma é vertical e
> determinístico, com nós terminais arredondados para `Início`/`Fim`; o HTML
> persistido segue leve, sem SVG runtime.
>
> **Ressalvas futuras (não bloqueiam MVP):** o preview de `flowchart` está
> funcional, mas visualmente pequeno em fluxos com várias etapas. Labels longos
> são truncados corretamente, mas o truncamento ainda está agressivo.
>
> **Update Fase 5A:** o parser `parseDiagramSource` ganhou cobertura mínima
> com Vitest. Os testes cobrem texto vazio, linhas vazias, relação simples,
> múltiplas relações, ordem de nós únicos, linhas inválidas, mistura de linhas
> válidas/inválidas, labels com acentos/Unicode e relações malformadas sem nós
> vazios. O parser permanece sem mudança de comportamento.
>
> ### Segurança / Dependências
>
> - Investigado `npm audit`: 9 vulnerabilidades reportadas, sendo 8 moderate e
>   1 high.
> - A origem principal está em dependências transitivas de
>   `@excalidraw/excalidraw@0.18.1`, especialmente
>   `@excalidraw/mermaid-to-excalidraw`, `@mermaid-js/parser`, `langium`,
>   `chevrotain`, `lodash-es` e `nanoid`.
> - `npm audit --omit=dev` reporta o mesmo conjunto, então o problema não vem
>   do Vitest.
> - `npm audit fix --force` foi descartado porque faria downgrade para
>   `@excalidraw/excalidraw@0.17.6`, com breaking change.
> - Decisão: manter como risco conhecido e reavaliar quando houver nova versão
>   do Excalidraw ou de suas dependências transitivas.

> **Update técnico 05/07/2026:** revisão de regressões da categoria `Inserir`
> no editor de Cadernos. Blocos ricos vazios (`Tabela`, `Callout`, `Diagrama`,
> `Equação`, `Figura` e `Arquivo`) agora contam como conteúdo real para não
> exibir placeholder sobre blocos inseridos. A inserção de blocos passa a
> reposicionar o cursor na linha vazia criada após o elemento, evitando que o
> caret volte para o bloco anterior. No Windows, `Mostrar no sistema` para
> anexos usa o caminho canonizado e chama o Explorer com `/select,` separado
> do arquivo para evitar abrir uma pasta incorreta quando há espaços no path.
> O visual de `Diagrama/Grafo/Fluxograma` também foi refinado para parecer um
> card único, com preview e fonte no mesmo contêiner. Limitações mantidas:
> diagramas seguem como prévia textual, sem SVG/canvas/renderizador visual.

> **Changelog técnico 05/07/2026:** `Inserir > Figura > Diagrama`,
> `Diagrama de grafo` e `Fluxograma` no editor de Cadernos agora usam uma
> base única de bloco (`data-athenaeum-block="diagram"`) com
> `data-diagram-kind="diagram" | "graph" | "flowchart"`. Cada bloco persiste
> HTML leve com prévia textual, fonte editável em texto puro e toolbar
> contextual para trocar o tipo ou remover o bloco. A implementação também
> normaliza placeholders antigos de figura/diagrama para o novo formato.
> Limitação conhecida: esta fase ainda não renderiza SVG/canvas nem usa
> biblioteca externa de diagramas; a prévia é textual e serve como base
> confiável para um renderizador visual futuro.

> **Changelog técnico 05/07/2026:** `Inserir > Arquivo` no editor de
> Cadernos deixou de ser placeholder e ganhou persistência inicial de anexos.
> A migration `v18` cria `notebook_file_attachments`; os bytes ficam em
> `notebook-attachments/{notebookId}/{pageId}/{attachmentId}/`, enquanto o
> HTML da página salva apenas `data-notebook-attachment-id`, sem base64 nem
> caminho absoluto. O backend valida IDs/nome de arquivo, aplica limite de
> 4MB, usa escrita temp+rename e registra metadados no SQLite.
>
> **Update 05/07/2026:** cards de anexo agora exibem ações `Abrir`,
> `Mostrar no sistema` e `Remover`. Essas ações enviam somente `attachmentId`
> ao backend, que busca `file_path` no banco antes de abrir/revelar/remover;
> ao remover, o registro é excluído e o arquivo físico é apagado quando ainda
> existe. Limitações conhecidas: ainda não há preview de PDF/imagem/vídeo,
> busca em anexos, múltiplos uploads, drag and drop, deduplicação por hash,
> limpeza global de órfãos ou sincronização em nuvem.

> **Changelog 05/07/2026:** a tela de Caderno foi reestruturada para uma
> experiência de editor em três áreas: trilho/lista de páginas à esquerda,
> editor central responsivo e drawer de detalhes à direita. O header agora
> usa breadcrumb centralizado (`Minha Biblioteca > Coleção > Caderno`), o
> painel de detalhes passou a exibir `Caderno`, `Coleção`, `Status de leitura`,
> `PDFs vinculados`, `Tags`, `Autor / disciplina`, `Criado`, `Atualizado` e
> `Última abertura`, e o footer do editor ganhou contagem de palavras/caracteres,
> modo `Foco` e zoom com presets. O modo Foco esconde laterais, centraliza o
> texto, usa toolbar reduzida (`Texto`, `Inserir`, `Mais opções`) e permite
> espaçamento independente (`Compacto`, `Normal`, `Confortável`, `Amplo`) para
> leitura/escrita longa. A toolbar normal também ganhou `Espaçamento` no menu
> `...`.
>
> **Changelog técnico 05/07/2026:** Cadernos ganharam tags próprias,
> metadados adicionais, PDFs vinculados e assets persistentes em disco. As
> migrations `v15`, `v16` e `v17` criam `notebook_tags`,
> `notebook_linked_documents`, `reading_status`, `author_discipline` e
> `notebook_assets`. Imagens coladas ou inseridas por `Inserir > Figura >
> Imagem` são salvas em `notebook-assets/{notebookId}/{pageId}/` via
> `save_notebook_asset`, com allowlist PNG/JPEG/WebP/GIF, limite de 4MB,
> escrita temp+rename e proteção contra path traversal; o HTML da página salva
> apenas `data-notebook-asset-id`, sem `src="data:image..."`. O editor também
> passou a suportar tabelas editáveis com navegação por Tab, callouts com tipos
> `Info`, `Dica`, `Atenção` e `Perigo`, links com Ctrl+clique, e equações com
> fonte LaTeX editável renderizada por **KaTeX** (`throwOnError: false`,
> `trust: false`). Limitações conhecidas: KaTeX cobre preview matemático de
> bloco, ainda sem equação inline, numeração automática, referência cruzada ou
> macros globais persistentes; assets SVG, múltiplos uploads, drag and drop,
> compressão e galeria de assets ficam para etapas futuras.

> **Changelog 05/07/2026:** o painel de Ajustes passou a organizar as
> preferências em navegação lateral (`Geral`, `Aparência`, `Biblioteca`,
> `Avançado`) e ganhou a opção `Linhas divisórias`, persistida em
> `app_settings` (`show_divider_lines`), que oculta visualmente bordas/
> separadores sem remover a estrutura dos componentes. A seção de tags
> da sidebar de detalhes também foi refinada: pílulas e botões usam o
> mesmo raio do `+ Tag`, o dropdown fica contido na largura do painel, o
> texto dos inputs mantém contraste no modo escuro, a lixeira interna do
> seletor foi removida e o `x` flutuante das tags aplicadas permanece.
> Cards e detalhes agora compartilham o mesmo resolvedor de cor, usando
> os tokens existentes (`violet`, `indigo`, `blue`, `teal`, `rose`,
> `amber`) sem criar novos hex. Clique simples em uma tag aplicada cicla
> entre esses tons e persiste em `tags.color_token`; duplo clique renomeia
> inline e preserva o tom quando o novo nome ainda não existe. Limitação:
> a troca de cor é global por tag, não por documento; renomear para uma
> tag já existente assume a cor já registrada dessa tag.

> **Changelog 04/07/2026:** o painel de Ajustes ganhou seleção funcional
> de variante do ícone do app (`Frontão` / `Coluna`). Os previews agora
> usam SVG inline compartilhado com a marca da sidebar, removendo o antigo
> `column-icon.svg` externo renderizado via `mask-image` (que no WebView
> podia aparecer como bloco sólido). A seleção persiste em `app_settings`
> (`icon_variant`) e passa por um provider global, então sidebar e painel
> respondem juntos à troca. Limitação conhecida: a aplicação também tenta
> trocar o ícone da janela/taskbar via API runtime do Tauri, mas o ícone do
> executável, instalador e atalhos continua sendo o definido em build-time
> pelo `src-tauri/tauri.conf.json`/`src-tauri/icons/*`; no Windows, o shell
> ainda pode manter cache visual do ícone nativo até reiniciar/reinstalar.

> **Nota conhecida (03/07/2026):** o popup "Mais ferramentas" do Quadro
> mostra 4 itens em inglês (Web Embed, Laser pointer, Generate, Mermaid
> to Excalidraw) — traduções ausentes no locale pt-BR da própria lib
> @excalidraw/excalidraw@0.18.1, mesmo com a cobertura geral do idioma
> em 91%. Aceito como limitação conhecida: baixa visibilidade (exige
> abrir o popup), e esconder via CSS adicionaria fragilidade
> desproporcional ao ganho. Reavaliar apenas se a lib atualizar a
> tradução, ou se decidirmos contribuir a tradução faltante ao projeto
> Excalidraw upstream.

> **Changelog 03/07/2026:** revisão de decisão — o header dos painéis
> flutuantes (Quadro/Caderno/Leitor) deixou de ser fixo em `#14161F`
> independente do tema. Agora acompanha o tema do app via os tokens
> `--floating-header-*` e `--reader-header-*` (claro: fundo `var(--card)`
> = `#FAF5EF`; escuro: `var(--card)` = `#231C16`). O token `--surface-header`
> (`#14161F`) continua existindo no código mas não é mais usado nesses
> headers — mantido apenas por compatibilidade até uma limpeza futura
> remover as referências órfãs, se houver.

> **Changelog 03/07/2026:** adicionado token `accent-tint-bg` (#EFE2D8) —
> fundo de destaque para ferramenta ativa na toolbar de Quadros, extraído
> por amostragem de pixel do protótipo Claude Design em 03/07/2026.

> Referência de design system. Validado em WCAG AA (contraste mínimo
> 4.5:1, critério de texto pequeno) via fórmula de luminância relativa
> do WCAG. Última atualização: 01/07/2026.
>
> **Changelog 01/07/2026:** (4) `accent-interactive` trocado de indigo
> (`#4F46E5`/`#6366F1`) para terracota/cobre (`#9C5A2E`) — hue do
> indigo estava a apenas ~20–25° do Violet das tags, causando colisão
> visual no dark mode onde ambos eram as únicas cores saturadas da
> tela. Terracota validado: contraste texto branco 5.36:1. Mesmo hex
> nos dois modos (sem variante dark separada). Aplicado em: ícone do
> logo, botão "+ Adicionar", barra de progresso de leitura, toggle de
> painel ativo, aba ativa no painel de anotações.
>
> **Changelog 30/06/2026:** (1) texto secundário estava com contraste
> abaixo do mínimo no modo claro real do app (~3.9–4.1:1, medido por
> amostragem de pixel no protótipo "Redesign Library View" do Figma
> Make) — corrigido. (2) O protótipo adotou pílulas de tag com
> **fill sólido** (bg saturado + texto branco) em vez do pastel
> original — este documento agora registra os dois estilos, com o
> fill sólido marcado como padrão atual de produção. (3) mapeamento
> palavra-chave→cor expandido: o rascunho de 20/06 só cobria um
> acervo de CS/IA; o protótipo real trouxe 21 palavras-chave
> diferentes (Philosophy of Mind, Urban Studies, Cognitive Science
> etc.), cada uma com hex individual hardcoded no código — consolidado
> de volta pros 9 tokens abaixo.

## Contexto

App desktop open source para organizar biblioteca pessoal de PDFs/
artigos acadêmicos. Stack: Tauri + React + TypeScript + Tailwind CSS +
SQLite (FTS5) + pdf.js. Esta paleta substitui as cores pastel geradas
inicialmente pelo Figma Make na tela "Library View", que falhavam
contraste em texto pequeno (tags de 12-13px).

**Direção visual do protótipo atual** ("Redesign Library View"): warm
minimalism — fundo creme quente (`#F5EDE4` claro / `#1A1410` escuro),
nunca branco puro ou cinza frio, com terracota/cobre `#9C5A2E` como
accent (único valor, claro e escuro). Os tokens de tag e texto
secundário abaixo já refletem essa paleta quente, não um fundo branco
genérico.

## Paleta de tags — pastel (bg claro + texto escuro)

Estilo original, ainda válido para qualquer lugar que precise de uma
pílula "leve" (ex: badge dentro de um card já colorido, hover state):

| Nome   | Background | Texto     | Contraste | Uso sugerido                               |
| ------ | ---------- | --------- | --------- | ------------------------------------------ |
| Violet | `#EDE9FE`  | `#5B21B6` | 7.56:1    | Tema/assunto principal                     |
| Indigo | `#E0E7FF`  | `#4338CA` | 6.42:1    | Tema/assunto principal                     |
| Blue   | `#DBEAFE`  | `#1D4ED8` | 5.49:1    | Subcategoria                               |
| Teal   | `#CCFBF1`  | `#0D5C54` | 6.97:1    | Subcategoria                               |
| Green  | `#D1FAE5`  | `#036B4D` | 5.75:1    | Estado positivo (ex: concluído)            |
| Amber  | `#FEF3C7`  | `#92400E` | 6.37:1    | Atenção / destaque                         |
| Rose   | `#FCE7F3`  | `#9D174D` | 6.71:1    | Subcategoria                               |
| Red    | `#FEE2E2`  | `#B91C1C` | 5.30:1    | Erro / exclusão (não usar como tag normal) |
| Slate  | `#E2E8F0`  | `#475569` | 6.15:1    | Estados neutros (ex: badge "Não iniciado") |

## Paleta de tags — fill sólido (padrão atual das pílulas de tag)

O protótipo atual usa pílula com fundo saturado + texto branco fixo.
Reaproveita a coluna "Texto" da tabela pastel acima como o novo
**Background**, então nenhum hex novo precisou ser inventado:

| Nome   | Background (= texto pastel) | Texto     | Contraste | Uso sugerido           |
| ------ | --------------------------- | --------- | --------- | ---------------------- |
| Violet | `#5B21B6`                   | `#FFFFFF` | 8.98:1    | Tema/assunto principal |
| Indigo | `#4338CA`                   | `#FFFFFF` | 7.90:1    | Tema/assunto principal |
| Blue   | `#1D4ED8`                   | `#FFFFFF` | 6.70:1    | Subcategoria           |
| Teal   | `#0D5C54`                   | `#FFFFFF` | 7.85:1    | Subcategoria           |
| Green  | `#036B4D`                   | `#FFFFFF` | 6.53:1    | Estado positivo        |
| Amber  | `#92400E`                   | `#FFFFFF` | 7.09:1    | Atenção / destaque     |
| Rose   | `#9D174D`                   | `#FFFFFF` | 7.88:1    | Subcategoria           |
| Red    | `#B91C1C`                   | `#FFFFFF` | 6.47:1    | Erro / exclusão        |
| Slate  | `#475569`                   | `#FFFFFF` | 7.58:1    | Estados neutros        |

Pior caso é Red a 6.47:1 — todos folgados acima do mínimo de 4.5:1.

## Texto secundário (metadados, datas, percentuais)

> A versão de 20/06 assumia fundo branco/`#FAFAFA` genérico. O app
> real não usa branco — usa a paleta creme quente abaixo.

**Modo claro** — sobre `--card` `#FAF5EF`:

- Cor: `#7A6558` _(era `#8B7263` — corrigido; o valor antigo media
  ~3.9–4.1:1, abaixo do mínimo)_
- Contraste: 5.06:1
- **Não usar tom mais claro que este.**

**Modo escuro** — sobre `--card` `#231C16`:

- Cor: `#9E8878` _(sem alteração — já passava)_
- Contraste: 5.00:1
- **Não usar tom mais claro que este.**

## Texto principal e seleção na biblioteca

Esses valores cobrem títulos fortes e estados selecionados da Home, incluindo
sidebar esquerda, título `Athenaeum`, nome da coleção ativa e o título da
coleção aberta.

**Modo claro** — sobre `--sidebar` `#EDE5DA` e superfícies claras da biblioteca:

- Cor: `#2C1810`
- Uso: texto principal da sidebar e títulos/itens selecionados

**Modo escuro** — sobre `--sidebar` `#140F0B` e superfícies escuras da biblioteca:

- Cor: `#F0E8DF`
- Uso: texto principal da sidebar e títulos/itens selecionados

## Regras de uso

1. Cada par bg/texto já foi validado — não trocar o tom de texto por
   um mais claro mesmo que pareça "mais bonito". Isso quebra o
   contraste calculado.
2. A mesma palavra-chave de tag deve sempre usar o mesmo par de cor em
   todas as telas. Ver mapeamento fechado na seção "Mapeamento
   palavra-chave → cor" abaixo. **Nunca gerar um hex novo por tag** —
   se a palavra-chave não está no mapeamento, escolher o token
   existente cujo "papel" mais se aproxima, e adicionar a linha na
   tabela (não inventar tom vizinho).
3. Red é reservado para erro/exclusão, não para tags de assunto.
4. Estes tokens cobrem tags e badges de status. Cor do ícone por
   documento na lista (se representa coleção, tipo de arquivo, ou é
   decorativo) é uma decisão separada, ainda em aberto.
5. Entre pastel e fill sólido: fill sólido é o padrão atual de
   produção pra pílulas de tag. Pastel fica disponível pra outros usos
   (hover, badge dentro de área já colorida) — não misturar os dois
   estilos pra tags dentro da mesma tela.

## Mapeamento palavra-chave → cor (tags de assunto)

> **Status: expandido em 30/06/2026.** A versão de 20/06 cobria só um
> acervo de CS/IA com 2 exemplos confirmados. O protótipo real trouxe
> coleções de Filosofia, Design, Urbanismo e Ciência Cognitiva — as
> 21 palavras-chave que apareceram foram consolidadas nos 9 tokens
> existentes por papel semântico (tema principal / subcategoria /
> destaque / estado), não por área de conhecimento.

| Cor    | Papel                | Palavras-chave                                                                   |
| ------ | -------------------- | -------------------------------------------------------------------------------- |
| Violet | Tema principal       | Machine Learning, Consciousness, Philosophy, Deep Learning, Urbanismo, Cognition |
| Indigo | Tema principal       | Systems / Infra, Design Systems, Typography, Accessibility                       |
| Blue   | Subcategoria         | NLP, Transformers, Language                                                      |
| Teal   | Subcategoria         | Computer Vision, Neuroscience, Perception                                        |
| Rose   | Subcategoria         | Theory / Math, Epistemologia, Memory, Sociologia, Reinf. Learning                |
| Amber  | Destaque             | AI Safety / Ethics, Seminal                                                      |
| Green  | Estado (não-assunto) | Concluído                                                                        |
| Slate  | Estado (não-assunto) | Não iniciado, Review                                                             |
| Red    | Estado (não-assunto) | Erro / exclusão                                                                  |

Green, Slate e Red **nunca** devem ser usados para tags de assunto —
estão reservados para badges de estado.

⚠️ **Nota de produto, não só técnica:** ao consolidar assim, "Violet"
passa a aparecer em Philosophy of Mind, Machine Learning, Urban
Studies e Cognitive Science ao mesmo tempo — o token identifica o
_papel_ da tag (tema principal), não a área de conhecimento nem a
coleção. Se no futuro você quiser que cada coleção tenha uma
identidade de cor mais exclusiva, esse mapeamento precisa ser revisto
(provavelmente separando "cor por coleção" de "cor por tag", que hoje
são dois sistemas sobrepostos).

## Cores de interface (chrome / elementos interativos)

> Diferente da paleta de tags acima (conteúdo: assunto, status), estas
> cores são da casca do app — header, toolbars, estados ativos.

| Nome                 | Valor     | Uso                                                                                                                                                                                                                              |
| -------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `surface-header`     | `#14161F` | Fundo do header/top bar (telas com leitor)                                                                                                                                                                                       |
| `surface-elevated`   | `#1E2130` | Fundo de elementos flutuantes escuros (toolbar de seleção, toolbar de formatação)                                                                                                                                                |
| `accent-interactive` | `#9C5A2E` | Ícone do logo, botão "+ Adicionar", barra de progresso de leitura, toggle de painel ativo, aba ativa no painel de anotações. **Mesmo hex em claro e escuro — sem variante separada.**                                            |
| `accent-icon-amber`  | `#F59E0B` | Ícone "Marcar" em estado ativo na toolbar de seleção (mais vívido que `tag-amber-text`, é ícone pequeno, não texto)                                                                                                              |
| `accent-tint-bg`     | `#EFE2D8` | Fundo de destaque em estado "ativo" de botões de ferramenta (ex: toolbar do Quadro) — tint sutil de terracota sobre o accent. Diferente do fill sólido das tags: aqui o texto/ícone continua na cor accent por cima, não branco. |
| `sidebar-text`       | claro `#2C1810`; escuro `#F0E8DF` | Texto principal da sidebar, título `Athenaeum`, título da coleção aberta e itens selecionados da navegação/biblioteca. |
| `sidebar-muted`      | claro `#7A6558`; escuro `#9E8878` | Itens não selecionados da sidebar, ações secundárias e metadados leves da navegação. |
| `document-cover-hue` | hue derivado do documento | Base determinística das miniaturas de documento; o hue é estável por documento e a saturação/luminosidade mudam por tema. |
| `document-cover-swatch` | claro `hsl(hue 28% 74%)`; escuro `hsl(hue 30% 18%)` | Fundo principal da área de preview dos cards de documento. |
| `document-cover-line` | claro `hsl(hue 28% 34% / 0.24)`; escuro `rgb(255 255 255 / 0.08)` | Linhas secundárias internas das miniaturas. |
| `document-cover-line-strong` | claro `hsl(hue 30% 30% / 0.34)`; escuro `rgb(255 255 255 / 0.15)` | Linhas internas mais fortes das miniaturas. |

Regra: `accent-icon-amber` não substitui o par `tag-amber-bg`/`tag-amber-text`
documentado acima — são usos diferentes (ícone vívido vs. texto sobre fundo
claro). Não usar um no lugar do outro.

> **Nota sobre a troca de accent (01/07/2026):** o indigo anterior
> (`#4F46E5` claro / `#6366F1` escuro) ficava a apenas ~20–25° de hue
> do Violet das tags (`#5B21B6`, hue 263°), causando colisão visual no
> dark mode. O terracota (`#9C5A2E`, hue 24°) fica a ~239° de distância
> do Violet — sem sobreposição possível com nenhum dos 9 tokens de tag.

## Prompt para colar no Figma Make

```
Aplique esses tokens de cor em todas as tags, badges de status e texto
secundário, substituindo as cores pastel/fill-sólido atuais:

TEXTO SECUNDÁRIO (metadados, datas, percentuais):
- Modo claro (sobre --card #FAF5EF): #7A6558
- Modo escuro (sobre --card #231C16): #9E8878
Não usar tom mais claro que esses — são o limite mínimo aceitável.

TAGS (fill sólido — bg saturado + texto branco fixo #FFFFFF):
- Violet #5B21B6 — Consciousness, Philosophy, Deep Learning, Urbanismo, Cognition
- Indigo #4338CA — Design Systems, Typography, Accessibility
- Blue   #1D4ED8 — NLP, Transformers, Language
- Teal   #0D5C54 — Computer Vision, Neuroscience, Perception
- Rose   #9D174D — Epistemologia, Memory, Sociologia, Reinf. Learning
- Amber  #92400E — Ethics, Seminal
- Slate  #475569 — Review, Não iniciado
- Green  #036B4D — Concluído (estado, não usar como tag de assunto)
- Red    #B91C1C — Erro/exclusão (estado, não usar como tag de assunto)

Cada palavra-chave usa sempre o mesmo par de cor em todas as telas —
não gerar um hex novo por tag, mesmo que pareça "mais bonito" ou mais
distinto visualmente.
```

## Prompt para colar no Claude Design

```
An interactive prototype from these mocks. Apply the color tokens from
athenaeum-design-tokens-cores.md to all tags, status badges, and
secondary text.

Secondary text (metadata, dates, percentages):
- Light mode (over --card #FAF5EF): #7A6558
- Dark mode (over --card #231C16): #9E8878
Do not lighten these tones even if it looks "nicer" — this breaks the
calculated WCAG AA contrast.

Tags use solid-fill pills (saturated bg + fixed white #FFFFFF text).
Use this fixed keyword-to-color mapping, and do not invent new colors
for these keywords across screens:
- Violet #5B21B6 — Consciousness, Philosophy, Deep Learning, Urbanismo, Cognition
- Indigo #4338CA — Design Systems, Typography, Accessibility
- Blue   #1D4ED8 — NLP, Transformers, Language
- Teal   #0D5C54 — Computer Vision, Neuroscience, Perception
- Rose   #9D174D — Epistemologia, Memory, Sociologia, Reinf. Learning
- Amber  #92400E — Ethics, Seminal
- Slate  #475569 — Review, Não iniciado

Green (#036B4D) and Red (#B91C1C) are reserved for status badges only
(concluído / erro-exclusão respectively) — never use them for subject
tags.
```

## Próximos passos (quando for para código/Tailwind)

Ao implementar, estes pares devem virar variáveis de tema (ex:
`tag-violet-bg`, `tag-violet-text`, `accent-interactive`) em vez de
hex hardcoded em componentes — facilita manutenção e mantém o
contraste validado centralizado em um único lugar.

Telas finalizadas no protótipo (Figma Make) e prontas para spec de
implementação:

- Library View (grid + list, claro + escuro)
- Modal Adicionar Documento (4 estados: vazio, revisão 1 arquivo,
  revisão lote, importando/status)
- PDF Reader (header, área de leitura, painel de anotações com 3
  abas, toolbar de highlight, toolbar de formatação de texto)
- Modal Nova Coleção (nome + descrição + color picker)

Telas ainda sem design próprio (implementar como variação da
Library View, sem necessidade de spec separada):

- Recentes, Favoritos, Lixeira — mesma estrutura, filtro diferente
- List view — mesmo card em layout de linha, toggle já visível

Telas que precisam de design antes de codar:

- Settings/Ajustes — sem spec ainda
