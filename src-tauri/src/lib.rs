use base64::Engine;
use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use tauri::Manager;
use tauri_plugin_sql::{DbInstances, DbPool, Migration, MigrationKind};

#[derive(Serialize)]
struct SelectedPdfFile {
  file_name: String,
  file_path: String,
  data_base64: String,
}

#[tauri::command]
fn select_pdf_file() -> Result<Option<SelectedPdfFile>, String> {
  let Some(path) = rfd::FileDialog::new()
    .add_filter("PDF", &["pdf"])
    .pick_file()
  else {
    return Ok(None);
  };

  let file_name = path
    .file_name()
    .and_then(|name| name.to_str())
    .unwrap_or("documento.pdf")
    .to_string();
  let bytes = std::fs::read(&path).map_err(|error| error.to_string())?;

  Ok(Some(SelectedPdfFile {
    file_name,
    file_path: path.to_string_lossy().to_string(),
    data_base64: base64::engine::general_purpose::STANDARD.encode(bytes),
  }))
}

// Referencia leve a um PDF escolhido: so nome + caminho. Os bytes NAO vem aqui
// (diferente de select_pdf_file) — para um lote grande, embutir base64 de cada
// arquivo seria pesado. Quando os bytes forem necessarios (extrair metadados ou
// pre-visualizar), o frontend le sob demanda via read_pdf_file(caminho).
#[derive(Serialize)]
struct PickedPdfFile {
  file_name: String,
  file_path: String,
}

// Selecao MULTIPLA nativa (um unico dialogo, varios PDFs). Devolve lista vazia
// se o usuario cancelar. Nao substitui select_pdf_file — este e o caminho de
// lote do novo modal de adicionar documentos.
#[tauri::command]
fn select_pdf_files() -> Result<Vec<PickedPdfFile>, String> {
  let Some(paths) = rfd::FileDialog::new()
    .add_filter("PDF", &["pdf"])
    .pick_files()
  else {
    return Ok(Vec::new());
  };

  Ok(
    paths
      .into_iter()
      .map(|path| {
        let file_name = path
          .file_name()
          .and_then(|name| name.to_str())
          .unwrap_or("documento.pdf")
          .to_string();

        PickedPdfFile {
          file_name,
          file_path: path.to_string_lossy().to_string(),
        }
      })
      .collect(),
  )
}

#[tauri::command]
fn select_notebook_export_destination(default_file_name: String) -> Result<Option<String>, String> {
  let fallback_file_name = "caderno.html";
  let trimmed_file_name = default_file_name.trim();
  let file_name = if trimmed_file_name.is_empty() {
    fallback_file_name
  } else {
    trimmed_file_name
  };

  Ok(
    rfd::FileDialog::new()
      .add_filter("HTML", &["html", "htm"])
      .set_file_name(file_name)
      .save_file()
      .map(|path| path.to_string_lossy().to_string()),
  )
}

#[tauri::command]
fn read_pdf_file(file_path: String) -> Result<String, String> {
  let path = PathBuf::from(&file_path);

  if !path.exists() {
    return Err("Arquivo nao encontrado.".to_string());
  }

  let bytes = std::fs::read(&path).map_err(|error| error.to_string())?;

  Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

// ===========================================================================
// import_document — importacao de PDF com transacao REAL.
//
// O resto da persistencia do app roda em TypeScript via plugin-sql: cada acao do
// usuario e 1 statement atomico, o que ja e seguro. A IMPORTACAO e diferente:
// ela grava varias linhas relacionadas (colecao, tags, documento, autores,
// vinculos) que precisam entrar TODAS ou NENHUMA. Isso exige uma transacao numa
// unica conexao (BEGIN...COMMIT) — algo que o pool do plugin-sql, acessado
// statement-a-statement pelo TS, nao garante. Por isso ESTE caso (e so ele) vive
// no Rust. Nao use isso como precedente para mover outras escritas para ca.
//
// Alem do banco, a importacao copia o PDF para o storage do app. O sistema de
// arquivos NAO participa da transacao SQLite, entao a ordem das etapas e o
// tratamento de erro sao explicitos para nunca deixar arquivo orfao (PDF
// copiado, mas sem linha correspondente no banco).
// ===========================================================================

// Tag ja resolvida no TS (id = slug, color_token = tom validado em WCAG AA).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportTag {
  id: String,
  name: String,
  color_token: String,
}

// Tudo o que o comando precisa para gravar o documento. Os ids/tokens ja vem
// resolvidos do TS (slug, tom da tag, id da colecao), entao o Rust so cuida da
// copia do arquivo e da transacao — nao replica regra de negocio.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportDocumentRequest {
  id: String,
  title: String,
  source: String,
  year: i64,
  status: String,
  progress: i64,
  favorite: bool,
  collection_id: String,
  collection_name: String,
  file_name: String,
  // Caminho de ONDE copiar o PDF (arquivo escolhido pelo usuario).
  source_path: String,
  notes: String,
  updated_at: String,
  authors: Vec<String>,
  tags: Vec<ImportTag>,
}

// Mesma string usada no TS em Database.load(...). E a chave do pool no estado.
const DATABASE_KEY: &str = "sqlite:athenaeum.db";

#[tauri::command]
async fn import_document<R: tauri::Runtime>(
  app: tauri::AppHandle<R>,
  db_instances: tauri::State<'_, DbInstances>,
  request: ImportDocumentRequest,
) -> Result<String, String> {
  // -------------------------------------------------------------------------
  // ETAPA 1 — Copiar o PDF para o storage do app (operacao de filesystem, FORA
  // da transacao do banco).
  //
  // Por que copiar ANTES de tocar no banco: se a copia falhar, retornamos erro
  // sem ter aberto nenhuma transacao — nao ha nada a reverter. O caminho inverso
  // (gravar a linha e so depois copiar) poderia deixar uma linha no banco
  // apontando para um arquivo que nunca foi criado.
  // -------------------------------------------------------------------------
  let data_dir = app
    .path()
    .app_data_dir()
    .map_err(|error| format!("Nao foi possivel achar o diretorio de dados: {error}"))?;
  let pdf_dir = data_dir.join("pdfs");
  std::fs::create_dir_all(&pdf_dir)
    .map_err(|error| format!("Nao foi possivel criar a pasta de PDFs: {error}"))?;

  // No storage, o arquivo se chama <id>.pdf (o id ja e unico). O nome original
  // de exibicao vai separado, na coluna file_name.
  let dest_path = pdf_dir.join(format!("{}.pdf", request.id));
  let dest_path_str = dest_path.to_string_lossy().into_owned();

  let source_path = Path::new(&request.source_path);
  if !source_path.exists() {
    return Err("Arquivo de origem nao encontrado.".to_string());
  }

  // Se a copia do arquivo falhar, nem tentamos abrir a transacao.
  std::fs::copy(source_path, &dest_path)
    .map_err(|error| format!("Nao foi possivel copiar o PDF: {error}"))?;

  // -------------------------------------------------------------------------
  // ETAPA 2 — Gravar tudo numa unica transacao, reaproveitando o MESMO pool do
  // plugin-sql (mesma conexao logica, mesmas PRAGMAs de durabilidade).
  // -------------------------------------------------------------------------
  let instances = db_instances.0.read().await;
  let pool = match instances.get(DATABASE_KEY) {
    Some(DbPool::Sqlite(pool)) => pool,
    _ => {
      // Banco ainda nao carregado: desfaz a copia para nao deixar orfao.
      let _ = std::fs::remove_file(&dest_path);
      return Err("Banco de dados nao carregado.".to_string());
    }
  };

  // Toda a escrita fica neste bloco async que devolve Result. Qualquer `?` aqui
  // dentro encerra o bloco com Err e dropa a `tx` SEM commit (rollback
  // automatico). Caimos entao no `if let Err(...)` abaixo, onde apagamos o
  // arquivo ja copiado. Assim banco e disco ficam sempre coerentes.
  let write_result: Result<(), String> = async {
    let mut tx = pool.begin().await.map_err(|error| error.to_string())?;

    // Colecao: cria se ainda nao existir (o id ja foi resolvido no TS).
    sqlx::query("INSERT OR IGNORE INTO collections (id, name, is_system) VALUES (?, ?, 0)")
      .bind(&request.collection_id)
      .bind(&request.collection_name)
      .execute(&mut *tx)
      .await
      .map_err(|error| error.to_string())?;

    // Tags: upsert mantendo a cor validada.
    for tag in &request.tags {
      sqlx::query(
        "INSERT INTO tags (id, name, color_token) VALUES (?, ?, ?) \
         ON CONFLICT(name) DO UPDATE SET color_token = excluded.color_token",
      )
      .bind(&tag.id)
      .bind(&tag.name)
      .bind(&tag.color_token)
      .execute(&mut *tx)
      .await
      .map_err(|error| error.to_string())?;
    }

    // Documento. file_path aponta para a COPIA no storage do app (nao para o
    // arquivo original do usuario, que pode ser movido/apagado depois).
    sqlx::query(
      "INSERT INTO documents (\
         id, title, source, year, status, progress, favorite, collection_id, \
         file_name, file_path, notes, reading_location_json, updated_at\
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)",
    )
    .bind(&request.id)
    .bind(&request.title)
    .bind(&request.source)
    .bind(request.year)
    .bind(&request.status)
    .bind(request.progress)
    .bind(i64::from(request.favorite))
    .bind(&request.collection_id)
    .bind(&request.file_name)
    .bind(&dest_path_str)
    .bind(&request.notes)
    .bind(&request.updated_at)
    .execute(&mut *tx)
    .await
    .map_err(|error| error.to_string())?;

    // Autores, preservando a ordem.
    for (index, author) in request.authors.iter().enumerate() {
      sqlx::query(
        "INSERT INTO document_authors (document_id, author, author_order) VALUES (?, ?, ?)",
      )
      .bind(&request.id)
      .bind(author)
      .bind(index as i64)
      .execute(&mut *tx)
      .await
      .map_err(|error| error.to_string())?;
    }

    // Vinculo documento<->tags.
    for (index, tag) in request.tags.iter().enumerate() {
      sqlx::query("INSERT INTO document_tags (document_id, tag_id, tag_order) VALUES (?, ?, ?)")
        .bind(&request.id)
        .bind(&tag.id)
        .bind(index as i64)
        .execute(&mut *tx)
        .await
        .map_err(|error| error.to_string())?;
    }

    // Confirma tudo de uma vez. Se isto falhar, o `?` propaga e nada e gravado.
    tx.commit().await.map_err(|error| error.to_string())?;
    Ok(())
  }
  .await;

  if let Err(error) = write_result {
    // A transacao foi revertida (tx dropada sem commit), mas o ARQUIVO ja havia
    // sido copiado na Etapa 1. Apagamos para nao sobrar PDF orfao sem linha.
    let _ = std::fs::remove_file(&dest_path);
    return Err(error);
  }

  // Sucesso: devolve o caminho final (storage do app) para o frontend apontar o
  // documento para a copia estavel.
  Ok(dest_path_str)
}

#[tauri::command]
fn open_file_location(file_path: String) -> Result<(), String> {
  let path = PathBuf::from(file_path);

  if !path.exists() {
    return Err("Arquivo nao encontrado.".to_string());
  }

  open_path_in_file_manager(&path)
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
  let normalized_url = url.trim();
  let lower_url = normalized_url.to_ascii_lowercase();

  if normalized_url.is_empty() || normalized_url.chars().any(char::is_control) {
    return Err("URL invalida.".to_string());
  }

  if !lower_url.starts_with("https://")
    && !lower_url.starts_with("http://")
    && !lower_url.starts_with("mailto:")
  {
    return Err("Apenas links http, https e mailto podem ser abertos.".to_string());
  }

  open_url_with_system(normalized_url)
}

#[cfg(target_os = "windows")]
fn open_url_with_system(url: &str) -> Result<(), String> {
  Command::new("rundll32")
    .arg("url.dll,FileProtocolHandler")
    .arg(url)
    .spawn()
    .map(|_| ())
    .map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
fn open_url_with_system(url: &str) -> Result<(), String> {
  Command::new("open")
    .arg(url)
    .spawn()
    .map(|_| ())
    .map_err(|error| error.to_string())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn open_url_with_system(url: &str) -> Result<(), String> {
  Command::new("xdg-open")
    .arg(url)
    .spawn()
    .map(|_| ())
    .map_err(|error| error.to_string())
}

#[cfg(target_os = "windows")]
fn open_file_with_system(path: &Path) -> Result<(), String> {
  Command::new("rundll32")
    .arg("url.dll,FileProtocolHandler")
    .arg(path)
    .spawn()
    .map(|_| ())
    .map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
fn open_file_with_system(path: &Path) -> Result<(), String> {
  Command::new("open")
    .arg(path)
    .spawn()
    .map(|_| ())
    .map_err(|error| error.to_string())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn open_file_with_system(path: &Path) -> Result<(), String> {
  Command::new("xdg-open")
    .arg(path)
    .spawn()
    .map(|_| ())
    .map_err(|error| error.to_string())
}

#[cfg(target_os = "windows")]
fn open_path_in_file_manager(path: &Path) -> Result<(), String> {
  let target_path = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
  let mut command = Command::new("explorer");

  if target_path.is_dir() {
    command.arg(&target_path);
  } else {
    // Explorer espera `/select,` separado do caminho quando o path precisa de
    // aspas; um unico argumento com tudo junto pode abrir uma pasta incorreta.
    command.arg("/select,").arg(&target_path);
  }

  command
    .spawn()
    .map(|_| ())
    .map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
fn open_path_in_file_manager(path: &Path) -> Result<(), String> {
  Command::new("open")
    .arg("-R")
    .arg(path)
    .spawn()
    .map(|_| ())
    .map_err(|error| error.to_string())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn open_path_in_file_manager(path: &Path) -> Result<(), String> {
  let folder = path.parent().unwrap_or(path);
  Command::new("xdg-open")
    .arg(folder)
    .spawn()
    .map(|_| ())
    .map_err(|error| error.to_string())
}

// ===========================================================================
// save_canvas_file / load_canvas_files — binarios (imagens) dos Quadros.
//
// Por que comandos Rust dedicados, e nao TypeScript via plugin-sql: a
// operacao tem DUAS metades que precisam ficar coerentes — o arquivo em
// disco e a linha em canvas_files — e nao existe transacao que cubra os
// dois sistemas ao mesmo tempo. A coerencia vem da ORDEM das etapas e do
// tratamento de erro explicito (mesmo motivo pelo qual import_document
// foge do padrao TypeScript).
// ===========================================================================

// Limite de tamanho por arquivo: 4MB. Validado no BACKEND porque o backend
// e a ultima linha de defesa — a validacao do frontend e cortesia de UX,
// nao seguranca (qualquer chamada de invoke chega aqui direto).
//
// O valor ESPELHA de proposito o MAX_ALLOWED_FILE_BYTES (4 * 1024 * 1024) do
// Excalidraw: a lib ja reduz a imagem para 1440px e rejeita acima de 4MB
// ANTES de chamar este comando, entao pela via normal da UI nada entre 4MB e
// o antigo limite de 10MB chegava aqui. Alinhar os dois numeros garante que,
// se algum caminho futuro (mudanca da lib, invoke manual) entregar um arquivo
// grande direto ao backend, ele seja rejeitado no MESMO patamar que a UI
// anuncia — uma unica fonte de verdade, sem duas mensagens de erro diferentes
// para o mesmo problema.
const MAX_CANVAS_FILE_BYTES: usize = 4 * 1024 * 1024;
const MAX_NOTEBOOK_ASSET_BYTES: usize = 4 * 1024 * 1024;
const MAX_NOTEBOOK_ATTACHMENT_BYTES: usize = 4 * 1024 * 1024;

// Traduz o mime type do Excalidraw para a extensao do arquivo em disco.
// Lista fechada de proposito: mime desconhecido e rejeitado com erro claro
// em vez de gravado com extensao "chutada" (um arquivo com extensao errada
// e um bug latente dificil de rastrear depois).
fn mime_to_extension(mime_type: &str) -> Result<&'static str, String> {
  match mime_type {
    "image/png" => Ok("png"),
    "image/jpeg" => Ok("jpg"),
    "image/gif" => Ok("gif"),
    "image/svg+xml" => Ok("svg"),
    "image/webp" => Ok("webp"),
    other => Err(format!("Tipo de arquivo nao suportado no quadro: {other}")),
  }
}

fn notebook_asset_mime_to_extension(mime_type: &str) -> Result<&'static str, String> {
  match mime_type {
    "image/png" => Ok("png"),
    "image/jpeg" => Ok("jpg"),
    "image/gif" => Ok("gif"),
    "image/webp" => Ok("webp"),
    "image/svg+xml" => Err("SVG ainda nao e suportado em assets de caderno.".to_string()),
    other => Err(format!("Tipo de arquivo nao suportado no caderno: {other}")),
  }
}

// O file_id vem do frontend e entra na montagem de um caminho de arquivo.
// Sem esta validacao, um file_id malicioso ou corrompido contendo "../"
// poderia escrever FORA do diretorio do app (path traversal). O fileId real
// do Excalidraw e um hash em [a-zA-Z0-9], entao o filtro nao rejeita nada
// legitimo.
fn validate_file_id(file_id: &str) -> Result<(), String> {
  if file_id.is_empty()
    || !file_id
      .chars()
      .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
  {
    return Err("Identificador de arquivo invalido.".to_string());
  }
  Ok(())
}

fn validate_numeric_path_id(value: &str, label: &str) -> Result<i64, String> {
  if value.is_empty() || !value.chars().all(|c| c.is_ascii_digit()) {
    return Err(format!("{label} invalido."));
  }

  let parsed = value
    .parse::<i64>()
    .map_err(|_| format!("{label} invalido."))?;

  if parsed <= 0 || parsed.to_string() != value {
    return Err(format!("{label} invalido."));
  }

  Ok(parsed)
}

fn normalize_attachment_display_name(original_name: &str) -> Result<String, String> {
  let trimmed = original_name.trim();
  if trimmed.is_empty() || trimmed.chars().any(char::is_control) {
    return Err("Nome do arquivo anexado invalido.".to_string());
  }

  let base_name = Path::new(trimmed)
    .file_name()
    .and_then(|name| name.to_str())
    .unwrap_or(trimmed)
    .trim();

  if base_name.is_empty()
    || base_name == "."
    || base_name == ".."
    || base_name.chars().any(char::is_control)
  {
    return Err("Nome do arquivo anexado invalido.".to_string());
  }

  Ok(base_name.chars().take(240).collect())
}

fn sanitize_attachment_file_name(original_name: &str) -> Result<String, String> {
  let trimmed = original_name.trim();
  if trimmed.is_empty() || trimmed.chars().any(char::is_control) {
    return Err("Nome do arquivo anexado invalido.".to_string());
  }

  let base_name = Path::new(trimmed)
    .file_name()
    .and_then(|name| name.to_str())
    .unwrap_or(trimmed);

  let mut sanitized = String::with_capacity(base_name.len().min(180));
  for character in base_name.chars() {
    if character.is_ascii_alphanumeric()
      || matches!(character, '.' | '-' | '_' | ' ' | '(' | ')')
    {
      sanitized.push(character);
    } else if !character.is_control() {
      sanitized.push('_');
    }

    if sanitized.len() >= 180 {
      break;
    }
  }

  let sanitized = sanitized.trim_matches(|character| character == ' ' || character == '.');
  if sanitized.is_empty() || sanitized == "." || sanitized == ".." {
    return Err("Nome do arquivo anexado invalido.".to_string());
  }

  Ok(sanitized.to_string())
}

fn resolve_app_data_relative_path(data_dir: &Path, relative_path: &str) -> Result<PathBuf, String> {
  let relative_path = Path::new(relative_path);

  if relative_path.is_absolute() {
    return Err("Caminho de anexo invalido.".to_string());
  }

  for component in relative_path.components() {
    if !matches!(component, Component::Normal(_)) {
      return Err("Caminho de anexo invalido.".to_string());
    }
  }

  Ok(data_dir.join(relative_path))
}

#[tauri::command]
async fn save_canvas_file<R: tauri::Runtime>(
  app: tauri::AppHandle<R>,
  db_instances: tauri::State<'_, DbInstances>,
  canvas_id: i64,
  file_id: String,
  mime_type: String,
  data_base64: String,
) -> Result<String, String> {
  // ---------------------------------------------------------------------
  // ETAPA 1 — Validacoes ANTES de tocar no disco.
  //
  // Os bytes chegam como base64 (e nao Vec<u8>) de proposito: o IPC do
  // Tauri serializa argumentos como JSON, e um Vec<u8> de 4MB viraria um
  // array JSON de 4 milhoes de numeros — lento de serializar e parsear.
  // O Excalidraw ja entrega a imagem como dataURL base64, entao o TS so
  // recorta o prefixo e repassa a string; o Rust decodifica uma vez aqui.
  //
  // Checagem em dois tempos: primeiro o tamanho da STRING codificada
  // (base64 ocupa ~4/3 do binario — da para rejeitar um payload de 100MB
  // sem gastar CPU decodificando), depois o tamanho exato dos bytes.
  // ---------------------------------------------------------------------
  validate_file_id(&file_id)?;
  let extension = mime_to_extension(&mime_type)?;

  if data_base64.len() > (MAX_CANVAS_FILE_BYTES / 3 + 1) * 4 {
    // Mensagem derivada da constante: se o limite mudar, o texto acompanha
    // sozinho (uma fonte de verdade, sem "10MB" hardcoded desatualizando).
    return Err(format!(
      "Arquivo excede o limite de {}MB.",
      MAX_CANVAS_FILE_BYTES / 1024 / 1024
    ));
  }

  let data = base64::engine::general_purpose::STANDARD
    .decode(&data_base64)
    .map_err(|error| format!("Base64 invalido: {error}"))?;

  if data.len() > MAX_CANVAS_FILE_BYTES {
    // Mensagem derivada da constante: se o limite mudar, o texto acompanha
    // sozinho (uma fonte de verdade, sem "10MB" hardcoded desatualizando).
    return Err(format!(
      "Arquivo excede o limite de {}MB.",
      MAX_CANVAS_FILE_BYTES / 1024 / 1024
    ));
  }

  // ---------------------------------------------------------------------
  // ETAPA 2 — Montar os caminhos.
  //
  // No banco fica o caminho RELATIVO (com "/", estavel entre plataformas);
  // o caminho absoluto e resolvido em runtime a partir do app_data_dir —
  // assim o banco continua valido se o usuario mover a pasta do app.
  // ---------------------------------------------------------------------
  let data_dir = app
    .path()
    .app_data_dir()
    .map_err(|error| format!("Nao foi possivel achar o diretorio de dados: {error}"))?;
  let relative_path = format!("canvas-assets/{canvas_id}/{file_id}.{extension}");
  let final_path = data_dir
    .join("canvas-assets")
    .join(canvas_id.to_string())
    .join(format!("{file_id}.{extension}"));

  // ---------------------------------------------------------------------
  // ETAPA 3 — Se o arquivo final JA existe, pular a escrita.
  //
  // O file_id e um hash do CONTEUDO: arquivo existente com esse nome tem,
  // por construcao, os mesmos bytes. Alem de evitar trabalho, isso resolve
  // um detalhe do Windows: std::fs::rename falha quando o destino existe
  // (diferente do POSIX, que sobrescreve). O INSERT da etapa 6 ainda roda:
  // se uma execucao anterior morreu ENTRE o rename e o insert (arquivo
  // orfao em disco), o re-save "cura" o orfao criando a linha que faltou.
  // ---------------------------------------------------------------------
  if !final_path.exists() {
    // -------------------------------------------------------------------
    // ETAPA 4 — Garantir o diretorio de destino.
    // -------------------------------------------------------------------
    if let Some(parent) = final_path.parent() {
      std::fs::create_dir_all(parent).map_err(|error| {
        format!("Nao foi possivel criar a pasta de arquivos do quadro: {error}")
      })?;
    }

    // -------------------------------------------------------------------
    // ETAPA 5 — ESCRITA ATOMICA: temporario + rename.
    //
    // Este e o ponto mais importante da funcao. Se o processo morrer no
    // meio de um write direto no arquivo final, ele fica parcialmente
    // escrito mas "existindo" — o pior cenario possivel, porque parece
    // valido mas esta corrompido (e a etapa 3 passaria a pular a escrita
    // para sempre!). Com temp+rename, ou a escrita completa 100% e o
    // rename acontece, ou nada muda: rename() e atomico no nivel do SO
    // dentro do mesmo filesystem (por isso o .tmp mora no MESMO diretorio
    // do destino — rename entre filesystems deixaria de ser atomico).
    // -------------------------------------------------------------------
    let temp_path = final_path.with_extension(format!("{extension}.tmp"));

    std::fs::write(&temp_path, &data)
      .map_err(|error| format!("Nao foi possivel gravar o arquivo do quadro: {error}"))?;

    if let Err(error) = std::fs::rename(&temp_path, &final_path) {
      // Best effort: nao deixar o .tmp para tras. Se o remove tambem
      // falhar, e so lixo inofensivo — nunca um arquivo final corrompido.
      let _ = std::fs::remove_file(&temp_path);
      return Err(format!(
        "Nao foi possivel finalizar o arquivo do quadro: {error}"
      ));
    }
  }

  // ---------------------------------------------------------------------
  // ETAPA 6 — Registrar no banco SOMENTE depois do arquivo estar integro
  // em disco.
  //
  // A ordem importa: se o insert falhar agora, sobra um arquivo orfao em
  // disco (lixo inofensivo, curavel no proximo save — ver etapa 3). A
  // ordem inversa poderia deixar uma linha apontando para um arquivo que
  // nao existe: quadro quebrado ao carregar, sem pista do motivo.
  //
  // ON CONFLICT DO NOTHING casa com o UNIQUE (canvas_id, file_id) da v12:
  // re-salvar a mesma imagem e idempotente.
  // ---------------------------------------------------------------------
  let instances = db_instances.0.read().await;
  let pool = match instances.get(DATABASE_KEY) {
    Some(DbPool::Sqlite(pool)) => pool,
    _ => return Err("Banco de dados nao carregado.".to_string()),
  };

  sqlx::query(
    "INSERT INTO canvas_files (canvas_id, file_id, mime_type, file_path) VALUES (?, ?, ?, ?) \
     ON CONFLICT (canvas_id, file_id) DO NOTHING",
  )
  .bind(canvas_id)
  .bind(&file_id)
  .bind(&mime_type)
  .bind(&relative_path)
  .execute(pool)
  .await
  .map_err(|error| format!("Nao foi possivel registrar o arquivo do quadro: {error}"))?;

  // Devolve o caminho relativo para o TS confirmar o sucesso.
  Ok(relative_path)
}

// Um arquivo do quadro pronto para o frontend: base64 para o TS reconstruir
// o dataURL que o Excalidraw espera em `files`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CanvasFileData {
  file_id: String,
  mime_type: String,
  data_base64: String,
}

#[tauri::command]
async fn load_canvas_files<R: tauri::Runtime>(
  app: tauri::AppHandle<R>,
  db_instances: tauri::State<'_, DbInstances>,
  canvas_id: i64,
) -> Result<Vec<CanvasFileData>, String> {
  let data_dir = app
    .path()
    .app_data_dir()
    .map_err(|error| format!("Nao foi possivel achar o diretorio de dados: {error}"))?;

  let instances = db_instances.0.read().await;
  let pool = match instances.get(DATABASE_KEY) {
    Some(DbPool::Sqlite(pool)) => pool,
    _ => return Err("Banco de dados nao carregado.".to_string()),
  };

  let rows: Vec<(String, String, String)> =
    sqlx::query_as("SELECT file_id, mime_type, file_path FROM canvas_files WHERE canvas_id = ?")
      .bind(canvas_id)
      .fetch_all(pool)
      .await
      .map_err(|error| format!("Nao foi possivel listar os arquivos do quadro: {error}"))?;

  let mut files = Vec::with_capacity(rows.len());

  for (file_id, mime_type, relative_path) in rows {
    // O caminho relativo usa "/" — PathBuf::join resolve corretamente em
    // qualquer plataforma.
    let absolute_path = data_dir.join(&relative_path);

    // Arquivo sumiu do disco (limpeza manual, backup restaurado pela
    // metade...): degradar em vez de quebrar. O quadro abre sem ESTA
    // imagem (o Excalidraw mostra um placeholder no lugar) — melhor do
    // que o load inteiro falhar e o usuario perder acesso ao resto.
    match std::fs::read(&absolute_path) {
      Ok(bytes) => files.push(CanvasFileData {
        file_id,
        mime_type,
        data_base64: base64::engine::general_purpose::STANDARD.encode(bytes),
      }),
      Err(error) => {
        eprintln!("canvas {canvas_id}: arquivo {relative_path} ilegivel, pulando: {error}");
      }
    }
  }

  Ok(files)
}

// ===========================================================================
// save_notebook_asset / load_notebook_assets — binarios das paginas de Caderno.
//
// Primeira fase: infraestrutura de persistencia, sem alterar ainda o paste do
// editor. O HTML de notebook_pages.content deve guardar so referencias
// (`data-notebook-asset-id` no futuro); bytes ficam em disco.
// ===========================================================================

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NotebookAssetMetadata {
  id: String,
  notebook_id: String,
  page_id: String,
  mime_type: String,
  file_path: String,
  file_size: i64,
  checksum: Option<String>,
  original_name: Option<String>,
  created_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NotebookAssetData {
  id: String,
  notebook_id: String,
  page_id: String,
  mime_type: String,
  file_path: String,
  file_size: i64,
  checksum: Option<String>,
  original_name: Option<String>,
  created_at: String,
  data_base64: String,
}

#[tauri::command]
async fn save_notebook_asset<R: tauri::Runtime>(
  app: tauri::AppHandle<R>,
  db_instances: tauri::State<'_, DbInstances>,
  notebook_id: String,
  page_id: String,
  asset_id: String,
  mime_type: String,
  data_base64: String,
  checksum: Option<String>,
  original_name: Option<String>,
) -> Result<NotebookAssetMetadata, String> {
  // Validacoes antes de qualquer escrita no disco.
  let notebook_id_number = validate_numeric_path_id(&notebook_id, "Identificador do caderno")?;
  let page_id_number = validate_numeric_path_id(&page_id, "Identificador da pagina")?;
  validate_file_id(&asset_id)?;
  let extension = notebook_asset_mime_to_extension(&mime_type)?;

  if data_base64.len() > (MAX_NOTEBOOK_ASSET_BYTES / 3 + 1) * 4 {
    return Err(format!(
      "Asset do caderno excede o limite de {}MB.",
      MAX_NOTEBOOK_ASSET_BYTES / 1024 / 1024
    ));
  }

  let data = base64::engine::general_purpose::STANDARD
    .decode(&data_base64)
    .map_err(|error| format!("Base64 invalido: {error}"))?;

  if data.len() > MAX_NOTEBOOK_ASSET_BYTES {
    return Err(format!(
      "Asset do caderno excede o limite de {}MB.",
      MAX_NOTEBOOK_ASSET_BYTES / 1024 / 1024
    ));
  }

  let instances = db_instances.0.read().await;
  let pool = match instances.get(DATABASE_KEY) {
    Some(DbPool::Sqlite(pool)) => pool,
    _ => return Err("Banco de dados nao carregado.".to_string()),
  };

  let page_owner: Option<(i64,)> =
    sqlx::query_as("SELECT notebook_id FROM notebook_pages WHERE id = ?")
      .bind(page_id_number)
      .fetch_optional(pool)
      .await
      .map_err(|error| format!("Nao foi possivel validar a pagina do caderno: {error}"))?;

  match page_owner {
    Some((owner_notebook_id,)) if owner_notebook_id == notebook_id_number => {}
    Some(_) => return Err("A pagina informada nao pertence ao caderno informado.".to_string()),
    None => return Err("Pagina do caderno nao encontrada.".to_string()),
  }

  let existing_asset: Option<(String, String)> =
    sqlx::query_as("SELECT notebook_id, page_id FROM notebook_assets WHERE id = ?")
      .bind(&asset_id)
      .fetch_optional(pool)
      .await
      .map_err(|error| format!("Nao foi possivel verificar o asset do caderno: {error}"))?;

  if let Some((existing_notebook_id, existing_page_id)) = existing_asset {
    if existing_notebook_id != notebook_id || existing_page_id != page_id {
      return Err("Identificador de asset ja esta em uso por outra pagina.".to_string());
    }
  }

  let data_dir = app
    .path()
    .app_data_dir()
    .map_err(|error| format!("Nao foi possivel achar o diretorio de dados: {error}"))?;
  let relative_path = format!("notebook-assets/{notebook_id}/{page_id}/{asset_id}.{extension}");
  let final_path = data_dir
    .join("notebook-assets")
    .join(&notebook_id)
    .join(&page_id)
    .join(format!("{asset_id}.{extension}"));

  if final_path.exists() {
    let existing_size = std::fs::metadata(&final_path)
      .map_err(|error| format!("Nao foi possivel inspecionar o asset existente: {error}"))?
      .len();

    if existing_size != data.len() as u64 {
      return Err("Asset do caderno ja existe em disco com tamanho diferente.".to_string());
    }
  } else {
    if let Some(parent) = final_path.parent() {
      std::fs::create_dir_all(parent)
        .map_err(|error| format!("Nao foi possivel criar a pasta de assets do caderno: {error}"))?;
    }

    let temp_path = final_path.with_extension(format!("{extension}.tmp"));

    std::fs::write(&temp_path, &data)
      .map_err(|error| format!("Nao foi possivel gravar o asset do caderno: {error}"))?;

    if let Err(error) = std::fs::rename(&temp_path, &final_path) {
      let _ = std::fs::remove_file(&temp_path);
      return Err(format!(
        "Nao foi possivel finalizar o asset do caderno: {error}"
      ));
    }
  }

  sqlx::query(
    "INSERT INTO notebook_assets \
       (id, notebook_id, page_id, mime_type, file_path, file_size, checksum, original_name) \
     VALUES (?, ?, ?, ?, ?, ?, ?, ?) \
     ON CONFLICT (id) DO UPDATE SET \
       notebook_id = excluded.notebook_id, \
       page_id = excluded.page_id, \
       mime_type = excluded.mime_type, \
       file_path = excluded.file_path, \
       file_size = excluded.file_size, \
       checksum = excluded.checksum, \
       original_name = excluded.original_name",
  )
  .bind(&asset_id)
  .bind(&notebook_id)
  .bind(&page_id)
  .bind(&mime_type)
  .bind(&relative_path)
  .bind(data.len() as i64)
  .bind(&checksum)
  .bind(&original_name)
  .execute(pool)
  .await
  .map_err(|error| format!("Nao foi possivel registrar o asset do caderno: {error}"))?;

  let row: (String, String, String, String, String, i64, Option<String>, Option<String>, String) = sqlx::query_as(
    "SELECT id, notebook_id, page_id, mime_type, file_path, file_size, checksum, original_name, created_at \
     FROM notebook_assets WHERE id = ?",
  )
  .bind(&asset_id)
  .fetch_one(pool)
  .await
  .map_err(|error| format!("Nao foi possivel carregar o asset salvo do caderno: {error}"))?;

  Ok(NotebookAssetMetadata {
    id: row.0,
    notebook_id: row.1,
    page_id: row.2,
    mime_type: row.3,
    file_path: row.4,
    file_size: row.5,
    checksum: row.6,
    original_name: row.7,
    created_at: row.8,
  })
}

#[tauri::command]
async fn load_notebook_assets<R: tauri::Runtime>(
  app: tauri::AppHandle<R>,
  db_instances: tauri::State<'_, DbInstances>,
  page_id: String,
) -> Result<Vec<NotebookAssetData>, String> {
  validate_numeric_path_id(&page_id, "Identificador da pagina")?;

  let data_dir = app
    .path()
    .app_data_dir()
    .map_err(|error| format!("Nao foi possivel achar o diretorio de dados: {error}"))?;

  let instances = db_instances.0.read().await;
  let pool = match instances.get(DATABASE_KEY) {
    Some(DbPool::Sqlite(pool)) => pool,
    _ => return Err("Banco de dados nao carregado.".to_string()),
  };

  let rows: Vec<(String, String, String, String, String, i64, Option<String>, Option<String>, String)> = sqlx::query_as(
    "SELECT id, notebook_id, page_id, mime_type, file_path, file_size, checksum, original_name, created_at \
     FROM notebook_assets WHERE page_id = ? ORDER BY created_at ASC, id ASC",
  )
  .bind(&page_id)
  .fetch_all(pool)
  .await
  .map_err(|error| format!("Nao foi possivel listar os assets do caderno: {error}"))?;

  let mut assets = Vec::with_capacity(rows.len());

  for (
    id,
    notebook_id,
    page_id,
    mime_type,
    file_path,
    file_size,
    checksum,
    original_name,
    created_at,
  ) in rows
  {
    let absolute_path = data_dir.join(&file_path);

    match std::fs::read(&absolute_path) {
      Ok(bytes) => assets.push(NotebookAssetData {
        id,
        notebook_id,
        page_id,
        mime_type,
        file_path,
        file_size,
        checksum,
        original_name,
        created_at,
        data_base64: base64::engine::general_purpose::STANDARD.encode(bytes),
      }),
      Err(error) => {
        eprintln!("notebook page {page_id}: asset {file_path} ilegivel, pulando: {error}");
      }
    }
  }

  Ok(assets)
}

// ===========================================================================
// save_notebook_file_attachment / load_notebook_file_attachments — arquivos
// anexados as paginas de Caderno. Primeira fase: sem abrir/revelar/remover.
// ===========================================================================

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NotebookFileAttachmentMetadata {
  id: String,
  notebook_id: i64,
  page_id: i64,
  original_name: String,
  mime_type: Option<String>,
  file_path: String,
  file_size: i64,
  created_at: String,
}

async fn fetch_notebook_file_attachment(
  pool: &sqlx::SqlitePool,
  attachment_id: &str,
) -> Result<NotebookFileAttachmentMetadata, String> {
  let row: Option<(String, i64, i64, String, Option<String>, String, i64, String)> = sqlx::query_as(
    "SELECT id, notebook_id, page_id, original_name, mime_type, file_path, file_size, created_at \
     FROM notebook_file_attachments WHERE id = ?",
  )
  .bind(attachment_id)
  .fetch_optional(pool)
  .await
  .map_err(|error| format!("Nao foi possivel carregar o anexo do caderno: {error}"))?;

  let Some(row) = row else {
    return Err("Anexo do caderno nao encontrado.".to_string());
  };

  Ok(NotebookFileAttachmentMetadata {
    id: row.0,
    notebook_id: row.1,
    page_id: row.2,
    original_name: row.3,
    mime_type: row.4,
    file_path: row.5,
    file_size: row.6,
    created_at: row.7,
  })
}

async fn get_notebook_file_attachment_with_path<R: tauri::Runtime>(
  app: &tauri::AppHandle<R>,
  db_instances: &tauri::State<'_, DbInstances>,
  attachment_id: &str,
) -> Result<(NotebookFileAttachmentMetadata, PathBuf), String> {
  validate_file_id(attachment_id)?;

  let instances = db_instances.0.read().await;
  let pool = match instances.get(DATABASE_KEY) {
    Some(DbPool::Sqlite(pool)) => pool,
    _ => return Err("Banco de dados nao carregado.".to_string()),
  };

  let attachment = fetch_notebook_file_attachment(pool, attachment_id).await?;
  let data_dir = app
    .path()
    .app_data_dir()
    .map_err(|error| format!("Nao foi possivel achar o diretorio de dados: {error}"))?;
  let absolute_path = resolve_app_data_relative_path(&data_dir, &attachment.file_path)?;

  Ok((attachment, absolute_path))
}

#[tauri::command]
async fn save_notebook_file_attachment<R: tauri::Runtime>(
  app: tauri::AppHandle<R>,
  db_instances: tauri::State<'_, DbInstances>,
  notebook_id: String,
  page_id: String,
  attachment_id: String,
  original_name: String,
  mime_type: Option<String>,
  data_base64: String,
) -> Result<NotebookFileAttachmentMetadata, String> {
  // Validacoes antes de qualquer escrita no disco.
  let notebook_id_number = validate_numeric_path_id(&notebook_id, "Identificador do caderno")?;
  let page_id_number = validate_numeric_path_id(&page_id, "Identificador da pagina")?;
  validate_file_id(&attachment_id)?;
  let display_name = normalize_attachment_display_name(&original_name)?;
  let sanitized_name = sanitize_attachment_file_name(&display_name)?;
  let normalized_mime_type = mime_type
    .map(|value| value.trim().to_string())
    .filter(|value| !value.is_empty() && !value.chars().any(char::is_control));

  if data_base64.len() > (MAX_NOTEBOOK_ATTACHMENT_BYTES / 3 + 1) * 4 {
    return Err(format!(
      "Arquivo anexado excede o limite de {}MB.",
      MAX_NOTEBOOK_ATTACHMENT_BYTES / 1024 / 1024
    ));
  }

  let data = base64::engine::general_purpose::STANDARD
    .decode(&data_base64)
    .map_err(|error| format!("Base64 invalido: {error}"))?;

  if data.len() > MAX_NOTEBOOK_ATTACHMENT_BYTES {
    return Err(format!(
      "Arquivo anexado excede o limite de {}MB.",
      MAX_NOTEBOOK_ATTACHMENT_BYTES / 1024 / 1024
    ));
  }

  let instances = db_instances.0.read().await;
  let pool = match instances.get(DATABASE_KEY) {
    Some(DbPool::Sqlite(pool)) => pool,
    _ => return Err("Banco de dados nao carregado.".to_string()),
  };

  let page_owner: Option<(i64,)> =
    sqlx::query_as("SELECT notebook_id FROM notebook_pages WHERE id = ?")
      .bind(page_id_number)
      .fetch_optional(pool)
      .await
      .map_err(|error| format!("Nao foi possivel validar a pagina do caderno: {error}"))?;

  match page_owner {
    Some((owner_notebook_id,)) if owner_notebook_id == notebook_id_number => {}
    Some(_) => return Err("A pagina informada nao pertence ao caderno informado.".to_string()),
    None => return Err("Pagina do caderno nao encontrada.".to_string()),
  }

  let existing_attachment: Option<(i64, i64)> =
    sqlx::query_as("SELECT notebook_id, page_id FROM notebook_file_attachments WHERE id = ?")
      .bind(&attachment_id)
      .fetch_optional(pool)
      .await
      .map_err(|error| format!("Nao foi possivel verificar o anexo do caderno: {error}"))?;

  if let Some((existing_notebook_id, existing_page_id)) = existing_attachment {
    if existing_notebook_id != notebook_id_number || existing_page_id != page_id_number {
      return Err("Identificador de anexo ja esta em uso por outra pagina.".to_string());
    }
  }

  let data_dir = app
    .path()
    .app_data_dir()
    .map_err(|error| format!("Nao foi possivel achar o diretorio de dados: {error}"))?;
  let relative_path = format!(
    "notebook-attachments/{notebook_id}/{page_id}/{attachment_id}/{sanitized_name}"
  );
  let final_path = data_dir
    .join("notebook-attachments")
    .join(&notebook_id)
    .join(&page_id)
    .join(&attachment_id)
    .join(&sanitized_name);

  if final_path.exists() {
    let existing_size = std::fs::metadata(&final_path)
      .map_err(|error| format!("Nao foi possivel inspecionar o anexo existente: {error}"))?
      .len();

    if existing_size != data.len() as u64 {
      return Err("Anexo do caderno ja existe em disco com tamanho diferente.".to_string());
    }
  } else {
    if let Some(parent) = final_path.parent() {
      std::fs::create_dir_all(parent)
        .map_err(|error| format!("Nao foi possivel criar a pasta de anexos do caderno: {error}"))?;
    }

    let temp_path = final_path.with_file_name(format!("{sanitized_name}.tmp"));

    std::fs::write(&temp_path, &data)
      .map_err(|error| format!("Nao foi possivel gravar o anexo do caderno: {error}"))?;

    if let Err(error) = std::fs::rename(&temp_path, &final_path) {
      let _ = std::fs::remove_file(&temp_path);
      return Err(format!(
        "Nao foi possivel finalizar o anexo do caderno: {error}"
      ));
    }
  }

  sqlx::query(
    "INSERT INTO notebook_file_attachments \
       (id, notebook_id, page_id, original_name, mime_type, file_path, file_size) \
     VALUES (?, ?, ?, ?, ?, ?, ?) \
     ON CONFLICT (id) DO UPDATE SET \
       notebook_id = excluded.notebook_id, \
       page_id = excluded.page_id, \
       original_name = excluded.original_name, \
       mime_type = excluded.mime_type, \
       file_path = excluded.file_path, \
       file_size = excluded.file_size",
  )
  .bind(&attachment_id)
  .bind(notebook_id_number)
  .bind(page_id_number)
  .bind(&display_name)
  .bind(&normalized_mime_type)
  .bind(&relative_path)
  .bind(data.len() as i64)
  .execute(pool)
  .await
  .map_err(|error| format!("Nao foi possivel registrar o anexo do caderno: {error}"))?;

  let row: (String, i64, i64, String, Option<String>, String, i64, String) = sqlx::query_as(
    "SELECT id, notebook_id, page_id, original_name, mime_type, file_path, file_size, created_at \
     FROM notebook_file_attachments WHERE id = ?",
  )
  .bind(&attachment_id)
  .fetch_one(pool)
  .await
  .map_err(|error| format!("Nao foi possivel carregar o anexo salvo do caderno: {error}"))?;

  Ok(NotebookFileAttachmentMetadata {
    id: row.0,
    notebook_id: row.1,
    page_id: row.2,
    original_name: row.3,
    mime_type: row.4,
    file_path: row.5,
    file_size: row.6,
    created_at: row.7,
  })
}

#[tauri::command]
async fn open_notebook_file_attachment<R: tauri::Runtime>(
  app: tauri::AppHandle<R>,
  db_instances: tauri::State<'_, DbInstances>,
  attachment_id: String,
) -> Result<(), String> {
  let (_attachment, absolute_path) =
    get_notebook_file_attachment_with_path(&app, &db_instances, &attachment_id).await?;

  if !absolute_path.is_file() {
    return Err("Arquivo anexado nao encontrado no disco.".to_string());
  }

  open_file_with_system(&absolute_path)
    .map_err(|error| format!("Nao foi possivel abrir o arquivo anexado: {error}"))
}

#[tauri::command]
async fn reveal_notebook_file_attachment<R: tauri::Runtime>(
  app: tauri::AppHandle<R>,
  db_instances: tauri::State<'_, DbInstances>,
  attachment_id: String,
) -> Result<(), String> {
  let (_attachment, absolute_path) =
    get_notebook_file_attachment_with_path(&app, &db_instances, &attachment_id).await?;

  if !absolute_path.exists() {
    return Err("Arquivo anexado nao encontrado no disco.".to_string());
  }

  open_path_in_file_manager(&absolute_path)
    .map_err(|error| format!("Nao foi possivel mostrar o arquivo anexado: {error}"))
}

#[tauri::command]
async fn delete_notebook_file_attachment<R: tauri::Runtime>(
  app: tauri::AppHandle<R>,
  db_instances: tauri::State<'_, DbInstances>,
  attachment_id: String,
) -> Result<NotebookFileAttachmentMetadata, String> {
  let (attachment, absolute_path) =
    get_notebook_file_attachment_with_path(&app, &db_instances, &attachment_id).await?;

  if absolute_path.exists() {
    std::fs::remove_file(&absolute_path)
      .map_err(|error| format!("Nao foi possivel remover o arquivo anexado: {error}"))?;
  }

  let instances = db_instances.0.read().await;
  let pool = match instances.get(DATABASE_KEY) {
    Some(DbPool::Sqlite(pool)) => pool,
    _ => return Err("Banco de dados nao carregado.".to_string()),
  };

  sqlx::query("DELETE FROM notebook_file_attachments WHERE id = ?")
    .bind(&attachment.id)
    .execute(pool)
    .await
    .map_err(|error| format!("Nao foi possivel remover o registro do anexo: {error}"))?;

  if let Some(attachment_dir) = absolute_path.parent() {
    let _ = std::fs::remove_dir(attachment_dir);
    if let Some(page_dir) = attachment_dir.parent() {
      let _ = std::fs::remove_dir(page_dir);
      if let Some(notebook_dir) = page_dir.parent() {
        let _ = std::fs::remove_dir(notebook_dir);
      }
    }
  }

  Ok(attachment)
}

#[tauri::command]
async fn load_notebook_file_attachments(
  db_instances: tauri::State<'_, DbInstances>,
  page_id: String,
) -> Result<Vec<NotebookFileAttachmentMetadata>, String> {
  let page_id_number = validate_numeric_path_id(&page_id, "Identificador da pagina")?;

  let instances = db_instances.0.read().await;
  let pool = match instances.get(DATABASE_KEY) {
    Some(DbPool::Sqlite(pool)) => pool,
    _ => return Err("Banco de dados nao carregado.".to_string()),
  };

  let rows: Vec<(String, i64, i64, String, Option<String>, String, i64, String)> = sqlx::query_as(
    "SELECT id, notebook_id, page_id, original_name, mime_type, file_path, file_size, created_at \
     FROM notebook_file_attachments WHERE page_id = ? ORDER BY created_at ASC, id ASC",
  )
  .bind(page_id_number)
  .fetch_all(pool)
  .await
  .map_err(|error| format!("Nao foi possivel listar os anexos do caderno: {error}"))?;

  Ok(
    rows
      .into_iter()
      .map(|row| NotebookFileAttachmentMetadata {
        id: row.0,
        notebook_id: row.1,
        page_id: row.2,
        original_name: row.3,
        mime_type: row.4,
        file_path: row.5,
        file_size: row.6,
        created_at: row.7,
      })
      .collect(),
  )
}

fn database_migrations() -> Vec<Migration> {
  vec![
    Migration {
      version: 1,
      description: "create_library_persistence_schema",
      sql: r#"
CREATE TABLE collections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  source TEXT NOT NULL,
  year INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('in-progress', 'completed', 'not-started', 'error')),
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
  collection_id TEXT NOT NULL,
  file_name TEXT,
  file_path TEXT,
  notes TEXT NOT NULL DEFAULT '',
  reading_location_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (collection_id) REFERENCES collections(id) ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE TABLE document_authors (
  document_id TEXT NOT NULL,
  author TEXT NOT NULL,
  author_order INTEGER NOT NULL,
  PRIMARY KEY (document_id, author_order),
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  color_token TEXT NOT NULL CHECK (color_token IN ('violet', 'indigo', 'blue', 'teal', 'rose', 'amber')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE document_tags (
  document_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  tag_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (document_id, tag_id),
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE VIRTUAL TABLE documents_fts USING fts5(
  document_id UNINDEXED,
  title,
  authors,
  source,
  year,
  collection,
  tags,
  notes
);

CREATE INDEX idx_documents_collection_id ON documents(collection_id);
CREATE INDEX idx_documents_updated_at ON documents(updated_at);
CREATE INDEX idx_documents_favorite ON documents(favorite);
CREATE INDEX idx_documents_status ON documents(status);
CREATE INDEX idx_document_tags_tag_id ON document_tags(tag_id);

CREATE TRIGGER collections_touch_updated_at
AFTER UPDATE ON collections
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE collections
  SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.id;
END;

CREATE TRIGGER documents_touch_updated_at
AFTER UPDATE ON documents
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE documents
  SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.id;
END;

CREATE TRIGGER tags_touch_updated_at
AFTER UPDATE ON tags
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE tags
  SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.id;
END;

CREATE TRIGGER documents_fts_after_document_insert
AFTER INSERT ON documents
FOR EACH ROW
BEGIN
  INSERT INTO documents_fts(document_id, title, authors, source, year, collection, tags, notes)
  SELECT
    NEW.id,
    NEW.title,
    COALESCE((SELECT group_concat(author, ' ') FROM document_authors WHERE document_id = NEW.id ORDER BY author_order), ''),
    NEW.source,
    CAST(NEW.year AS TEXT),
    collections.name,
    COALESCE((SELECT group_concat(tags.name, ' ') FROM document_tags JOIN tags ON tags.id = document_tags.tag_id WHERE document_tags.document_id = NEW.id ORDER BY document_tags.tag_order), ''),
    NEW.notes
  FROM collections
  WHERE collections.id = NEW.collection_id;
END;

CREATE TRIGGER documents_fts_after_document_update
AFTER UPDATE ON documents
FOR EACH ROW
BEGIN
  DELETE FROM documents_fts WHERE document_id = OLD.id;
  INSERT INTO documents_fts(document_id, title, authors, source, year, collection, tags, notes)
  SELECT
    NEW.id,
    NEW.title,
    COALESCE((SELECT group_concat(author, ' ') FROM document_authors WHERE document_id = NEW.id ORDER BY author_order), ''),
    NEW.source,
    CAST(NEW.year AS TEXT),
    collections.name,
    COALESCE((SELECT group_concat(tags.name, ' ') FROM document_tags JOIN tags ON tags.id = document_tags.tag_id WHERE document_tags.document_id = NEW.id ORDER BY document_tags.tag_order), ''),
    NEW.notes
  FROM collections
  WHERE collections.id = NEW.collection_id;
END;

CREATE TRIGGER documents_fts_after_document_delete
AFTER DELETE ON documents
FOR EACH ROW
BEGIN
  DELETE FROM documents_fts WHERE document_id = OLD.id;
END;

CREATE TRIGGER documents_fts_after_author_insert
AFTER INSERT ON document_authors
FOR EACH ROW
BEGIN
  DELETE FROM documents_fts WHERE document_id = NEW.document_id;
  INSERT INTO documents_fts(document_id, title, authors, source, year, collection, tags, notes)
  SELECT
    documents.id,
    documents.title,
    COALESCE((SELECT group_concat(author, ' ') FROM document_authors WHERE document_id = documents.id ORDER BY author_order), ''),
    documents.source,
    CAST(documents.year AS TEXT),
    collections.name,
    COALESCE((SELECT group_concat(tags.name, ' ') FROM document_tags JOIN tags ON tags.id = document_tags.tag_id WHERE document_tags.document_id = documents.id ORDER BY document_tags.tag_order), ''),
    documents.notes
  FROM documents
  JOIN collections ON collections.id = documents.collection_id
  WHERE documents.id = NEW.document_id;
END;

CREATE TRIGGER documents_fts_after_author_update
AFTER UPDATE ON document_authors
FOR EACH ROW
BEGIN
  DELETE FROM documents_fts WHERE document_id = NEW.document_id;
  INSERT INTO documents_fts(document_id, title, authors, source, year, collection, tags, notes)
  SELECT
    documents.id,
    documents.title,
    COALESCE((SELECT group_concat(author, ' ') FROM document_authors WHERE document_id = documents.id ORDER BY author_order), ''),
    documents.source,
    CAST(documents.year AS TEXT),
    collections.name,
    COALESCE((SELECT group_concat(tags.name, ' ') FROM document_tags JOIN tags ON tags.id = document_tags.tag_id WHERE document_tags.document_id = documents.id ORDER BY document_tags.tag_order), ''),
    documents.notes
  FROM documents
  JOIN collections ON collections.id = documents.collection_id
  WHERE documents.id = NEW.document_id;
END;

CREATE TRIGGER documents_fts_after_author_delete
AFTER DELETE ON document_authors
FOR EACH ROW
BEGIN
  DELETE FROM documents_fts WHERE document_id = OLD.document_id;
  INSERT INTO documents_fts(document_id, title, authors, source, year, collection, tags, notes)
  SELECT
    documents.id,
    documents.title,
    COALESCE((SELECT group_concat(author, ' ') FROM document_authors WHERE document_id = documents.id ORDER BY author_order), ''),
    documents.source,
    CAST(documents.year AS TEXT),
    collections.name,
    COALESCE((SELECT group_concat(tags.name, ' ') FROM document_tags JOIN tags ON tags.id = document_tags.tag_id WHERE document_tags.document_id = documents.id ORDER BY document_tags.tag_order), ''),
    documents.notes
  FROM documents
  JOIN collections ON collections.id = documents.collection_id
  WHERE documents.id = OLD.document_id;
END;

CREATE TRIGGER documents_fts_after_document_tag_insert
AFTER INSERT ON document_tags
FOR EACH ROW
BEGIN
  DELETE FROM documents_fts WHERE document_id = NEW.document_id;
  INSERT INTO documents_fts(document_id, title, authors, source, year, collection, tags, notes)
  SELECT
    documents.id,
    documents.title,
    COALESCE((SELECT group_concat(author, ' ') FROM document_authors WHERE document_id = documents.id ORDER BY author_order), ''),
    documents.source,
    CAST(documents.year AS TEXT),
    collections.name,
    COALESCE((SELECT group_concat(tags.name, ' ') FROM document_tags JOIN tags ON tags.id = document_tags.tag_id WHERE document_tags.document_id = documents.id ORDER BY document_tags.tag_order), ''),
    documents.notes
  FROM documents
  JOIN collections ON collections.id = documents.collection_id
  WHERE documents.id = NEW.document_id;
END;

CREATE TRIGGER documents_fts_after_document_tag_update
AFTER UPDATE ON document_tags
FOR EACH ROW
BEGIN
  DELETE FROM documents_fts WHERE document_id = OLD.document_id;
  DELETE FROM documents_fts WHERE document_id = NEW.document_id;
  INSERT INTO documents_fts(document_id, title, authors, source, year, collection, tags, notes)
  SELECT
    documents.id,
    documents.title,
    COALESCE((SELECT group_concat(author, ' ') FROM document_authors WHERE document_id = documents.id ORDER BY author_order), ''),
    documents.source,
    CAST(documents.year AS TEXT),
    collections.name,
    COALESCE((SELECT group_concat(tags.name, ' ') FROM document_tags JOIN tags ON tags.id = document_tags.tag_id WHERE document_tags.document_id = documents.id ORDER BY document_tags.tag_order), ''),
    documents.notes
  FROM documents
  JOIN collections ON collections.id = documents.collection_id
  WHERE documents.id = NEW.document_id;
END;

CREATE TRIGGER documents_fts_after_document_tag_delete
AFTER DELETE ON document_tags
FOR EACH ROW
BEGIN
  DELETE FROM documents_fts WHERE document_id = OLD.document_id;
  INSERT INTO documents_fts(document_id, title, authors, source, year, collection, tags, notes)
  SELECT
    documents.id,
    documents.title,
    COALESCE((SELECT group_concat(author, ' ') FROM document_authors WHERE document_id = documents.id ORDER BY author_order), ''),
    documents.source,
    CAST(documents.year AS TEXT),
    collections.name,
    COALESCE((SELECT group_concat(tags.name, ' ') FROM document_tags JOIN tags ON tags.id = document_tags.tag_id WHERE document_tags.document_id = documents.id ORDER BY document_tags.tag_order), ''),
    documents.notes
  FROM documents
  JOIN collections ON collections.id = documents.collection_id
  WHERE documents.id = OLD.document_id;
END;

CREATE TRIGGER documents_fts_after_tag_update
AFTER UPDATE ON tags
FOR EACH ROW
BEGIN
  DELETE FROM documents_fts
  WHERE document_id IN (SELECT document_id FROM document_tags WHERE tag_id = NEW.id);
  INSERT INTO documents_fts(document_id, title, authors, source, year, collection, tags, notes)
  SELECT
    documents.id,
    documents.title,
    COALESCE((SELECT group_concat(author, ' ') FROM document_authors WHERE document_id = documents.id ORDER BY author_order), ''),
    documents.source,
    CAST(documents.year AS TEXT),
    collections.name,
    COALESCE((SELECT group_concat(tags.name, ' ') FROM document_tags JOIN tags ON tags.id = document_tags.tag_id WHERE document_tags.document_id = documents.id ORDER BY document_tags.tag_order), ''),
    documents.notes
  FROM documents
  JOIN collections ON collections.id = documents.collection_id
  WHERE documents.id IN (SELECT document_id FROM document_tags WHERE tag_id = NEW.id);
END;

CREATE TRIGGER documents_fts_after_tag_delete
AFTER DELETE ON tags
FOR EACH ROW
BEGIN
  DELETE FROM documents_fts
  WHERE document_id IN (SELECT document_id FROM document_tags WHERE tag_id = OLD.id);
END;
"#,
      kind: MigrationKind::Up,
    },
    Migration {
      version: 2,
      description: "add_document_trash_state",
      sql: r#"
ALTER TABLE documents ADD COLUMN deleted_at TEXT;
CREATE INDEX idx_documents_deleted_at ON documents(deleted_at);
"#,
      kind: MigrationKind::Up,
    },
    // v3: tabela de anotacoes da tela de leitura (highlights + comentarios).
    //
    // Cada linha e uma anotacao ancorada a uma selecao de texto numa pagina.
    // Modelamos highlight e comentario na MESMA tabela: `note = ''` significa
    // highlight puro; `note <> ''` significa highlight com comentario.
    //
    // Decisao de confiabilidade (prioridade #1 do projeto): toda a geometria do
    // highlight fica em UMA coluna (`rects_json`), entao criar/editar/excluir uma
    // anotacao e sempre UM unico statement SQL. O SQLite garante atomicidade por
    // statement, logo nao precisamos de transacao multi-statement (que seria
    // insegura no pool de conexoes do plugin-sql).
    Migration {
      version: 3,
      description: "create_reading_annotations",
      sql: r#"
CREATE TABLE annotations (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  -- Pagina 1-based onde a anotacao vive. Uma selecao que cruza paginas vira
  -- uma anotacao por pagina (cada uma com seus proprios rects).
  page INTEGER NOT NULL CHECK (page >= 1),
  -- Cor do highlight. Por ora so 'amber' (unica cor validada em WCAG AA para
  -- este uso). Verde/Green fica reservado para status "concluido" e nao entra
  -- aqui. Extensao futura reaproveitaria violet/indigo/blue/teal/rose, que ja
  -- sao validados; nao inventar cores novas sem validar contraste.
  color TEXT NOT NULL DEFAULT 'amber' CHECK (color IN ('amber')),
  -- Texto exato selecionado: usado na lista do painel, no copiar, e como sinal
  -- de verificacao/fallback de re-ancoragem se o PDF mudar.
  selected_text TEXT NOT NULL,
  -- Comentario opcional do usuario. '' = highlight sem comentario.
  note TEXT NOT NULL DEFAULT '',
  -- Geometria: JSON com array de retangulos normalizados (fracoes 0..1 do
  -- tamanho da pagina renderizada), ex: [{"x":0.1,"y":0.2,"w":0.3,"h":0.02}].
  -- Normalizado para sobreviver a zoom, DPR e tamanho de janela.
  rects_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE INDEX idx_annotations_document_id ON annotations(document_id);
CREATE INDEX idx_annotations_document_page ON annotations(document_id, page);

-- Mantem updated_at em dia em qualquer UPDATE que nao o altere explicitamente,
-- seguindo o mesmo padrao das outras tabelas.
CREATE TRIGGER annotations_touch_updated_at
AFTER UPDATE ON annotations
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE annotations
  SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.id;
END;
"#,
      kind: MigrationKind::Up,
    },
    Migration {
      version: 4,
      description: "add_collection_descriptions",
      sql: r#"
ALTER TABLE collections ADD COLUMN description TEXT NOT NULL DEFAULT '';
"#,
      kind: MigrationKind::Up,
    },
    Migration {
      version: 5,
      description: "remove_sample_library_items",
      sql: r#"
DELETE FROM documents
WHERE id IN (
  'attention-is-all-you-need',
  'survey-large-language-models',
  'designing-data-intensive-applications',
  'imagenet-deep-cnns',
  'concrete-problems-ai-safety',
  'deep-learning',
  'bert-pretraining',
  'raft-reliable-distributed-systems',
  'probabilistic-machine-learning',
  'alignment-problem',
  'damaged-import-transformers'
);

DELETE FROM collections
WHERE id IN (
  'machine-learning-papers',
  'engineering-books',
  'business-books',
  'psychology',
  'reading-queue',
  'lixeira'
)
AND NOT EXISTS (
  SELECT 1 FROM documents WHERE documents.collection_id = collections.id
);
"#,
      kind: MigrationKind::Up,
    },
    Migration {
      version: 6,
      description: "drop_collection_descriptions",
      sql: r#"
ALTER TABLE collections DROP COLUMN description;
"#,
      kind: MigrationKind::Up,
    },
    Migration {
      version: 7,
      description: "create_default_collection",
      sql: r#"
INSERT OR IGNORE INTO collections (id, name, is_system)
SELECT 'sem-titulo', 'Sem título', 0
WHERE NOT EXISTS (
  SELECT 1 FROM collections WHERE is_system = 0
);
"#,
      kind: MigrationKind::Up,
    },
    Migration {
      version: 8,
      description: "add_reader_info_fields_and_annotation_colors",
      sql: r#"
ALTER TABLE documents ADD COLUMN time_spent_seconds INTEGER NOT NULL DEFAULT 0;

DROP TRIGGER IF EXISTS annotations_touch_updated_at;
DROP INDEX IF EXISTS idx_annotations_document_id;
DROP INDEX IF EXISTS idx_annotations_document_page;

CREATE TABLE annotations_new (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  page INTEGER NOT NULL CHECK (page >= 1),
  color TEXT NOT NULL DEFAULT 'amber',
  selected_text TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  rects_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

INSERT INTO annotations_new (
  id,
  document_id,
  page,
  color,
  selected_text,
  note,
  rects_json,
  created_at,
  updated_at
)
SELECT
  id,
  document_id,
  page,
  color,
  selected_text,
  note,
  rects_json,
  created_at,
  updated_at
FROM annotations;

DROP TABLE annotations;
ALTER TABLE annotations_new RENAME TO annotations;

CREATE INDEX idx_annotations_document_id ON annotations(document_id);
CREATE INDEX idx_annotations_document_page ON annotations(document_id, page);

CREATE TRIGGER annotations_touch_updated_at
AFTER UPDATE ON annotations
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE annotations
  SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.id;
END;
"#,
      kind: MigrationKind::Up,
    },
    Migration {
      version: 9,
      description: "add_collection_color_and_description",
      sql: include_str!("../migrations/0009_add_collection_color_and_description.sql"),
      kind: MigrationKind::Up,
    },
    // v10: Cadernos (notebooks + notebook_pages) e Quadros (canvases).
    // O SQL vive em arquivo separado (mesmo padrao da v9) e esta comentado
    // bloco a bloco la. Pontos-chave do design:
    //   - collection_id e TEXT (collections.id e slug textual, nao numero);
    //   - FK colecao -> caderno/quadro usa ON DELETE RESTRICT: excluir a
    //     colecao exige mover o conteudo para a colecao fallback antes
    //     (deleteCollection, em src/lib/database.ts, faz esse UPDATE);
    //   - FK caderno -> pagina usa ON DELETE CASCADE: pagina e parte do
    //     caderno, nao sobrevive sem ele.
    // CRUD de cadernos/paginas/quadros fica em TypeScript via plugin-sql
    // (mesmo padrao de annotations) — nenhum comando Rust novo.
    Migration {
      version: 10,
      description: "add_notebooks_and_canvases",
      sql: include_str!("../migrations/0010_add_notebooks_and_canvases.sql"),
      kind: MigrationKind::Up,
    },
    Migration {
      version: 11,
      description: "add_notebook_description",
      sql: include_str!("../migrations/0011_add_notebook_description.sql"),
      kind: MigrationKind::Up,
    },
    // v12: conteudo dos Quadros (cena Excalidraw em canvases.content) + tabela
    // canvas_files (indice dos binarios em disco). O trigger de updated_at de
    // canvases ja existe desde a v10 — a v12 nao recria. SQL comentado no arquivo.
    Migration {
      version: 12,
      description: "add_canvas_content_and_files",
      sql: include_str!("../migrations/0012_add_canvas_content_and_files.sql"),
      kind: MigrationKind::Up,
    },
    Migration {
      version: 13,
      description: "add_notebook_canvas_menu_state",
      sql: include_str!("../migrations/0013_add_notebook_canvas_menu_state.sql"),
      kind: MigrationKind::Up,
    },
    // v14: tabela app_settings (chave-valor) para preferencias globais do app.
    // Primeira chave: icon_variant (variante do icone). O CRUD e feito em
    // TypeScript via plugin-sql (mesmo padrao das outras leituras/escritas
    // simples); nenhum comando Rust novo — este bloco so registra a migration.
    Migration {
      version: 14,
      description: "add_app_settings",
      sql: include_str!("../migrations/0014_add_app_settings.sql"),
      kind: MigrationKind::Up,
    },
    // v15: notebook_tags (mesmo vocabulario de tags dos documentos) e
    // notebook_linked_documents (PDFs vinculados a um caderno, N:N). CRUD em
    // TypeScript via plugin-sql; nenhum comando Rust novo. SQL comentado
    // bloco a bloco no arquivo.
    Migration {
      version: 15,
      description: "add_notebook_tags_and_linked_documents",
      sql: include_str!("../migrations/0015_add_notebook_tags_and_linked_documents.sql"),
      kind: MigrationKind::Up,
    },
    // v16: metadados editaveis do painel de Detalhes dos Cadernos
    // (status de leitura e autor/disciplina).
    Migration {
      version: 16,
      description: "add_notebook_details_metadata",
      sql: include_str!("../migrations/0016_add_notebook_details_metadata.sql"),
      kind: MigrationKind::Up,
    },
    // v17: indice dos binarios de paginas de Caderno. O editor ainda nao cola
    // imagens nesta fase; a tabela e os comandos Rust preparam a persistencia
    // em disco para evitar base64 dentro de notebook_pages.content.
    Migration {
      version: 17,
      description: "add_notebook_assets",
      sql: include_str!("../migrations/0017_add_notebook_assets.sql"),
      kind: MigrationKind::Up,
    },
    // v18: arquivos anexados a paginas de Caderno. O HTML salva apenas
    // data-notebook-attachment-id; metadados ficam no SQLite e bytes em disco.
    Migration {
      version: 18,
      description: "add_notebook_file_attachments",
      sql: include_str!("../migrations/0018_add_notebook_file_attachments.sql"),
      kind: MigrationKind::Up,
    },
  ]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_fs::init())
    .plugin(
      tauri_plugin_sql::Builder::default()
        .add_migrations("sqlite:athenaeum.db", database_migrations())
        .build(),
    )
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      import_document,
      delete_notebook_file_attachment,
      load_canvas_files,
      load_notebook_assets,
      load_notebook_file_attachments,
      open_external_url,
      open_file_location,
      open_notebook_file_attachment,
      read_pdf_file,
      reveal_notebook_file_attachment,
      save_canvas_file,
      save_notebook_asset,
      save_notebook_file_attachment,
      select_notebook_export_destination,
      select_pdf_file,
      select_pdf_files
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
