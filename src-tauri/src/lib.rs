use base64::Engine;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
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
      sqlx::query("INSERT INTO document_authors (document_id, author, author_order) VALUES (?, ?, ?)")
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
fn open_reader_panel_window<R: tauri::Runtime>(
  app: tauri::AppHandle<R>,
  document_title: String,
) -> Result<(), String> {
  let label = "reader-annotations-panel";

  if let Some(window) = app.get_webview_window(label) {
    window.set_focus().map_err(|error| error.to_string())?;
    return Ok(());
  }

  WebviewWindowBuilder::new(&app, label, WebviewUrl::App("index.html?readerPanel=1".into()))
    .title(format!("Anotações — {document_title}"))
    .inner_size(420.0, 720.0)
    .min_inner_size(360.0, 520.0)
    .resizable(true)
    .build()
    .map_err(|error| error.to_string())?;

  Ok(())
}

#[cfg(target_os = "windows")]
fn open_path_in_file_manager(path: &Path) -> Result<(), String> {
  Command::new("explorer")
    .arg(format!("/select,{}", path.display()))
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
      open_file_location,
      open_reader_panel_window,
      read_pdf_file,
      select_pdf_file,
      select_pdf_files
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
