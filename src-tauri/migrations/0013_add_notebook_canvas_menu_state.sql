-- ============================================================
-- v13 - Estado de menu para Cadernos e Quadros
-- ============================================================

-- Cadernos e Quadros passam a ter as mesmas acoes de card dos documentos:
-- favoritar, mover entre colecoes e mover para lixeira. O conteudo continua
-- nas tabelas existentes; aqui entram so metadados de listagem/menu.
ALTER TABLE notebooks ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1));
ALTER TABLE notebooks ADD COLUMN deleted_at TEXT;
CREATE INDEX idx_notebooks_favorite ON notebooks(favorite);
CREATE INDEX idx_notebooks_deleted_at ON notebooks(deleted_at);

ALTER TABLE canvases ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1));
ALTER TABLE canvases ADD COLUMN deleted_at TEXT;
CREATE INDEX idx_canvases_favorite ON canvases(favorite);
CREATE INDEX idx_canvases_deleted_at ON canvases(deleted_at);
