# Popout do painel de anotações — Discovery v2

> Fase somente de leitura (12/07/2026). Nenhum código de produção foi
> alterado. Este documento cobre: diagnóstico da tentativa anterior
> (51b2e24 → 0e85673), mapa do fluxo de dados atual, viabilidade de
> acesso direto ao SQLite pela popout, mecanismo de sincronização por
> eventos, ciclo de vida da janela e o que falta no lado Rust.

## Resumo executivo

A causa da quebra anterior está confirmada no código: a popout lia um
snapshot único de `localStorage` no mount e todos os handlers de save
eram no-ops — não houve bug de plataforma do Tauri. A v2 proposta
(popout lê/escreve direto no SQLite + eventos de invalidação entre
janelas) é tecnicamente viável **sem nenhuma mudança estrutural no lado
Rust**: o pool do `tauri-plugin-sql` é estado global do app, acessível
de qualquer WebView. Os dois pontos críticos descobertos são (1) o
arquivo de capabilities restringe todas as permissões à janela `main` —
sem incluir o label da popout, `sql:*` e `core:event:*` são negados
nela; e (2) o comando `load` do plugin **substitui** o pool existente a
cada chamada — a popout deve usar `Database.get()` (síncrono, sem
re-load), viável porque o banco já está em `preload`. As abas do painel
(Notas/Anotações/Ask AI) não dependem de estado do PDF.js, então rodam
numa janela separada; o único callback que exige a janela principal é
"pular para a página" (vira evento). O risco de produto mais sério é a
edição simultânea das notas livres nas duas janelas (documentado
abaixo, com opções).

---

## 1. Diagnóstico confirmado da quebra anterior

### 1.1 O que o diff do revert (0e85673) mostra

Validei o diff fornecido contra o histórico real (`git log`): os
commits existem como descrito — `51b2e24` ("Add reader panel popout
window", 02/07/2026) criou a feature e `0e85673` a reverteu no mesmo
dia. O `ReaderPanelPopout.tsx` deletado no revert confirma os três
defeitos apontados:

1. **Snapshot único, lido uma vez**: `const payload = useMemo(parsePayload, [])`
   — o `localStorage` (`athenaeum:reader-panel-popout`) era lido apenas
   no mount da popout. Mudanças posteriores na janela principal nunca
   chegavam.
2. **Save no-op nas notas**: `<NotesTab ... onBlur={() => undefined} />`
   e `onNotesChange={setNotesText}` (estado local da popout, nunca
   persistido). Tudo que o usuário digitasse na popout era perdido ao
   fechar.
3. **Anotações somente leitura disfarçadas de editáveis**:
   `onJumpToPage={() => undefined}` e `onDelete={() => undefined}`.

Conclusão: **não havia fonte de verdade compartilhada**. A janela
nativa em si (via `WebviewWindowBuilder` + `WebviewUrl::App("index.html?readerPanel=1")`)
era código Tauri padrão e nada no diff sugere falha de plataforma.

*Limite do diagnóstico (inferência, não fato)*: pelo histórico não dá
para reproduzir o comportamento em runtime da época; a mensagem do
revert chama a janela de "quebrada", mas a única quebra demonstrável no
código é a de dados descrita acima.

### 1.2 O que mudou no código desde 02/07 (importante para a v2)

O código atual **divergiu** do que existia na época do revert:

- O modo flutuante interno não é mais um boolean local
  (`sidePanelFloating`) com `position: fixed` manual. Hoje ele vive na
  **pilha global de painéis** (`FloatingPanelsContext`): o
  `ReaderModal` deriva `sidePanelFloating` da existência da entrada
  `floatingPanelId("annotations", document.id)` na pilha
  ([ReaderModal.tsx:557-560](src/features/library/ReaderModal.tsx#L557-L560)),
  e `onFloat` chama `openPanel("annotations", document.id, ...)`
  ([ReaderModal.tsx:1387](src/features/library/ReaderModal.tsx#L1387)).
- O `ReaderSidePanel` flutuante renderiza dentro de
  `FloatingPanelFrame` (drag, resize, minimizar, z-index pela pilha)
  ([ReaderSidePanel.tsx:158-222](src/features/reader/ReaderSidePanel.tsx#L158-L222)).
- O próprio leitor também virou um painel da pilha (`"reader"`).

Consequência para a v2: o botão "abrir em janela separada" hoje ocupa o
slot do `onFloat`. A v2 precisa decidir se a janela nativa **substitui**
o painel flutuante interno ou se vira um **terceiro estado** (docked →
flutuante interno → janela do SO). Isso é decisão de UX, listada nas
perguntas em aberto.

---

## 2. Mapa de pontos de toque no código atual

### 2.1 Fluxo de dados das notas livres (`documents.notes`)

| Etapa | Onde | Detalhe |
|---|---|---|
| Load | `LibraryView` → prop `document.notes` | Vem do snapshot da biblioteca (`loadLibrarySnapshot`/`listDocuments` em [database.ts](src/lib/database.ts)), coluna `documents.notes`. |
| Estado vivo | [ReaderModal.tsx:587-589](src/features/library/ReaderModal.tsx#L587-L589) | `notesText` (state) + `latestNotesRef`. |
| Edição | [NotesTab.tsx](src/features/reader/panels/NotesTab.tsx) | `contenteditable` com sanitização na carga e no save (`sanitizeNotesHtml`). |
| Autosave | [ReaderModal.tsx:894-909](src/features/library/ReaderModal.tsx#L894-L909) | `handleNotesChange`: debounce de **500 ms** → `onSaveNotes`. |
| Flush | [ReaderModal.tsx:646-653](src/features/library/ReaderModal.tsx#L646-L653) | `flushNotes` no blur do editor, no fechamento (`closeAndSave`) e no unmount. |
| Persistência | [LibraryView.tsx:439-442](src/features/library/LibraryView.tsx#L439-L442) → [database.ts:1438-1441](src/lib/database.ts#L1438-L1441) | `saveDocumentNote` atualiza o cache do react-query e chama `setDocumentNote` (`UPDATE documents SET notes = $1 WHERE id = $2`). 1 statement, atômico. |

### 2.2 Fluxo de dados das anotações (tabela `annotations`)

| Etapa | Onde | Detalhe |
|---|---|---|
| Load | [ReaderModal.tsx:738-757](src/features/library/ReaderModal.tsx#L738-L757) | `listAnnotations(document.id)` ao abrir/trocar documento. |
| Estado vivo | `annotations` (state do ReaderModal) | Compartilhado entre `HighlightLayer` (páginas do PDF) e `AnnotationsTab`. |
| Criar | [ReaderModal.tsx:782-811](src/features/library/ReaderModal.tsx#L782-L811) | Otimista: entra na UI como "saving", `createAnnotation` confirma; falha vira "unsaved" + retry. |
| Editar nota | `saveAnnotationNoteById` ([ReaderModal.tsx:873-877](src/features/library/ReaderModal.tsx#L873-L877)) | `updateAnnotationNote` — escrita imediata, sem debounce (save no blur do textarea do card). |
| Excluir | `removeAnnotation` ([ReaderModal.tsx:881-890](src/features/library/ReaderModal.tsx#L881-L890)) | `deleteAnnotation` — só remove da UI após o banco confirmar. |

Todas as queries em [database.ts:1589-1664](src/lib/database.ts#L1589-L1664)
são statements únicos via `tauri-plugin-sql` — nenhuma exige Rust.

### 2.3 Independência das abas em relação ao ReaderModal

O `ReaderSidePanel` recebe uma superfície de dados pequena e **nenhum
estado do PDF.js** chega às abas:

- **NotesTab**: `notesText` + `onNotesChange` + `onBlur`. Dependências
  próprias (`notesSanitizer`, `richTextShared`) são puras/DOM-local.
  ✔ roda em janela separada.
- **AnnotationsTab**: `annotations` + `onDelete` + `onUpdateNote` +
  `onJumpToPage`. As três primeiras viram acesso direto ao banco. ✘
  `onJumpToPage` **exige a janela principal** (usa `readerSurfaceRef`
  e `pageRefs` do PDF renderizado) — na popout precisa virar um evento
  para a principal (ou no-op, se o documento estiver fechado lá).
- **AiTab**: placeholder sem persistência
  ([AiTab.tsx](src/features/reader/panels/AiTab.tsx)). ✔ sem impacto.

Estado que fica **para trás** na principal (e não deve ir junto):
PDF.js (`pdfDocument`, render/virtualização), `currentPage`, zoom,
scroll, seleção/`SelectionToolbar`, `NotePopover`, timer de leitura,
tags, progresso. O painel nem renderiza `progress`/`timeSpentSeconds`
hoje (as props existem no tipo mas não são destruturadas).

### 2.4 Providers que a popout precisaria

O entry atual ([main.tsx](src/main.tsx) → [App.tsx](src/app/App.tsx))
monta `QueryClientProvider`, `ThemeProvider`,
`AppearancePreferencesProvider`, `DividerLinesProvider`,
`FloatingPanelsProvider`. Para a popout, o mínimo é o **ThemeProvider**
(classe `.dark` no `<html>`; sem ele a popout abre sempre clara). Os
demais são dispensáveis para as três abas. Observação: como os imports
de `App.tsx`/`LibraryView` são estáticos, um branch
`?readerPanel=1` no mesmo entry carrega o bundle inteiro (incluindo
`pdfjs-dist`, `konva`, `katex`) na popout — ver risco M3.

### 2.5 Lado Rust hoje

- [lib.rs:3104-3146](src-tauri/src/lib.rs#L3104-L3146): builder sem
  nenhum comando de janela (o `open_reader_panel_window` foi removido
  no revert). Plugins: `fs`, `sql` (com `add_migrations`), `log` (dev).
- [lib.rs:200](src-tauri/src/lib.rs#L200): `DATABASE_KEY = "sqlite:athenaeum.db"`
  — mesma chave usada pelo TS, e é assim que `import_document` acessa o
  pool via `tauri::State<'_, DbInstances>`.
- [capabilities/default.json](src-tauri/capabilities/default.json):
  `"windows": ["main"]` — **todas** as permissões (`core:default`,
  `sql:*`, `fs:*`) valem só para a janela `main`.
- [tauri.conf.json](src-tauri/tauri.conf.json): `plugins.sql.preload`
  já carrega `sqlite:athenaeum.db` na inicialização (migrations rodam
  aí, uma única vez).

---

## 3. Viabilidade: popout consultando o SQLite diretamente (item 2)

**Resposta curta: sim, é direto — o pool é do app, não da janela.**
Mas há duas armadilhas confirmadas na fonte do plugin.

### 3.1 Como o plugin-sql compartilha o pool (detalhe Rust)

O `tauri-plugin-sql` registra um estado gerenciado `DbInstances` no app
inteiro (um `RwLock<HashMap<String, DbPool>>` — mapa de "connection
string" → pool sqlx). *Estado gerenciado* (`app.manage(...)`) é um
singleton por aplicação: qualquer comando invocado de **qualquer**
WebView recebe a mesma instância via injeção
(`tauri::State<'_, DbInstances>`). É exatamente o que
`import_document` já faz em
[lib.rs:243-251](src-tauri/src/lib.rs#L243-L251). Os comandos
`plugin:sql|select/execute` do frontend passam a string
`"sqlite:athenaeum.db"` e o Rust resolve o pool no mapa — a janela de
origem é irrelevante. **Nenhum trabalho no Rust é necessário para a
popout "enxergar" o mesmo banco.**

### 3.2 Armadilha 1 — `load` substitui o pool (confirmado na fonte)

Verifiquei `tauri-plugin-sql 2.4.0/src/commands.rs` (registry local do
cargo): o comando `load` **sempre** cria um pool novo
(`DbPool::connect`) e faz `insert` no mapa, **substituindo** o pool
existente sob a mesma chave. O pool antigo é dropado (as conexões
fecham). Não há corrupção — o `RwLock` serializa: `select`/`execute`
seguram o read-lock durante a query inteira, então o swap espera
queries em voo terminarem. Mas cada `Database.load()` extra descarta e
recria conexões (e o `PRAGMA foreign_keys = ON` aplicado pelo
`getDatabase()` do TS na conexão antiga não migra para o pool novo —
mitigado pelo fato de o sqlx ligar `foreign_keys` por default).

Hoje o [database.ts:193-202](src/lib/database.ts#L193-L202) memoiza
`Database.load` por contexto JS (`databasePromise`) — mas cada janela é
um contexto JS separado. Se a popout importar `getDatabase()` como
está, **cada abertura da popout troca o pool debaixo da janela
principal**, e ainda re-executa `seedInitialData` + `purgeExpiredTrash`.

**Mitigação limpa**: a popout usa `Database.get("sqlite:athenaeum.db")`
— método estático **síncrono** do plugin que só constrói o handle JS
sem invocar `load` (verificado em
`node_modules/@tauri-apps/plugin-sql/dist-js/index.d.ts:55`). Ele é
projetado justamente para bancos em `preload`, que é o caso aqui. As
migrations não correm risco de rodar duas vezes de qualquer forma: o
plugin remove a entrada do mapa de migrations após a primeira execução.

Como encaixar sem duplicar lógica: extrair no `database.ts` um caminho
de obtenção do handle que a popout use com `Database.get` (as funções
`listAnnotations`, `setDocumentNote`, `updateAnnotationNote`,
`deleteAnnotation` continuam únicas — só a inicialização difere).
Detalhe de implementação para a fase seguinte.

### 3.3 Armadilha 2 — capabilities (a lacuna real de configuração)

[capabilities/default.json](src-tauri/capabilities/default.json)
declara `"windows": ["main"]`. Uma janela com outro label **não tem
permissão nenhuma**: `plugin:sql|select` falha, `listen`/`emit` falham.
A tentativa anterior nunca esbarrou nisso porque a popout só usava
`localStorage` (não passa por permission) — na v2 isso quebra na
primeira query, com erro de permissão em runtime.

Correção (config, não código): incluir o label da popout no array
`windows` da capability existente, ou criar uma capability própria com
o subconjunto necessário (`core:default` + `sql:allow-select` +
`sql:allow-execute` — a popout não precisa de `fs:*` nem
`sql:allow-load` se usar `Database.get`, o que é inclusive mais
alinhado ao princípio de menor privilégio). O campo `windows` aceita
glob (ex.: `reader-annotations-*`), relevante para a decisão de label
do item 5.

---

## 4. Sincronização entre janelas via eventos (item 3)

### 4.1 API relevante do Tauri 2

Frontend (`@tauri-apps/api/event` — já disponível, `@tauri-apps/api`
2.5.0 no package.json):

- `emit(name, payload)` — broadcast para **todas** as janelas (e
  listeners Rust).
- `emitTo(target, name, payload)` — direcionado a um label específico.
- `listen(name, handler)` → retorna `unlisten` (guardar e chamar no
  cleanup do effect).
- `getCurrentWebviewWindow().label` — identifica a janela atual (para
  filtrar eco).

Permissões: `core:event:default` (incluída em `core:default`, já
presente na capability) cobre `allow-emit`, `allow-emit-to`,
`allow-listen`, `allow-unlisten` — **verificado no schema gerado**
(`src-tauri/gen/schemas/desktop-schema.json`). Ou seja: para a janela
`main` nada muda; para a popout basta a correção de capability do
§3.3. **Nada é necessário no builder Rust** — o sistema de eventos é
core do Tauri, não um plugin.

Nomes de evento aceitam apenas `[a-zA-Z0-9-/:_]` (ex.:
`reader:annotations-changed` é válido; acentos não).

### 4.2 Desenho proposto (re-fetch, não repasse de payload)

Princípio: o evento é **invalidação**, o SQLite é a fonte de verdade.
O payload carrega só `{ documentId, origin }` — nunca os dados.

Ponto único de emissão — dentro das funções de escrita já existentes em
[database.ts](src/lib/database.ts), após o `execute` resolver:

| Função (já existe) | Evento emitido |
|---|---|
| `setDocumentNote` | `reader:notes-changed` |
| `createAnnotation` | `reader:annotations-changed` |
| `updateAnnotationNote` | `reader:annotations-changed` |
| `deleteAnnotation` | `reader:annotations-changed` |

Como as duas janelas importam **as mesmas funções**, nenhuma lógica de
load/save é duplicada — a emissão fica no único lugar por onde toda
escrita já passa. `origin = getCurrentWebviewWindow().label` permite ao
listener ignorar eventos da própria janela (anti-eco).

Pontos de escuta:

- **Janela principal** (`ReaderModal`): um `useEffect` com
  `listen("reader:annotations-changed", ...)` que, se
  `payload.documentId === document.id && payload.origin !== labelLocal`,
  re-executa o mesmo `listAnnotations` do effect de load existente
  ([ReaderModal.tsx:738-757](src/features/library/ReaderModal.tsx#L738-L757)).
  Para notas: re-buscar `documents.notes` exige um helper de leitura
  novo e pequeno (ex.: `getDocumentNotes(documentId)` — `SELECT notes
  FROM documents WHERE id = $1`; leitura pura, **sem migration**,
  conforme regra do AGENTS.md) e atualizar `notesText`/`latestNotesRef`.
- **Popout**: componente próprio que faz o load inicial
  (`listAnnotations` + `getDocumentNotes`) e instala os mesmos
  listeners. `NotesTab` e `AnnotationsTab` são reutilizados **sem
  alteração** — eles já operam por props/callbacks.
- `NotesTab` já tolera atualização externa de `notesText`
  ([NotesTab.tsx:113-120](src/features/reader/panels/NotesTab.tsx#L113-L120)):
  reescreve o editor só quando o valor difere do último emitido. Mas
  reescrever **enquanto o usuário digita na outra ponta** reposiciona o
  cursor — ver risco A3.
- `onJumpToPage` na popout vira `emitTo("main", "reader:jump-to-page",
  { documentId, page })`; o `ReaderModal` escuta e chama o
  `scrollToPage` existente.

Interações com o estado otimista: o fluxo otimista de criação
(`persistNewAnnotation`) continua como está na principal; o
`createAnnotation` só emite após o INSERT confirmar, então o re-fetch
remoto nunca vê estado "saving". Um re-fetch **local** disparado por
evento remoto enquanto há criações "unsaved" pendentes na principal
poderia descartá-las da lista — o listener da principal deve preservar
itens com `saveStates` ≠ saved ao mesclar (detalhe para a fase de
implementação, registrado como risco A4).

---

## 5. Ciclo de vida da janela (item 4) — opções para decisão

### Decisão A — documento fechado na principal com a popout aberta

| Opção | Comportamento | Implicações |
|---|---|---|
| **A-1** Popout continua funcional | Continua lendo/escrevendo no banco (é autossuficiente na v2). | "Pular para página" vira no-op ou reabre o leitor (mais escopo). Janela órfã pode confundir ("por que isto ainda está aberto?"). Zero risco de perda de dados. |
| **A-2** Popout fecha junto | `ReaderModal` no unmount (ou o LibraryView ao fechar o leitor) emite `reader:document-closed`; a popout se fecha (`getCurrentWindow().close()`), ou um comando Rust fecha pelo label. | Comportamento mais previsível ("a popout é um pedaço do leitor"). Edição em andamento na popout: o save é imediato/500 ms, então a janela precisa dar flush antes de fechar (mesmo padrão do `flushNotes`). |
| **A-3** Popout mostra estado "documento fechado" | Banner + ações (reabrir na principal / fechar). | Melhor UX teórica, mais código e mais um estado para manter. |

Caso relacionado que precisa de decisão junto: **fechar a janela
principal inteira** (não só o ReaderModal). Por default o Tauri mantém
o processo vivo enquanto existir qualquer janela — a popout ficaria
sozinha, sem biblioteca. Se a escolha for "popout morre com a
principal", o lado Rust adiciona um `.on_window_event` no builder que,
em `WindowEvent::CloseRequested`/`Destroyed` da `main`, fecha as
popouts (ou simplesmente `app.exit(0)`).

### Decisão B — label fixo (1 popout global) vs label por documento

| | **B-1: label fixo** (`reader-annotations-panel`) | **B-2: label por documento** (`reader-annotations-<uuid>`) |
|---|---|---|
| Popouts simultâneas | 1 (troca de documento reaproveita a janela) | N (uma por documento) |
| Memória | +1 WebView (dezenas de MB no WebView2) | +N WebViews — conflita com a prioridade nº 3 do projeto (baixo consumo) |
| Capability | Label literal no array `windows` | Glob `reader-annotations-*` |
| Coerência com o app | Alinha com o modelo atual de **um leitor por vez** (`openForReading` fecha outros leitores — [LibraryView.tsx:425-437](src/features/library/LibraryView.tsx#L425-L437)) e com a dedup da pilha de painéis | Cria a situação "popout de um documento cujo leitor não existe mais" como caso comum → força a Decisão A-1 ou A-3 |
| Complexidade | Precisa do mecanismo de troca de documento (Decisão C) | Precisa de gestão de N janelas + validação do id no label |
| Rust | `get_webview_window(label)` simples | O `documentId` vindo do IPC precisa ser validado (formato UUID) antes de entrar no label/URL — labels só aceitam `[a-zA-Z0-9-/:_]`, e input IPC é não-confiável por regra do AGENTS.md |

### Decisão C — clicar em "janela separada" com popout aberta para OUTRO documento

(Só existe com B-1.) A implementação anterior fazia apenas
`set_focus()` — o conteúdo continuava do documento antigo. Opções:

- **C-1 Trocar o conteúdo**: o comando Rust foca a janela existente,
  atualiza o título (`window.set_title(...)` — feito no Rust, dispensa
  a permission `core:window:allow-set-title` no JS) e emite
  `reader:set-document { documentId }` para a popout recarregar do
  banco. É o comportamento espelhado da pilha interna ("abrir entidade
  já ativa foca o painel existente").
- **C-2 Fechar e recriar**: mais simples de raciocinar, com flash de
  janela. Só faz sentido se C-1 se mostrar frágil.

---

## 6. O que precisa ser (re)criado no lado Rust (item 5)

Detalhado, já que é a parte em aprendizado:

1. **Comando `open_reader_panel_window`** (recriar, com ajustes):
   ```rust
   #[tauri::command]
   fn open_reader_panel_window<R: tauri::Runtime>(
     app: tauri::AppHandle<R>,
     document_id: String,
     document_title: String,
   ) -> Result<(), String>
   ```
   - Diferenças vs. a versão revertida: recebe `document_id`, valida o
     formato (UUID) antes de usá-lo em URL/label (input IPC é
     não-confiável), e monta a URL como
     `index.html?readerPanel=1&documentId=<id>` — a popout descobre o
     documento pela URL e busca **tudo** no banco (nada de
     `localStorage`).
   - `WebviewWindowBuilder::new(&app, label, WebviewUrl::App(...))` é o
     mesmo padrão de antes; `WebviewUrl::App` resolve para o `devUrl`
     em dev e para o bundle em produção — funcionou na v1, o problema
     nunca foi esse.
   - Se a janela já existe (`app.get_webview_window(label)`):
     `set_focus()` + comportamento da Decisão C.
   - Por que um comando Rust e não `new WebviewWindow(...)` no JS:
     criar janela pelo JS exigiria a permission
     `core:webview:allow-create-webview-window` (fora do
     `core:default`); o comando Rust é lado confiável, não passa por
     capability, e é onde título/label são montados com validação —
     consistente com a divisão de responsabilidades do AGENTS.md
     (integração com SO fica no Rust).
2. **`DbInstances`: nada a fazer.** É estado gerenciado do app; os
   comandos do plugin-sql funcionam de qualquer WebView (§3.1). Nenhum
   comando novo de banco é necessário — todas as operações da popout
   são statements únicos já existentes no TS.
3. **`listen`/`emit`: nada a fazer no builder.** O sistema de eventos é
   core (não é plugin, não se registra). O que faltava na v1 não era
   nada no builder — era a entrada de capability para a popout, que a
   v1 nunca precisou porque não usava banco nem eventos.
4. **Capability** (config): incluir o label da popout —
   `"windows": ["main", "reader-annotations-panel"]` na capability
   atual, ou (recomendado) capability separada só com `core:default` +
   `sql:allow-select` + `sql:allow-execute` (menor privilégio; sem
   `fs:*`, sem `sql:allow-load`).
5. **Opcional, conforme Decisão A**: `.on_window_event(...)` no builder
   para fechar a popout quando a `main` fechar; e/ou o handler de
   `CloseRequested` da popout se for necessário flush antes de fechar.

Nenhuma migration: a feature usa exclusivamente o schema existente
(`documents.notes`, `annotations`).

---

## 7. Riscos, por severidade

### Altos

- **A1 — Capability ausente** (§3.3): sem o label da popout em
  `capabilities`, toda query e todo `listen` falham em runtime. É o
  erro estrutural mais provável de uma v2 ingênua, e não aparece em
  `cargo check`/`tsc` — só rodando.
- **A2 — `Database.load` na popout substitui o pool** (§3.2): usar o
  `getDatabase()` atual na popout recria o pool a cada abertura e
  re-roda seed/purge. Usar `Database.get()` (banco já em `preload`).
- **A3 — Edição simultânea das notas livres**: dois editores
  `contenteditable` vivos sobre `documents.notes` com debounce de
  500 ms = last-write-wins entre janelas; o re-fetch por evento pode
  reescrever o editor da outra janela no meio da digitação
  (reposiciona cursor / perde tecladas entre o save remoto e o
  re-fetch). Não tem solução barata perfeita; opções na pergunta Q3.
- **A4 — Re-fetch descartando estado otimista**: um `listAnnotations`
  disparado por evento na principal pode apagar da lista criações ainda
  "saving"/"unsaved" (retry pendente). O merge do listener precisa
  preservar itens com `saveStates` não confirmado.

### Médios

- **M1 — Ciclo de vida órfão**: sem a Decisão A implementada, fechar o
  leitor/principal deixa a popout num estado não especificado (hoje o
  cleanup do ReaderModal só fecha painéis internos da pilha —
  [ReaderModal.tsx:578-583](src/features/library/ReaderModal.tsx#L578-L583)).
- **M2 — Consumo de memória por janela**: cada WebView2 extra custa
  dezenas de MB (prioridade nº 3 do projeto). Pesa na decisão B-1 vs
  B-2.
- **M3 — Bundle inteiro na popout**: com um único entry
  (`index.html?readerPanel=1`), a popout avalia `pdfjs-dist`, `konva` e
  `katex` sem usar (imports estáticos de `App.tsx`/`LibraryView`).
  Mitigações: branch com `import()` dinâmico ou entry Vite separado
  (`popout.html`). Custo/benefício a decidir na implementação.
- **M4 — Cache da biblioteca desatualizado na principal**: hoje
  `saveDocumentNote` atualiza o cache do react-query da `main`. Notas
  salvas pela popout precisam invalidar esse cache (o listener de
  `reader:notes-changed` na principal deve também atualizar/invalidar
  `["library"]`), senão reabrir o leitor mostra nota velha vinda do
  snapshot.

### Baixos

- **B1 — Tema**: a popout precisa do `ThemeProvider` (ou equivalente)
  para respeitar claro/escuro.
- **B2 — StrictMode**: em dev, effects montam duas vezes — os `listen`
  precisam de cleanup correto (`unlisten`) para não duplicar handlers.
- **B3 — Título da janela**: `format!("Anotações — {title}")` com
  título arbitrário é seguro como título de janela, mas o `set_title`
  na troca de documento (C-1) não pode ficar dessincronizado do
  conteúdo.
- **B4 — `formatRelativeTime`/ordenacão**: nenhum impacto novo — dados
  re-buscados do banco chegam consistentes.

---

## 8. Fora do escopo desta fase (e da v2 em si)

- Renderizar o PDF na popout, ou sincronizar entre janelas: scroll,
  página atual, zoom, posição de leitura, modo marca-texto, seleção de
  texto. A popout é só o painel de abas.
- Timer de leitura, progresso e tags na popout (o painel interno nem os
  exibe hoje).
- Ask AI funcional (a aba é placeholder).
- Múltiplos leitores simultâneos na janela principal (modelo atual é um
  por vez e permanece).
- Migrations (nenhuma é necessária) e qualquer mudança de schema.
- Refactor do fluxo otimista de anotações além do merge mínimo (A4).
- Nesta fase: **nenhuma alteração de código foi feita e nada será
  commitado** — este documento é o único artefato.

---

## 9. Perguntas em aberto (decisões do usuário)

- **Q1 (Decisão A)**: fechar o documento na principal → popout continua
  (A-1), fecha junto (A-2) ou mostra estado "fechado" (A-3)? E fechar a
  janela principal inteira encerra o app/popout?
- **Q2 (Decisão B)**: 1 popout global com label fixo (B-1) ou 1 por
  documento (B-2)? (A análise favorece B-1 pelo alinhamento com "um
  leitor por vez" e pela memória, mas a escolha é sua.)
- **Q3 (risco A3)**: política para edição simultânea de notas —
  (a) aceitar last-write-wins e **não** aplicar atualização remota
  enquanto o editor local está focado/sujo; (b) enquanto a popout está
  aberta, a aba Notas da principal fica somente leitura (dona única da
  edição é a popout); ou (c) outra regra?
- **Q4**: a janela nativa **substitui** o painel flutuante interno
  (botão popout passa a abrir a janela do SO) ou vira **terceiro
  estado** (docked → flutuante interno → janela do SO)?
- **Q5 (M3)**: vale um entry Vite separado para a popout (bundle menor,
  build mais complexo) ou o entry único com import dinâmico basta?
- **Q6**: a popout deve exibir a aba Ask AI (placeholder) ou só
  Notas/Anotações até a IA existir?
