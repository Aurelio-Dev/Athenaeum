-- ============================================================
-- v10 — Cadernos (notebooks + notebook_pages) e Quadros (canvases)
-- ============================================================

-- Cadernos pertencem a uma colecao. collection_id e TEXT porque
-- collections.id e um slug textual (ex.: "philosophy-of-mind"),
-- nao um numero — um FK INTEGER aqui nunca casaria.
--
-- ON DELETE RESTRICT (mesmo padrao de documents): o banco RECUSA
-- excluir uma colecao que ainda tenha cadernos. Isso forca o codigo
-- de exclusao (deleteCollection, no TypeScript) a mover os cadernos
-- para a colecao fallback ANTES do DELETE — se o codigo esquecer,
-- o erro aparece na hora em vez de dados sumirem silenciosamente.
-- ON UPDATE CASCADE: se o id da colecao mudar, o FK acompanha.
CREATE TABLE notebooks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  collection_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT 'Untitled Notebook',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (collection_id) REFERENCES collections(id) ON UPDATE CASCADE ON DELETE RESTRICT
);

-- A tab Cadernos lista sempre filtrando por colecao; sem indice o
-- SQLite faria scan da tabela inteira a cada troca de colecao.
CREATE INDEX idx_notebooks_collection_id ON notebooks(collection_id);

-- Paginas de um caderno. title e NULL de proposito: o fallback
-- "Untitled Page N" e calculado no frontend a partir de position,
-- nunca persistido como string generica.
--
-- position e separado de id porque id so cresce (autoincrement) e
-- nunca muda, enquanto position representa a ORDEM no rail — que o
-- usuario podera reordenar no futuro sem mexer na identidade da linha.
--
-- Aqui o ON DELETE CASCADE fica: pagina nao tem vida propria fora do
-- caderno — excluir o caderno deve levar as paginas junto (diferente
-- de caderno x colecao, onde o conteudo e preservado via fallback).
CREATE TABLE notebook_pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  notebook_id INTEGER NOT NULL,
  title TEXT,
  content TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE
);

CREATE INDEX idx_notebook_pages_notebook_id ON notebook_pages(notebook_id);

-- Quadros: tabela minima por enquanto (o schema do conteudo do canvas
-- sera definido quando a biblioteca de whiteboard for escolhida).
-- Mesmas regras de FK dos cadernos.
CREATE TABLE canvases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  collection_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT 'Untitled Canvas',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (collection_id) REFERENCES collections(id) ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE INDEX idx_canvases_collection_id ON canvases(collection_id);

-- Triggers de updated_at (mesmo padrao de annotations, v8): qualquer
-- UPDATE que nao mexa explicitamente em updated_at recebe o timestamp
-- atual. O WHEN evita loop infinito (o proprio UPDATE do trigger nao
-- re-dispara o trigger, pois nele updated_at muda).
CREATE TRIGGER notebooks_touch_updated_at
AFTER UPDATE ON notebooks
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE notebooks
  SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.id;
END;

CREATE TRIGGER notebook_pages_touch_updated_at
AFTER UPDATE ON notebook_pages
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE notebook_pages
  SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.id;
END;

CREATE TRIGGER canvases_touch_updated_at
AFTER UPDATE ON canvases
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE canvases
  SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.id;
END;
