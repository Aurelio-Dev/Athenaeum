-- Guarda a preferencia de cada documento para a lista de anotacoes. O DEFAULT
-- aplica "mostrar todas" tambem aos documentos que ja existiam antes da v22.
ALTER TABLE documents
ADD COLUMN annotations_filter_scope TEXT NOT NULL DEFAULT 'all'
CHECK (annotations_filter_scope IN ('all', 'current_page'));

-- O CHECK mantem o dominio protegido no proprio SQLite: mesmo que uma chamada
-- futura envie outro texto, o banco rejeita o valor em vez de persistir um
-- estado que a interface nao sabe interpretar.
