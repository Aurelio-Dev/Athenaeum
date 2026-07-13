ALTER TABLE documents
ADD COLUMN description TEXT NOT NULL DEFAULT '';

ALTER TABLE documents
ADD COLUMN last_opened_at TEXT;
