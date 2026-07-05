-- ============================================================
-- v15 - Tags e PDFs vinculados a Cadernos
-- ============================================================

-- notebook_tags espelha document_tags (mesmo vocabulario de tags: uma
-- tag como "Philosophy" pode marcar tanto um documento quanto um caderno).
-- notebook_id e INTEGER (notebooks.id e autoincrement) enquanto tag_id e
-- TEXT (tags.id e slug) — tipos DIFERENTES entre si de proposito, cada FK
-- casa com o tipo real da tabela referenciada (ver document_tags, que tem
-- a mesma assimetria: document_id TEXT, tag_id TEXT).
CREATE TABLE notebook_tags (
  notebook_id INTEGER NOT NULL,
  tag_id TEXT NOT NULL,
  tag_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (notebook_id, tag_id),
  FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

-- Indice reverso (mesmo papel de idx_document_tags_tag_id): sem ele, achar
-- "quais cadernos usam esta tag" faria table scan em notebook_tags inteira.
CREATE INDEX idx_notebook_tags_tag_id ON notebook_tags(tag_id);

-- notebook_linked_documents: many-to-many entre Cadernos e Documentos (o
-- botao "Attach another PDF" permite mais de um PDF por caderno; um PDF
-- tambem pode estar vinculado a mais de um caderno). notebook_id INTEGER,
-- document_id TEXT — tipos batendo com as tabelas de origem (ver item 1
-- da investigacao: documents.id e TEXT, diferente de notebooks.id).
--
-- ON DELETE CASCADE nas duas pontas: se o caderno OU o documento forem
-- excluidos de vez, o vinculo perde sentido por si so. Isso e distinto do
-- fluxo de excluir uma COLECAO (que move notebooks/canvases para a colecao
-- padrao antes, via ON DELETE RESTRICT em notebooks.collection_id) — aqui
-- a exclusao e da propria entidade, nao da colecao que a contem. Documentos
-- passam por lixeira (deleted_at) antes do DELETE fisico, entao restaurar
-- da lixeira preserva os vinculos; so o purge definitivo aciona o cascade.
CREATE TABLE notebook_linked_documents (
  notebook_id INTEGER NOT NULL,
  document_id TEXT NOT NULL,
  linked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (notebook_id, document_id),
  FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

-- Indice reverso: "quais cadernos tem este documento vinculado" (util para,
-- futuramente, mostrar essa lista na propria tela do documento).
CREATE INDEX idx_notebook_linked_documents_document_id ON notebook_linked_documents(document_id);
