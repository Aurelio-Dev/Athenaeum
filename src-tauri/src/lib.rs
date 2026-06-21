use base64::Engine;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri_plugin_sql::{Migration, MigrationKind};

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

#[tauri::command]
fn read_pdf_file(file_path: String) -> Result<String, String> {
  let path = PathBuf::from(&file_path);

  if !path.exists() {
    return Err("Arquivo nao encontrado.".to_string());
  }

  let bytes = std::fs::read(&path).map_err(|error| error.to_string())?;

  Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

#[tauri::command]
fn open_file_location(file_path: String) -> Result<(), String> {
  let path = PathBuf::from(file_path);

  if !path.exists() {
    return Err("Arquivo nao encontrado.".to_string());
  }

  open_path_in_file_manager(&path)
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
    .invoke_handler(tauri::generate_handler![open_file_location, read_pdf_file, select_pdf_file])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
