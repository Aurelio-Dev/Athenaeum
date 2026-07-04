import { invoke } from "@tauri-apps/api/core";
import Database from "@tauri-apps/plugin-sql";
import { availableSubjectTags } from "../data/subjectTags";
import { TAG_COLOR_TOKENS } from "./tagColors";
import { getSubjectTagTone } from "../styles/designTokens";
import { isHighlightColor } from "../types/annotation";
import type { Annotation, HighlightColor, NormalizedRect } from "../types/annotation";
import type { Canvas, LibraryCollection, LibraryDocument, LibraryRoute, Notebook, NotebookPage, ReadingLocation, SortMode, SubjectTag } from "../types/library";

const databaseUrl = "sqlite:athenaeum.db";
const listSeparator = String.fromCharCode(31);
const trashItemCountSql = `
  SELECT
    (SELECT COUNT(*) FROM documents WHERE deleted_at IS NOT NULL) +
    (SELECT COUNT(*) FROM notebooks WHERE deleted_at IS NOT NULL) +
    (SELECT COUNT(*) FROM canvases WHERE deleted_at IS NOT NULL) AS count
`;
const defaultCollectionColor = TAG_COLOR_TOKENS.slate.bg;
const defaultCollectionName = "Sem título";

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
  timeSpentSeconds: number;
  authors: string | null;
  tags: string | null;
};

type CollectionRow = {
  id: string;
  name: string;
  color: string;
  description: string;
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

type CollectionLookupRow = {
  id: string;
  name: string;
};

type AnnotationRow = {
  id: string;
  documentId: string;
  page: number;
  color: HighlightColor;
  selectedText: string;
  note: string;
  rectsJson: string;
  createdAt: string;
  updatedAt: string;
};

// Dados necessarios para criar uma anotacao. id e timestamps sao gerados aqui
// dentro para o chamador ficar simples.
export type NewAnnotation = {
  documentId: string;
  page: number;
  color: HighlightColor;
  selectedText: string;
  note: string;
  rects: NormalizedRect[];
};

export type LibrarySnapshot = {
  collections: LibraryCollection[];
  allDocuments: LibraryDocument[];
  documents: LibraryDocument[];
  availableTags: SubjectTag[];
  trashCount: number;
};

export type DocumentMetadataUpdates = Pick<LibraryDocument, "title" | "authors" | "source" | "year" | "collection" | "tags">;

export type ListDocumentsOptions = {
  searchTerm: string;
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
    timeSpentSeconds: row.timeSpentSeconds ?? 0,
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
  await ensureDefaultCollection(database);

  const [row] = await database.select<CountRow[]>("SELECT COUNT(*) AS count FROM tags");

  if (row && row.count > 0) {
    return;
  }

  for (const tag of availableSubjectTags) {
    await upsertTag(database, tag);
  }
}

async function ensureDefaultCollection(database: Database) {
  const [row] = await database.select<CountRow[]>("SELECT COUNT(*) AS count FROM collections WHERE is_system = 0");

  if (row && row.count > 0) {
    return;
  }

  await database.execute("INSERT OR IGNORE INTO collections (id, name, is_system) VALUES ($1, $2, 0)", [
    await createUniqueCollectionId(database, defaultCollectionName),
    defaultCollectionName,
  ]);
}

async function upsertTag(database: Database, tag: SubjectTag) {
  await database.execute(
    "INSERT INTO tags (id, name, color_token) VALUES ($1, $2, $3) ON CONFLICT(name) DO UPDATE SET color_token = excluded.color_token",
    [slugify(tag), tag, getSubjectTagTone(tag)],
  );
}

async function findCollectionId(database: Database, collectionName: string) {
  const rows = await database.select<Array<{ id: string }>>("SELECT id FROM collections WHERE name = $1 COLLATE NOCASE LIMIT 1", [collectionName]);

  if (rows[0]) {
    return rows[0].id;
  }

  const collectionId = await createUniqueCollectionId(database, collectionName);
  await database.execute("INSERT INTO collections (id, name, is_system) VALUES ($1, $2, 0)", [collectionId, collectionName]);
  return collectionId;
}

async function findCollectionByName(database: Database, collectionName: string) {
  const rows = await database.select<CollectionLookupRow[]>(
    "SELECT id, name FROM collections WHERE name = $1 COLLATE NOCASE LIMIT 1",
    [collectionName],
  );

  return rows[0] ?? null;
}

async function createUniqueCollectionId(database: Database, collectionName: string) {
  const baseId = slugify(collectionName);
  let nextId = baseId;
  let suffix = 2;

  while ((await database.select<Array<{ id: string }>>("SELECT id FROM collections WHERE id = $1 LIMIT 1", [nextId]))[0]) {
    nextId = `${baseId}-${suffix}`;
    suffix += 1;
  }

  return nextId;
}

async function ensureFallbackCollection(database: Database, ignoredCollectionId: string) {
  const fallbackName = defaultCollectionName;
  const existingFallback = await findCollectionByName(database, fallbackName);

  if (existingFallback && existingFallback.id !== ignoredCollectionId) {
    return existingFallback.id;
  }

  if (!existingFallback) {
    const fallbackId = await createUniqueCollectionId(database, fallbackName);
    await database.execute("INSERT INTO collections (id, name, is_system) VALUES ($1, $2, 0)", [fallbackId, fallbackName]);
    return fallbackId;
  }

  const [otherCollection] = await database.select<CollectionLookupRow[]>(
    "SELECT id, name FROM collections WHERE id != $1 ORDER BY is_system ASC, created_at ASC, name ASC LIMIT 1",
    [ignoredCollectionId],
  );

  if (!otherCollection) {
    throw new Error("Nao foi possivel encontrar uma colecao para receber os documentos.");
  }

  return otherCollection.id;
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

function buildDocumentListQuery({ searchTerm, sortMode, route }: ListDocumentsOptions) {
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

  if (route.type === "reading-list") {
    whereClauses.push("documents.status = 'in-progress'");
  }

  if (route.type === "collection") {
    bindValues.push(route.collectionName);
    whereClauses.push(`collections.name = $${bindValues.length}`);
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
        documents.time_spent_seconds AS timeSpentSeconds,
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
    database.select<CollectionRow[]>("SELECT id, name, color, description FROM collections WHERE is_system = 0 ORDER BY created_at ASC, name ASC"),
    database.select<TagRow[]>("SELECT name FROM tags ORDER BY name COLLATE NOCASE ASC"),
    listDocuments(database, { searchTerm: "", sortMode: "recentes", route: { type: "all" } }),
    listDocuments(database, options),
    database.select<CountRow[]>(trashItemCountSql),
  ]);

  return {
    collections,
    allDocuments,
    availableTags: availableTags.map((tag) => tag.name),
    documents,
    trashCount: trashCountRows[0]?.count ?? 0,
  };
}

export async function listCollections(): Promise<LibraryCollection[]> {
  const database = await getDatabase();
  return database.select<CollectionRow[]>("SELECT id, name, color, description FROM collections WHERE is_system = 0 ORDER BY created_at ASC, name ASC");
}

export async function listAvailableTags(): Promise<SubjectTag[]> {
  const database = await getDatabase();
  const rows = await database.select<TagRow[]>("SELECT name FROM tags ORDER BY name COLLATE NOCASE ASC");
  return rows.map((tag) => tag.name);
}

export async function countTrashDocuments(): Promise<number> {
  const database = await getDatabase();
  const rows = await database.select<CountRow[]>(trashItemCountSql);
  return rows[0]?.count ?? 0;
}

export async function listLibraryDocuments(options: ListDocumentsOptions): Promise<LibraryDocument[]> {
  const database = await getDatabase();
  return listDocuments(database, options);
}

export async function listDocuments(database: Database, options: ListDocumentsOptions) {
  const query = buildDocumentListQuery(options);
  const rows = await database.select<DocumentRow[]>(query.sql, query.bindValues);
  return rows.map(mapDocumentRow);
}

function normalizeCollectionName(collectionName: string) {
  return collectionName.trim().replace(/\s+/g, " ");
}

function normalizeCollectionDescription(collectionDescription = "") {
  return collectionDescription.trim().replace(/\s+/g, " ");
}

export async function createCollection(collectionName: string, collectionDescription = "", collectionColor = defaultCollectionColor) {
  const database = await getDatabase();
  const name = normalizeCollectionName(collectionName);
  const description = normalizeCollectionDescription(collectionDescription);

  if (name.length === 0) {
    throw new Error("Informe um nome para a colecao.");
  }

  if (await findCollectionByName(database, name)) {
    throw new Error("Ja existe uma colecao com esse nome.");
  }

  const id = await createUniqueCollectionId(database, name);
  await database.execute("INSERT INTO collections (id, name, color, description, is_system) VALUES ($1, $2, $3, $4, 0)", [
    id,
    name,
    collectionColor,
    description,
  ]);

  return { id, name, color: collectionColor, description };
}

export async function renameCollection(collectionId: string, collectionName: string) {
  const database = await getDatabase();
  const name = normalizeCollectionName(collectionName);

  if (name.length === 0) {
    throw new Error("Informe um nome para a colecao.");
  }

  const existingCollection = await findCollectionByName(database, name);
  if (existingCollection && existingCollection.id !== collectionId) {
    throw new Error("Ja existe uma colecao com esse nome.");
  }

  await database.execute("UPDATE collections SET name = $1 WHERE id = $2", [name, collectionId]);

  return { id: collectionId, name };
}

export type CollectionUpdates = {
  name: string;
  description: string;
  color: string;
};

// Edicao completa da colecao (nome, descricao e cor) — usada pelo lapis de
// editar no cabecalho da colecao. renameCollection cobre so o nome (menu de
// contexto da sidebar).
export async function updateCollection(collectionId: string, updates: CollectionUpdates) {
  const database = await getDatabase();
  const name = normalizeCollectionName(updates.name);
  const description = normalizeCollectionDescription(updates.description);

  if (name.length === 0) {
    throw new Error("Informe um nome para a colecao.");
  }

  const existingCollection = await findCollectionByName(database, name);
  if (existingCollection && existingCollection.id !== collectionId) {
    throw new Error("Ja existe uma colecao com esse nome.");
  }

  await database.execute("UPDATE collections SET name = $1, description = $2, color = $3 WHERE id = $4", [
    name,
    description,
    updates.color,
    collectionId,
  ]);

  return { id: collectionId, name, description, color: updates.color };
}

export async function deleteCollection(collectionId: string) {
  const database = await getDatabase();
  const fallbackCollectionId = await ensureFallbackCollection(database, collectionId);

  // Documentos, cadernos e quadros sao PRESERVADOS: migram para a colecao
  // fallback antes do DELETE. Os FKs usam ON DELETE RESTRICT, entao o banco
  // recusaria excluir a colecao se algum desses UPDATEs faltasse.
  await database.execute("UPDATE documents SET collection_id = $1 WHERE collection_id = $2", [fallbackCollectionId, collectionId]);
  await database.execute("UPDATE notebooks SET collection_id = $1 WHERE collection_id = $2", [fallbackCollectionId, collectionId]);
  await database.execute("UPDATE canvases SET collection_id = $1 WHERE collection_id = $2", [fallbackCollectionId, collectionId]);
  await database.execute("DELETE FROM collections WHERE id = $1", [collectionId]);
}

type NotebookRow = {
  id: number;
  collection_id: string;
  title: string;
  favorite: number;
  deleted_at: string | null;
  created_at: string;
  page_count: number;
  last_edited_at: string;
};

export type NotebookInfo = {
  id: number;
  title: string;
  collectionId: string;
  collectionName: string;
  description: string;
  createdAt: string;
  updatedAt: string;
};

export async function listNotebooks(collectionId: string): Promise<Notebook[]> {
  const database = await getDatabase();

  // page_count e last_edited_at sao agregados das paginas. O CASE cobre o
  // "Editado ha X" do card: vale a edicao mais recente entre as paginas e o
  // proprio caderno (renomear o caderno tambem conta como edicao).
  const rows = await database.select<NotebookRow[]>(
    `SELECT
       notebooks.id,
       notebooks.collection_id,
       notebooks.title,
       notebooks.favorite,
       notebooks.deleted_at,
       notebooks.created_at,
       COUNT(notebook_pages.id) AS page_count,
       CASE
         WHEN MAX(notebook_pages.updated_at) IS NULL OR MAX(notebook_pages.updated_at) < notebooks.updated_at
         THEN notebooks.updated_at
         ELSE MAX(notebook_pages.updated_at)
       END AS last_edited_at
     FROM notebooks
     LEFT JOIN notebook_pages ON notebook_pages.notebook_id = notebooks.id
     WHERE notebooks.collection_id = $1 AND notebooks.deleted_at IS NULL
     GROUP BY notebooks.id
     ORDER BY last_edited_at DESC`,
    [collectionId],
  );

  return rows.map((row) => ({
    id: row.id,
    collectionId: row.collection_id,
    title: row.title,
    pageCount: row.page_count,
    favorite: row.favorite === 1,
    createdAt: row.created_at,
    updatedAt: row.last_edited_at,
    deletedAt: row.deleted_at ?? undefined,
  }));
}

export async function createNotebook(collectionId: string, title = "Caderno sem título"): Promise<Notebook> {
  const database = await getDatabase();

  const insertResult = await database.execute("INSERT INTO notebooks (collection_id, title) VALUES ($1, $2)", [
    collectionId,
    title,
  ]);
  const notebookId = insertResult.lastInsertId;

  if (typeof notebookId !== "number") {
    throw new Error("Nao foi possivel criar o caderno.");
  }

  // Todo caderno nasce com uma pagina vazia (position 1): o editor sempre tem
  // onde focar ao abrir, sem estado especial de "caderno sem paginas".
  await database.execute("INSERT INTO notebook_pages (notebook_id, position) VALUES ($1, 1)", [notebookId]);

  const [row] = await database.select<Array<{ created_at: string; updated_at: string }>>(
    "SELECT created_at, updated_at FROM notebooks WHERE id = $1",
    [notebookId],
  );

  return {
    id: notebookId,
    collectionId,
    title,
    pageCount: 1,
    favorite: false,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function renameNotebook(notebookId: number, title: string) {
  const database = await getDatabase();
  const nextTitle = title.trim() || "Caderno sem título";
  await database.execute("UPDATE notebooks SET title = $1 WHERE id = $2 AND deleted_at IS NULL", [nextTitle, notebookId]);
}

export async function setNotebookFavorite(notebookId: number, favorite: boolean) {
  const database = await getDatabase();
  await database.execute("UPDATE notebooks SET favorite = $1 WHERE id = $2 AND deleted_at IS NULL", [favorite ? 1 : 0, notebookId]);
}

export async function moveNotebookToCollection(notebookId: number, collectionId: string) {
  const database = await getDatabase();
  await database.execute("UPDATE notebooks SET collection_id = $1 WHERE id = $2 AND deleted_at IS NULL", [collectionId, notebookId]);
}

export async function moveNotebookToTrash(notebookId: number) {
  const database = await getDatabase();
  await database.execute("UPDATE notebooks SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = $1", [notebookId]);
}

type NotebookPageRow = {
  id: number;
  notebook_id: number;
  title: string | null;
  content: string;
  position: number;
  created_at: string;
  updated_at: string;
};

function mapNotebookPageRow(row: NotebookPageRow): NotebookPage {
  return {
    id: row.id,
    notebookId: row.notebook_id,
    title: row.title,
    content: row.content,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getNotebookTitle(notebookId: number): Promise<string> {
  const database = await getDatabase();
  const [row] = await database.select<Array<{ title: string }>>("SELECT title FROM notebooks WHERE id = $1", [notebookId]);

  if (!row) {
    throw new Error("Caderno nao encontrado.");
  }

  return row.title;
}

export async function getNotebookInfo(notebookId: number): Promise<NotebookInfo> {
  const database = await getDatabase();
  const [row] = await database.select<
    Array<{
      id: number;
      title: string;
      collection_id: string;
      description: string;
      collection_name: string;
      created_at: string;
      last_edited_at: string;
    }>
  >(
    `SELECT
       notebooks.id,
       notebooks.title,
       notebooks.collection_id,
       notebooks.description,
       collections.name AS collection_name,
       notebooks.created_at,
       CASE
         WHEN MAX(notebook_pages.updated_at) IS NULL OR MAX(notebook_pages.updated_at) < notebooks.updated_at
         THEN notebooks.updated_at
         ELSE MAX(notebook_pages.updated_at)
       END AS last_edited_at
     FROM notebooks
     JOIN collections ON collections.id = notebooks.collection_id
     LEFT JOIN notebook_pages ON notebook_pages.notebook_id = notebooks.id
     WHERE notebooks.id = $1
     GROUP BY notebooks.id`,
    [notebookId],
  );

  if (!row) {
    throw new Error("Caderno nao encontrado.");
  }

  return {
    id: row.id,
    title: row.title,
    collectionId: row.collection_id,
    collectionName: row.collection_name,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.last_edited_at,
  };
}

export async function updateNotebookInfo(notebookId: number, updates: { title: string; description: string; collectionId: string }): Promise<NotebookInfo> {
  const database = await getDatabase();
  const title = updates.title.trim() || "Caderno sem título";
  const description = updates.description;

  await database.execute("UPDATE notebooks SET title = $1, description = $2, collection_id = $3 WHERE id = $4", [
    title,
    description,
    updates.collectionId,
    notebookId,
  ]);
  return getNotebookInfo(notebookId);
}

export async function listNotebookPages(notebookId: number): Promise<NotebookPage[]> {
  const database = await getDatabase();
  const rows = await database.select<NotebookPageRow[]>(
    "SELECT id, notebook_id, title, content, position, created_at, updated_at FROM notebook_pages WHERE notebook_id = $1 ORDER BY position ASC",
    [notebookId],
  );

  return rows.map(mapNotebookPageRow);
}

export async function createNotebookPage(notebookId: number): Promise<NotebookPage> {
  const database = await getDatabase();

  // position = maior atual + 1, calculado no proprio INSERT (a query agregada
  // sempre devolve exatamente uma linha, mesmo sem paginas: MAX = NULL -> 1).
  const insertResult = await database.execute(
    "INSERT INTO notebook_pages (notebook_id, position) SELECT $1, COALESCE(MAX(position), 0) + 1 FROM notebook_pages WHERE notebook_id = $1",
    [notebookId],
  );
  const pageId = insertResult.lastInsertId;

  if (typeof pageId !== "number") {
    throw new Error("Nao foi possivel criar a pagina.");
  }

  const [row] = await database.select<NotebookPageRow[]>(
    "SELECT id, notebook_id, title, content, position, created_at, updated_at FROM notebook_pages WHERE id = $1",
    [pageId],
  );

  return mapNotebookPageRow(row);
}

export async function deleteNotebookPage(notebookId: number, pageId: number) {
  const database = await getDatabase();
  const [page] = await database.select<Array<{ position: number }>>(
    "SELECT position FROM notebook_pages WHERE id = $1 AND notebook_id = $2",
    [pageId, notebookId],
  );

  if (!page) {
    return;
  }

  await database.execute("DELETE FROM notebook_pages WHERE id = $1 AND notebook_id = $2", [pageId, notebookId]);
  await database.execute("UPDATE notebook_pages SET position = position - 1 WHERE notebook_id = $1 AND position > $2", [
    notebookId,
    page.position,
  ]);
  await database.execute("UPDATE notebooks SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = $1", [notebookId]);
}

// Autosave do editor de caderno (blur/troca de pagina/fechar painel). O
// trigger notebook_pages_touch_updated_at cuida do updated_at.
export async function saveNotebookPage(pageId: number, updates: { title: string | null; content: string }) {
  const database = await getDatabase();
  await database.execute("UPDATE notebook_pages SET title = $1, content = $2 WHERE id = $3", [
    updates.title,
    updates.content,
    pageId,
  ]);
}

type CanvasRow = {
  id: number;
  collection_id: string;
  title: string;
  favorite: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

function mapCanvasRow(row: CanvasRow): Canvas {
  return {
    id: row.id,
    collectionId: row.collection_id,
    title: row.title,
    favorite: row.favorite === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at ?? undefined,
  };
}

export async function listCanvases(collectionId: string): Promise<Canvas[]> {
  const database = await getDatabase();
  const rows = await database.select<CanvasRow[]>(
    "SELECT id, collection_id, title, favorite, deleted_at, created_at, updated_at FROM canvases WHERE collection_id = $1 AND deleted_at IS NULL ORDER BY updated_at DESC",
    [collectionId],
  );

  return rows.map(mapCanvasRow);
}

export async function createCanvas(collectionId: string, title = "Quadro sem título"): Promise<Canvas> {
  const database = await getDatabase();
  const insertResult = await database.execute("INSERT INTO canvases (collection_id, title) VALUES ($1, $2)", [
    collectionId,
    title,
  ]);
  const canvasId = insertResult.lastInsertId;

  if (typeof canvasId !== "number") {
    throw new Error("Nao foi possivel criar o quadro.");
  }

  const [row] = await database.select<CanvasRow[]>(
    "SELECT id, collection_id, title, favorite, deleted_at, created_at, updated_at FROM canvases WHERE id = $1",
    [canvasId],
  );

  return mapCanvasRow(row);
}

export async function renameCanvas(canvasId: number, title: string) {
  const database = await getDatabase();
  const nextTitle = title.trim() || "Quadro sem título";
  await database.execute("UPDATE canvases SET title = $1 WHERE id = $2 AND deleted_at IS NULL", [nextTitle, canvasId]);
}

export async function setCanvasFavorite(canvasId: number, favorite: boolean) {
  const database = await getDatabase();
  await database.execute("UPDATE canvases SET favorite = $1 WHERE id = $2 AND deleted_at IS NULL", [favorite ? 1 : 0, canvasId]);
}

export async function moveCanvasToCollection(canvasId: number, collectionId: string) {
  const database = await getDatabase();
  await database.execute("UPDATE canvases SET collection_id = $1 WHERE id = $2 AND deleted_at IS NULL", [collectionId, canvasId]);
}

export async function moveCanvasToTrash(canvasId: number) {
  const database = await getDatabase();
  await database.execute("UPDATE canvases SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = $1", [canvasId]);
}

// Cena do Excalidraw serializada ({elements, appState}, SEM imagens — elas
// vivem em disco via canvas_files, carregadas pelo comando Rust
// load_canvas_files).
export async function getCanvasContent(canvasId: number): Promise<string> {
  const database = await getDatabase();
  const [row] = await database.select<Array<{ content: string }>>("SELECT content FROM canvases WHERE id = $1", [
    canvasId,
  ]);

  if (!row) {
    throw new Error("Quadro nao encontrado.");
  }

  return row.content;
}

// Autosave da cena (debounce + flush no fechamento). O trigger
// canvases_touch_updated_at cuida do updated_at — o "Editado ha X" do card
// acompanha sozinho.
export async function saveCanvasContent(canvasId: number, contentJson: string) {
  const database = await getDatabase();
  await database.execute("UPDATE canvases SET content = $1 WHERE id = $2", [contentJson, canvasId]);
}

// Imagens do quadro: a persistencia fisica (escrita atomica em disco + linha
// em canvas_files) e dos comandos Rust — aqui so os wrappers tipados de
// invoke. dataBase64 e o corpo do dataURL do Excalidraw, sem o prefixo
// "data:...;base64," (o Rust decodifica e valida o limite de 10MB).
export type CanvasFilePayload = {
  fileId: string;
  mimeType: string;
  dataBase64: string;
};

export async function loadCanvasFiles(canvasId: number): Promise<CanvasFilePayload[]> {
  return invoke<CanvasFilePayload[]>("load_canvas_files", { canvasId });
}

export async function saveCanvasFile(canvasId: number, file: CanvasFilePayload): Promise<string> {
  return invoke<string>("save_canvas_file", {
    canvasId,
    fileId: file.fileId,
    mimeType: file.mimeType,
    dataBase64: file.dataBase64,
  });
}

function uniqueTrimmed(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

// Resolve o id da colecao SEM inserir: devolve o id existente (se houver) ou o
// slug do nome. A criacao da colecao (se nova) acontece DENTRO da transacao do
// comando Rust, para o import ser totalmente atomico.
async function resolveCollectionIdForImport(database: Database, collectionName: string) {
  const rows = await database.select<Array<{ id: string }>>("SELECT id FROM collections WHERE name = $1 LIMIT 1", [collectionName]);
  return rows[0]?.id ?? slugify(collectionName);
}

export async function createDocument(document: LibraryDocument): Promise<LibraryDocument> {
  const database = await getDatabase();

  // Sem arquivo de origem (ex.: drag-drop que nao expoe o caminho): mantemos o
  // fluxo antigo em TS, sem copia para o storage do app.
  if (!document.filePath) {
    try {
      await insertDocument(database, document);
      return document;
    } catch (error) {
      await deletePartialDocument(database, document.id);
      throw error;
    }
  }

  // Com arquivo: o import vai para o comando Rust transacional, que copia o PDF
  // para o storage do app e grava colecao + tags + documento + autores + vinculos
  // numa unica transacao (tudo ou nada). Os ids/tons sao resolvidos aqui no TS
  // para o Rust nao precisar replicar regra de negocio.
  const collectionId = await resolveCollectionIdForImport(database, document.collection);
  const tags = uniqueTrimmed(document.tags);

  const storedFilePath = await invoke<string>("import_document", {
    request: {
      id: document.id,
      title: document.title,
      source: document.source,
      year: document.year,
      status: document.status,
      progress: document.progress,
      favorite: document.favorite,
      collectionId,
      collectionName: document.collection,
      fileName: document.fileName ?? `${document.id}.pdf`,
      sourcePath: document.filePath,
      notes: document.notes ?? "",
      updatedAt: document.updatedAt,
      authors: uniqueTrimmed(document.authors),
      tags: tags.map((tag) => ({ id: slugify(tag), name: tag, colorToken: getSubjectTagTone(tag) })),
    },
  });

  // O PDF agora vive no storage do app; o documento passa a referenciar a copia
  // estavel (sobrevive a mover/apagar o arquivo original).
  return { ...document, filePath: storedFilePath };
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

export async function incrementDocumentReadingTime(documentId: string, seconds: number) {
  if (seconds <= 0) {
    return;
  }

  const database = await getDatabase();
  await database.execute("UPDATE documents SET time_spent_seconds = time_spent_seconds + $1 WHERE id = $2", [Math.floor(seconds), documentId]);
}

export async function addDocumentTag(documentId: string, tag: SubjectTag) {
  const normalizedTag = tag.trim().replace(/\s+/g, " ");

  if (normalizedTag.length === 0) {
    return;
  }

  const database = await getDatabase();
  await upsertTag(database, normalizedTag);

  const tagId = slugify(normalizedTag);
  const [position] = await database.select<Array<{ nextOrder: number }>>(
    "SELECT COALESCE(MAX(tag_order) + 1, 0) AS nextOrder FROM document_tags WHERE document_id = $1",
    [documentId],
  );

  await database.execute("INSERT OR IGNORE INTO document_tags (document_id, tag_id, tag_order) VALUES ($1, $2, $3)", [
    documentId,
    tagId,
    position?.nextOrder ?? 0,
  ]);
}

export async function removeDocumentTag(documentId: string, tag: SubjectTag) {
  const database = await getDatabase();
  await database.execute(
    `DELETE FROM document_tags
     WHERE document_id = $1
       AND tag_id = (SELECT id FROM tags WHERE name = $2 COLLATE NOCASE LIMIT 1)`,
    [documentId, tag],
  );
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
  await database.execute("DELETE FROM notebooks WHERE deleted_at IS NOT NULL");
  await database.execute("DELETE FROM canvases WHERE deleted_at IS NOT NULL");
}

function isNormalizedRect(value: unknown): value is NormalizedRect {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const rect = value as Record<string, unknown>;
  return (
    typeof rect.x === "number" &&
    typeof rect.y === "number" &&
    typeof rect.w === "number" &&
    typeof rect.h === "number"
  );
}

function parseRects(value: string): NormalizedRect[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isNormalizedRect) : [];
  } catch {
    return [];
  }
}

function mapAnnotationRow(row: AnnotationRow): Annotation {
  return {
    id: row.id,
    documentId: row.documentId,
    page: row.page,
    color: isHighlightColor(row.color) ? row.color : "amber",
    selectedText: row.selectedText,
    note: row.note,
    rects: parseRects(row.rectsJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listAnnotations(documentId: string): Promise<Annotation[]> {
  const database = await getDatabase();
  const rows = await database.select<AnnotationRow[]>(
    `SELECT
      id,
      document_id AS documentId,
      page,
      color,
      selected_text AS selectedText,
      note,
      rects_json AS rectsJson,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM annotations
    WHERE document_id = $1
    ORDER BY page ASC, created_at ASC`,
    [documentId],
  );

  return rows.map(mapAnnotationRow);
}

// Escrita imediata: ao resolver, o INSERT esta commitado e duravel
// (synchronous=FULL por conexao). Um unico statement => atomico.
export async function createAnnotation(input: NewAnnotation): Promise<Annotation> {
  const database = await getDatabase();
  const now = new Date().toISOString();
  const annotation: Annotation = {
    id: crypto.randomUUID(),
    documentId: input.documentId,
    page: input.page,
    color: input.color,
    selectedText: input.selectedText,
    note: input.note,
    rects: input.rects,
    createdAt: now,
    updatedAt: now,
  };

  await database.execute(
    `INSERT INTO annotations (
      id,
      document_id,
      page,
      color,
      selected_text,
      note,
      rects_json,
      created_at,
      updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      annotation.id,
      annotation.documentId,
      annotation.page,
      annotation.color,
      annotation.selectedText,
      annotation.note,
      JSON.stringify(annotation.rects),
      annotation.createdAt,
      annotation.updatedAt,
    ],
  );

  return annotation;
}

export async function updateAnnotationNote(annotationId: string, note: string): Promise<void> {
  const database = await getDatabase();
  await database.execute("UPDATE annotations SET note = $1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = $2", [note, annotationId]);
}

export async function deleteAnnotation(annotationId: string): Promise<void> {
  const database = await getDatabase();
  await database.execute("DELETE FROM annotations WHERE id = $1", [annotationId]);
}

async function purgeExpiredTrash(database: Database) {
  await database.execute(
    "DELETE FROM documents WHERE deleted_at IS NOT NULL AND deleted_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days')",
  );
  await database.execute(
    "DELETE FROM notebooks WHERE deleted_at IS NOT NULL AND deleted_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days')",
  );
  await database.execute(
    "DELETE FROM canvases WHERE deleted_at IS NOT NULL AND deleted_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days')",
  );
}
