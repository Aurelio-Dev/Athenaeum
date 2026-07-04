-- ============================================================
-- v12 — Conteudo dos Quadros (Excalidraw) + arquivos binarios
-- ============================================================

-- A cena do Excalidraw (elements + appState) e um JSON pequeno que muda a
-- cada edicao — mover um retangulo ja gera um save. Imagens NAO entram
-- neste blob de proposito: em base64 elas inflariam ~33% sobre o binario
-- original, e cada autosave teria que reserializar (e cada load reparsear)
-- megabytes de imagem so para persistir uma mudanca de geometria. Imagens
-- vivem em disco, indexadas pela tabela canvas_files abaixo.
ALTER TABLE canvases ADD COLUMN content TEXT NOT NULL
  DEFAULT '{"elements":[],"appState":{}}';

-- Indice dos binarios (imagens) de cada quadro. A linha guarda so METADADOS
-- + o caminho relativo dentro do app data dir; os bytes ficam no filesystem
-- (gravados pelo comando Rust save_canvas_file, com escrita atomica).
--
-- file_id e o hash SHA-1 que o proprio Excalidraw gera a partir do CONTEUDO
-- do arquivo — a mesma imagem colada duas vezes produz o mesmo file_id.
-- Por isso o UNIQUE (canvas_id, file_id): re-salvar a cena nao pode duplicar
-- linhas; o INSERT do Rust usa ON CONFLICT DO NOTHING e vira idempotente.
--
-- ON DELETE CASCADE: os registros de arquivo nao tem vida propria fora do
-- quadro (mesma relacao de composicao de notebook_pages -> notebooks).
-- Os bytes em disco viram orfaos inofensivos ao excluir o quadro — limpeza
-- de disco fica para uma rotina futura, nunca no caminho critico do DELETE.
CREATE TABLE canvas_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  canvas_id INTEGER NOT NULL,
  file_id TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_path TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (canvas_id, file_id),
  FOREIGN KEY (canvas_id) REFERENCES canvases(id) ON DELETE CASCADE
);

-- O load de um quadro busca todos os arquivos dele de uma vez; sem indice
-- seria scan completo da tabela a cada abertura de painel.
CREATE INDEX idx_canvas_files_canvas_id ON canvas_files(canvas_id);

-- NOTA: o trigger de touch em canvases.updated_at NAO e criado aqui — ele
-- ja existe desde a v10 (canvases_touch_updated_at) e cobre o UPDATE de
-- content feito pelo autosave.
