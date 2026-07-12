# Sistema de Export — Fase 0 (Discovery)

Data: 2026-07-11. Fase somente de leitura: nenhum arquivo de produção foi
alterado. Migration v8 (`add_reader_info_fields_and_annotation_colors`,
`src-tauri/src/lib.rs:2948-3011`) verificada e íntegra — rebuild da tabela
`annotations` com colunas, índices e trigger consistentes.

---

## Resumo executivo

**O achado central desta discovery é que a arquitetura decidida já está
implementada e commitada em `main`, de ponta a ponta.** O pipeline
TS → sentinelas → manifest → Rust streaming → temp-then-rename existe e tem
testes nos dois lados (commits `6d30810`, `ed28559`, `1024ae1`, `6e585d0`).
O builder TS (`notebookExportHtml.ts`) sanitiza o HTML persistido e emite
sentinelas; o comando Rust `write_notebook_export` resolve cada slot no
banco, embute base64 em streaming (`EncoderWriter` + `BufWriter`) e grava
com temporário exclusivo + rename + backup recuperável. Diagramas já viram
SVG estático e KaTeX já sai como HTML+MathML. **O único item da arquitetura
decidida que NÃO existe é a UX de estimativa de tamanho pré-export
(~100MB)** — e há três divergências de detalhe entre o brief e o código
real, listadas em "Divergências", que precisam de decisão antes da Fase 1.

---

## 1. Estado real vs. arquitetura decidida

| Item da arquitetura decidida | Estado no código |
| --- | --- |
| HTML autocontido único (página atual OU caderno completo) | **Implementado** — escopos `current-page` / `full-notebook` no diálogo do `NotebookPanel.tsx` |
| TS monta template leve com sentinelas de comentário | **Implementado** — com divergência de formato (ver Divergência 1) |
| Rust dono da substituição incremental via streaming (BufWriter), base64 um asset por vez | **Implementado** — `write_notebook_export` (`lib.rs:2121-2518`) |
| Escrita temp-then-rename atômica | **Implementado** — com backup recuperável para sobrescrita no Windows |
| Diagramas viram SVG estático | **Implementado** — `notebookDiagramStaticSvg.ts`, função pura sobre o parser canônico |
| KaTeX vira HTML+MathML | **Implementado** — `output: "htmlAndMathml"` em `notebookExportKatex.ts:69` |
| Lora embutida em base64 só quando o conteúdo relevante está presente | **Parcial** — embutida sempre, e via TS, não via Rust (ver Divergências 2 e 3) |
| UX de estimativa de tamanho pré-export (~100MB) | **Não existe** — nenhum cálculo agregado pré-export no código |

### Divergências entre o brief e o código real

1. **Formato da sentinela.** O brief descreve dois formatos
   (`<!--ATHENAEUM_ASSET:{nonce}:{id}-->` e
   `<!--ATHENAEUM_ATTACHMENT:{nonce}:{id}-->`). O código usa **um único
   formato**: `<!--ATHENAEUM_SLOT:{nonce}:{slotId}-->`, com o tipo
   (`notebook-asset` | `notebook-attachment`) e o `resourceId` vivendo no
   **manifest** tipado, não na sentinela. Emissão em
   `createNotebookExportSlotSentinel` (`notebookExportHtml.ts:223`);
   parsing Rust em `parse_export_slot_sentinels` (`lib.rs:1529`). O
   contrato é fechado nos dois lados (`deny_unknown_fields`, padrões de
   nonce/slot espelhados) e coberto por testes — mudar o formato agora
   quebraria o contrato TS↔Rust sem ganho funcional.

2. **Fonte Lora não passa pelo Rust.** O brief supunha "self-hosted .ttf +
   caminho de acesso a partir do Rust para embutir em base64". No código,
   a Lora (Medium 500 e Bold 700, `src/assets/fonts/Lora-*.ttf`, licença
   OFL) já foi convertida **em build-time** para um módulo TS gerado com
   Data URLs (`notebookExportLoraFontCss.generated.ts`, ~352 KB), carregado
   por import dinâmico só no momento do export
   (`notebookExportFonts.ts:9-12`). O Rust nunca toca nos .ttf. Não há
   script de regeneração automatizado — o cabeçalho do módulo instrui a
   regenerar manualmente se os .ttf mudarem.

3. **Condicionalidade das fontes.** O CSS do KaTeX (~360 KB,
   `notebookExportKatexCss.generated.ts`, KaTeX 0.17.0 com WOFF2 em Data
   URLs) é condicional: só entra se alguma equação foi de fato renderizada
   (`loadKatexStylesIfNeeded`, `notebookExportHtml.ts:1426-1433`). A Lora,
   porém, é incluída **incondicionalmente**
   (`notebookExportHtml.ts:1490-1493`). Fato atenuante: o título do export
   sempre usa `--ax-serif` (Lora), então "conteúdo relevante" está sempre
   presente no template atual — mas isso difere da regra enunciada no
   brief.

---

## 2. Mapa de pontos de toque (arquivo por arquivo)

### Frontend — pipeline de export

- **`src/features/notebooks/notebookExportHtml.ts`** (1510 linhas) — fonte
  de verdade do build. `buildNotebookExportHtml` (linha 1435): parte do
  HTML **persistido** (`notebook_pages.content`), parseia em documento
  isolado (`document.implementation.createHTMLDocument`), sanitiza com
  allowlist de elementos/atributos (`allowedElements`,
  `allowedDataAttributes`, linhas 83-157), remove elementos runtime-only,
  bloqueia `javascript:`/URLs inseguras, converte cada
  `img[data-notebook-asset-id]` e `figure[data-athenaeum-block="file-attachment"]`
  em sentinela + slot do manifest (`sanitizeAssetImage:664`,
  `sanitizeAttachmentFigure:687`), renderiza diagramas e equações
  estáticos inline, monta o documento com CSP restritiva
  (`default-src 'none'; img-src data:; font-src data:`, linha 1403) e CSS
  editorial embutido (`renderExportStyles:796`). Valida HTML×manifest
  antes de devolver (`validateNotebookExportManifestSlots:243`). Testes em
  `notebookExportHtml.test.ts`.

- **`src/features/notebooks/notebookExportKatex.ts`** — render estático de
  equação com a config de segurança canônica + `output: "htmlAndMathml"`
  (linha 65-70). Rejeita saída com `katex-error` ou padrões inseguros
  (`hasUnsafeRenderedEquationHtml:37`) e cai para fallback textual seguro.
  **Já é portável; nenhum ajuste de configuração é necessário.**

- **`src/features/notebooks/notebookDiagramStaticSvg.ts`** (747 linhas) —
  `renderNotebookDiagramStaticSvg`: função **pura** de geração de SVG para
  os quatro kinds (`diagram`, `graph`, ciclo, `flowchart`), reutilizando
  `parseDiagramSource`/`parseGraphSource` de `notebookDiagramParser.ts`
  (o parser canônico — sem parser duplicado). Não depende do ambiente do
  editor; sintaxe inválida vira fallback visível. **Já atende ao requisito
  "SVG estático exportável"; nada precisa mudar.**

- **`src/features/notebooks/notebookExportFonts.ts`** +
  **`notebookExportLoraFontCss.generated.ts`** — Lora como Data URLs (ver
  Divergência 2).

- **`src/features/notebooks/notebookExportFileName.ts`** — slug do nome de
  arquivo padrão (`caderno-AAAA-MM-DD.html`).

- **`src/features/notebooks/NotebookPanel.tsx`** — orquestração e UX.
  Fluxo em duas etapas: `prepareNotebookExport` (linha 978) força
  `saveNotebookInfoDraft()` + `saveActivePage()` (coordenação explícita
  com o autosave; `saveActivePage` é fila serializada via
  `saveQueueTailRef`, linha 767), relê as páginas **persistidas**
  (`listNotebookPages`), abre o diálogo nativo
  (`selectNotebookExportDestination`) e faz um build de pré-visualização
  (contagem de sentinelas/avisos). `runNotebookExport` (linha 1038)
  **reconstrói** o HTML com o mesmo `nonce`/`createdAt` e chama
  `writeNotebookExport`. O diálogo (linha 2031+) mostra escopo, avisos,
  destino e — só **depois** da gravação — o tamanho real
  (`formatExportFileSize(exportResult.bytesWritten)`).

- **`src/lib/database.ts:1232-1291`** — wrappers `invoke` dos dois
  comandos Rust e o contrato tipado de warnings
  (`NotebookExportWriteWarningCode`).

### Frontend — origem do conteúdo (editor)

- **`src/features/notebooks/NotebookPageEditor.tsx`** — editor
  `contenteditable`; o HTML persistido que o export consome nasce aqui
  (drafts + autosave). O export **não** lê o DOM vivo do editor; lê
  `notebook_pages.content` já persistido.
- **`notebookEditorFigureDom.ts`** — hidratação/desidratação de imagens:
  `removeNotebookAssetImageSources` (garante que `src` runtime não
  persiste) e `hydrateNotebookAssetImages`. Persistido:
  `<img data-notebook-asset-id="...">`.
- **`notebookEditorAttachmentDom.ts`** — cartões de anexo; persistido:
  `figure[data-athenaeum-block="file-attachment"][data-notebook-attachment-id]`
  (controles runtime removidos por `clearFileAttachmentControls`).
- **`notebookEditorDiagramDom.ts`** — blocos de diagrama; persistido:
  `data-athenaeum-block="diagram"` + `data-diagram-kind` +
  `data-diagram-source` + `data-diagram-scale`; preview SVG é runtime.
- **`notebookEditorEquationDom.ts`** — blocos de equação; persistido:
  fonte LaTeX (`data-equation-source`) + `data-equation-scale`; preview
  KaTeX é runtime.
- **`notebookEditorCalloutDom.ts`** — callouts; exportados como HTML
  comum via allowlist (`data-callout-type/icon/content`).

### Rust — `src-tauri/src/lib.rs`

- **`select_notebook_export_destination`** (linha 95) — diálogo nativo de
  salvar (`rfd`), valida a forma do destino e registra o `PathBuf` exato
  no estado `NotebookExportDestinations` (linha 86, `Mutex<HashSet>`,
  teto de 32): o WebView não consegue inventar destino de escrita.
- **`write_notebook_export`** (linha 2121) — o coração. Ordem:
  1. valida manifest (contrato fechado, fatal) e forma do destino;
  2. exige destino autorizado nesta sessão (autorização consumida no
     sucesso, linha 2499);
  3. **PASSO 1**: resolve cada slot no banco (lock do pool segurado só
     aqui) — `notebook_assets` / `notebook_file_attachments` são a fonte
     de verdade de caminho/MIME/propriedade; propriedade divergente é
     **fatal** (`export_owner_matches:1613`), recurso sumido **degrada**
     com warning;
  4. **PASSO 2**: `parse_export_slot_sentinels` +
     `validate_export_html_against_manifest` (fatal, antes de criar
     qualquer arquivo);
  5. **PASSO 3**: `create_exclusive_export_temp` (`create_new`, nunca
     trunca), `BufWriter`, corpo escrito em stream trocando cada sentinela
     pelo embed; `stream_embed_data_uri` (linha 1693) faz
     `File → BufReader → base64 EncoderWriter → BufWriter`, um recurso
     por vez, sem cópia base64 completa em memória;
  6. `sync_all` (fsync) no temporário, `finalize_notebook_export_file`
     (linha 2056): rename com backup exclusivo
     (`.athenaeum-export-backup-<nonce>-<n>/`) para sobrescrita
     recuperável no Windows, restauração em falha de promoção,
     `sync_parent_directory` best-effort.
- **Validações reutilizadas** — `validate_file_id:533`,
  `resolve_app_data_relative_path:617`,
  `sanitize_attachment_file_name:583`,
  `is_supported_export_image_mime:1678` (espelha
  `notebook_asset_mime_to_extension:517`).
- **Testes** — `mod tests` (linha 3149+) cobre sentinelas, contrato do
  manifest, MIME seguro em data URI, allowlist de imagem, e finalização
  com filesystem real.

### Onde os bytes vivem hoje

| Recurso | Tabela | Disco (relativo ao app data dir) | Limite | Allowlist |
| --- | --- | --- | --- | --- |
| Imagem | `notebook_assets` (v17; `file_size` INTEGER) | `notebook-assets/{notebook}/{page}/{asset}.{ext}` | 4 MB (`MAX_NOTEBOOK_ASSET_BYTES:499`) | png, jpeg, gif, webp; SVG rejeitado |
| Anexo | `notebook_file_attachments` (v18; `file_size` INTEGER) | `notebook-attachments/{notebook}/{page}/{attachment}/{nome-sanitizado}` | 4 MB (`MAX_NOTEBOOK_ATTACHMENT_BYTES:500`) | qualquer MIME (normalizado; desconhecido → `application/octet-stream` no export) |

Tamanho médio real depende da biblioteca do usuário (não inferível do
código); o teto duro é 4 MB por recurso, imposto no backend.

---

## 3. Riscos identificados

### Lado Rust (detalhado)

- **[Baixo] Duas cópias do HTML textual em memória durante o IPC.**
  O parâmetro `html: String` de `write_notebook_export` chega inteiro
  pela ponte IPC: enquanto o comando roda, existe a cópia do WebView e a
  cópia do Rust. Importante: isso é **só texto com sentinelas** — os
  bytes de assets/anexos nunca atravessam o IPC nem são materializados
  em base64 completo (é exatamente o que o padrão de sentinelas foi
  desenhado para evitar, e o código cumpre). Em Rust, `String` é um
  buffer no heap com ponteiro/tamanho/capacidade; um caderno gigantesco
  de texto puro (dezenas de MB de HTML) dobraria temporariamente esse
  custo, mas não há caminho realista para isso com o editor atual.
  Nenhuma ação necessária na Fase 1; registrado para consciência.

- **[Baixo] Sem teto agregado de tamanho do export.** Cada recurso tem
  teto de 4 MB, e o manifest aceita até 10.000 slots
  (`MAX_NOTEBOOK_EXPORT_SLOTS:1787`) — teoricamente ~40 GB de origem
  (~53 GB escritos, com o overhead de 4/3 do base64). O streaming
  garante que a **memória** fica constante (os buffers de `BufReader`/
  `BufWriter` têm 8 KB por padrão; `std::io::copy` lê, codifica e grava
  em blocos, e o handle de cada arquivo é fechado ao fim da iteração
  antes de abrir o próximo), mas **disco e tempo de escrita** não têm
  guarda nenhuma, e o usuário só descobre o tamanho no final. É
  exatamente o buraco que a UX de estimativa (~100MB) fecha. Referência
  de escala: ~25 recursos no teto de 4 MB já produzem ~133 MB escritos.

- **[Baixo] Sobrescrita no Windows não é atomicidade estrita.** No
  Windows, `std::fs::rename` falha se o destino existe; a implementação
  move o arquivo antigo para um diretório de backup exclusivo, promove o
  temporário e restaura o backup se a promoção falhar
  (`finalize_notebook_export_file:2056`). Há uma janela pequena entre o
  "mover o antigo" e o "promover o novo" em que o destino não existe; a
  falha nessa janela é recuperável (backup preservado + mensagem), mas o
  próprio comentário do código reconhece que não é atomicidade estrita.
  Risco residual documentado e aceito no design atual; o `fsync` do
  conteúdo antes do rename e o `sync_parent_directory` (best-effort,
  no-op efetivo no Windows — o journal do NTFS ordena metadados) cobrem
  queda de energia razoavelmente.

- **[Baixo] Bytes órfãos em disco.** Excluir página/caderno remove as
  linhas (CASCADE) mas pode deixar bytes órfãos em
  `notebook-assets/`/`notebook-attachments/` (decisão herdada de
  `canvas_files`, comentada nas migrations v17/v18). Para o export isso
  aparece como warning `missing-resource`/`missing-file` (degrada, não
  aborta) — comportamento correto. A rotina de limpeza física é backlog
  separado, fora do export.

- **[Informativo] Precedentes de streaming no código atual.** O único
  ponto com streaming real é o próprio `stream_embed_data_uri`. Os
  comandos `save_notebook_asset` (linha 877) e
  `save_notebook_file_attachment` (linha 1167) **não** são streaming:
  recebem base64 completo pelo IPC e usam `std::fs::write` — aceitável
  porque o teto é 4 MB, validado antes. `read_pdf_file` (linha 137) usa
  `std::fs::read` + base64 completo (pré-existente, fora deste escopo).
  Ou seja: para *export* o precedente de streaming já existe e está no
  lugar certo; não há necessidade de desenho novo no lado Rust para a
  funcionalidade já entregue.

### Lado TypeScript

- **[Médio] Build duplo com conteúdo potencialmente divergente.**
  `prepareNotebookExport` constrói o HTML uma vez (para contagens/avisos
  do diálogo) e `runNotebookExport` **reconstrói** a partir das páginas
  persistidas relidas naquele momento, com o mesmo nonce. HTML e
  manifest nascem juntos no segundo build, então nunca há mismatch
  estrutural — mas se o usuário editar (e o autosave persistir) entre
  "Preparar" e "Exportar", as contagens mostradas no diálogo podem não
  corresponder ao arquivo gravado. Além disso, `runNotebookExport` não
  repete `saveActivePage()`: edição ainda não persistida no momento do
  clique final fica de fora. Consistente com o invariante de autosave do
  AGENTS.md, porém vale decisão explícita de UX (re-salvar no clique
  final ou invalidar a preparação quando o conteúdo muda).

- **[Baixo] Peso fixo de fontes.** Todo export carrega ~352 KB de Lora;
  export com equação soma ~360 KB de KaTeX (fontes WOFF2). Para exports
  pequenos, as fontes dominam o tamanho do arquivo. Qualquer estimativa
  de tamanho precisa incluir esses termos fixos.

- **[Baixo] Módulos `.generated.ts` sem pipeline de regeneração.** Não há
  script em `package.json`/`scripts/` para regenerar
  `notebookExportKatexCss.generated.ts` (atualização do KaTeX) nem
  `notebookExportLoraFontCss.generated.ts` (mudança dos .ttf). O processo
  é manual e só está descrito nos cabeçalhos dos arquivos. Risco de
  drift silencioso ao atualizar o KaTeX.

---

## 4. Estimativa de tamanho pré-export (pergunta 3 do escopo)

**Não existe hoje nenhum cálculo agregado reaproveitável** — nem no TS nem
no Rust. O tamanho só aparece **depois** da gravação
(`bytesWritten`, lido do `metadata()` do arquivo final). Porém, **os dados
para estimar já estão no banco**: as duas tabelas têm `file_size` (INTEGER,
NOT NULL), preenchido no save. A estimativa não precisa tocar filesystem:

```
estimativa ≈ len(html do build)                    (já disponível na preparação)
           + Σ file_size × 4/3                     (SUM sobre notebook_assets e
                                                    notebook_file_attachments
                                                    filtrado por page_ids)
           + 0, pois fontes/CSS/SVG já estão dentro do html do build
```

Observação: como o build de preparação já embute Lora, KaTeX CSS e SVGs de
diagramas no HTML, `build.html.length` já cobre os termos fixos; só os
assets/anexos (sentinelas) faltam, e o fator 4/3 do base64 (+ ~30 bytes de
moldura `data:` por recurso) completa a conta. Precisão esperada: alta
(erro < 1%).

Caminho natural, respeitando a divisão TS/Rust do AGENTS.md: `SELECT
SUM(file_size) ... WHERE page_id IN (...)` é leitura simples de 1 statement
→ **TypeScript via `tauri-plugin-sql`**, sem comando Rust novo. O gancho de
UI já existe: o bloco "Exportação preparada" do diálogo
(`NotebookPanel.tsx:2100-2128`) é onde a estimativa e o aviso de ~100MB se
encaixariam, antes do botão Exportar.

---

## 5. Migrations (pergunta 4 do escopo)

**Nenhuma migration é necessária para a funcionalidade existente nem para a
estimativa de tamanho** (leitura pura de colunas que já existem; AGENTS.md
proíbe migration para funcionalidade read-only). Único cenário que exigiria
migration nova (v19, arquivo externo em `src-tauri/migrations/`, padrão
`include_str!`): uma **tabela de histórico/log de exports** (destino, data,
tamanho, avisos). Isso é decisão de produto em aberto — hoje o resultado do
export só vive no estado do diálogo e se perde ao fechar. Documentado aqui;
não criado.

---

## 6. Fora do escopo da Fase 0 (para confirmação)

- Implementar a estimativa de tamanho e o aviso de ~100MB (candidato a
  Fase 1 — hoje é o único gap real da arquitetura decidida).
- Qualquer alteração em `src-tauri/src/lib.rs` (cumprido: somente leitura).
- Rotina de limpeza física de bytes órfãos de assets/anexos.
- Export de outros tipos de conteúdo (documentos PDF da biblioteca,
  Quadros/canvases, anotações do leitor).
- Tema escuro no HTML exportado (decisão registrada no CSS: documento
  estático só com tema claro) e export direto para PDF.
- Tabela de histórico de exports (migration v19) — só documentada.
- Pipeline de regeneração dos módulos `.generated.ts` (KaTeX/Lora).
- Mudanças no formato da sentinela ou no contrato do manifest (versão 1).

---

## 7. Perguntas em aberto (decisões necessárias antes da Fase 1)

1. **Recorte da Fase 1.** Dado que o pipeline já está implementado, a
   Fase 1 vira essencialmente "estimativa de tamanho + aviso ~100MB"?
   Ou há requisitos adicionais não capturados no brief?
2. **Formato da sentinela.** Aceitar o formato unificado
   `ATHENAEUM_SLOT` existente como canônico (recomendado — contrato
   fechado, testado dos dois lados), atualizando o brief, em vez dos dois
   formatos `ATHENAEUM_ASSET`/`ATHENAEUM_ATTACHMENT`?
3. **Lora incondicional.** Manter a Lora sempre embutida (~352 KB;
   justificável porque o título do export sempre usa a serif) ou tornar
   condicional como o KaTeX (exigiria definir o que é "conteúdo
   relevante")?
4. **Semântica do limiar (~100MB).** Aviso informativo, confirmação
   explícita, ou bloqueio? Limiar fixo ou configurável?
5. **Via da estimativa.** Confirmar o caminho recomendado (SUM via
   `tauri-plugin-sql` em TS, sem comando Rust novo) — alternativa seria um
   comando Rust, contra a divisão de responsabilidades do AGENTS.md.
6. **Divergência preparar→exportar.** Re-executar `saveActivePage()` e/ou
   invalidar a preparação quando o conteúdo persistido mudar entre as duas
   etapas, ou aceitar o comportamento atual?
7. **Histórico de exports.** Desejado (migration v19) ou descartado?

---

*Nenhuma alteração de código foi feita nesta fase; este documento é o único
arquivo criado e nada foi commitado.*
