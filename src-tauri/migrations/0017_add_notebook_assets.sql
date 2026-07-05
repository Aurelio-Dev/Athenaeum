-- ============================================================
-- v17 — Assets binarios dos Cadernos
-- ============================================================

-- Imagens coladas ou inseridas em paginas de caderno nao devem entrar em
-- notebook_pages.content como base64: isso inflaria o HTML salvo e faria cada
-- autosave regravar megabytes. O HTML deve guardar apenas referencias aos
-- assets; os bytes vivem no filesystem, indexados por esta tabela.
--
-- id e TEXT para permitir que o frontend use um hash/id estavel do conteudo
-- como identificador. notebook_id e page_id tambem ficam TEXT conforme a API
-- de assets; os comandos Rust validam que os valores recebidos sao IDs
-- numericos canonicos antes de montar caminhos em disco.
--
-- ON DELETE CASCADE em page_id: asset de pagina nao tem vida propria fora da
-- pagina. Excluir a pagina remove a linha do banco; os bytes em disco podem
-- ficar orfaos inofensivos ate uma rotina futura de limpeza, seguindo a mesma
-- decisao tomada para canvas_files.
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
);

CREATE INDEX idx_notebook_assets_page_id ON notebook_assets(page_id);
CREATE INDEX idx_notebook_assets_notebook_page ON notebook_assets(notebook_id, page_id);
