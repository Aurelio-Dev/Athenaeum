# Discovery — Aba Notas do leitor: contentEditable + sanitização

Fase somente de leitura. Nenhum código de produção foi alterado.
Data: 2026-07-12. Migration v8 verificada íntegra antes da análise
(`src-tauri/src/lib.rs:2948-3010` — `add_reader_info_fields_and_annotation_colors`,
adiciona `time_spent_seconds` e recria `annotations` com `color`; consistente
com a descrição registrada).

---

## Resumo executivo

A premissa do problema está **parcialmente desatualizada**: a aba Notas do
leitor já **não é** um `<textarea>`. Desde o commit `7411919` ("Make notes
formatting toolbar apply real rich text"), `NotesTab.tsx` é um
`contentEditable` funcional que aplica formatação real e persiste HTML em
`documents.notes`. O sintoma descrito (tags literais na tela) existe, mas em
**outra superfície**: o painel de detalhes da biblioteca
(`DocumentDetailsPanel.tsx`) exibe o mesmo campo num `<textarea>` de texto
plano — o HTML salvo pela NotesTab aparece lá como tags cruas. O gap crítico
real desta fase é **sanitização**: a NotesTab injeta `innerHTML` no load e
persiste `innerHTML` no save **sem nenhuma sanitização**, com `csp: null` no
Tauri — qualquer HTML que chegue ao banco por outra superfície (detalhes,
import, drag-and-drop) executa no WebView do leitor. Não há biblioteca de
sanitização no projeto; a disciplina de allowlist existe em
`notebookExportHtml.ts` e serve de modelo (não de módulo reutilizável direto).

---

## Mapa de pontos de toque no código atual

### `src/features/reader/panels/NotesTab.tsx` — o editor (já contentEditable)

- Editor: `<div contentEditable>` com `role="textbox"` (linhas 278-292).
  Modelo de linha inline-only: Enter vira `insertLineBreak` → `<br>`
  (linhas 228-236); não há blocos `<div>`/`<p>` intencionais.
- Toolbar flutuante (aparece com seleção não colapsada, linhas 240-270).
  Botões reais (linhas 12-20): **negrito, itálico, sublinhado, tachado,
  subscrito, sobrescrito, bloco de código**. *Não há listas* — a premissa do
  prompt citava listas, mas nenhum comando de lista existe hoje.
- Aplicação de formato (`applyFormat`, linhas 169-194), abordagem híbrida:
  - `document.execCommand`: `bold`, `italic`, `underline`, `strikeThrough`
    (mapa `execCommandByAction`, linhas 28-33);
  - Range manual: `sub`/`sup` via `toggleWrapTag` e código via
    `wrapSelectionInCode` (evitam aninhamento cumulativo que o comando
    nativo causaria).
- **Load sem sanitização**: `editor.innerHTML = notesText` no mount
  (linha 99) e em atualização externa (linha 112), seguido de
  `prepareCodeElements` (re-aplica estilo canônico em `<code>`).
- **Save sem sanitização**: `emitChange` emite `editor.innerHTML` cru
  (linhas 165-166).
- Paste: interceptado, só `text/plain` (linhas 198-218) — mitigação real,
  mas restrita a esta superfície.
- **Não há handler de `drop`** — drag-and-drop de conteúdo HTML entra sem
  filtro (vetor detalhado na seção de XSS).

### `src/features/reader/richTextShared.ts` — helpers compartilhados

Utilitários de Selection/Range usados pela NotesTab e pelo
`NotebookPageEditor`: `findEnclosingTag`, `unwrapElement`, `toggleWrapTag`,
`wrapSelectionInCode`, `flattenBlockElements`,
`insertPlainTextWithLineBreaks`, `stripNestedFormattingTags`, e o
`codeBlockStyle` (estilo inline persistido nos `<code>`). É a prova de que o
padrão "Range manual" já é idioma do projeto quando o execCommand não serve.

### `src/features/reader/ReaderSidePanel.tsx` — as 3 abas

Abas `ai | notes | annotations` (linhas 10, 33-37). `NotesTab` renderizada na
linha 148 com `notesText`/`onNotesChange`/`onBlur` vindos do `ReaderModal`.

### `src/features/reader/panels/InfoTab.tsx` — **código morto**

Não é importado em lugar nenhum (grep em `src/` só encontra as
autorreferências). Contém um `<textarea>` ligado ao mesmo `notesText`
(linhas 163-172, rótulo "Descricao"). Se fosse reativado, exibiria HTML cru.
Decisão pendente (pergunta em aberto nº 1).

### `src/features/library/ReaderModal.tsx` — estado e autosave das notas

- Estado: `notesText` + `latestNotesRef` (linhas 587-589), inicializados de
  `document.notes`.
- `handleNotesChange` (linhas 894-909): atualiza estado e agenda save com
  **debounce próprio de 500 ms** (`notesSaveTimerRef`).
- `flushNotes` (linhas 646-653): flush imediato no blur do editor
  (`onNotesBlur`, linha 1378) e no unmount (linhas 655-663).
- Não usa `useReaderPersistence` (o debounce de 750 ms daquele hook é da
  posição de leitura) e **não há fila serializada** como no autosave do
  Caderno — nem precisa: o save é um UPDATE de statement único,
  last-write-wins.

### `src/features/library/LibraryView.tsx` — ponte para o banco

`saveDocumentNote` (linhas 446-449): atualiza o cache do react-query e chama
`setDocumentNote`. Ligada em **duas** superfícies: `DocumentDetailsPanel`
(`onUpdateNotes`, linha 876) e `ReaderModal` (`onSaveNotes`, linha 942) —
ambas podem estar montadas ao mesmo tempo, gravando o mesmo campo.

### `src/lib/database.ts` — persistência

`setDocumentNote` (linhas 1438-1441):
`UPDATE documents SET notes = $1 WHERE id = $2`. Statement único
parametrizado via `tauri-plugin-sql` — padrão correto do projeto (TS, sem
comando Rust). Leitura em `mapDocumentRow` (linha 188: `row.notes ?? ""`).

### `src/features/library/DocumentDetailsPanel.tsx` — **onde as tags aparecem literalmente**

`<textarea>` "Notas" (linhas 608-616) exibe `notesDraft` (draft de
`document.notes`, linhas 355-371) e salva no blur (linhas 399-401). Como é
texto plano: (a) HTML salvo pela NotesTab aparece como tags cruas — o bug de
UX relatado; (b) o que o usuário digitar/colar aqui é gravado **cru** e
depois renderizado via `innerHTML` na NotesTab — o principal vetor de
injeção (ver XSS).

### `src/features/library/AddDocumentModal.tsx` — terceira superfície de escrita

Textareas de notas no fluxo de import (linhas 489 e 683) → `item.notes` →
comando Rust `import_document` (`lib.rs:284-301`), que grava
`documents.notes` na transação de import. Também texto plano cru.

### `src-tauri/src/lib.rs` — schema e FTS

- Coluna: `notes TEXT NOT NULL DEFAULT ''` na tabela `documents`
  (linha 2545, migration v1). Nenhuma mudança de schema é necessária para a
  sanitização em si.
- **FTS5**: `documents_fts` indexa `notes` (linhas 2578-2586) e é mantida
  por triggers (linhas 2625 em diante). Consequência já vigente: o HTML cru
  (nomes de tags, valores do `codeBlockStyle`) vira token de busca —
  buscar "code" ou "block" pode retornar documentos só por causa da
  formatação das notas.

### `src-tauri/tauri.conf.json` — CSP

`"csp": null` (linha 23). Não há Content-Security-Policy mitigando script
inline ou handlers de evento — qualquer XSS no WebView tem acesso à bridge
IPC do Tauri (comandos de filesystem, shell etc.). Isso eleva a severidade
de todos os vetores abaixo.

### Dependências (`package.json`)

Nenhuma biblioteca de sanitização (sem DOMPurify ou similar). A única
sanitização de HTML do projeto é a allowlist manual de
`src/features/notebooks/notebookExportHtml.ts`.

---

## Recomendação: abordagem de sanitização

**Allowlist própria, minimalista, num módulo novo e pequeno** (ex.:
`src/features/reader/notesSanitizer.ts`), seguindo a *disciplina* de
`notebookExportHtml.ts` sem reutilizar o módulo diretamente.

Por que não reutilizar `notebookExportHtml.ts` como está:

- Ele é acoplado ao domínio do export de Caderno: manifest, slots
  (`createSlotComment`), sentinelas de asset/anexo, warnings por página —
  nada disso se aplica a Notas.
- A allowlist dele é muito maior que o necessário (h1-h6, tabelas, figure,
  blockquote, aside…). Notas é inline-only + `<br>`; allowlist maior =
  superfície de ataque e de manutenção maior sem ganho.

O que emprestar dele (padrões já validados no projeto):

- parse em documento isolado
  (`new DOMParser().parseFromString(...)` / `document.implementation`),
  nunca innerHTML direto num nó vivo;
- caminhada nó a nó com allowlist de elementos: elemento não permitido é
  *unwrapped* (filhos sobem), não descartado — preserva o texto do usuário;
- atributos: negar por padrão (remover `on*`, `id`, `contenteditable`,
  `style` etc.).

Allowlist proposta para Notas (a confirmar — pergunta em aberto nº 5):

- Elementos: `b`, `strong`, `i`, `em`, `u`, `s`, `strike`, `del`, `sub`,
  `sup`, `code`, `br`. (Os pares `b`/`strong` etc. porque o execCommand do
  Chromium emite as formas curtas, mas dado legado/colado pode ter as
  longas.)
- `div`/`p`: não permitir; achatar para texto + `<br>` reutilizando
  `flattenBlockElements` de `richTextShared.ts` (o modelo de linha da
  NotesTab já é esse).
- Atributos: **nenhum** persistido. Em `<code>`, descartar o `style` salvo e
  re-impor o canônico via `prepareCodeElement` no load (que já roda hoje) —
  o estilo deixa de ser dado confiável vindo do banco.

Por que não DOMPurify: resolveria com menos código próprio, mas (a) o
projeto evita dependências sem necessidade demonstrada (AGENTS.md), (b) a
superfície aqui é pequena e fechada (12 tags, zero atributos), (c) já existe
know-how de allowlist manual no repo. Se no futuro Notas ganhar links,
imagens ou colagem rica, reavaliar — nesse ponto DOMPurify passa a se pagar.

**Onde rodar: nas duas pontas.**

- **No load (obrigatório)**: antes de cada `editor.innerHTML = ...`
  (NotesTab linhas 99 e 112). É a única defesa contra o que já está no banco
  (dado legado, dado gravado pelas superfícies de texto plano, banco editado
  fora do app). É a linha de defesa que não pode faltar.
- **No save (defesa em profundidade)**: em `emitChange`, sanitizar antes de
  `onNotesChange(...)`. Mantém o banco convergindo para o formato canônico,
  reduz a poluição do índice FTS e protege leitores futuros do campo.

---

## Recomendação: comandos de formatação

**Manter o híbrido atual** (execCommand para bold/italic/underline/strike +
Range manual para sub/sup/código). Não adotar biblioteca de editor.

Justificativa:

- Já está implementado e funcional — a conversão para contentEditable
  aconteceu no commit `7411919`; esta fase não precisa reescrever comandos.
- É o mesmo padrão do `NotebookPageEditor` (que usa `execCommand` em ~15
  pontos). Trocar a abordagem só na NotesTab criaria dois idiomas para o
  mesmo problema, contra a regra de fonte de verdade única do projeto.
- `document.execCommand` está deprecated na spec, mas é estável e sem
  anúncio de remoção nos engines (o próprio Google Docs e afins dependem
  dele); o app roda num WebView controlado (WebView2/Chromium no Windows),
  não na web aberta — o risco de quebra silenciosa é baixo e detectável.
- O plano B já existe no repo: `toggleWrapTag`/`wrapSelectionInCode`
  (`richTextShared.ts`) demonstram o padrão de substituição por Range
  manual, comando a comando, se algum execCommand regredir um dia.
- Biblioteca (TipTap/Lexical/ProseMirror) traria dependência pesada, novo
  modelo de documento e reescrita dos dois editores — desproporcional para
  7 botões inline (prioridades do projeto: confiabilidade > peso).

Mapa comando a comando (estado atual, nada a criar):

| Botão | Mecanismo atual | Observação |
| --- | --- | --- |
| Negrito | `execCommand("bold")` | toggle nativo, estado via `queryCommandState` |
| Itálico | `execCommand("italic")` | idem |
| Sublinhado | `execCommand("underline")` | idem |
| Tachado | `execCommand("strikeThrough")` | idem |
| Subscrito | `toggleWrapTag("sub")` | manual para evitar aninhamento cumulativo |
| Sobrescrito | `toggleWrapTag("sup")` | idem |
| Bloco de código | `wrapSelectionInCode` | sem comando nativo equivalente |

---

## Riscos de XSS identificados

Contexto de severidade: `csp: null` + bridge IPC do Tauri no mesmo WebView.
Um XSS aqui não é "alert box": é chamada de comandos nativos (filesystem,
shell `open_external_url` etc.) com os privilégios do app. Threat model
offline-first: o "atacante" é conteúdo que o usuário cola/importa de fora.

| # | Vetor | Severidade | Detalhe |
| --- | --- | --- | --- |
| 1 | **Load sem sanitização** (`NotesTab.tsx:99,112`) | **Alta** | Qualquer HTML em `documents.notes` renderiza via `innerHTML`. `<script>` inserido assim não executa (regra do HTML5), mas `<img src=x onerror=...>`, `<svg onload=...>` etc. **executam**. Portas de entrada do payload: textarea do `DocumentDetailsPanel`, textareas do `AddDocumentModal` (usuário cola texto malicioso "inofensivo" fora do leitor), dado legado, banco alterado externamente. |
| 2 | **Drag-and-drop no contentEditable** | **Média** | Não há `onDrop`; arrastar seleção rica (de outro app, de uma página, do próprio caderno) insere HTML arbitrário direto no DOM, que o `onInput`/`emitChange` persiste cru e futuros loads re-renderizam (vira o vetor 1). |
| 3 | Digitação direta de markup | Baixa | Digitar `<img onerror=...>` na NotesTab produz *texto* (nós de texto), não elementos — inofensivo no momento. Mas se salvo cru e depois re-injetado via `innerHTML` no load, o texto vira markup vivo. A sanitização de load resolve; a de save + escape correto de texto eliminam a janela. |
| 4 | Paste | Baixa (já mitigado na NotesTab) | `handlePaste` força `text/plain`. Mesma ressalva do vetor 3: o texto colado pode conter markup que "liga" num load futuro sem sanitização. Superfícies de texto plano (detalhes/import) não têm — nem precisam de — filtro, mas alimentam o vetor 1. |
| 5 | Atalhos nativos (Ctrl+B/I/U) | Info | Inserem só `b`/`i`/`u` — inócuos. Registrado para deixar claro que markup entra por caminhos fora da toolbar: a sanitização deve agir sobre o **dado**, não sobre os handlers. |
| 6 | FTS5 indexa HTML cru | Info (não é XSS) | Tags e valores de estilo viram tokens de busca (`documents_fts`, `lib.rs:2585`) — falsos positivos ao buscar "code", "block" etc. A sanitização no save converge apenas notas ATIVAMENTE editadas; notas nunca tocadas mantêm HTML cru no índice indefinidamente (abrir/reabrir não regrava nada). Limpeza retroativa exigiria reindexação (fora do escopo). |
| 7 | `csp: null` (`tauri.conf.json:23`) | Info (multiplicador) | Sem CSP, qualquer vetor acima tem impacto máximo. Definir uma CSP é mudança de superfície ampla (afeta pdf.js, KaTeX, Konva, assets) — fase própria. |

**Conclusão sobre onde sanitizar**: no load **e** no save, como detalhado na
seção de sanitização. Só no save deixaria o dado pré-existente ativo; só no
load deixaria o banco sujo e o FTS poluído.

---

## Plano de migração de dados existentes

Estados possíveis hoje na coluna `documents.notes`:

1. **Vazio** (`''`, default) — nenhum tratamento.
2. **Texto plano** — da era `<textarea>` da NotesTab (pré-`7411919`) e de
   tudo que `DocumentDetailsPanel`/`AddDocumentModal` gravam até hoje.
3. **HTML rico não sanitizado** — gravado pela NotesTab atual.

Avaliação:

- **Não é necessária migration SQL.** Não há mudança de schema; transformação
  de conteúdo é responsabilidade do TypeScript (AGENTS.md), e as regras do
  projeto vedam migration sem mudança real de schema. A normalização pode
  ser **lazy**: sanitizar no load, e o ciclo natural de edição/save regrava
  o formato canônico. **Ressalva (confirmada na implementação): a
  convergência do banco só ocorre por edição ATIVA da nota** — abrir/reabrir
  o leitor sanitiza apenas a renderização e não regrava nada (o flush de
  blur/unmount sem edição reenvia o valor original cru). Notas nunca
  editadas mantêm o valor cru em `documents.notes` indefinidamente.
- Texto plano sem `<` nem `&` já renderiza corretamente no `innerHTML` atual
  (o editor usa `whitespace-pre-wrap`, então `\n` de dado legado exibe a
  quebra). Sanitizar não muda nada para ele.
- **Caso ambíguo real**: texto plano contendo `<` ou `&` (ex.: "se x<10",
  "AT&T"). O `innerHTML` de hoje **já corrompe** esses casos (o parser
  interpreta como tag/entidade) — não é regressão nova, mas a fase deve
  decidir o tratamento:
  - *Opção A — heurística no load*: se a string não contém `<`, tratar como
    texto plano (escapar `&` e converter para nós de texto); se contém,
    tratar como HTML e sanitizar. Simples, sem migration, mas `<` legado
    continua sendo interpretado como markup (perda já ocorrida hoje).
  - *Opção B — marcador de formato explícito*: distinguir plano de HTML por
    metadado. Coluna nova = migration (contra as regras sem necessidade
    forte); prefixo mágico na própria string = gambiarra que vaza para FTS
    e outras superfícies. Não recomendo nesta fase.
  - **Recomendação: Opção A**, documentando a limitação.
- Atenção à convivência das superfícies: enquanto `DocumentDetailsPanel` e
  `AddDocumentModal` continuarem gravando texto plano cru, o load da
  NotesTab precisa da heurística acima permanentemente (não é só legado).
  A alternativa (escapar no save dessas superfícies) muda o que o usuário
  vê nos textareas — decisão do produto (pergunta em aberto nº 2).

---

## Perguntas em aberto (decisões suas antes da implementação)

1. **`InfoTab.tsx` (código morto)**: remover nesta fase, deixar como está,
   ou reativar em algum lugar? (Se reativar, o textarea dele tem o mesmo
   problema do painel de detalhes.)
2. **Superfícies de texto plano** (`DocumentDetailsPanel`,
   `AddDocumentModal`): continuam como textareas de texto plano (e a
   NotesTab convive via heurística de load), ou o campo "Notas" do painel de
   detalhes também deveria render HTML (readonly ou editável)? Minha
   sugestão para esta fase: manter texto plano e conviver via heurística;
   unificação fica para depois.
3. **Allowlist própria vs DOMPurify**: recomendo allowlist própria (razões
   acima) — confirmar.
4. **`div`/`span` na allowlist**: proposta é *não* permitir e achatar com
   `flattenBlockElements` — confirmar (afeta como conteúdo dropado/legado é
   normalizado).
5. **Heurística de legado (Opção A) vs marcador de formato (Opção B)** na
   migração — recomendo A.
6. **Poluição do FTS**: aceitar como limitação documentada nesta fase
   (sanitização no save melhora daqui pra frente **apenas para notas
   ativamente editadas** — as nunca tocadas permanecem cruas no índice, pois
   a convergência não acontece ao simplesmente reabrir), ou abrir fase
   própria para stripping de tags na indexação (mexeria em triggers =
   migration)?

---

## Fora do escopo desta fase (para sua confirmação)

- Aba **Ask AI** e aba **Anotações** (`annotations.note` segue texto plano).
- **Editor do Caderno** (`NotebookPageEditor`) e `notebookExportHtml.ts` —
  nenhuma mudança; servem apenas de referência de padrão.
- **Export** das notas do leitor (não existe e não será criado).
- **Unificação das superfícies** de edição de `documents.notes` (detalhes e
  import continuam textareas de texto plano, salvo decisão na pergunta 2).
- **Novas capacidades de formatação** (listas, títulos, links, imagens) — a
  toolbar atual não as tem; adicioná-las mudaria a allowlist e o modelo de
  linha.
- **Mudanças de schema, migrations e triggers FTS** (inclusive a
  reindexação retroativa da pergunta 6).
- **CSP global** (`tauri.conf.json`) — recomendável, mas é mudança de
  superfície ampla que merece fase própria.
- Fila serializada de autosave estilo Caderno — desnecessária para um UPDATE
  de statement único; o debounce + flush atuais permanecem.

---

## Validações executadas nesta fase

- Leitura de `AGENTS.md` e inspeção dos arquivos citados (nenhum arquivo de
  produção modificado).
- Verificação da integridade da migration v8 em `src-tauri/src/lib.rs`.
- `git status`: árvore limpa antes da criação deste documento; nenhum
  commit realizado nesta fase.
