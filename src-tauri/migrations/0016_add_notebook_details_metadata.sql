-- ============================================================
-- v16 - Metadados adicionais de Cadernos
-- ============================================================

ALTER TABLE notebooks
ADD COLUMN reading_status TEXT NOT NULL DEFAULT 'not-started'
CHECK (reading_status IN ('not-started', 'in-progress', 'completed'));

ALTER TABLE notebooks
ADD COLUMN author_discipline TEXT NOT NULL DEFAULT '';
