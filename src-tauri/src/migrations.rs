use tauri_plugin_sql::{Migration, MigrationKind};

pub(crate) fn database_migrations() -> Vec<Migration> {
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
        // O CRUD e feito em TypeScript via plugin-sql (mesmo padrao das outras
        // leituras/escritas simples); nenhum comando Rust novo — este bloco so
        // registra a migration.
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
        Migration {
            version: 19,
            description: "add_document_details_metadata",
            sql: include_str!("../migrations/0019_add_document_details_metadata.sql"),
            kind: MigrationKind::Up,
        },
        // v20: cada anotacao passa a registrar como sua geometria deve ser
        // desenhada no PDF: preenchimento de marca-texto ou linha inferior.
        // O SQL fica em arquivo separado porque migrations novas seguem esse
        // padrao no projeto. `include_str!` inclui o texto no binario durante a
        // compilacao; a execucao continua sendo feita pelo tauri-plugin-sql, na
        // ordem numerica das versions, quando o aplicativo abre o banco.
        Migration {
            version: 20,
            description: "add_annotation_mark_style",
            sql: include_str!("../migrations/0020_add_annotation_mark_style.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 21,
            description: "add_document_bookmarks",
            sql: include_str!("../migrations/0021_add_document_bookmarks.sql"),
            kind: MigrationKind::Up,
        },
        // v22: cada documento guarda se a lista de anotacoes deve mostrar todas
        // as paginas ou apenas a pagina atual. O DEFAULT `all` define o estado
        // inicial inclusive para documentos antigos. O CHECK e uma regra do
        // proprio SQLite: ele impede que qualquer caminho de escrita persista
        // um texto fora dos dois valores que o TypeScript sabe representar.
        Migration {
            version: 22,
            description: "add_document_annotations_filter_scope",
            sql: include_str!("../migrations/0022_add_document_annotations_filter_scope.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 23,
            description: "add_document_reading_list_dismissed_at",
            sql: include_str!("../migrations/0023_add_document_reading_list_dismissed_at.sql"),
            kind: MigrationKind::Up,
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::path::{Path, PathBuf};

    // -----------------------------------------------------------------------
    // Cadeia de migrations
    // -----------------------------------------------------------------------

    use sqlx::error::BoxDynError;
    use sqlx::migrate::{Migration as SqlxMigration, MigrationSource, MigrationType, Migrator};
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePool};
    use std::borrow::Cow;
    use std::future::Future;
    use std::pin::Pin;

    // Espelha a conversao feita pelo `MigrationList` do tauri-plugin-sql, que e
    // privado e por isso nao pode ser reaproveitado daqui: `MigrationKind::Up`
    // vira `MigrationType::ReversibleUp`, `no_tx` e sempre `false`, e migrations
    // `Down` sao descartadas. Se o plugin mudar essa conversao numa versao
    // futura, este helper precisa acompanhar — senao os testes abaixo passam a
    // exercitar uma cadeia que nao e mais a que roda em producao.
    fn to_sqlx_migrations(migrations: Vec<Migration>) -> Vec<SqlxMigration> {
        migrations
            .into_iter()
            .filter(|migration| matches!(migration.kind, MigrationKind::Up))
            .map(|migration| {
                SqlxMigration::new(
                    migration.version,
                    Cow::Borrowed(migration.description),
                    MigrationType::ReversibleUp,
                    Cow::Borrowed(migration.sql),
                    false,
                )
            })
            .collect()
    }

    // `MigrationSource` nao e implementado para `Vec<Migration>` no sqlx, e o
    // unico construtor publico de `Migrator` exige uma fonte. Este newtype so
    // devolve a lista ja convertida.
    #[derive(Debug)]
    struct ChainMigrationSource(Vec<SqlxMigration>);

    impl MigrationSource<'static> for ChainMigrationSource {
        fn resolve(
            self,
        ) -> Pin<Box<dyn Future<Output = Result<Vec<SqlxMigration>, BoxDynError>> + Send + 'static>>
        {
            Box::pin(async move { Ok(self.0) })
        }
    }

    async fn migration_chain_migrator() -> Migrator {
        Migrator::new(ChainMigrationSource(to_sqlx_migrations(
            database_migrations(),
        )))
        .await
        .expect("resolver a lista de migrations de producao")
    }

    fn migration_test_db_path(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "athenaeum-migrations-{}-{name}.db",
            std::process::id()
        ));
        remove_migration_test_db(&path);
        path
    }

    // O sqlx abre o SQLite em WAL por padrao, entao sobram `-wal` e `-shm` ao
    // lado do arquivo principal.
    fn remove_migration_test_db(path: &Path) {
        for suffix in ["", "-wal", "-shm"] {
            let mut candidate = path.as_os_str().to_os_string();
            candidate.push(suffix);
            let _ = std::fs::remove_file(PathBuf::from(candidate));
        }
    }

    // Banco em arquivo, nao `:memory:`: e o que se parece com producao, e as
    // tabelas-sombra do FTS5 podem se comportar diferente em memoria.
    async fn open_migration_test_pool(path: &Path) -> SqlitePool {
        let options = SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true);
        SqlitePool::connect_with(options)
            .await
            .expect("abrir o banco temporario de teste")
    }

    // Fecha o pool antes de apagar: no Windows o arquivo continua travado
    // enquanto houver conexao aberta.
    async fn close_migration_test_pool(pool: SqlitePool, path: &Path) {
        pool.close().await;
        remove_migration_test_db(path);
    }

    #[tokio::test]
    async fn applies_the_whole_migration_chain_to_an_empty_database() {
        let path = migration_test_db_path("chain");
        let pool = open_migration_test_pool(&path).await;

        let outcome = migration_chain_migrator().await.run(&pool).await;

        // Le `_sqlx_migrations` antes de fechar o pool; se a cadeia falhou nao
        // ha o que ler, e o erro original vai no panic depois da limpeza, para
        // que o arquivo temporario nao sobreviva a uma falha.
        let applied = match outcome {
            Ok(()) => {
                let last: i64 = sqlx::query_scalar("SELECT MAX(version) FROM _sqlx_migrations")
                    .fetch_one(&pool)
                    .await
                    .expect("ler a ultima versao aplicada em _sqlx_migrations");
                let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM _sqlx_migrations")
                    .fetch_one(&pool)
                    .await
                    .expect("contar as migrations aplicadas");
                Ok((last, count))
            }
            Err(error) => Err(error),
        };

        close_migration_test_pool(pool, &path).await;

        let (applied_last, applied_count) = match applied {
            Ok(values) => values,
            Err(error) => {
                panic!("a cadeia completa de migrations falhou num banco vazio: {error}")
            }
        };

        let migrations = database_migrations();
        let expected_last = migrations
            .iter()
            .map(|migration| migration.version)
            .max()
            .expect("a lista de migrations nao pode estar vazia");

        assert_eq!(
            applied_last, expected_last,
            "a ultima migration aplicada deveria ser a v{expected_last}"
        );
        assert_eq!(
            applied_count,
            migrations.len() as i64,
            "todas as {} migrations declaradas deveriam ter sido aplicadas",
            migrations.len()
        );
    }

    #[test]
    fn migration_versions_are_sequential_and_descriptions_unique() {
        let migrations = database_migrations();
        assert!(
            !migrations.is_empty(),
            "a lista de migrations nao pode estar vazia"
        );

        let mut seen_descriptions: HashMap<&str, i64> = HashMap::new();
        for (index, migration) in migrations.iter().enumerate() {
            let expected_version = index as i64 + 1;
            assert_eq!(
                migration.version, expected_version,
                "a migration na posicao {index} declara v{} (\"{}\"), mas as versoes precisam comecar em 1 e subir de 1 em 1: esperada v{expected_version}",
                migration.version, migration.description
            );
            assert!(
                matches!(migration.kind, MigrationKind::Up),
                "a migration v{} (\"{}\") nao e MigrationKind::Up; o plugin descarta as demais na conversao e ela nunca rodaria",
                migration.version,
                migration.description
            );
            if let Some(previous) =
                seen_descriptions.insert(migration.description, migration.version)
            {
                panic!(
                    "a migration v{} repete a description \"{}\", ja usada pela v{previous}",
                    migration.version, migration.description
                );
            }
        }
    }

    // `sqlite_master` guarda o SQL exatamente como veio da migration. Os
    // arquivos em `migrations/` sao LF por `.gitattributes`, e o literal
    // comparado abaixo e normalizado pelo proprio rustc; normalizar o lado do
    // banco evita uma falha de fim de linha que nao seria divergencia de
    // schema.
    async fn schema_snapshot(pool: &SqlitePool) -> String {
        let entries: Vec<(String, String, Option<String>)> =
            sqlx::query_as("SELECT type, name, sql FROM sqlite_master ORDER BY type, name")
                .fetch_all(pool)
                .await
                .expect("ler sqlite_master");

        let mut snapshot = String::new();
        for (kind, name, sql) in entries {
            snapshot.push_str(&format!("== {kind} {name}\n"));
            match sql {
                Some(sql) => {
                    snapshot.push_str(sql.replace("\r\n", "\n").trim());
                    snapshot.push('\n');
                }
                None => snapshot.push_str("<sem sql>\n"),
            }
        }
        snapshot
    }

    // Um `assert_eq!` cru entre duas strings deste tamanho imprime tudo
    // escapado numa linha so, ilegivel justamente quando mais importa ler. Este
    // helper aponta a primeira linha divergente com o contexto anterior, que e
    // o que se precisa olhar antes de decidir atualizar o snapshot.
    fn first_snapshot_difference(actual: &str, expected: &str) -> Option<String> {
        let actual_lines: Vec<&str> = actual.lines().collect();
        let expected_lines: Vec<&str> = expected.lines().collect();

        for index in 0..actual_lines.len().max(expected_lines.len()) {
            let actual_line = actual_lines.get(index).copied();
            let expected_line = expected_lines.get(index).copied();
            if actual_line == expected_line {
                continue;
            }

            let mut report = format!("primeira divergencia na linha {}:\n", index + 1);
            for line in &expected_lines[index.saturating_sub(3)..index] {
                report.push_str(&format!("   {line}\n"));
            }
            report.push_str(&format!(
                "-  {}\n+  {}\n",
                expected_line.unwrap_or("<fim do snapshot>"),
                actual_line.unwrap_or("<fim do schema lido>")
            ));
            report.push_str(&format!(
                "({} linhas no schema lido, {} no snapshot)",
                actual_lines.len(),
                expected_lines.len()
            ));
            return Some(report);
        }

        None
    }

    // Snapshot literal de `sqlite_master` depois da cadeia completa.
    //
    // As tabelas-sombra do FTS5 (`documents_fts_data`, `_idx`, `_content`,
    // `_docsize`, `_config`) entram de proposito: sao schema real, e uma
    // divergencia ali quebra a busca sem erro visivel — exatamente o defeito
    // silencioso que este teste existe para pegar. Filtrar por conveniencia
    // enfraqueceria o teste.
    //
    // Este teste falha sempre que uma migration nova muda o schema. A
    // atualizacao do snapshot e DELIBERADA: ler o diff, confirmar que a
    // mudanca e a pretendida, e so entao substituir a constante. Atualizar sem
    // ler o diff anula o teste.
    //
    // O snapshot e texto integral, nao um hash: um hash falharia dizendo
    // apenas "mudou" e obrigaria a reinvestigar do zero a cada alteracao
    // legitima de schema; o texto falha mostrando o diff.
    //
    // Aviso sobre a origem de uma falha aqui: o snapshot inclui as
    // tabelas-sombra do FTS5 (documents_fts_data, documents_fts_idx,
    // documents_fts_content, documents_fts_docsize e
    // documents_fts_config) e os indices sqlite_autoindex_*. Nenhum
    // desses e escrito pelas nossas migrations — quem os gera e o
    // proprio motor do SQLite, que chega via libsqlite3-sys.
    //
    // Consequencia pratica: um bump de sqlx ou libsqlite3-sys pode
    // quebrar este teste sem que nenhuma migration tenha mudado. Se a
    // falha aparecer sem alteracao em migrations/ nem em
    // database_migrations(), verifique o diff do Cargo.lock antes de
    // suspeitar do schema. Isso e informacao legitima, nao ruido:
    // mudou o layout real do banco em disco.
    //
    // Nao delete este teste ao encontrar uma divergencia inesperada. Leia o
    // diff primeiro.
    const MIGRATION_SCHEMA_SNAPSHOT: &str = r#"== index idx_annotations_document_id
CREATE INDEX idx_annotations_document_id ON annotations(document_id)
== index idx_annotations_document_page
CREATE INDEX idx_annotations_document_page ON annotations(document_id, page)
== index idx_canvas_files_canvas_id
CREATE INDEX idx_canvas_files_canvas_id ON canvas_files(canvas_id)
== index idx_canvases_collection_id
CREATE INDEX idx_canvases_collection_id ON canvases(collection_id)
== index idx_canvases_deleted_at
CREATE INDEX idx_canvases_deleted_at ON canvases(deleted_at)
== index idx_canvases_favorite
CREATE INDEX idx_canvases_favorite ON canvases(favorite)
== index idx_document_bookmarks_document_id
CREATE INDEX idx_document_bookmarks_document_id ON document_bookmarks(document_id)
== index idx_document_tags_tag_id
CREATE INDEX idx_document_tags_tag_id ON document_tags(tag_id)
== index idx_documents_collection_id
CREATE INDEX idx_documents_collection_id ON documents(collection_id)
== index idx_documents_deleted_at
CREATE INDEX idx_documents_deleted_at ON documents(deleted_at)
== index idx_documents_favorite
CREATE INDEX idx_documents_favorite ON documents(favorite)
== index idx_documents_status
CREATE INDEX idx_documents_status ON documents(status)
== index idx_documents_updated_at
CREATE INDEX idx_documents_updated_at ON documents(updated_at)
== index idx_notebook_assets_notebook_page
CREATE INDEX idx_notebook_assets_notebook_page ON notebook_assets(notebook_id, page_id)
== index idx_notebook_assets_page_id
CREATE INDEX idx_notebook_assets_page_id ON notebook_assets(page_id)
== index idx_notebook_file_attachments_notebook_id
CREATE INDEX idx_notebook_file_attachments_notebook_id
  ON notebook_file_attachments(notebook_id)
== index idx_notebook_file_attachments_page_id
CREATE INDEX idx_notebook_file_attachments_page_id
  ON notebook_file_attachments(page_id)
== index idx_notebook_linked_documents_document_id
CREATE INDEX idx_notebook_linked_documents_document_id ON notebook_linked_documents(document_id)
== index idx_notebook_pages_notebook_id
CREATE INDEX idx_notebook_pages_notebook_id ON notebook_pages(notebook_id)
== index idx_notebook_tags_tag_id
CREATE INDEX idx_notebook_tags_tag_id ON notebook_tags(tag_id)
== index idx_notebooks_collection_id
CREATE INDEX idx_notebooks_collection_id ON notebooks(collection_id)
== index idx_notebooks_deleted_at
CREATE INDEX idx_notebooks_deleted_at ON notebooks(deleted_at)
== index idx_notebooks_favorite
CREATE INDEX idx_notebooks_favorite ON notebooks(favorite)
== index sqlite_autoindex__sqlx_migrations_1
<sem sql>
== index sqlite_autoindex_annotations_1
<sem sql>
== index sqlite_autoindex_app_settings_1
<sem sql>
== index sqlite_autoindex_canvas_files_1
<sem sql>
== index sqlite_autoindex_collections_1
<sem sql>
== index sqlite_autoindex_collections_2
<sem sql>
== index sqlite_autoindex_document_authors_1
<sem sql>
== index sqlite_autoindex_document_bookmarks_1
<sem sql>
== index sqlite_autoindex_document_tags_1
<sem sql>
== index sqlite_autoindex_documents_1
<sem sql>
== index sqlite_autoindex_notebook_assets_1
<sem sql>
== index sqlite_autoindex_notebook_file_attachments_1
<sem sql>
== index sqlite_autoindex_notebook_linked_documents_1
<sem sql>
== index sqlite_autoindex_notebook_tags_1
<sem sql>
== index sqlite_autoindex_tags_1
<sem sql>
== index sqlite_autoindex_tags_2
<sem sql>
== table _sqlx_migrations
CREATE TABLE _sqlx_migrations (
    version BIGINT PRIMARY KEY,
    description TEXT NOT NULL,
    installed_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    success BOOLEAN NOT NULL,
    checksum BLOB NOT NULL,
    execution_time BIGINT NOT NULL
)
== table annotations
CREATE TABLE "annotations" (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  page INTEGER NOT NULL CHECK (page >= 1),
  color TEXT NOT NULL DEFAULT 'amber',
  selected_text TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  rects_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), mark_style TEXT NOT NULL DEFAULT 'highlight'
CHECK (mark_style IN ('highlight', 'underline')),
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
)
== table app_settings
CREATE TABLE app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
)
== table canvas_files
CREATE TABLE canvas_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  canvas_id INTEGER NOT NULL,
  file_id TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_path TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (canvas_id, file_id),
  FOREIGN KEY (canvas_id) REFERENCES canvases(id) ON DELETE CASCADE
)
== table canvases
CREATE TABLE canvases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  collection_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT 'Untitled Canvas',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), content TEXT NOT NULL
  DEFAULT '{"elements":[],"appState":{}}', favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)), deleted_at TEXT,
  FOREIGN KEY (collection_id) REFERENCES collections(id) ON UPDATE CASCADE ON DELETE RESTRICT
)
== table collections
CREATE TABLE collections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
, color TEXT NOT NULL DEFAULT '#475569', description TEXT NOT NULL DEFAULT '')
== table document_authors
CREATE TABLE document_authors (
  document_id TEXT NOT NULL,
  author TEXT NOT NULL,
  author_order INTEGER NOT NULL,
  PRIMARY KEY (document_id, author_order),
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
)
== table document_bookmarks
CREATE TABLE document_bookmarks (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    page_number INTEGER NOT NULL,
    label TEXT,
    created_at TEXT NOT NULL
)
== table document_tags
CREATE TABLE document_tags (
  document_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  tag_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (document_id, tag_id),
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
)
== table documents
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
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), deleted_at TEXT, time_spent_seconds INTEGER NOT NULL DEFAULT 0, description TEXT NOT NULL DEFAULT '', last_opened_at TEXT, annotations_filter_scope TEXT NOT NULL DEFAULT 'all'
CHECK (annotations_filter_scope IN ('all', 'current_page')), reading_list_dismissed_at TEXT,
  FOREIGN KEY (collection_id) REFERENCES collections(id) ON UPDATE CASCADE ON DELETE RESTRICT
)
== table documents_fts
CREATE VIRTUAL TABLE documents_fts USING fts5(
  document_id UNINDEXED,
  title,
  authors,
  source,
  year,
  collection,
  tags,
  notes
)
== table documents_fts_config
CREATE TABLE 'documents_fts_config'(k PRIMARY KEY, v) WITHOUT ROWID
== table documents_fts_content
CREATE TABLE 'documents_fts_content'(id INTEGER PRIMARY KEY, c0, c1, c2, c3, c4, c5, c6, c7)
== table documents_fts_data
CREATE TABLE 'documents_fts_data'(id INTEGER PRIMARY KEY, block BLOB)
== table documents_fts_docsize
CREATE TABLE 'documents_fts_docsize'(id INTEGER PRIMARY KEY, sz BLOB)
== table documents_fts_idx
CREATE TABLE 'documents_fts_idx'(segid, term, pgno, PRIMARY KEY(segid, term)) WITHOUT ROWID
== table notebook_assets
CREATE TABLE notebook_assets (
  id TEXT PRIMARY KEY,
  notebook_id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  checksum TEXT,
  original_name TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (page_id) REFERENCES notebook_pages(id) ON DELETE CASCADE
)
== table notebook_file_attachments
CREATE TABLE notebook_file_attachments (
  id TEXT PRIMARY KEY,
  notebook_id INTEGER NOT NULL,
  page_id INTEGER NOT NULL,
  original_name TEXT NOT NULL,
  mime_type TEXT,
  file_path TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (page_id) REFERENCES notebook_pages(id) ON DELETE CASCADE
)
== table notebook_linked_documents
CREATE TABLE notebook_linked_documents (
  notebook_id INTEGER NOT NULL,
  document_id TEXT NOT NULL,
  linked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (notebook_id, document_id),
  FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
)
== table notebook_pages
CREATE TABLE notebook_pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  notebook_id INTEGER NOT NULL,
  title TEXT,
  content TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE
)
== table notebook_tags
CREATE TABLE notebook_tags (
  notebook_id INTEGER NOT NULL,
  tag_id TEXT NOT NULL,
  tag_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (notebook_id, tag_id),
  FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
)
== table notebooks
CREATE TABLE notebooks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  collection_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT 'Untitled Notebook',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), description TEXT NOT NULL DEFAULT '', favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)), deleted_at TEXT, reading_status TEXT NOT NULL DEFAULT 'not-started'
CHECK (reading_status IN ('not-started', 'in-progress', 'completed')), author_discipline TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (collection_id) REFERENCES collections(id) ON UPDATE CASCADE ON DELETE RESTRICT
)
== table sqlite_sequence
CREATE TABLE sqlite_sequence(name,seq)
== table tags
CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  color_token TEXT NOT NULL CHECK (color_token IN ('violet', 'indigo', 'blue', 'teal', 'rose', 'amber')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
)
== trigger annotations_touch_updated_at
CREATE TRIGGER annotations_touch_updated_at
AFTER UPDATE ON annotations
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE annotations
  SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.id;
END
== trigger canvases_touch_updated_at
CREATE TRIGGER canvases_touch_updated_at
AFTER UPDATE ON canvases
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE canvases
  SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.id;
END
== trigger collections_touch_updated_at
CREATE TRIGGER collections_touch_updated_at
AFTER UPDATE ON collections
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE collections
  SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.id;
END
== trigger documents_fts_after_author_delete
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
END
== trigger documents_fts_after_author_insert
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
END
== trigger documents_fts_after_author_update
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
END
== trigger documents_fts_after_document_delete
CREATE TRIGGER documents_fts_after_document_delete
AFTER DELETE ON documents
FOR EACH ROW
BEGIN
  DELETE FROM documents_fts WHERE document_id = OLD.id;
END
== trigger documents_fts_after_document_insert
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
END
== trigger documents_fts_after_document_tag_delete
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
END
== trigger documents_fts_after_document_tag_insert
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
END
== trigger documents_fts_after_document_tag_update
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
END
== trigger documents_fts_after_document_update
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
END
== trigger documents_fts_after_tag_delete
CREATE TRIGGER documents_fts_after_tag_delete
AFTER DELETE ON tags
FOR EACH ROW
BEGIN
  DELETE FROM documents_fts
  WHERE document_id IN (SELECT document_id FROM document_tags WHERE tag_id = OLD.id);
END
== trigger documents_fts_after_tag_update
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
END
== trigger documents_touch_updated_at
CREATE TRIGGER documents_touch_updated_at
AFTER UPDATE ON documents
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE documents
  SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.id;
END
== trigger notebook_pages_touch_updated_at
CREATE TRIGGER notebook_pages_touch_updated_at
AFTER UPDATE ON notebook_pages
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE notebook_pages
  SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.id;
END
== trigger notebooks_touch_updated_at
CREATE TRIGGER notebooks_touch_updated_at
AFTER UPDATE ON notebooks
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE notebooks
  SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.id;
END
== trigger tags_touch_updated_at
CREATE TRIGGER tags_touch_updated_at
AFTER UPDATE ON tags
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE tags
  SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.id;
END
"#;

    #[tokio::test]
    async fn the_migration_chain_produces_the_snapshotted_schema() {
        let path = migration_test_db_path("schema");
        let pool = open_migration_test_pool(&path).await;
        migration_chain_migrator()
            .await
            .run(&pool)
            .await
            .expect("aplicar a cadeia completa de migrations");

        let snapshot = schema_snapshot(&pool).await;

        close_migration_test_pool(pool, &path).await;

        if let Some(difference) = first_snapshot_difference(&snapshot, MIGRATION_SCHEMA_SNAPSHOT) {
            panic!(
                "o schema produzido pela cadeia divergiu do snapshot.\n{difference}\n\nLeia a divergencia acima e so atualize MIGRATION_SCHEMA_SNAPSHOT depois de confirmar que a mudanca e a pretendida."
            );
        }
    }
}
