# AGENTS.md — Athenaeum

## Purpose

This file defines the canonical engineering, architecture, safety, and
workflow instructions for coding agents and contributors working in this
repository.

Read this file before analyzing, planning, or modifying the project.

If another agent-specific instruction file conflicts with this document,
follow `AGENTS.md`.

---

## Project

Athenaeum is an offline-first desktop application for organizing, reading,
annotating, and studying PDFs and academic materials.

All user data is stored locally. The application has:

- no cloud dependency;
- no user account;
- no remote application server.

The user interface is written in Portuguese (`pt-BR`).

Code comments in TypeScript and Rust should also be written in Portuguese,
unless an existing file consistently uses another language.

---

## Limitações conhecidas de plataforma

**Clique duplo necessário após a janela do Reader ganhar foco (Windows).**
Em janelas Tauri/WebView2, o primeiro clique após a janela sair de
segundo plano é consumido pelo próprio SO só para trazer foco — não
chega como evento de clique ao React. Isso NÃO é um bug do Athenaeum
nem tem relação com scrollToPage/handleReaderScroll/qualquer lógica
de navegação. É uma limitação de engine sem correção oficial até
agosto/2026 (tauri-apps/wry#637). Se reportado de novo, não investigar
como bug de estado/scroll — confirmar primeiro se o problema
desaparece quando a janela já está em foco antes do clique.

## Limitações conhecidas do editor de Caderno

### Blocos de código perdem estilo até o reload

Ao aplicar realce ou cor em qualquer ponto da página,
`normalizeTextColorElement` interpreta todo elemento com `background` ou
`color` inline como carrier transitório e chama
`removeInlineColorStyles`. O estilo semântico do próprio `<code>` é
atingido, inclusive em blocos distantes da seleção, porque
`normalizeNotebookTextColors` percorre todo o editor.

O efeito é visual e temporário: `prepareCodeElements` restaura o estilo
ao trocar de página ou recarregar. O HTML persistido perde as
propriedades inline `background` e `color`, mas preserva a tag `<code>`,
o conteúdo e os spans de realce/cor. A exportação gera `<pre><code>`
com CSS próprio e não depende dessas propriedades. Não há corrupção de
conteúdo.

### Fonte de equação rejeita realce silenciosamente

`execCommand` dispara `input` de forma síncrona. Assim,
`handleInput` → `emitChange` → `normalizeEquations` executa
`source.textContent = source.textContent` e achata o `<figcaption>`
antes que `applyNotebookTextColor` restaure a seleção.

A operação é descartada sem feedback; o LaTeX persistido fica intacto e
não há corrupção. Há uma inconsistência deliberadamente ainda não
resolvida: a fonte de diagrama, que também é uma linguagem de sintaxe
consumida por parser, aceita realce hoje. A decisão de produto de
unificar os comportamentos permanece pendente.

### Bug histórico de realce em texto errado — não reabrir

O relato de que o realce caía no texto errado em páginas com blocos de
código foi corrigido em `6c02f78`, que moveu a criação dos marcadores de
seleção para antes de `execCommand`. O diagnóstico no `5f0f731` executou
21 aplicações de realce, incluindo arraste real de ponteiro, sem nenhum
deslocamento. Callout, tabela, diagrama, figura e anexo também ficaram
exatos.

O caminho atual deve ser preservado: clona a `Range`, insere marcadores
DOM nos extremos, reconstrói a seleção entre eles, executa
`hiliteColor`/`foreColor`, normaliza o markup transitório e restaura a
seleção pelos mesmos marcadores. O WebView2 troca os nós extremos após
`execCommand`, mas os marcadores permanecem na posição original; é isso
que impede o deslocamento. Alterar a ordem dos marcadores reintroduz o
bug.

## Notas de arquitetura do Reader

### Wrapper de ilha flutuante deve ser pointer-events-none

Um wrapper de chrome flutuante do Reader (ex.: o header,
`absolute inset-x-0 top-0`) costuma ser maior que a pílula visível
dentro dele — cobre 100% da largura da janela, mas só uma faixa
central tem conteúdo real. Se esse wrapper não for
`pointer-events-none`, a área transparente ao redor da pílula fica
hit-testável e intercepta ponteiro destinado ao que está por baixo.

Bug corrigido: o header do Reader (`ReaderChrome.tsx`) cobria os 84px
superiores da janela inteira, incluindo a faixa de 11px da barra de
rolagem vertical na borda direita. Como o header ficava em `z-30`
contra o `z-auto` do workspace, a scrollbar nativa ficava morta sempre
que o thumb estava nesses primeiros 84px — sintoma reportado como
"scrollbar quebrada", sem relação com lógica de scroll.

Regra: o wrapper leva `pointer-events-none`; os contêineres realmente
interativos dentro dele (a pílula inteira, não botão a botão) levam
`pointer-events-auto`. Nunca deixar a área transparente hit-testável.

Se o wrapper tiver um estado oculto (`--hidden`) que também depende de
`pointer-events: none`, um seletor de especificidade simples
(`.classe--hidden *`) empata em especificidade com
`.pointer-events-auto` e a vitória passa a depender da ordem de
origem no CSS gerado — frágil a mudanças no pipeline de build. Use
especificidade composta (`.classe.classe--hidden *`) para vencer por
especificidade em vez de depender de ordem.

### Header do Reader não arrasta a janela

O wrapper do header (`ReaderChrome.tsx`) tem um `onMouseDown`
condicionado a uma prop `draggable`, mas essa prop nunca é `true` em
produção: o único consumidor de `ReaderContent`
(`ReaderWindowRoot.tsx`) chama `renderHeader()` sem passar
`startDragging`. As decorações da janela do Reader são nativas do
Tauri (`decorations(true)` em `src-tauri/src/lib.rs`); não há arraste
por chrome customizado hoje.

Se o arraste por chrome customizado for retomado no futuro, a faixa
arrastável precisa de um contêiner próprio com `pointer-events-auto`
— depois da regra acima, o restante do wrapper é
`pointer-events-none` e não repassa mais eventos de mouse.

## Fixed stack

The technology stack is a closed project decision:

- Tauri 2;
- Rust;
- React 18;
- TypeScript;
- Tailwind CSS;
- SQLite;
- SQLite FTS5;
- `tauri-plugin-sql`;
- pdf.js.

Do not replace or propose replacing this stack with Electron, Next.js,
another frontend framework, another database, another ORM, or another
desktop runtime unless the user explicitly requests an architectural
reevaluation.

---

## Engineering priorities

Apply these priorities in this exact order:

1. Reliability
2. Performance
3. Low resource consumption
4. Development speed

Prefer a more reliable implementation over a faster implementation process.

Avoid designs that unnecessarily duplicate large data across the WebView,
IPC boundary, Rust memory, and filesystem buffers.

---

## Commands

### Full application — isolated dev profile (use this one)

```bash
npm run tauri:dev
```

Runs the frontend and Tauri shell in development mode against a **disposable
data profile** (`identifier` `io.github.aurelio-dev.athenaeum.dev`, overlay in
`src-tauri/tauri.dev.conf.json`). Use this for any manual test.

```bash
npm run dev:reset
```

Deletes the dev profile. The next `tauri:dev` recreates the database from
scratch, running migrations `v1..v23`. Close the app first.

### Full application — real user data

```bash
npm run tauri dev
```

Same thing, but against the **user's real library**: same `identifier` as the
installed build, so the same SQLite file and the same PDF folder. Every manual
action becomes permanent data — merely opening a document writes
`last_opened_at`, and applying a highlight writes an annotation row.

Do not use this for manual testing. Prefer `npm run tauri:dev` unless the task
is specifically about the real data.

The first run may take several minutes because Rust dependencies need to be
compiled. Switching between the two commands changes the config the Rust build
sees, so it triggers a recompile.

### Frontend only

```bash
npm run dev
```

Use for UI work that does not require native commands, filesystem access, or
SQLite through the Tauri environment.

### Frontend build

```bash
npm run build
```

Runs the TypeScript check and Vite build.

### Production application build

```bash
npm run tauri build
```

Builds the production binary and installer.

### TypeScript validation

```bash
npm run typecheck
```

### Frontend tests

```bash
npm test
```

### Individual diagram parser test

```bash
npx vitest run src/features/notebooks/notebookDiagramParser.test.ts
```

### Rust validation

From the repository root:

```bash
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

Standard Cargo commands may also be run from `src-tauri/`.

Execute only validations relevant to the modified scope.

Do not install or update dependencies without a demonstrated need and
explicit approval when the change is not already part of the requested task.

---

## Fonts

The interface uses Segoe UI when the required local font files are available.

Segoe UI font files are not distributed in the repository and are ignored
under:

```text
src/assets/fonts/*.ttf
```

On Windows, the files may be copied from:

```text
C:\Windows\Fonts
```

Follow the table in `README.md` when a build must visually match the design
reference.

Without Segoe UI files, the application must continue working with its
configured fallback fonts, such as:

- Inter;
- IBM Plex Sans;
- `system-ui`.

Do not commit proprietary font files.

---

## Architecture

### TypeScript and Rust responsibilities

The division between TypeScript and Rust is a core architectural decision.

#### TypeScript owns

Use TypeScript for:

- React UI;
- client-side state;
- editor behavior;
- content transformation;
- parsing and rendering logic already implemented in the frontend;
- ordinary SQLite reads;
- ordinary SQLite writes that can be completed safely with one SQL statement;
- persistence through `src/lib/database.ts`;
- logic that does not require privileged filesystem or operating-system access.

Most database operations should continue using `tauri-plugin-sql`.

Do not add a Rust command for an operation that can already be performed
safely with one atomic SQL statement.

#### Rust owns

Use Rust for:

- filesystem access;
- native file dialogs;
- opening files or URLs through the operating system;
- validation and canonicalization of filesystem paths;
- binary asset reads and writes;
- operations requiring coherence between filesystem and database;
- real multi-statement database transactions;
- file operations requiring temporary files and safe finalization;
- operating-system integrations;
- native commands that cannot be implemented safely through
  `tauri-plugin-sql`.

Do not duplicate in Rust a parser, renderer, or transformation whose source
of truth already exists in TypeScript unless there is a concrete
architectural requirement.

---

## Existing Rust command patterns

### Multi-row atomic database operations

`import_document` uses Rust because it writes several related records inside
one real transaction.

Its filesystem and database order is intentional:

1. copy the PDF;
2. write database records;
3. remove the copied file if the transaction fails.

Preserve this type of explicit coherence ordering.

### Binary assets

Commands such as:

- `save_canvas_file`;
- `save_notebook_asset`;
- `save_notebook_file_attachment`;

exist because a file on disk and its database record must remain coherent.

The expected pattern is:

1. validate all client-provided IDs and names;
2. write to a temporary file;
3. flush and finalize the file safely;
4. rename the temporary file into place;
5. only then insert or update the database record;
6. clean up the temporary or final file when a later step fails.

A process interruption must not leave a partially written file that appears
valid.

Missing physical files should be handled explicitly. Existing loading
behavior may skip missing files with a log message instead of failing an
entire collection, where appropriate.

### Native and path-derived commands

Commands such as:

- `select_pdf_file`;
- `select_pdf_files`;
- `read_pdf_file`;
- `open_file_location`;
- `open_external_url`;
- `open_notebook_file_attachment`;

must remain in Rust because they interact with the filesystem, native
dialogs, or operating-system shell.

---

## Filesystem and IPC security

Values received from the frontend are untrusted IPC input.

Before turning a client-provided value into a filesystem path:

- validate the identifier;
- validate the expected format;
- validate resource ownership;
- resolve paths from trusted application directories;
- reject path traversal;
- reject absolute paths where only internal IDs are expected;
- avoid trusting filenames sent by the frontend;
- never expose internal absolute paths unnecessarily.

Reuse existing validation patterns such as:

- `validate_file_id`;
- `validate_numeric_path_id`;
- `sanitize_attachment_file_name`;
- `resolve_app_data_relative_path`.

Do not weaken existing allowlists.

Do not construct filesystem paths by directly concatenating unvalidated IPC
strings.

---

## Large files and memory

Avoid loading multiple large binary resources into memory simultaneously.

For operations involving potentially large files:

- prefer buffered reads;
- prefer buffered writes;
- prefer streaming transformations;
- release each resource before processing the next;
- avoid creating full binary and base64 copies at the same time;
- avoid sending large base64 payloads through the Tauri IPC boundary when
  Rust can write them directly.

Do not use `std::fs::read()` followed by a full in-memory encoding for
unbounded export or attachment workflows when a streaming implementation is
possible.

---

## Database and migrations

The schema is registered in:

```text
src-tauri/src/lib.rs
```

through `database_migrations()`.

Early migrations are inline Rust string literals.

From migration v9 onward, SQL lives under:

```text
src-tauri/migrations/
```

and is included with `include_str!`.

Follow the external SQL-file pattern for future migrations.

### Migration rules

- Migrations are forward-only.
- Number migrations sequentially.
- Never edit a historical migration that may already have been applied.
- Never rewrite an old migration to fix a new requirement.
- Create a new migration only when the database schema truly changes.
- Do not create a migration for read-only functionality.
- Review the migration registration diff carefully when modifying
  `src-tauri/src/lib.rs`.
- Preserve existing foreign-key and cascade decisions unless the task
  explicitly requires changing them.

### Main tables

The current schema includes:

- `collections`;
- `documents`;
- `document_authors`;
- `document_tags`;
- `tags`;
- `documents_fts`;
- `annotations`;
- `notebooks`;
- `notebook_pages`;
- `notebook_assets`;
- `notebook_file_attachments`;
- `notebook_tags`;
- `notebook_linked_documents`;
- `canvases`;
- `canvas_files`;
- `app_settings`.

`documents_fts` uses SQLite FTS5 and is maintained through database triggers.

---

## Frontend structure

```text
src/
├── app/
│   └── App.tsx
├── components/
├── features/
│   ├── library/
│   ├── reader/
│   ├── notebooks/
│   ├── canvases/
│   └── settings/
├── lib/
│   ├── database.ts
│   └── tagColors.ts
├── styles/
│   └── designTokens.ts
└── types/
```

### Relevant responsibilities

- `src/app/App.tsx`:
  root composition and provider hierarchy.

- `src/components/`:
  shared UI components, badges, navigation, floating-panel chrome and menu
  primitives.

- `src/features/library/`:
  library views, cards, import flows, toolbar and document details.

- `src/features/reader/`:
  PDF rendering, text layer, highlights and annotation panels.

- `src/features/notebooks/`:
  notebook panel, rich-text editor, page management and block-specific DOM
  helpers.

- `src/features/canvases/`:
  Konva-based canvases with application-owned UI.

- `src/features/settings/`:
  settings interface.

- `src/lib/database.ts`:
  frontend SQLite access through `tauri-plugin-sql`.

---

## Floating panels

Reader, notebook, canvas, settings and annotation panels use the shared
floating-panel stack.

Panels are identified by a key similar to:

```text
${type}-${entityId}
```

Opening an already active entity should focus the existing panel instead of
creating a duplicate.

The `z-index` must be derived from stack position, using the existing base
and ordering logic.

Do not replace this with an ever-increasing global counter. Repeated
refocusing must not leak panel `z-index` values into the modal range.

Preserve:

- deduplication;
- focus ordering;
- panel stacking;
- modal separation;
- close behavior.

---

## Notebook editor

The notebook editor uses a custom `contenteditable` DOM implementation rather
than a rich-text framework.

Block-specific DOM behavior is separated into modules such as:

- attachment helpers;
- callout helpers;
- equation helpers;
- figure helpers;
- diagram helpers.

The main editor contains orchestration, event handling, selection, range,
autosave, paste and toolbar behavior.

### Preserve these invariants

Unless the task explicitly requires changing them, preserve:

- autosave behavior;
- pending draft handling;
- current selection;
- browser range;
- caret restoration;
- page switching behavior;
- paste behavior;
- clipboard behavior;
- persisted HTML structure;
- existing `data-*` attributes;
- compatibility with legacy blocks;
- hydration and dehydration behavior;
- contextual toolbars;
- image handling;
- attachment handling;
- callouts;
- equations;
- diagrams;
- tables;
- links;
- keyboard navigation;
- focus mode;
- zoom and spacing settings.

### Persisted HTML

Do not persist runtime-only data such as:

- generated SVG previews;
- generated KaTeX preview HTML;
- runtime image URLs;
- `data:` image payloads;
- absolute filesystem paths;
- editor controls;
- contextual toolbars;
- resize handles;
- temporary selection state.

Runtime visual content must be recreated from persisted semantic data.

### Autosave

When implementing operations that depend on the latest page content, inspect
the existing draft refs, debounce logic and save promises.

Do not assume the database already contains the latest text while the user is
actively editing.

An export, navigation or destructive action that requires the newest content
must explicitly coordinate with pending autosave state.

Avoid introducing global state or abstractions when a local callback or
existing save function is sufficient.

---

## Notebook assets and attachments

### Images

Notebook images are stored on disk.

Persisted HTML references them through IDs such as:

```html
<img data-notebook-asset-id="..." />
```

Do not persist image bytes or absolute paths in notebook page HTML.

### Attachments

Notebook attachments are stored on disk and represented in persisted HTML by
an attachment ID.

For any command that reads, opens, reveals, removes or exports an attachment:

- validate the attachment ID;
- verify its notebook and page association;
- resolve the path from trusted database data;
- preserve the original filename where needed;
- sanitize filenames before inserting them into HTML or filesystem paths;
- handle missing files explicitly.

The frontend must not be treated as the authoritative source for physical
paths, MIME types or resource ownership.

---

## Diagrams

Diagram blocks persist semantic source data rather than generated SVG.

Supported kinds include:

- diagram;
- graph;
- cycle graph;
- flowchart.

Preserve attributes such as:

- `data-athenaeum-block`;
- `data-diagram-kind`;
- `data-diagram-source`;
- `data-diagram-scale`.

`notebookDiagramParser.ts` is the parser source of truth.

Do not create another parser with different behavior.

When diagram rendering logic is needed outside the editor, prefer:

1. a pure shared render model;
2. a pure SVG-generation function;
3. reuse of existing rendering components when extraction would be
   disproportionate.

Do not persist generated SVG in the notebook database unless the project
architecture is explicitly changed.

Invalid diagram syntax must have a visible and safe fallback instead of
producing an empty block.

---

## Equations

Equation blocks persist their LaTeX source.

KaTeX rendering is runtime behavior.

Preserve the existing safety configuration:

```ts
{
  displayMode: true,
  throwOnError: false,
  trust: false
}
```

For accessible static rendering, prefer HTML and MathML output where
supported.

Do not persist generated KaTeX preview markup as the source of truth.

Invalid equations must show a safe textual fallback.

---

## Tags and design tokens

Subject tags use a fixed token palette defined through the project tag-color
system.

Relevant files include:

```text
src/lib/tagColors.ts
docs/design/athenaeum-design-tokens-cores.md
```

The palette is designed to satisfy WCAG AA contrast requirements.

Rules:

- do not invent a new hexadecimal color for an individual tag;
- reuse existing semantic tokens;
- preserve consistent colors for the same tag;
- do not use status-reserved colors as ordinary subject colors;
- `green`, `red`, and `slate` are reserved for status semantics;
- use theme variables instead of hardcoded colors in components;
- preserve light and dark theme behavior.

Do not introduce a parallel color system.

---

## TypeScript and React conventions

- Use functional React components.
- Do not introduce `any`.
- Prefer explicit domain types.
- Use discriminated unions where appropriate.
- Prefer composition over inheritance.
- Avoid premature abstraction.
- Avoid generic “manager”, “service”, or “helper” layers without a concrete
  need.
- Reuse existing utilities when they are the real source of truth.
- Do not duplicate parsers or validation rules.
- Keep component responsibilities understandable.
- Use clear names for state, callbacks and domain objects.
- Preserve existing public component contracts unless the task requires a
  change.
- Do not apply unrelated refactors during a feature implementation.

---

## Rust conventions

- Add a new `#[tauri::command]` only when TypeScript and
  `tauri-plugin-sql` cannot safely perform the operation.
- Validate all IPC input.
- Prefer explicit error handling.
- Do not panic on user-controlled input.
- Avoid `unwrap()` in paths reachable through normal user data unless the
  invariant is proven locally.
- Use buffered I/O for large files.
- Keep temporary files in a location compatible with safe finalization.
- Clean temporary files after failure.
- Preserve filesystem and database operation ordering.
- Do not expose internal filesystem paths without need.
- Add short comments in Portuguese for non-obvious safety or coherence logic.
- Avoid abstractions that make the filesystem sequence harder to audit.

---

## HTML and content security

When generating HTML outside the live editor:

- start from persisted content;
- parse into an isolated document;
- use an explicit allowlist;
- remove `<script>`;
- remove `on*` event attributes;
- reject `javascript:` URLs;
- remove internal WebView URLs;
- remove runtime editor controls;
- remove `contenteditable`;
- remove temporary IDs or prefix IDs to avoid collisions;
- escape titles, labels, captions and filenames;
- do not expose absolute paths;
- block script execution in static exports.

Do not copy the live editor DOM directly when persisted semantic content is
available.

---

## Workflow

### Before modifying code

1. Read `AGENTS.md`.
2. Read any relevant agent-specific instruction file.
3. Inspect the current implementation.
4. Identify the existing source of truth.
5. Run `git status`.
6. Check for user changes that must not be overwritten.
7. Map the files and symbols involved.
8. Identify likely regression risks.
9. Confirm whether the task is investigation, planning or implementation.

### During implementation

- Keep changes within the approved scope.
- Prefer small and independently verifiable phases.
- Preserve existing behavior outside the feature.
- Do not silently expand the task.
- Do not change public persistence formats without explicit approval.
- Do not install dependencies merely for convenience.
- Do not create a migration unless schema changes require it.
- Do not use destructive Git commands to discard local work.
- Do not edit generated or vendor files unless explicitly required.

### After modifying code

1. Review the complete diff.
2. Confirm no unrelated files changed.
3. Run relevant TypeScript checks.
4. Run relevant frontend tests.
5. Run relevant Rust checks and tests.
6. Verify migration files were not unintentionally modified.
7. Report limitations and remaining risks.
8. Report the final Git status.

---

## Investigation-only phases

When a task is explicitly a discovery or planning phase:

- do not alter production files;
- do not create documentation in the repository unless requested;
- do not install dependencies;
- do not execute migrations;
- do not make commits;
- inspect real files and symbols;
- distinguish facts from inference;
- provide exact paths and symbol names;
- do not begin implementation after delivering the plan.

---

## Completion reports

At the end of an implementation phase, report:

- files created;
- files modified;
- functionality implemented;
- validations executed;
- tests passed;
- tests not executed;
- failures encountered;
- known limitations;
- remaining risks;
- final `git status`.

Do not claim that a check passed unless it was actually executed.

Do not describe a placeholder or partial implementation as complete.

User-facing summaries should be written in Portuguese.
