# Fronteira de filesystem

Este documento registra a fronteira entre o WebView e o filesystem do
Athenaeum. O objetivo e permitir a auditoria dos comandos nativos sem tratar
como confiavel um caminho recebido por IPC ou recuperado do SQLite.

## Modelo de confianca

- Todo valor vindo do WebView e entrada nao confiavel. Isso inclui caminhos
  devolvidos anteriormente pelo proprio Rust e enviados de volta pelo
  frontend.
- Valores de caminho no SQLite tambem nao sao autoridade. O frontend possui
  `sql:allow-execute`, portanto um comando Rust precisa validar novamente o
  caminho obtido do banco antes de acessar o disco.
- Uma escolha feita em dialogo nativo ou um drop observado pelo runtime Tauri
  pode autorizar um caminho externo durante a sessao. O WebView nao pode
  acrescentar entradas a essas listas.
- Recursos gerenciados sao resolvidos a partir de `app_data_dir` e de IDs ou
  nomes validados. O frontend nao escolhe o caminho fisico final.
- As autorizacoes de origem e destino vivem apenas em memoria, tem limite de
  entradas e desaparecem quando o processo termina.

Essa fronteira e necessaria porque o aplicativo renderiza PDFs de terceiros e
HTML persistido do Caderno. Uma falha nesses conteudos nao deve transformar um
`invoke` em leitura, escrita ou exclusao arbitraria de arquivos do usuario.

## PDFs

| Entrada nativa ou comando | Caminho aceito | Autorizacao e consumo | Motivo |
| --- | --- | --- | --- |
| `select_pdf_file` | Nao recebe caminho. O dialogo nativo escolhe e o Rust canonicaliza um arquivo `.pdf`. | A escolha cria permissoes separadas de leitura e importacao. Como este comando ja devolve os bytes, ele consome imediatamente a permissao de leitura e preserva a de importacao. Nao possui consumidor no frontend atual. | Compatibilidade com o seletor unitario sem transformar um caminho IPC em fonte de leitura. |
| `select_pdf_files` | Nao recebe caminho. O dialogo nativo escolhe ate 512 PDFs. | Cada caminho canonicalizado recebe uma leitura e uma importacao. | O modal usa referencias leves; metadados e copia acontecem depois. |
| evento nativo `DragDrop::Drop` da WebView `main` | Nao recebe caminho por IPC. O runtime entrega os caminhos efetivamente soltos na janela e filtra `.pdf`. | Registra as mesmas permissoes de leitura e importacao e so depois emite `pdf-import:dropped` ao frontend. Um evento JavaScript com o mesmo nome nao autoriza nada no Rust. | Mantem o arraste sem confiar em `File.path` criado ou adulterado no WebView. |
| `read_pdf_file(file_path)` | Um PDF externo previamente autorizado ou um arquivo canonicalizado que seja filho direto de `$APPDATA/pdfs`. | A leitura externa consome uma unica permissao de leitura. Falha de I/O restaura essa permissao; falta de arquivo e falta de autorizacao retornam a mesma mensagem. PDFs gerenciados nao precisam de autorizacao de sessao. | O Reader, o preview e a extracao de metadados precisam dos bytes; o caminho por si so nao concede acesso. |
| `import_document(request.sourcePath)` | Um PDF externo previamente autorizado ou um PDF gerenciado em `$APPDATA/pdfs`. | Reserva uma permissao de importacao. Falhas restauram a reserva; sucesso consome todas as permissoes restantes daquela origem. | Copia a origem para `$APPDATA/pdfs/<document-id>.pdf` e coordena a copia com a transacao SQLite. |

`PdfImportSources` e a fonte de verdade dessas permissoes. A canonicalizacao
exige arquivo regular com extensao PDF. O caminho gerenciado e derivado de um
ID de documento validado, nunca de `request.fileName`.

### Abertura e exclusao de PDFs gerenciados

`open_document_externally(document_id)` e
`delete_document_permanently(document_id)` nao aceitam caminho do frontend.
Ambos consultam `file_path` no banco, mas tratam o valor como nao confiavel:

- abertura exige o nome exato `<document-id>.pdf`, canonicaliza o diretorio,
  o caminho registrado e o caminho esperado, rejeita escape por symlink e so
  entao entrega o arquivo ao aplicativo associado do sistema;
- exclusao so remove o caminho lexical e canonical exato em
  `$APPDATA/pdfs/<document-id>.pdf`. Caminho legado ou divergente e preservado;
  apenas o registro do documento e removido e o resultado
  `unmanaged-file-preserved` permite que a UI avise o usuario;
- arquivo gerenciado ja ausente produz `managed-file-missing`, sem ampliar o
  alvo da exclusao.

## Wallpaper

| Comando | Caminho aceito | Autorizacao e consumo | Motivo |
| --- | --- | --- | --- |
| `select_wallpaper_image` | Nao recebe caminho; o dialogo nativo escolhe a imagem. | Registra o `PathBuf` exato em `WallpaperImportSources`. | A escolha do usuario e a unica origem externa permitida. |
| `import_wallpaper(source_path)` | Apenas um caminho exato registrado pelo seletor nesta sessao. | Uma importacao concluida consome a autorizacao; uma falha permite nova tentativa. | Le o arquivo com limite de 16 MiB, valida PNG/JPEG/WebP pelo conteudo e promove uma copia temporaria para `$APPDATA/wallpaper`. |
| `resolve_wallpaper_path(file_name)` | Aceita somente o nome gerenciado no formato produzido pela importacao, nao um caminho. | Nao usa autorizacao de origem. Valida o nome antes de combina-lo com `$APPDATA/wallpaper`. | Traduz o valor persistido em `app_settings` para a copia interna servida ao WebView. |
| `remove_wallpaper` | Nao recebe caminho. | Restrito ao diretorio gerenciado de wallpaper. | O frontend pode solicitar a remocao, mas nao escolher o alvo fisico. |

O protocolo `asset:` possui allowlist propria apenas para
`$APPDATA/wallpaper/*`. Ele nao serve PDFs, anexos, assets de Caderno nem
outros arquivos de `AppData`.

## Exportacao de Caderno

| Comando | Caminho aceito | Autorizacao e consumo | Motivo |
| --- | --- | --- | --- |
| `select_notebook_export_destination(default_file_name)` | Nao recebe caminho; o dialogo nativo de salvar produz um destino absoluto `.html` ou `.htm`, com pasta existente. | Registra o `PathBuf` exato em `NotebookExportDestinations`. | Exportar precisa escrever fora do storage do aplicativo, mas somente onde o usuario escolheu. |
| `write_notebook_export(destination_path, ...)` | Apenas o destino exato registrado pelo seletor nesta sessao. | Consome a autorizacao depois da finalizacao bem-sucedida; falhas permitem nova tentativa. | Faz escrita temporaria, `sync_all` e promocao no mesmo diretorio, sem aceitar um destino inventado pelo WebView. |

Assets e anexos embutidos na exportacao nao recebem caminho do frontend. O
Rust resolve ID, propriedade, MIME e `file_path` no banco e passa o caminho
relativo por `resolve_app_data_relative_path`, que impede caminho absoluto e
travessia para fora de `app_data_dir`.

## Assets, anexos e quadros

Os comandos `save_*`, `load_*`, `open_*`, `reveal_*` e `delete_*` de assets de
Caderno, anexos e arquivos de Quadro recebem IDs e/ou bytes, nao caminhos
fisicos. O Rust valida os IDs, consulta propriedade e metadados no banco e
resolve o arquivo sob `app_data_dir`. Caminhos persistidos sao relativos e
voltam a passar por `resolve_app_data_relative_path` antes de uso.

## Excecao registrada: abrir local do arquivo

`open_file_location(file_path)` continua registrado e aceita um caminho
arbitrario sem autorizacao de sessao. Nao ha consumidor desse comando no
frontend atual. Sua operacao e limitada a:

1. consultar se o caminho existe;
2. pedir ao gerenciador de arquivos do sistema que abra ou revele o caminho.

Ele nao devolve bytes ao WebView, nao grava e nao exclui o alvo, mas permanece
uma superficie IPC e um oraculo de existencia. Qualquer consumidor futuro deve
preferir um ID de recurso e resolucao Rust a partir do banco; habilitar o uso
direto exige uma decisao explicita sobre autorizacao de origem.

## Capabilities do frontend

O frontend nao possui mais `tauri-plugin-fs`. A capability padrao concede
somente:

- `core:default`;
- `core:window:allow-set-fullscreen`;
- `sql:allow-load`;
- `sql:allow-execute`;
- `sql:allow-select`.

Nao ha `fs:allow-remove`, escopo `$HOME/**`, `$DOCUMENT/**`, `$DOWNLOAD/**` ou
`$APPDATA/**`, nem `sql:allow-close`. Assim, acesso a bytes e mutacoes de
filesystem ficam nos comandos Rust acima, com o alvo resolvido e validado no
lado privilegiado.

## Regra para novos fluxos

Um novo comando que precise de caminho deve seguir um destes modelos:

1. receber um ID, resolver propriedade e caminho sob um diretorio gerenciado;
2. receber de volta um caminho externo escolhido por dialogo nativo e exigir
   uma autorizacao de sessao exata, consumida depois do sucesso;
3. observar a origem por um evento nativo do runtime antes de publicar o
   caminho ao WebView.

Receber um caminho arbitrario por IPC e apenas canonicaliza-lo nao prova
consentimento nem propriedade. Receber um caminho do SQLite tambem exige
validacao contra o diretorio e o nome esperados.
