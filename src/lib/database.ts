import Database from "@tauri-apps/plugin-sql";
import { availableSubjectTags, mockCollections, mockDocuments } from "../data/mockDocuments";
import { getSubjectTagTone } from "../styles/designTokens";
import type { LibraryCollection, LibraryDocument, LibraryRoute, ReadingLocation, SortMode, StatusFilter, SubjectTag } from "../types/library";

const databaseUrl = "sqlite:athenaeum.db";
const listSeparator = String.fromCharCode(31);

let databasePromise: Promise<Database> | null = null;

type DocumentRow = {
  id: string;
  title: string;
  source: string;
  year: number;
  status: LibraryDocument["status"];
  progress: number;
  favorite: number;
  collection: string;
  updatedAt: string;
  deletedAt: string | null;
  fileName: string | null;
  filePath: string | null;
  notes: string | null;
  readingLocationJson: string | null;
  authors: string | null;
  tags: string | null;
};

type CollectionRow = {
  id: string;
  name: string;
};

type TagRow = {
  name: string;
};

type CountRow = {
  count: number;
};

type FilePathRow = {
  filePath: string | null;
};

export type LibrarySnapshot = {
  collections: LibraryCollection[];
  allDocuments: LibraryDocument[];
  documents: LibraryDocument[];
  availableTags: SubjectTag[];
  trashCount: number;
};

export type DocumentMetadataUpdates = Pick<LibraryDocument, "title" | "authors" | "source" | "year" | "collection" | "tags">;

type ListDocumentsOptions = {
  searchTerm: string;
  statusFilter: StatusFilter;
  sortMode: SortMode;
  route: LibraryRoute;
};

function slugify(value: string) {
  const normalized = value
    .trim()
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

  return normalized || "item";
}

function parseSeparatedList(value: string | null) {
  return value ? value.split(listSeparator).filter((item) => item.length > 0) : [];
}

function parseReadingLocation(value: string | null): ReadingLocation | undefined {
  if (!value) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(value) as Partial<ReadingLocation>;

    if (
      typeof parsed.scrollTop === "number" &&
      typeof parsed.scrollRatio === "number" &&
      typeof parsed.scrollMax === "number" &&
      typeof parsed.canMeasure === "boolean" &&
      typeof parsed.page === "number" &&
      typeof parsed.pageOffset === "number" &&
      typeof parsed.zoom === "number" &&
      typeof parsed.savedAt === "string"
    ) {
      return {
        scrollTop: parsed.scrollTop,
        scrollRatio: parsed.scrollRatio,
        scrollMax: parsed.scrollMax,
        canMeasure: parsed.canMeasure,
        page: parsed.page,
        pageOffset: parsed.pageOffset,
        zoom: parsed.zoom,
        savedAt: parsed.savedAt,
      };
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function mapDocumentRow(row: DocumentRow): LibraryDocument {
  return {
    id: row.id,
    title: row.title,
    authors: parseSeparatedList(row.authors),
    source: row.source,
    year: row.year,
    tags: parseSeparatedList(row.tags),
    status: row.status,
    progress: row.progress,
    favorite: row.favorite === 1,
    collection: row.collection,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt ?? undefined,
    fileName: row.fileName ?? undefined,
    filePath: row.filePath ?? undefined,
    readingLocation: parseReadingLocation(row.readingLocationJson),
    notes: row.notes ?? "",
  };
}

async function getDatabase() {
  databasePromise ??= Database.load(databaseUrl).then(async (database) => {
    await database.execute("PRAGMA foreign_keys = ON");
    await seedInitialData(database);
    await purgeExpiredTrash(database);
    return database;
  });

  return databasePromise;
}

async function seedInitialData(database: Database) {
  const [row] = await database.select<CountRow[]>("SELECT COUNT(*) AS count FROM documents");

  if (row && row.count > 0) {
    return;
  }

  for (const collection of mockCollections) {
    await database.execute(
      "INSERT INTO collections (id, name, is_system) VALUES ($1, $2, 0) ON CONFLICT(id) DO UPDATE SET name = excluded.name",
      [collection.id, collection.name],
    );
  }

  const seededCollectionNames = new Set(mockCollections.map((collection) => collection.name));
  const referencedCollections = new Set(mockDocuments.map((document) => document.collection));

  for (const collectionName of referencedCollections) {
    if (!seededCollectionNames.has(collectionName)) {
      await database.execute(
        "INSERT INTO collections (id, name, is_system) VALUES ($1, $2, 1) ON CONFLICT(id) DO UPDATE SET name = excluded.name",
        [slugify(collectionName), collectionName],
      );
    }
  }

  for (const tag of [...availableSubjectTags, ...mockDocuments.flatMap((document) => document.tags)]) {
    await upsertTag(database, tag);
  }

  for (const document of mockDocuments) {
    try {
      await insertDocument(database, document);
    } catch (error) {
      await deletePartialDocument(database, document.id);
      throw error;
    }
  }
}

async function upsertTag(database: Database, tag: SubjectTag) {
  await database.execute(
    "INSERT INTO tags (id, name, color_token) VALUES ($1, $2, $3) ON CONFLICT(name) DO UPDATE SET color_token = excluded.color_token",
    [slugify(tag), tag, getSubjectTagTone(tag)],
  );
}

async function findCollectionId(database: Database, collectionName: string) {
  const rows = await database.select<Array<{ id: string }>>("SELECT id FROM collections WHERE name = $1 LIMIT 1", [collectionName]);

  if (rows[0]) {
    return rows[0].id;
  }

  const collectionId = slugify(collectionName);
  await database.execute("INSERT INTO collections (id, name, is_system) VALUES ($1, $2, 0)", [collectionId, collectionName]);
  return collectionId;
}

async function insertDocument(database: Database, document: LibraryDocument) {
  const collectionId = await findCollectionId(database, document.collection);
  const authors = [...new Set(document.authors.map((author) => author.trim()).filter((author) => author.length > 0))];
  const tags = [...new Set(document.tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0))];

  for (const tag of tags) {
    await upsertTag(database, tag);
  }

  await database.execute(
    `INSERT INTO documents (
      id,
      title,
      source,
      year,
      status,
      progress,
      favorite,
      collection_id,
      file_name,
      file_path,
      notes,
      reading_location_json,
      updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      document.id,
      document.title,
      document.source,
      document.year,
      document.status,
      document.progress,
      document.favorite ? 1 : 0,
      collectionId,
      document.fileName ?? null,
      document.filePath ?? null,
      document.notes ?? "",
      document.readingLocation ? JSON.stringify(document.readingLocation) : null,
      document.updatedAt,
    ],
  );

  for (const [index, author] of authors.entries()) {
    await database.execute("INSERT INTO document_authors (document_id, author, author_order) VALUES ($1, $2, $3)", [
      document.id,
      author,
      index,
    ]);
  }

  for (const [index, tag] of tags.entries()) {
    await database.execute("INSERT INTO document_tags (document_id, tag_id, tag_order) VALUES ($1, $2, $3)", [
      document.id,
      slugify(tag),
      index,
    ]);
  }
}

function buildDocumentListQuery({ searchTerm, statusFilter, sortMode, route }: ListDocumentsOptions) {
  const joins = [
    "JOIN collections ON collections.id = documents.collection_id",
    `LEFT JOIN (
      SELECT document_id, group_concat(author, char(31)) AS authors
      FROM (SELECT document_id, author FROM document_authors ORDER BY author_order)
      GROUP BY document_id
    ) document_author_list ON document_author_list.document_id = documents.id`,
    `LEFT JOIN (
      SELECT document_id, group_concat(name, char(31)) AS tags
      FROM (
        SELECT document_tags.document_id, tags.name
        FROM document_tags
        JOIN tags ON tags.id = document_tags.tag_id
        ORDER BY document_tags.tag_order
      )
      GROUP BY document_id
    ) document_tag_list ON document_tag_list.document_id = documents.id`,
  ];
  const whereClauses: string[] = [];
  const bindValues: unknown[] = [];
  const normalizedSearchTerm = searchTerm.trim();

  if (route.type === "trash") {
    whereClauses.push("documents.deleted_at IS NOT NULL");
  } else {
    whereClauses.push("documents.deleted_at IS NULL");
  }

  if (route.type === "favorites") {
    whereClauses.push("documents.favorite = 1");
  }

  if (route.type === "collection") {
    bindValues.push(route.collectionName);
    whereClauses.push(`collections.name = $${bindValues.length}`);
  }

  if (route.type !== "trash" && statusFilter !== "all") {
    bindValues.push(statusFilter);
    whereClauses.push(`documents.status = $${bindValues.length}`);
  }

  if (normalizedSearchTerm.length > 0) {
    const ftsQuery = buildFtsQuery(normalizedSearchTerm);

    if (ftsQuery.length === 0) {
      whereClauses.push("1 = 0");
    } else {
      joins.push("JOIN documents_fts ON documents_fts.document_id = documents.id");
      bindValues.push(ftsQuery);
      whereClauses.push(`documents_fts MATCH $${bindValues.length}`);
    }
  }

  const orderBy =
    route.type === "trash"
      ? "documents.deleted_at DESC"
      : sortMode === "titulo"
      ? "documents.title COLLATE NOCASE ASC"
      : sortMode === "progresso"
        ? "documents.progress DESC, documents.updated_at DESC"
        : "documents.updated_at DESC";

  return {
    sql: `
      SELECT
        documents.id,
        documents.title,
        documents.source,
        documents.year,
        documents.status,
        documents.progress,
        documents.favorite,
        collections.name AS collection,
        documents.updated_at AS updatedAt,
        documents.deleted_at AS deletedAt,
        documents.file_name AS fileName,
        documents.file_path AS filePath,
        documents.notes,
        documents.reading_location_json AS readingLocationJson,
        document_author_list.authors,
        document_tag_list.tags
      FROM documents
      ${joins.join("\n")}
      WHERE ${whereClauses.join(" AND ")}
      ORDER BY ${orderBy}
    `,
    bindValues,
  };
}

function buildFtsQuery(searchTerm: string) {
  return searchTerm
    .split(/\s+/)
    .map((token) => token.replace(/"/g, "").trim())
    .filter((token) => token.length > 0)
    .map((token) => `"${token}"*`)
    .join(" ");
}

export async function loadLibrarySnapshot(options: ListDocumentsOptions): Promise<LibrarySnapshot> {
  const database = await getDatabase();
  const [collections, availableTags, allDocuments, documents, trashCountRows] = await Promise.all([
    database.select<CollectionRow[]>("SELECT id, name FROM collections WHERE is_system = 0 ORDER BY created_at ASC, name ASC"),
    database.select<TagRow[]>("SELECT name FROM tags ORDER BY name COLLATE NOCASE ASC"),
    listDocuments(database, { searchTerm: "", statusFilter: "all", sortMode: "recentes", route: { type: "all" } }),
    listDocuments(database, options),
    database.select<CountRow[]>("SELECT COUNT(*) AS count FROM documents WHERE deleted_at IS NOT NULL"),
  ]);

  return {
    collections,
    allDocuments,
    availableTags: availableTags.map((tag) => tag.name),
    documents,
    trashCount: trashCountRows[0]?.count ?? 0,
  };
}

export async function listDocuments(database: Database, options: ListDocumentsOptions) {
  const query = buildDocumentListQuery(options);
  const rows = await database.select<DocumentRow[]>(query.sql, query.bindValues);
  return rows.map(mapDocumentRow);
}

export async function createDocument(document: LibraryDocument): Promise<LibraryDocument> {
  const database = await getDatabase();

  try {
    await insertDocument(database, document);
    return document;
  } catch (error) {
    await deletePartialDocument(database, document.id);
    throw error;
  }
}

async function deletePartialDocument(database: Database, documentId: string) {
  try {
    await database.execute("DELETE FROM document_tags WHERE document_id = $1", [documentId]);
    await database.execute("DELETE FROM document_authors WHERE document_id = $1", [documentId]);
    await database.execute("DELETE FROM documents_fts WHERE document_id = $1", [documentId]);
    await database.execute("DELETE FROM documents WHERE id = $1", [documentId]);
  } catch (cleanupError) {
    console.warn("Nao foi possivel limpar a importacao parcial.", cleanupError);
  }
}

export async function updateDocumentMetadata(documentId: string, updates: DocumentMetadataUpdates) {
  const database = await getDatabase();
  const collectionId = await findCollectionId(database, updates.collection);
  const authors = [...new Set(updates.authors.map((author) => author.trim()).filter((author) => author.length > 0))];
  const tags = [...new Set(updates.tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0))];

  for (const tag of tags) {
    await upsertTag(database, tag);
  }

  await database.execute("UPDATE documents SET title = $1, source = $2, year = $3, collection_id = $4 WHERE id = $5", [
    updates.title,
    updates.source,
    updates.year,
    collectionId,
    documentId,
  ]);
  await database.execute("DELETE FROM document_authors WHERE document_id = $1", [documentId]);
  await database.execute("DELETE FROM document_tags WHERE document_id = $1", [documentId]);

  for (const [index, author] of authors.entries()) {
    await database.execute("INSERT INTO document_authors (document_id, author, author_order) VALUES ($1, $2, $3)", [
      documentId,
      author,
      index,
    ]);
  }

  for (const [index, tag] of tags.entries()) {
    await database.execute("INSERT INTO document_tags (document_id, tag_id, tag_order) VALUES ($1, $2, $3)", [
      documentId,
      slugify(tag),
      index,
    ]);
  }
}

export async function setDocumentFavorite(documentId: string, favorite: boolean) {
  const database = await getDatabase();
  await database.execute("UPDATE documents SET favorite = $1 WHERE id = $2", [favorite ? 1 : 0, documentId]);
}

export async function setDocumentNote(documentId: string, note: string) {
  const database = await getDatabase();
  await database.execute("UPDATE documents SET notes = $1 WHERE id = $2", [note, documentId]);
}

export async function setDocumentReadingStarted(documentId: string) {
  const database = await getDatabase();
  await database.execute(
    "UPDATE documents SET status = CASE WHEN status = 'not-started' THEN 'in-progress' ELSE status END, progress = CASE WHEN status = 'not-started' AND progress < 1 THEN 1 ELSE progress END WHERE id = $1 AND deleted_at IS NULL",
    [documentId],
  );
}

export async function setDocumentReadingLocation(document: LibraryDocument, readingLocation: ReadingLocation) {
  const database = await getDatabase();
  const measuredProgress = Math.round(readingLocation.scrollRatio * 100);
  const progress = readingLocation.canMeasure ? Math.max(document.progress, measuredProgress) : document.progress;

  await database.execute("UPDATE documents SET reading_location_json = $1, progress = $2, updated_at = $3 WHERE id = $4", [
    JSON.stringify(readingLocation),
    progress,
    readingLocation.savedAt,
    document.id,
  ]);
}

export async function deleteDocument(documentId: string) {
  const database = await getDatabase();
  await database.execute("DELETE FROM documents WHERE id = $1", [documentId]);
}

export async function moveDocumentToTrash(documentId: string) {
  const database = await getDatabase();
  await database.execute("UPDATE documents SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = $1", [documentId]);
}

export async function restoreDocument(documentId: string) {
  const database = await getDatabase();
  await database.execute("UPDATE documents SET deleted_at = NULL WHERE id = $1", [documentId]);
}

export async function getDocumentFilePaths(documentIds: string[]) {
  if (documentIds.length === 0) {
    return [];
  }

  const database = await getDatabase();
  const placeholders = documentIds.map((_, index) => `$${index + 1}`).join(", ");
  const rows = await database.select<FilePathRow[]>(`SELECT file_path AS filePath FROM documents WHERE id IN (${placeholders})`, documentIds);

  return rows.map((row) => row.filePath).filter((filePath): filePath is string => Boolean(filePath));
}

export async function getTrashFilePaths() {
  const database = await getDatabase();
  const rows = await database.select<FilePathRow[]>("SELECT file_path AS filePath FROM documents WHERE deleted_at IS NOT NULL");

  return rows.map((row) => row.filePath).filter((filePath): filePath is string => Boolean(filePath));
}

export async function permanentlyDeleteDocument(documentId: string) {
  const database = await getDatabase();
  await database.execute("DELETE FROM documents WHERE id = $1", [documentId]);
}

export async function emptyTrash() {
  const database = await getDatabase();
  await database.execute("DELETE FROM documents WHERE deleted_at IS NOT NULL");
}

async function purgeExpiredTrash(database: Database) {
  await database.execute(
    "DELETE FROM documents WHERE deleted_at IS NOT NULL AND deleted_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days')",
  );
}
