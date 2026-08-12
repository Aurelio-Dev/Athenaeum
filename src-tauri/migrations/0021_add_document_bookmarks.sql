CREATE TABLE document_bookmarks (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    page_number INTEGER NOT NULL,
    label TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX idx_document_bookmarks_document_id ON document_bookmarks(document_id);
