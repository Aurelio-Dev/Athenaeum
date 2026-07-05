-- ============================================================
-- v18 - Arquivos anexados a paginas de Caderno
-- ============================================================

-- Primeira fase de Inserir > Arquivo. O HTML de notebook_pages.content guarda
-- apenas data-notebook-attachment-id; bytes e metadados vivem fora do HTML.
--
-- ON DELETE CASCADE remove os metadados quando a pagina e excluida. Assim como
-- canvas_files/notebook_assets, os bytes em disco podem ficar orfaos ate uma
-- rotina futura de limpeza fisica.
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
);

CREATE INDEX idx_notebook_file_attachments_page_id
  ON notebook_file_attachments(page_id);

CREATE INDEX idx_notebook_file_attachments_notebook_id
  ON notebook_file_attachments(notebook_id);
