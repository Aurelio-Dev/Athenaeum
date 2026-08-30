import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import Database from "@tauri-apps/plugin-sql";
import { availableSubjectTags } from "../data/subjectTags";
import { TAG_COLOR_TOKENS } from "./tagColors";
import { getSubjectTagTone, registerSubjectTagTone } from "../styles/designTokens";
import { isAnnotationMarkStyle, isHighlightColor } from "../types/annotation";
import type { Annotation, AnnotationMarkStyle, HighlightColor, NormalizedRect } from "../types/annotation";
import type { DocumentBookmark } from "../types/bookmark";
import type { AnnotationsFilterScope, Canvas, DocumentStatus, LibraryCollection, LibraryDocument, LibraryRoute, Notebook, NotebookPage, ReadingLocation, SortMode, SubjectTag, Tone } from "../types/library";
import {
  normalizeShortcutOverrides,
  serializeShortcutOverrides,
  type ShortcutOverrides,
} from "./keyboardShortcuts";
import {
  DEFAULT_ACCENT_DARK,
  DEFAULT_ACCENT_LIGHT,
  DEFAULT_APPEARANCE_CONTRAST,
  DEFAULT_GLASS_BLUR,
  isHexColor,
  isNightLightPreferences,
  isScheduleTime,
  MAX_APPEARANCE_CONTRAST,
  MAX_GLASS_BLUR,
  MAX_NIGHT_LIGHT_STRENGTH,
  MIN_APPEARANCE_CONTRAST,
  MIN_GLASS_BLUR,
  MIN_NIGHT_LIGHT_STRENGTH,
  normalizeAppearanceContrast,
  normalizeGlassBlur,
  normalizeHexColor,
  normalizeNightLightStrength,
  normalizeNightLightPreferences,
  serializeNightLightPreferences,
  type AppearanceAccentTheme,
  type AppearancePreferences,
  type HexColor,
  type NightLightPreferences,
} from "./appearancePreferences";
// Type-only (apagado em runtime): a fonte de verdade do manifest e o builder
// da exportacao em features/notebooks; nao duplicamos o tipo aqui.
import type { NotebookExportManifest } from "../features/notebooks/notebookExportHtml";
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

export const READER_NOTES_CHANGED_EVENT = "reader:notes-changed";
export const READER_ANNOTATIONS_CHANGED_EVENT = "reader:annotations-changed";
export const READER_ANNOTATIONS_FILTER_SCOPE_CHANGED_EVENT = "reader:annotations-filter-scope-changed";
export const READER_JUMP_TO_PAGE_EVENT = "reader:jump-to-page";
export const READER_PAGE_STATE_CHANGED_EVENT = "reader:page-state-changed";
export const READER_PAGE_STATE_REQUESTED_EVENT = "reader:page-state-requested";
export const READER_DETAILS_CHANGED_EVENT = "reader:details-changed";
export const READER_PROGRESS_CHANGED_EVENT = "reader:progress-changed";
export const READER_POPOUT_CLOSED_EVENT = "reader:popout-closed";
export const READER_POPOUT_STATUS_CHANGED_EVENT = "reader:popout-status-changed";
export const READER_POPOUT_STATUS_REQUESTED_EVENT = "reader:popout-status-requested";
export const READER_SET_DOCUMENT_EVENT = "reader:set-document";
export const READER_SWITCH_DOCUMENT_EVENT = "reader-window:switch-document";
export const READER_PANEL_WINDOW_LABEL = "reader-annotations-panel";
export const READER_WINDOW_LABEL = "reader-window";
// Preferencia global (nao pertence a um documento): o material das superficies
// do app. Emitido para TODAS as janelas nativas, nao so para o Reader.
export const MATERIAL_VARIANT_CHANGED_EVENT = "app:material-variant-changed";
// Wallpaper, visibilidade e brilho tambem sao preferencias globais. O evento
// nao carrega caminhos: cada janela rele o nome confiavel do SQLite e o resolve
// no Rust.
export const WALLPAPER_SETTINGS_CHANGED_EVENT = "app:wallpaper-settings-changed";
// Preferencias visuais globais (paleta, contrastes, vidro e luz noturna).
// Cada evento leva uma mudanca canonica e discriminada para que as outras
// janelas possam atualizar a apresentacao sem reler todo o snapshot.
export const APPEARANCE_PREFERENCES_CHANGED_EVENT = "app:appearance-preferences-changed";
// Remapeamento de atalhos. O payload leva o mapa inteiro de overrides porque
// ele e pequeno e uma alteracao pode remover um conflito em outra linha.
export const KEYBOARD_SHORTCUTS_CHANGED_EVENT = "app:keyboard-shortcuts-changed";

// Eixo ortogonal ao tema claro/escuro: descreve como as superficies sao
// pintadas, nao qual e a paleta. "flat" e o material historico do app.
export type MaterialVariant = "flat" | "glass";

// Preferencia de composicao do chrome. Diferente do material, null nao e um
// default disfarçado: significa que o usuario nunca escolheu uma variante e
// que a resolucao deve acompanhar o material atual.
export type ChromeVariant = "docked" | "floating";

export type MaterialVariantChangedPayload = {
  material: MaterialVariant;
  origin: string;
};

export type WallpaperSettingsChangedPayload = {
  origin: string;
};

export type AppearancePreferenceChange =
  | { kind: "accent"; theme: AppearanceAccentTheme; value: HexColor }
  | { kind: "interface-contrast"; value: number }
  | { kind: "text-contrast"; value: number }
  | { kind: "title-contrast"; value: number }
  | { kind: "glass-blur"; value: number }
  | { kind: "night-light-strength"; value: number }
  | { kind: "night-light-settings"; value: NightLightSettings }
  | { kind: "night-light"; value: NightLightPreferences };

export type NightLightSettings = Pick<
  NightLightPreferences,
  "enabled" | "scheduleEnabled" | "startTime" | "endTime"
>;

export type AppearancePreferencesChangedPayload = AppearancePreferenceChange & {
  origin: string;
};

export type KeyboardShortcutsChangedPayload = {
  overrides: ShortcutOverrides;
  origin: string;
};

export function isKeyboardShortcutsChangedPayload(
  payload: unknown,
): payload is KeyboardShortcutsChangedPayload {
  if (typeof payload !== "object" || payload === null) {
    return false;
  }

  const candidate = payload as Record<string, unknown>;
  return (
    typeof candidate.origin === "string"
    && typeof candidate.overrides === "object"
    && candidate.overrides !== null
  );
}

export type AppearancePreferencesLoadResult = {
  preferences: AppearancePreferences;
  // A ausencia e diferente de 100 durante a migracao do antigo localStorage.
  // Depois que o provider gravar as novas chaves, ambos passam a true.
  storedContrast: {
    interface: boolean;
    text: boolean;
  };
};

export type ReaderInvalidationPayload = {
  documentId: string;
  origin: string;
};

export type ReaderAnnotationsFilterScopeChangedPayload = ReaderInvalidationPayload & {
  scope: AnnotationsFilterScope;
};

export type ReaderJumpToPagePayload = {
  documentId: string;
  page: number;
  annotationId?: string;
};

export type ReaderPageStatePayload = ReaderJumpToPagePayload & {
  progress: number;
  totalPages: number | null;
  fileSizeBytes: number | null;
  hasSelection: boolean;
};

export type OpenDocumentExternallyError = {
  code:
    | "invalid_document_id"
    | "database_unavailable"
    | "database_error"
    | "document_not_found"
    | "invalid_managed_path"
    | "file_not_found"
    | "permission_denied"
    | "no_associated_application"
    | "open_failed";
  message: string;
};

const openDocumentExternallyErrorCodes: ReadonlySet<OpenDocumentExternallyError["code"]> = new Set([
  "invalid_document_id",
  "database_unavailable",
  "database_error",
  "document_not_found",
  "invalid_managed_path",
  "file_not_found",
  "permission_denied",
  "no_associated_application",
  "open_failed",
]);

export type ReaderDocumentPayload = {
  documentId: string;
};

export function isReaderInvalidationPayload(payload: unknown): payload is ReaderInvalidationPayload {
  if (typeof payload !== "object" || payload === null) {
    return false;
  }

  const candidate = payload as Record<string, unknown>;
  return typeof candidate.documentId === "string" && typeof candidate.origin === "string";
}

export function isReaderAnnotationsFilterScopeChangedPayload(
  payload: unknown,
): payload is ReaderAnnotationsFilterScopeChangedPayload {
  return (
    isReaderInvalidationPayload(payload) &&
    "scope" in payload &&
    (payload.scope === "all" || payload.scope === "current_page")
  );
}

export function isMaterialVariant(value: unknown): value is MaterialVariant {
  return value === "flat" || value === "glass";
}

export function isChromeVariant(value: unknown): value is ChromeVariant {
  return value === "docked" || value === "floating";
}

export function resolveChromeVariant(
  stored: ChromeVariant | null,
  material: MaterialVariant,
): ChromeVariant {
  if (material === "flat") {
    return "docked";
  }

  return stored ?? "floating";
}

export function isMaterialVariantChangedPayload(payload: unknown): payload is MaterialVariantChangedPayload {
  if (typeof payload !== "object" || payload === null) {
    return false;
  }

  const candidate = payload as Record<string, unknown>;
  return isMaterialVariant(candidate.material) && typeof candidate.origin === "string";
}

export function isAppearancePreferencesChangedPayload(
  payload: unknown,
): payload is AppearancePreferencesChangedPayload {
  if (typeof payload !== "object" || payload === null) {
    return false;
  }

  const candidate = payload as Record<string, unknown>;
  if (typeof candidate.origin !== "string") {
    return false;
  }

  switch (candidate.kind) {
    case "accent":
      return (
        (candidate.theme === "light" || candidate.theme === "dark")
        && isHexColor(candidate.value)
        && candidate.value === candidate.value.toUpperCase()
      );
    case "interface-contrast":
    case "text-contrast":
    case "title-contrast":
      return (
        typeof candidate.value === "number"
        && Number.isInteger(candidate.value)
        && candidate.value >= MIN_APPEARANCE_CONTRAST
        && candidate.value <= MAX_APPEARANCE_CONTRAST
      );
    case "glass-blur":
      return (
        typeof candidate.value === "number"
        && Number.isInteger(candidate.value)
        && candidate.value >= MIN_GLASS_BLUR
        && candidate.value <= MAX_GLASS_BLUR
      );
    case "night-light-strength":
      return (
        typeof candidate.value === "number"
        && Number.isInteger(candidate.value)
        && candidate.value >= MIN_NIGHT_LIGHT_STRENGTH
        && candidate.value <= MAX_NIGHT_LIGHT_STRENGTH
      );
    case "night-light-settings": {
      if (typeof candidate.value !== "object" || candidate.value === null) {
        return false;
      }

      const settings = candidate.value as Record<string, unknown>;
      return (
        typeof settings.enabled === "boolean"
        && typeof settings.scheduleEnabled === "boolean"
        && isScheduleTime(settings.startTime)
        && isScheduleTime(settings.endTime)
      );
    }
    case "night-light":
      return isNightLightPreferences(candidate.value);
    default:
      return false;
  }
}

export function isReaderJumpToPagePayload(payload: unknown): payload is ReaderJumpToPagePayload {
  if (typeof payload !== "object" || payload === null) {
    return false;
  }

  const candidate = payload as Record<string, unknown>;
  return (
    typeof candidate.documentId === "string" &&
    typeof candidate.page === "number" &&
    Number.isInteger(candidate.page) &&
    candidate.page > 0 &&
    (!("annotationId" in candidate) || typeof candidate.annotationId === "string")
  );
}

export function isReaderPageStatePayload(payload: unknown): payload is ReaderPageStatePayload {
  if (!isReaderJumpToPagePayload(payload)) {
    return false;
  }

  const candidate = payload as unknown as Record<string, unknown>;
  const { progress, totalPages, fileSizeBytes, hasSelection } = candidate;
  const hasValidTotalPages =
    totalPages === null ||
    (typeof totalPages === "number" && Number.isInteger(totalPages) && totalPages > 0);
  const hasValidFileSize =
    fileSizeBytes === null ||
    (typeof fileSizeBytes === "number" && Number.isInteger(fileSizeBytes) && fileSizeBytes >= 0);

  return (
    typeof progress === "number" &&
    Number.isFinite(progress) &&
    progress >= 0 &&
    progress <= 100 &&
    hasValidTotalPages &&
    hasValidFileSize &&
    typeof hasSelection === "boolean"
  );
}

export function isOpenDocumentExternallyError(
  error: unknown,
): error is OpenDocumentExternallyError {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const candidate = error as Record<string, unknown>;

  return (
    typeof candidate.code === "string" &&
    openDocumentExternallyErrorCodes.has(candidate.code as OpenDocumentExternallyError["code"]) &&
    typeof candidate.message === "string"
  );
}

export function isReaderDocumentPayload(payload: unknown): payload is ReaderDocumentPayload {
  if (typeof payload !== "object" || payload === null) {
    return false;
  }

  return typeof (payload as Record<string, unknown>).documentId === "string";
}

let databasePromise: Promise<Database> | null = null;
let preloadedDatabase: Database | null = null;

export type DatabaseHandleSource = "loaded" | "preloaded";

type DocumentRow = {
  id: string;
  title: string;
  description: string;
  source: string;
  year: number;
  status: LibraryDocument["status"];
  progress: number;
  favorite: number;
  collection: string;
  updatedAt: string;
  lastOpenedAt: string | null;
  deletedAt: string | null;
  fileName: string | null;
  filePath: string | null;
  notes: string | null;
  annotationsFilterScope: AnnotationsFilterScope;
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
  colorToken: Tone;
};

type CountRow = {
  count: number;
};

type CollectionLookupRow = {
  id: string;
  name: string;
};

type AnnotationRow = {
  id: string;
  documentId: string;
  page: number;
  markStyle: string;
  color: HighlightColor;
  selectedText: string;
  note: string;
  rectsJson: string;
  createdAt: string;
  updatedAt: string;
};

type AnnotationDocumentRow = {
  documentId: string;
};

type DocumentBookmarkRow = {
  id: string;
  documentId: string;
  pageNumber: number;
  label: string | null;
  createdAt: string;
};

// Dados necessarios para criar uma anotacao. id e timestamps sao gerados aqui
// dentro para o chamador ficar simples.
export type NewAnnotation = {
  documentId: string;
  page: number;
  markStyle: AnnotationMarkStyle;
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

export type DocumentMetadataUpdates = Pick<LibraryDocument, "title" | "description" | "authors" | "source" | "year" | "collection" | "tags">;

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

function registerTagRows(rows: TagRow[]) {
  rows.forEach((tag) => registerSubjectTagTone(tag.name, tag.colorToken));
  return rows.map((tag) => tag.name);
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
    description: row.description,
    authors: parseSeparatedList(row.authors),
    source: row.source,
    year: row.year,
    tags: parseSeparatedList(row.tags),
    status: row.status,
    progress: row.progress,
    favorite: row.favorite === 1,
    collection: row.collection,
    updatedAt: row.updatedAt,
    lastOpenedAt: row.lastOpenedAt ?? undefined,
    deletedAt: row.deletedAt ?? undefined,
    fileName: row.fileName ?? undefined,
    filePath: row.filePath ?? undefined,
    annotationsFilterScope: row.annotationsFilterScope,
    readingLocation: parseReadingLocation(row.readingLocationJson),
    notes: row.notes ?? "",
    timeSpentSeconds: row.timeSpentSeconds ?? 0,
  };
}

function getPreloadedDatabase() {
  preloadedDatabase ??= Database.get(databaseUrl);
  return preloadedDatabase;
}

async function getDatabase(source: DatabaseHandleSource = "loaded") {
  if (source === "preloaded") {
    return getPreloadedDatabase();
  }

  databasePromise ??= Database.load(databaseUrl).then(async (database) => {
    await database.execute("PRAGMA foreign_keys = ON");
    await seedInitialData(database);
    await purgeExpiredTrash(database);
    return database;
  });

  return databasePromise;
}

async function emitReaderInvalidation(
  eventName:
    | typeof READER_NOTES_CHANGED_EVENT
    | typeof READER_ANNOTATIONS_CHANGED_EVENT
    | typeof READER_DETAILS_CHANGED_EVENT
    | typeof READER_PROGRESS_CHANGED_EVENT,
  documentId: string,
) {
  try {
    await emit<ReaderInvalidationPayload>(eventName, {
      documentId,
      origin: getCurrentWebviewWindow().label,
    });
  } catch (error) {
    // O SQLite ja confirmou a escrita. Falhar apenas a notificacao nao pode
    // fazer o chamador repetir uma operacao que ja foi persistida.
    console.warn("Nao foi possivel emitir a invalidacao do Reader.", error);
  }
}

async function emitReaderAnnotationsFilterScopeChanged(
  documentId: string,
  scope: AnnotationsFilterScope,
) {
  try {
    await emit<ReaderAnnotationsFilterScopeChangedPayload>(READER_ANNOTATIONS_FILTER_SCOPE_CHANGED_EVENT, {
      documentId,
      scope,
      origin: getCurrentWebviewWindow().label,
    });
  } catch (error) {
    // O SQLite ja confirmou a escrita; a falha de sincronizacao entre janelas
    // nao pode fazer o chamador repetir uma operacao que ja foi persistida.
    console.warn("Nao foi possivel emitir a mudanca do filtro de anotacoes.", error);
  }
}

async function emitMaterialVariantChanged(material: MaterialVariant) {
  try {
    await emit<MaterialVariantChangedPayload>(MATERIAL_VARIANT_CHANGED_EVENT, {
      material,
      origin: getCurrentWebviewWindow().label,
    });
  } catch (error) {
    // Mesmo racional das emissoes do Reader: o SQLite ja confirmou a escrita,
    // entao a falha de sincronizacao entre janelas nao pode fazer o chamador
    // repetir uma operacao que ja foi persistida.
    console.warn("Nao foi possivel emitir a mudanca de material.", error);
  }
}

async function emitWallpaperSettingsChanged() {
  try {
    await emit<WallpaperSettingsChangedPayload>(WALLPAPER_SETTINGS_CHANGED_EVENT, {
      origin: getCurrentWebviewWindow().label,
    });
  } catch (error) {
    // O SQLite ja confirmou a escrita. A janela de origem aplica a mudanca
    // localmente; uma falha de evento nao pode transformar sucesso em erro.
    console.warn("Nao foi possivel sincronizar o papel de parede entre as janelas.", error);
  }
}

async function emitAppearancePreferenceChanged(change: AppearancePreferenceChange) {
  try {
    await emit<AppearancePreferencesChangedPayload>(APPEARANCE_PREFERENCES_CHANGED_EVENT, {
      ...change,
      origin: getCurrentWebviewWindow().label,
    });
  } catch (error) {
    // A escrita no SQLite ja terminou. A janela de origem aplica a mudanca
    // localmente e nao deve repetir uma operacao confirmada por falha do evento.
    console.warn("Nao foi possivel sincronizar as preferencias de aparencia entre as janelas.", error);
  }
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
      description,
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
      annotations_filter_scope,
      updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
    [
      document.id,
      document.title,
      document.description,
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
      document.annotationsFilterScope,
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

function buildDocumentListQuery({ searchTerm, sortMode, route }: ListDocumentsOptions, documentId?: string) {
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

  if (documentId) {
    bindValues.push(documentId);
    whereClauses.push(`documents.id = $${bindValues.length}`);
  }

  if (route.type === "favorites") {
    whereClauses.push("documents.favorite = 1");
  }

  if (route.type === "reading-list") {
    whereClauses.push("documents.status = 'in-progress'");
    whereClauses.push(`(
      documents.reading_list_dismissed_at IS NULL
      OR documents.last_opened_at > documents.reading_list_dismissed_at
    )`);
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
        : route.type === "reading-list"
          ? "documents.last_opened_at IS NULL, documents.last_opened_at DESC"
          : "documents.updated_at DESC";

  return {
    sql: `
      SELECT
        documents.id,
        documents.title,
        documents.description,
        documents.source,
        documents.year,
        documents.status,
        documents.progress,
        documents.favorite,
        collections.name AS collection,
        documents.updated_at AS updatedAt,
        documents.last_opened_at AS lastOpenedAt,
        documents.deleted_at AS deletedAt,
        documents.file_name AS fileName,
        documents.file_path AS filePath,
        documents.notes,
        documents.annotations_filter_scope AS annotationsFilterScope,
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
    database.select<TagRow[]>("SELECT name, color_token AS colorToken FROM tags ORDER BY name COLLATE NOCASE ASC"),
    listDocuments(database, { searchTerm: "", sortMode: "recentes", route: { type: "all" } }),
    listDocuments(database, options),
    database.select<CountRow[]>(trashItemCountSql),
  ]);

  return {
    collections,
    allDocuments,
    availableTags: registerTagRows(availableTags),
    documents,
    trashCount: trashCountRows[0]?.count ?? 0,
  };
}

export async function listCollections(source: DatabaseHandleSource = "loaded"): Promise<LibraryCollection[]> {
  const database = await getDatabase(source);
  return database.select<CollectionRow[]>("SELECT id, name, color, description FROM collections WHERE is_system = 0 ORDER BY created_at ASC, name ASC");
}

async function listAvailableTagsFromDatabase(source: DatabaseHandleSource): Promise<SubjectTag[]> {
  const database = await getDatabase(source);
  const rows = await database.select<TagRow[]>("SELECT name, color_token AS colorToken FROM tags ORDER BY name COLLATE NOCASE ASC");
  return registerTagRows(rows);
}

export async function listAvailableTags(): Promise<SubjectTag[]> {
  return listAvailableTagsFromDatabase("loaded");
}

export async function listAvailableTagsFromPreloadedDatabase(): Promise<SubjectTag[]> {
  return listAvailableTagsFromDatabase("preloaded");
}

export async function updateTagTone(tag: SubjectTag, tone: Tone) {
  const database = await getDatabase();
  registerSubjectTagTone(tag, tone);
  await database.execute("UPDATE tags SET color_token = $1 WHERE name = $2 COLLATE NOCASE", [tone, tag]);
}

export async function countTrashDocuments(): Promise<number> {
  const database = await getDatabase();
  const rows = await database.select<CountRow[]>(trashItemCountSql);
  return rows[0]?.count ?? 0;
}

export async function listLibraryDocuments(
  options: ListDocumentsOptions,
  source: DatabaseHandleSource = "loaded",
): Promise<LibraryDocument[]> {
  const database = await getDatabase(source);
  return listDocuments(database, options);
}

export async function listDocuments(database: Database, options: ListDocumentsOptions) {
  const query = buildDocumentListQuery(options);
  const rows = await database.select<DocumentRow[]>(query.sql, query.bindValues);
  return rows.map(mapDocumentRow);
}

export async function getLibraryDocument(
  documentId: string,
  source: DatabaseHandleSource = "loaded",
): Promise<LibraryDocument | null> {
  const database = await getDatabase(source);
  const query = buildDocumentListQuery(
    { searchTerm: "", sortMode: "recentes", route: { type: "all" } },
    documentId,
  );
  const [row] = await database.select<DocumentRow[]>(query.sql, query.bindValues);
  return row ? mapDocumentRow(row) : null;
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
    throw new Error("Informe um nome para a coleção.");
  }

  if (await findCollectionByName(database, name)) {
    throw new Error("Já existe uma coleção com esse nome.");
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
    throw new Error("Informe um nome para a coleção.");
  }

  const existingCollection = await findCollectionByName(database, name);
  if (existingCollection && existingCollection.id !== collectionId) {
    throw new Error("Já existe uma coleção com esse nome.");
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
    throw new Error("Informe um nome para a coleção.");
  }

  const existingCollection = await findCollectionByName(database, name);
  if (existingCollection && existingCollection.id !== collectionId) {
    throw new Error("Já existe uma coleção com esse nome.");
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
  favorite: boolean;
  readingStatus: NotebookReadingStatus;
  authorDiscipline: string;
  description: string;
  createdAt: string;
  updatedAt: string;
};

export type NotebookReadingStatus = "not-started" | "in-progress" | "completed";

export async function listNotebooks(
  collectionId: string,
  source: DatabaseHandleSource = "loaded",
): Promise<Notebook[]> {
  const database = await getDatabase(source);

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

export async function createNotebook(
  collectionId: string,
  title = "Caderno sem título",
  source: DatabaseHandleSource = "loaded",
): Promise<Notebook> {
  const database = await getDatabase(source);

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

export async function renameNotebook(
  notebookId: number,
  title: string,
  source: DatabaseHandleSource = "loaded",
) {
  const database = await getDatabase(source);
  const nextTitle = title.trim() || "Caderno sem título";
  await database.execute("UPDATE notebooks SET title = $1 WHERE id = $2 AND deleted_at IS NULL", [nextTitle, notebookId]);
}

export async function setNotebookFavorite(
  notebookId: number,
  favorite: boolean,
  source: DatabaseHandleSource = "loaded",
) {
  const database = await getDatabase(source);
  await database.execute("UPDATE notebooks SET favorite = $1 WHERE id = $2 AND deleted_at IS NULL", [favorite ? 1 : 0, notebookId]);
}

export async function moveNotebookToCollection(
  notebookId: number,
  collectionId: string,
  source: DatabaseHandleSource = "loaded",
) {
  const database = await getDatabase(source);
  await database.execute("UPDATE notebooks SET collection_id = $1 WHERE id = $2 AND deleted_at IS NULL", [collectionId, notebookId]);
}

export async function moveNotebookToTrash(notebookId: number, source: DatabaseHandleSource = "loaded") {
  const database = await getDatabase(source);
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

export async function getNotebookTitle(
  notebookId: number,
  source: DatabaseHandleSource = "loaded",
): Promise<string> {
  const database = await getDatabase(source);
  const [row] = await database.select<Array<{ title: string }>>("SELECT title FROM notebooks WHERE id = $1", [notebookId]);

  if (!row) {
    throw new Error("Caderno nao encontrado.");
  }

  return row.title;
}

export async function getNotebookInfo(
  notebookId: number,
  source: DatabaseHandleSource = "loaded",
): Promise<NotebookInfo> {
  const database = await getDatabase(source);
  const [row] = await database.select<
    Array<{
      id: number;
      title: string;
      collection_id: string;
      favorite: number;
      reading_status: NotebookReadingStatus;
      author_discipline: string;
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
       notebooks.favorite,
       notebooks.reading_status,
       notebooks.author_discipline,
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
    favorite: row.favorite === 1,
    readingStatus: row.reading_status,
    authorDiscipline: row.author_discipline,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.last_edited_at,
  };
}

export async function updateNotebookInfo(
  notebookId: number,
  updates: { title: string; description: string; collectionId: string; readingStatus: NotebookReadingStatus; authorDiscipline: string },
  source: DatabaseHandleSource = "loaded",
): Promise<NotebookInfo> {
  const database = await getDatabase(source);
  const title = updates.title.trim() || "Caderno sem título";
  const description = updates.description;

  await database.execute("UPDATE notebooks SET title = $1, description = $2, collection_id = $3, reading_status = $4, author_discipline = $5 WHERE id = $6", [
    title,
    description,
    updates.collectionId,
    updates.readingStatus,
    updates.authorDiscipline,
    notebookId,
  ]);
  return getNotebookInfo(notebookId, source);
}

export async function listNotebookPages(
  notebookId: number,
  source: DatabaseHandleSource = "loaded",
): Promise<NotebookPage[]> {
  const database = await getDatabase(source);
  const rows = await database.select<NotebookPageRow[]>(
    "SELECT id, notebook_id, title, content, position, created_at, updated_at FROM notebook_pages WHERE notebook_id = $1 ORDER BY position ASC",
    [notebookId],
  );

  return rows.map(mapNotebookPageRow);
}

export async function createNotebookPage(
  notebookId: number,
  source: DatabaseHandleSource = "loaded",
): Promise<NotebookPage> {
  const database = await getDatabase(source);

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

export async function deleteNotebookPage(
  notebookId: number,
  pageId: number,
  source: DatabaseHandleSource = "loaded",
) {
  const database = await getDatabase(source);
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
export async function saveNotebookPage(
  pageId: number,
  updates: { title: string | null; content: string },
  source: DatabaseHandleSource = "loaded",
) {
  const database = await getDatabase(source);
  await database.execute("UPDATE notebook_pages SET title = $1, content = $2 WHERE id = $3", [
    updates.title,
    updates.content,
    pageId,
  ]);
}

// ---------------------------------------------------------------------------
// Tags de caderno (notebook_tags, migration v15) — mesmo vocabulario das tags
// de documento (tabela tags compartilhada). Espelha listAvailableTags /
// setDocumentTags: registra o tom de cada tag no runtime e persiste o vinculo.
// ---------------------------------------------------------------------------

export async function listNotebookTags(
  notebookId: number,
  source: DatabaseHandleSource = "loaded",
): Promise<SubjectTag[]> {
  const database = await getDatabase(source);
  const rows = await database.select<TagRow[]>(
    `SELECT tags.name AS name, tags.color_token AS colorToken
     FROM notebook_tags
     JOIN tags ON tags.id = notebook_tags.tag_id
     WHERE notebook_tags.notebook_id = $1
     ORDER BY notebook_tags.tag_order`,
    [notebookId],
  );
  return registerTagRows(rows);
}

export async function saveNotebookTags(
  notebookId: number,
  tags: SubjectTag[],
  source: DatabaseHandleSource = "loaded",
) {
  const database = await getDatabase(source);

  // Garante que toda tag existe na tabela tags ANTES do insert em notebook_tags
  // (a FK exige o tag_id). upsertTag e idempotente para as ja existentes.
  for (const tag of tags) {
    await upsertTag(database, tag);
  }

  // Substituicao total (mesmo padrao de setDocumentTags): apaga o conjunto
  // atual e regrava na ordem recebida — tag_order preserva a ordem da UI.
  await database.execute("DELETE FROM notebook_tags WHERE notebook_id = $1", [notebookId]);
  for (const [index, tag] of tags.entries()) {
    await database.execute("INSERT INTO notebook_tags (notebook_id, tag_id, tag_order) VALUES ($1, $2, $3)", [
      notebookId,
      slugify(tag),
      index,
    ]);
  }
}

// ---------------------------------------------------------------------------
// PDFs vinculados a um caderno (notebook_linked_documents, migration v15).
// ---------------------------------------------------------------------------

// Shape leve para a lista de "Linked PDF" no painel: so os metadados exibidos
// (titulo/autores/ano/colecao). Nao reusa LibraryDocument inteiro porque nao
// precisamos de progresso/notas/localizacao aqui — seria peso desnecessario.
export type LinkedDocument = {
  id: string;
  title: string;
  authors: string[];
  year: number;
  collection: string;
};

type LinkedDocumentRow = {
  id: string;
  title: string;
  year: number;
  collection: string;
  authors: string | null;
};

export type LatestLinkedNotebook = {
  id: number;
  title: string;
  collectionId: string;
  linkedAt: string;
};

export type RelatedDocument = {
  id: string;
  title: string;
  authors: string[];
  year: number;
  updatedAt: string;
};

type RelatedDocumentRow = Omit<RelatedDocument, "authors"> & {
  authors: string | null;
};

export async function listNotebookLinkedDocuments(
  notebookId: number,
  source: DatabaseHandleSource = "loaded",
): Promise<LinkedDocument[]> {
  const database = await getDatabase(source);
  // Ignora documentos na lixeira (deleted_at): o vinculo permanece no banco
  // (so o purge definitivo aciona o cascade), mas um PDF na lixeira nao e um
  // documento "ativo" para exibir na lista. Restaurar da lixeira faz o vinculo
  // reaparecer sozinho.
  const rows = await database.select<LinkedDocumentRow[]>(
    `SELECT
       documents.id AS id,
       documents.title AS title,
       documents.year AS year,
       collections.name AS collection,
       (SELECT group_concat(author, char(31)) FROM document_authors WHERE document_id = documents.id ORDER BY author_order) AS authors
     FROM notebook_linked_documents
     JOIN documents ON documents.id = notebook_linked_documents.document_id
     JOIN collections ON collections.id = documents.collection_id
     WHERE notebook_linked_documents.notebook_id = $1 AND documents.deleted_at IS NULL
     ORDER BY notebook_linked_documents.linked_at`,
    [notebookId],
  );

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    authors: parseSeparatedList(row.authors),
    year: row.year,
    collection: row.collection,
  }));
}

export async function getLatestLinkedNotebook(
  documentId: string,
  source: DatabaseHandleSource = "loaded",
): Promise<LatestLinkedNotebook | null> {
  const database = await getDatabase(source);
  const [notebook] = await database.select<LatestLinkedNotebook[]>(
    `SELECT
  notebooks.id, notebooks.title, notebooks.collection_id AS collectionId,
  notebook_linked_documents.linked_at AS linkedAt
FROM notebook_linked_documents
JOIN notebooks ON notebooks.id = notebook_linked_documents.notebook_id
WHERE notebook_linked_documents.document_id = $1
  AND notebooks.deleted_at IS NULL
ORDER BY notebook_linked_documents.linked_at DESC, notebooks.id DESC
LIMIT 1;`,
    [documentId],
  );

  return notebook ?? null;
}

export async function listRelatedDocuments(
  documentId: string,
  source: DatabaseHandleSource = "loaded",
): Promise<RelatedDocument[]> {
  const database = await getDatabase(source);
  const rows = await database.select<RelatedDocumentRow[]>(
    `SELECT
       documents.id,
       documents.title,
       documents.year,
       documents.updated_at AS updatedAt,
       (SELECT group_concat(author, char(31)) FROM document_authors WHERE document_id = documents.id ORDER BY author_order) AS authors
     FROM documents
     WHERE documents.collection_id = (
       SELECT collection_id
       FROM documents
       WHERE id = $1
     )
       AND documents.id != $1
       AND documents.deleted_at IS NULL
     ORDER BY documents.updated_at DESC
     LIMIT 5`,
    [documentId],
  );

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    authors: parseSeparatedList(row.authors),
    year: row.year,
    updatedAt: row.updatedAt,
  }));
}

export async function linkDocumentToNotebook(
  notebookId: number,
  documentId: string,
  source: DatabaseHandleSource = "loaded",
) {
  const database = await getDatabase(source);
  // INSERT OR IGNORE: o PK composto (notebook_id, document_id) ja garante que
  // vincular o mesmo PDF duas vezes e no-op — a UI tambem previne, mas o banco
  // e a rede de seguranca.
  await database.execute(
    "INSERT OR IGNORE INTO notebook_linked_documents (notebook_id, document_id) VALUES ($1, $2)",
    [notebookId, documentId],
  );
  await emitReaderInvalidation(READER_DETAILS_CHANGED_EVENT, documentId);
}

// Opcoes de caderno para o "Enviar para Caderno" do leitor — todas as colecoes,
// mais recentes primeiro.
export type NotebookOption = {
  id: number;
  title: string;
};

export async function listNotebookOptions(source: DatabaseHandleSource = "loaded"): Promise<NotebookOption[]> {
  const database = await getDatabase(source);
  return database.select<NotebookOption[]>(
    "SELECT id, title FROM notebooks WHERE deleted_at IS NULL ORDER BY updated_at DESC",
  );
}

// Cria uma pagina de caderno ja com titulo e conteudo em um unico INSERT
// atomico (envio de pagina do leitor). Nao passa pelo editor nem pelo
// autosave, entao nao ha draft pendente a coordenar.
export async function createNotebookPageWithContent(
  notebookId: number,
  title: string,
  content: string,
  source: DatabaseHandleSource = "loaded",
): Promise<number> {
  const database = await getDatabase(source);
  const insertResult = await database.execute(
    `INSERT INTO notebook_pages (notebook_id, title, content, position)
     SELECT $1, $2, $3, COALESCE(MAX(position), 0) + 1 FROM notebook_pages WHERE notebook_id = $1`,
    [notebookId, title, content],
  );
  const pageId = insertResult.lastInsertId;

  if (typeof pageId !== "number") {
    throw new Error("Não foi possível criar a página no Caderno.");
  }

  // O trigger de updated_at do caderno so cobre UPDATE de pagina; INSERT toca
  // manualmente, como deleteNotebookPage ja faz.
  await database.execute("UPDATE notebooks SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = $1", [notebookId]);
  return pageId;
}

export async function unlinkDocumentFromNotebook(
  notebookId: number,
  documentId: string,
  source: DatabaseHandleSource = "loaded",
) {
  const database = await getDatabase(source);
  await database.execute(
    "DELETE FROM notebook_linked_documents WHERE notebook_id = $1 AND document_id = $2",
    [notebookId, documentId],
  );
  await emitReaderInvalidation(READER_DETAILS_CHANGED_EVENT, documentId);
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
  // Mantem o parser/formato de Quadro fora do chunk inicial usado pela popout;
  // a fonte canonica continua sendo carregada somente quando um Quadro e criado.
  const { emptyCanvasContentJson } = await import("../features/canvases/canvasScene");
  // Passa o content explicito no formato Konva vazio em vez de herdar o DEFAULT
  // antigo da coluna (formato Excalidraw, ainda na migration 0012). Assim um
  // Quadro novo ja nasce no formato atual e nao depende do fallback do parser.
  const insertResult = await database.execute(
    "INSERT INTO canvases (collection_id, title, content) VALUES ($1, $2, $3)",
    [collectionId, title, emptyCanvasContentJson],
  );
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

// Cena do Quadro serializada no formato Konva (ver canvasScene.ts), SEM imagens
// — elas vivem em disco via canvas_files, carregadas pelo comando Rust
// load_canvas_files. Conteudo antigo do Excalidraw ainda pode existir no banco;
// o parseCanvasContent no frontend abre esses casos como cena vazia.
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
// "data:...;base64," (o Rust decodifica e valida o limite de 4MB).
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

// Assets de paginas de Caderno: primeira fase da infraestrutura para imagens
// coladas/inseridas sem base64 dentro de notebook_pages.content. Os bytes ficam
// em disco via comandos Rust; o HTML futuro deve guardar so referencias.
export type NotebookAssetPayload = {
  notebookId: number | string;
  pageId: number | string;
  assetId: string;
  mimeType: string;
  dataBase64: string;
  checksum?: string | null;
  originalName?: string | null;
};

export type NotebookAssetMetadata = {
  id: string;
  notebookId: string;
  pageId: string;
  mimeType: string;
  filePath: string;
  fileSize: number;
  checksum: string | null;
  originalName: string | null;
  createdAt: string;
};

export type NotebookAssetData = NotebookAssetMetadata & {
  dataBase64: string;
};

export async function saveNotebookAsset(asset: NotebookAssetPayload): Promise<NotebookAssetMetadata> {
  return invoke<NotebookAssetMetadata>("save_notebook_asset", {
    notebookId: String(asset.notebookId),
    pageId: String(asset.pageId),
    assetId: asset.assetId,
    mimeType: asset.mimeType,
    dataBase64: asset.dataBase64,
    checksum: asset.checksum ?? null,
    originalName: asset.originalName ?? null,
  });
}

export async function loadNotebookAssets(pageId: number | string): Promise<NotebookAssetData[]> {
  return invoke<NotebookAssetData[]>("load_notebook_assets", { pageId: String(pageId) });
}

// Arquivos anexados a paginas de Caderno. Diferente de notebook_assets, esta
// primeira fase lista apenas metadados: o arquivo fica em disco e o HTML guarda
// data-notebook-attachment-id, sem base64.
export type NotebookFileAttachmentPayload = {
  notebookId: number | string;
  pageId: number | string;
  attachmentId: string;
  originalName: string;
  mimeType?: string | null;
  dataBase64: string;
};

export type NotebookFileAttachmentMetadata = {
  id: string;
  notebookId: number;
  pageId: number;
  originalName: string;
  mimeType: string | null;
  filePath: string;
  fileSize: number;
  createdAt: string;
};

export async function saveNotebookFileAttachment(
  attachment: NotebookFileAttachmentPayload,
): Promise<NotebookFileAttachmentMetadata> {
  return invoke<NotebookFileAttachmentMetadata>("save_notebook_file_attachment", {
    notebookId: String(attachment.notebookId),
    pageId: String(attachment.pageId),
    attachmentId: attachment.attachmentId,
    originalName: attachment.originalName,
    mimeType: attachment.mimeType ?? null,
    dataBase64: attachment.dataBase64,
  });
}

export async function loadNotebookFileAttachments(pageId: number | string): Promise<NotebookFileAttachmentMetadata[]> {
  return invoke<NotebookFileAttachmentMetadata[]>("load_notebook_file_attachments", { pageId: String(pageId) });
}

export async function openNotebookFileAttachment(attachmentId: string): Promise<void> {
  await invoke<void>("open_notebook_file_attachment", { attachmentId });
}

export async function revealNotebookFileAttachment(attachmentId: string): Promise<void> {
  await invoke<void>("reveal_notebook_file_attachment", { attachmentId });
}

export async function deleteNotebookFileAttachment(attachmentId: string): Promise<NotebookFileAttachmentMetadata> {
  return invoke<NotebookFileAttachmentMetadata>("delete_notebook_file_attachment", { attachmentId });
}

export type NotebookExportDestinationRequest = {
  defaultFileName: string;
};

export async function selectNotebookExportDestination(request: NotebookExportDestinationRequest): Promise<string | null> {
  return invoke<string | null>("select_notebook_export_destination", {
    defaultFileName: request.defaultFileName,
  });
}

// Escrita final da exportacao: o Rust resolve cada slot (imagem/anexo) no
// banco, embute o base64 em streaming e grava o arquivo com temp + rename
// (sobrescrita recuperavel via diretorio de backup exclusivo).
// O manifest e o HTML vem do builder do frontend (notebookExportHtml.ts).

// Contrato fechado com os codigos emitidos por write_notebook_export no Rust.
// Aviso significa que um recurso individual nao pode ser embutido, mas a
// estrutura do export esta integra: a linha do banco nao existe mais
// (referencia orfa), o arquivo foi apagado do disco, o MIME do asset esta fora
// da allowlist, o MIME do anexo foi normalizado para octet-stream, ou a limpeza
// do backup de recuperacao falhou depois do HTML ja exportado. Todo o resto —
// divergencia estrutural HTML/manifest, kind fora do contrato, id malformado e
// propriedade (recurso de outro caderno/pagina) — e FATAL no Rust e aborta a
// exportacao inteira, nunca chega como aviso.
export type NotebookExportWriteWarningCode =
  | "missing-resource"
  | "missing-file"
  | "invalid-asset-mime-type"
  | "unknown-attachment-mime-type"
  | "backup-cleanup-failed";

export type NotebookExportWriteWarning = {
  code: NotebookExportWriteWarningCode;
  slotId: string | null;
  pageId: number | null;
  message: string;
};

export type NotebookExportWriteResult = {
  path: string;
  bytesWritten: number;
  embeddedAssets: number;
  embeddedAttachments: number;
  missingResources: number;
  warnings: NotebookExportWriteWarning[];
};

export type WriteNotebookExportRequest = {
  destinationPath: string;
  html: string;
  manifest: NotebookExportManifest;
};

export async function writeNotebookExport(request: WriteNotebookExportRequest): Promise<NotebookExportWriteResult> {
  return invoke<NotebookExportWriteResult>("write_notebook_export", {
    destinationPath: request.destinationPath,
    html: request.html,
    manifest: request.manifest,
  });
}

// Soma o file_size (bytes crus em disco) de todas as imagens e anexos das
// paginas no escopo do export. Usado apenas para ESTIMAR o tamanho final antes
// de gravar — leitura pura, nao toca no filesystem nem depende dos bytes reais
// dos arquivos no momento do clique.
//
// Duas queries de proposito: notebook_assets.page_id e TEXT (migration v17) e
// notebook_file_attachments.page_id e INTEGER (migration v18). Cada query recebe
// o parametro no tipo que casa exatamente com a coluna (string para a de TEXT,
// number para a de INTEGER), sem depender da coercao de afinidade do SQLite
// entre tipos diferentes. COALESCE garante 0 quando nao ha linhas.
export async function sumNotebookExportResourceBytes(
  pageIds: number[],
  source: DatabaseHandleSource = "loaded",
): Promise<number> {
  // Sem paginas nao ha o que somar; alem disso um `IN ()` vazio seria erro de
  // sintaxe no SQLite.
  if (pageIds.length === 0) {
    return 0;
  }

  const database = await getDatabase(source);
  const placeholders = pageIds.map((_, index) => `$${index + 1}`).join(", ");

  const [assetsRow] = await database.select<Array<{ total: number }>>(
    `SELECT COALESCE(SUM(file_size), 0) AS total FROM notebook_assets WHERE page_id IN (${placeholders})`,
    pageIds.map((pageId) => String(pageId)),
  );

  const [attachmentsRow] = await database.select<Array<{ total: number }>>(
    `SELECT COALESCE(SUM(file_size), 0) AS total FROM notebook_file_attachments WHERE page_id IN (${placeholders})`,
    pageIds,
  );

  return (assetsRow?.total ?? 0) + (attachmentsRow?.total ?? 0);
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

  await database.execute("UPDATE documents SET title = $1, description = $2, source = $3, year = $4, collection_id = $5 WHERE id = $6", [
    updates.title,
    updates.description,
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

  await emitReaderInvalidation(READER_DETAILS_CHANGED_EVENT, documentId);
}

export async function setDocumentFavorite(
  documentId: string,
  favorite: boolean,
  source: DatabaseHandleSource = "loaded",
) {
  const database = await getDatabase(source);
  await database.execute("UPDATE documents SET favorite = $1 WHERE id = $2", [favorite ? 1 : 0, documentId]);
  await emitReaderInvalidation(READER_DETAILS_CHANGED_EVENT, documentId);
}

export async function openDocumentExternally(documentId: string): Promise<void> {
  await invoke("open_document_externally", { documentId });
}

export async function getDocumentNotes(documentId: string, source: DatabaseHandleSource = "loaded"): Promise<string> {
  const database = await getDatabase(source);
  const [row] = await database.select<Array<{ notes: string | null }>>("SELECT notes FROM documents WHERE id = $1", [documentId]);
  return row?.notes ?? "";
}

export async function setDocumentNote(documentId: string, note: string, source: DatabaseHandleSource = "loaded") {
  const database = await getDatabase(source);
  await database.execute("UPDATE documents SET notes = $1 WHERE id = $2", [note, documentId]);
  await emitReaderInvalidation(READER_NOTES_CHANGED_EVENT, documentId);
}

export async function incrementDocumentReadingTime(
  documentId: string,
  seconds: number,
  source: DatabaseHandleSource = "loaded",
) {
  if (seconds <= 0) {
    return;
  }

  const database = await getDatabase(source);
  await database.execute("UPDATE documents SET time_spent_seconds = time_spent_seconds + $1 WHERE id = $2", [Math.floor(seconds), documentId]);
}

export async function addDocumentTag(documentId: string, tag: SubjectTag, source: DatabaseHandleSource = "loaded") {
  const normalizedTag = tag.trim().replace(/\s+/g, " ");

  if (normalizedTag.length === 0) {
    return;
  }

  const database = await getDatabase(source);
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
  await emitReaderInvalidation(READER_DETAILS_CHANGED_EVENT, documentId);
}

export async function removeDocumentTag(documentId: string, tag: SubjectTag, source: DatabaseHandleSource = "loaded") {
  const database = await getDatabase(source);
  await database.execute(
    `DELETE FROM document_tags
     WHERE document_id = $1
       AND tag_id = (SELECT id FROM tags WHERE name = $2 COLLATE NOCASE LIMIT 1)`,
    [documentId, tag],
  );
  await emitReaderInvalidation(READER_DETAILS_CHANGED_EVENT, documentId);
}

export async function setDocumentReadingStarted(
  documentId: string,
  source: DatabaseHandleSource = "loaded",
) {
  const database = await getDatabase(source);
  await database.execute(
    `UPDATE documents
     SET
       last_opened_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
       status = CASE WHEN status = 'not-started' THEN 'in-progress' ELSE status END
     WHERE id = $1 AND deleted_at IS NULL`,
    [documentId],
  );
  await emitReaderInvalidation(READER_PROGRESS_CHANGED_EVENT, documentId);
}

export async function updateDocumentReadingStatus(
  documentId: string,
  status: DocumentStatus,
  source: DatabaseHandleSource = "loaded",
) {
  if (status !== "not-started" && status !== "in-progress" && status !== "completed") {
    throw new Error("Status de leitura invalido.");
  }

  const database = await getDatabase(source);
  const result = await database.execute(
    `UPDATE documents
     SET status = $1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = $2 AND deleted_at IS NULL`,
    [status, documentId],
  );
  if (result.rowsAffected === 0) {
    throw new Error("Documento nao encontrado para atualizar o status de leitura.");
  }

  await emitReaderInvalidation(READER_PROGRESS_CHANGED_EVENT, documentId);
}

export async function dismissDocumentFromReadingList(
  documentId: string,
  source: DatabaseHandleSource = "loaded",
) {
  const database = await getDatabase(source);
  const result = await database.execute(
    `UPDATE documents
     SET reading_list_dismissed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = $1 AND deleted_at IS NULL`,
    [documentId],
  );
  if (result.rowsAffected === 0) {
    throw new Error("Documento nao encontrado para dispensar de Em andamento.");
  }

  await emitReaderInvalidation(READER_PROGRESS_CHANGED_EVENT, documentId);
}

export async function setDocumentReadingLocation(
  document: LibraryDocument,
  readingLocation: ReadingLocation,
  source: DatabaseHandleSource = "loaded",
) {
  // Uma montagem que nunca mediu a superficie nao tem informacao nova para
  // persistir. Ignorar o fallback impede zeros transitorios de substituirem
  // uma posicao valida ja salva (fechamento rapido, troca de documento ou
  // replay de efeitos do React.StrictMode).
  if (!readingLocation.canMeasure) {
    return;
  }

  const database = await getDatabase(source);
  const measuredProgress = Math.round(readingLocation.scrollRatio * 100);
  const progress = Math.max(document.progress, measuredProgress);

  await database.execute("UPDATE documents SET reading_location_json = $1, progress = $2, updated_at = $3 WHERE id = $4", [
    JSON.stringify(readingLocation),
    progress,
    readingLocation.savedAt,
    document.id,
  ]);
  await emitReaderInvalidation(READER_PROGRESS_CHANGED_EVENT, document.id);
}

export async function setDocumentAnnotationsFilterScope(
  documentId: string,
  scope: AnnotationsFilterScope,
  source: DatabaseHandleSource = "loaded",
): Promise<void> {
  const database = await getDatabase(source);
  await database.execute(
    "UPDATE documents SET annotations_filter_scope = $1 WHERE id = $2",
    [scope, documentId],
  );
  await emitReaderAnnotationsFilterScopeChanged(documentId, scope);
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

export async function getTrashDocumentIds() {
  const database = await getDatabase();
  const rows = await database.select<Array<{ id: string }>>("SELECT id FROM documents WHERE deleted_at IS NOT NULL ORDER BY id");

  return rows.map((row) => row.id);
}

export type DocumentFileDeletionOutcome =
  | "managed-file-deleted"
  | "managed-file-missing"
  | "no-file"
  | "unmanaged-file-preserved";

export type DeleteDocumentPermanentlyResult = {
  outcome: DocumentFileDeletionOutcome;
};

export async function permanentlyDeleteDocument(documentId: string): Promise<DeleteDocumentPermanentlyResult> {
  return invoke<DeleteDocumentPermanentlyResult>("delete_document_permanently", { documentId });
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
    markStyle: isAnnotationMarkStyle(row.markStyle) ? row.markStyle : "highlight",
    color: isHighlightColor(row.color) ? row.color : "amber",
    selectedText: row.selectedText,
    note: row.note,
    rects: parseRects(row.rectsJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function getAnnotationDocumentId(database: Database, annotationId: string): Promise<string | null> {
  const [row] = await database.select<AnnotationDocumentRow[]>(
    "SELECT document_id AS documentId FROM annotations WHERE id = $1",
    [annotationId],
  );
  return row?.documentId ?? null;
}

export async function listAnnotations(documentId: string, source: DatabaseHandleSource = "loaded"): Promise<Annotation[]> {
  const database = await getDatabase(source);
  const rows = await database.select<AnnotationRow[]>(
    `SELECT
      id,
      document_id AS documentId,
      page,
      mark_style AS markStyle,
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
export async function createAnnotation(input: NewAnnotation, source: DatabaseHandleSource = "loaded"): Promise<Annotation> {
  const database = await getDatabase(source);
  const now = new Date().toISOString();
  const annotation: Annotation = {
    id: crypto.randomUUID(),
    documentId: input.documentId,
    page: input.page,
    markStyle: input.markStyle,
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
      mark_style,
      color,
      selected_text,
      note,
      rects_json,
      created_at,
      updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      annotation.id,
      annotation.documentId,
      annotation.page,
      annotation.markStyle,
      annotation.color,
      annotation.selectedText,
      annotation.note,
      JSON.stringify(annotation.rects),
      annotation.createdAt,
      annotation.updatedAt,
    ],
  );

  await emitReaderInvalidation(READER_ANNOTATIONS_CHANGED_EVENT, annotation.documentId);

  return annotation;
}

// Cor e estilo formam uma unica aparencia logica. Atualiza ambos no mesmo
// statement para que leitores concorrentes nunca observem uma combinacao parcial.
export async function updateAnnotationMark(
  annotationId: string,
  markStyle: AnnotationMarkStyle,
  color: HighlightColor,
  source: DatabaseHandleSource = "loaded",
): Promise<void> {
  const database = await getDatabase(source);
  const documentId = await getAnnotationDocumentId(database, annotationId);
  const result = await database.execute(
    "UPDATE annotations SET mark_style = $1, color = $2, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = $3",
    [markStyle, color, annotationId],
  );

  if (documentId && result.rowsAffected > 0) {
    await emitReaderInvalidation(READER_ANNOTATIONS_CHANGED_EVENT, documentId);
  }
}

export async function updateAnnotationNote(annotationId: string, note: string, source: DatabaseHandleSource = "loaded"): Promise<void> {
  const database = await getDatabase(source);
  const documentId = await getAnnotationDocumentId(database, annotationId);
  const result = await database.execute("UPDATE annotations SET note = $1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = $2", [note, annotationId]);

  if (documentId && result.rowsAffected > 0) {
    await emitReaderInvalidation(READER_ANNOTATIONS_CHANGED_EVENT, documentId);
  }
}

export async function deleteAnnotation(annotationId: string, source: DatabaseHandleSource = "loaded"): Promise<void> {
  const database = await getDatabase(source);
  const documentId = await getAnnotationDocumentId(database, annotationId);
  const result = await database.execute("DELETE FROM annotations WHERE id = $1", [annotationId]);

  if (documentId && result.rowsAffected > 0) {
    await emitReaderInvalidation(READER_ANNOTATIONS_CHANGED_EVENT, documentId);
  }
}

function mapDocumentBookmarkRow(row: DocumentBookmarkRow): DocumentBookmark {
  return {
    id: row.id,
    documentId: row.documentId,
    pageNumber: row.pageNumber,
    label: row.label,
    createdAt: row.createdAt,
  };
}

export async function listBookmarks(
  documentId: string,
  source: DatabaseHandleSource,
): Promise<DocumentBookmark[]> {
  const database = await getDatabase(source);
  const rows = await database.select<DocumentBookmarkRow[]>(
    `SELECT
      id,
      document_id AS documentId,
      page_number AS pageNumber,
      label,
      created_at AS createdAt
    FROM document_bookmarks
    WHERE document_id = $1
    ORDER BY page_number ASC, created_at ASC`,
    [documentId],
  );

  return rows.map(mapDocumentBookmarkRow);
}

export async function createBookmark(
  documentId: string,
  pageNumber: number,
  label: string | null,
  source: DatabaseHandleSource,
): Promise<DocumentBookmark> {
  const database = await getDatabase(source);
  const bookmark: DocumentBookmark = {
    id: crypto.randomUUID(),
    documentId,
    pageNumber,
    label,
    createdAt: new Date().toISOString(),
  };

  await database.execute(
    `INSERT INTO document_bookmarks (
      id,
      document_id,
      page_number,
      label,
      created_at
    ) VALUES ($1, $2, $3, $4, $5)`,
    [bookmark.id, bookmark.documentId, bookmark.pageNumber, bookmark.label, bookmark.createdAt],
  );

  return bookmark;
}

export async function updateBookmarkLabel(
  bookmarkId: string,
  label: string | null,
  source: DatabaseHandleSource,
): Promise<void> {
  const database = await getDatabase(source);
  await database.execute("UPDATE document_bookmarks SET label = $1 WHERE id = $2", [label, bookmarkId]);
}

export async function deleteBookmark(bookmarkId: string, source: DatabaseHandleSource): Promise<void> {
  const database = await getDatabase(source);
  await database.execute("DELETE FROM document_bookmarks WHERE id = $1", [bookmarkId]);
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

// Configuracoes globais simples, persistidas como chave-valor. Preferencias de
// interface que precisam sobreviver entre sessoes reutilizam esta tabela.
type AppSettingRow = { value: string };

export async function getSetting(key: string, source: DatabaseHandleSource = "loaded"): Promise<string | null> {
  const database = await getDatabase(source);
  const [row] = await database.select<AppSettingRow[]>("SELECT value FROM app_settings WHERE key = $1", [key]);
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string, source: DatabaseHandleSource = "loaded"): Promise<void> {
  const database = await getDatabase(source);
  await database.execute(
    "INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
    [key, value],
  );
}

export async function deleteSetting(key: string, source: DatabaseHandleSource = "loaded"): Promise<void> {
  const database = await getDatabase(source);
  await database.execute("DELETE FROM app_settings WHERE key = $1", [key]);
}

// Preferencia de abertura do leitor. Sem valor persistido (primeira abertura)
// o leitor abre maximizado; depois disso vale o ultimo estado escolhido pelo
// usuario no botao maximizar/restaurar.
const READER_MAXIMIZED_SETTING_KEY = "reader.maximized";

export async function getReaderOpensMaximized(source: DatabaseHandleSource = "loaded"): Promise<boolean> {
  const value = await getSetting(READER_MAXIMIZED_SETTING_KEY, source);
  return value !== "false";
}

export async function setReaderOpensMaximized(
  maximized: boolean,
  source: DatabaseHandleSource = "loaded",
): Promise<void> {
  await setSetting(READER_MAXIMIZED_SETTING_KEY, maximized ? "true" : "false", source);
}

// Material das superficies do app (eixo ortogonal ao tema claro/escuro).
// Vive em app_settings, como show_divider_lines, e nao em localStorage: e uma
// preferencia global compartilhada por todas as janelas nativas, e a emissao
// abaixo e o que as mantem em sincronia.
const MATERIAL_VARIANT_SETTING_KEY = "material_variant";

export async function getMaterialVariant(source: DatabaseHandleSource = "loaded"): Promise<MaterialVariant> {
  const value = await getSetting(MATERIAL_VARIANT_SETTING_KEY, source);
  // Sem valor persistido (ou valor invalido escrito por uma versao futura) o
  // app volta ao material historico.
  return isMaterialVariant(value) ? value : "flat";
}

// Persiste antes de emitir, na mesma ordem de setDocumentAnnotationsFilterScope:
// nenhuma janela deve pintar um material que o SQLite ainda nao confirmou.
export async function setMaterialVariant(
  material: MaterialVariant,
  source: DatabaseHandleSource = "loaded",
): Promise<void> {
  await setSetting(MATERIAL_VARIANT_SETTING_KEY, material, source);
  await emitMaterialVariantChanged(material);
}

const CHROME_VARIANT_SETTING_KEY = "chrome_variant";

// Ausencia e valor invalido preservam o estado automatico. Nao convertemos
// null em uma variante concreta porque a escolha resolvida depende do material
// e uma preferencia explicita deve voltar a valer quando o material mudar.
export async function getChromeVariant(source: DatabaseHandleSource = "loaded"): Promise<ChromeVariant | null> {
  const value = await getSetting(CHROME_VARIANT_SETTING_KEY, source);
  return isChromeVariant(value) ? value : null;
}

export async function setChromeVariant(
  value: ChromeVariant,
  source: DatabaseHandleSource = "loaded",
): Promise<void> {
  await setSetting(CHROME_VARIANT_SETTING_KEY, value, source);
}

export async function clearChromeVariant(source: DatabaseHandleSource = "loaded"): Promise<void> {
  await deleteSetting(CHROME_VARIANT_SETTING_KEY, source);
}

const GLASS_NOTICE_SEEN_SETTING_KEY = "glass_notice_seen";

// Ao contrario de chrome_variant, ausencia nao e uma preferencia distinta: ela
// quer dizer simplesmente que o aviso ainda nao foi visto. O booleano preserva
// essa semantica sem repetir a perda de estado entre ausencia e default que
// show_divider_lines sofreu; no chrome, null continua sendo um estado real.
export async function getGlassNoticeSeen(source: DatabaseHandleSource = "loaded"): Promise<boolean> {
  return (await getSetting(GLASS_NOTICE_SEEN_SETTING_KEY, source)) === "true";
}

export async function setGlassNoticeSeen(source: DatabaseHandleSource = "loaded"): Promise<void> {
  await setSetting(GLASS_NOTICE_SEEN_SETTING_KEY, "true", source);
}

// Personalizacao visual global. As chaves novas reutilizam app_settings e nao
// alteram o schema. Leitores aceitam tanto o handle carregado quanto o
// preloaded porque Reader, Caderno e pop-outs montam em WebViews independentes.
const APPEARANCE_ACCENT_LIGHT_SETTING_KEY = "appearance_accent_light";
const APPEARANCE_ACCENT_DARK_SETTING_KEY = "appearance_accent_dark";
const APPEARANCE_INTERFACE_CONTRAST_SETTING_KEY = "appearance_interface_contrast";
const APPEARANCE_TEXT_CONTRAST_SETTING_KEY = "appearance_text_contrast";
const APPEARANCE_TITLE_CONTRAST_SETTING_KEY = "appearance_title_contrast";
const APPEARANCE_GLASS_BLUR_SETTING_KEY = "appearance_glass_blur";
const APPEARANCE_NIGHT_LIGHT_SETTING_KEY = "appearance_night_light";
// A forca fica em uma chave independente para que um arraste em uma janela
// nao sobrescreva toggle/agenda alterados ao mesmo tempo em outra WebView. O
// JSON versionado continua guardando a estrutura e serve de fallback para
// perfis gravados antes da separacao.
const APPEARANCE_NIGHT_LIGHT_STRENGTH_SETTING_KEY = "appearance_night_light_strength";

function appearanceAccentSettingKey(theme: AppearanceAccentTheme): string {
  return theme === "light"
    ? APPEARANCE_ACCENT_LIGHT_SETTING_KEY
    : APPEARANCE_ACCENT_DARK_SETTING_KEY;
}

function appearanceAccentDefault(theme: AppearanceAccentTheme): HexColor {
  return theme === "light" ? DEFAULT_ACCENT_LIGHT : DEFAULT_ACCENT_DARK;
}

export async function getAppearanceAccent(
  theme: AppearanceAccentTheme,
  source: DatabaseHandleSource = "loaded",
): Promise<HexColor> {
  return normalizeHexColor(
    await getSetting(appearanceAccentSettingKey(theme), source),
    appearanceAccentDefault(theme),
  );
}

export async function getAppearanceInterfaceContrast(
  source: DatabaseHandleSource = "loaded",
): Promise<number> {
  return normalizeAppearanceContrast(
    await getSetting(APPEARANCE_INTERFACE_CONTRAST_SETTING_KEY, source),
  );
}

export async function getAppearanceTextContrast(
  source: DatabaseHandleSource = "loaded",
): Promise<number> {
  return normalizeAppearanceContrast(
    await getSetting(APPEARANCE_TEXT_CONTRAST_SETTING_KEY, source),
  );
}

export async function getStoredAppearanceContrast(
  axis: "interface" | "text",
  source: DatabaseHandleSource = "loaded",
): Promise<number | null> {
  const key = axis === "interface"
    ? APPEARANCE_INTERFACE_CONTRAST_SETTING_KEY
    : APPEARANCE_TEXT_CONTRAST_SETTING_KEY;
  const stored = await getSetting(key, source);
  return stored === null ? null : normalizeAppearanceContrast(stored);
}

export async function getAppearanceTitleContrast(
  source: DatabaseHandleSource = "loaded",
): Promise<number> {
  return normalizeAppearanceContrast(
    await getSetting(APPEARANCE_TITLE_CONTRAST_SETTING_KEY, source),
  );
}

export async function getAppearanceGlassBlur(
  source: DatabaseHandleSource = "loaded",
): Promise<number> {
  return normalizeGlassBlur(await getSetting(APPEARANCE_GLASS_BLUR_SETTING_KEY, source));
}

export async function getNightLightPreferences(
  source: DatabaseHandleSource = "loaded",
): Promise<NightLightPreferences> {
  const [preferencesRaw, strengthRaw] = await Promise.all([
    getSetting(APPEARANCE_NIGHT_LIGHT_SETTING_KEY, source),
    getSetting(APPEARANCE_NIGHT_LIGHT_STRENGTH_SETTING_KEY, source),
  ]);
  const preferences = normalizeNightLightPreferences(preferencesRaw);
  return strengthRaw === null
    ? preferences
    : { ...preferences, strength: normalizeNightLightStrength(strengthRaw) };
}

export async function getAppearancePreferencesWithPresence(
  source: DatabaseHandleSource = "loaded",
): Promise<AppearancePreferencesLoadResult> {
  const [
    accentLight,
    accentDark,
    interfaceContrastRaw,
    textContrastRaw,
    titleContrastRaw,
    glassBlurRaw,
    nightLightRaw,
    nightLightStrengthRaw,
  ] = await Promise.all([
    getSetting(APPEARANCE_ACCENT_LIGHT_SETTING_KEY, source),
    getSetting(APPEARANCE_ACCENT_DARK_SETTING_KEY, source),
    getSetting(APPEARANCE_INTERFACE_CONTRAST_SETTING_KEY, source),
    getSetting(APPEARANCE_TEXT_CONTRAST_SETTING_KEY, source),
    getSetting(APPEARANCE_TITLE_CONTRAST_SETTING_KEY, source),
    getSetting(APPEARANCE_GLASS_BLUR_SETTING_KEY, source),
    getSetting(APPEARANCE_NIGHT_LIGHT_SETTING_KEY, source),
    getSetting(APPEARANCE_NIGHT_LIGHT_STRENGTH_SETTING_KEY, source),
  ]);

  const nightLight = normalizeNightLightPreferences(nightLightRaw);

  return {
    preferences: {
      accentLight: normalizeHexColor(accentLight, DEFAULT_ACCENT_LIGHT),
      accentDark: normalizeHexColor(accentDark, DEFAULT_ACCENT_DARK),
      interfaceContrast: normalizeAppearanceContrast(interfaceContrastRaw),
      textContrast: normalizeAppearanceContrast(textContrastRaw),
      titleContrast: normalizeAppearanceContrast(titleContrastRaw),
      glassBlur: normalizeGlassBlur(glassBlurRaw),
      nightLight: nightLightStrengthRaw === null
        ? nightLight
        : { ...nightLight, strength: normalizeNightLightStrength(nightLightStrengthRaw) },
    },
    storedContrast: {
      interface: interfaceContrastRaw !== null,
      text: textContrastRaw !== null,
    },
  };
}

export async function getAppearancePreferences(
  source: DatabaseHandleSource = "loaded",
): Promise<AppearancePreferences> {
  return (await getAppearancePreferencesWithPresence(source)).preferences;
}

export async function setAppearanceAccent(
  theme: AppearanceAccentTheme,
  color: unknown,
  source: DatabaseHandleSource = "loaded",
): Promise<void> {
  if (theme !== "light" && theme !== "dark") {
    throw new Error("Tema de destaque invalido.");
  }

  const value = normalizeHexColor(color, appearanceAccentDefault(theme));
  await setSetting(appearanceAccentSettingKey(theme), value, source);
  await emitAppearancePreferenceChanged({ kind: "accent", theme, value });
}

export async function setAppearanceInterfaceContrast(
  contrast: unknown,
  source: DatabaseHandleSource = "loaded",
): Promise<void> {
  const value = normalizeAppearanceContrast(contrast);
  await setSetting(APPEARANCE_INTERFACE_CONTRAST_SETTING_KEY, String(value), source);
  await emitAppearancePreferenceChanged({ kind: "interface-contrast", value });
}

export async function setAppearanceTextContrast(
  contrast: unknown,
  source: DatabaseHandleSource = "loaded",
): Promise<void> {
  const value = normalizeAppearanceContrast(contrast);
  await setSetting(APPEARANCE_TEXT_CONTRAST_SETTING_KEY, String(value), source);
  await emitAppearancePreferenceChanged({ kind: "text-contrast", value });
}

export async function setAppearanceTitleContrast(
  contrast: unknown,
  source: DatabaseHandleSource = "loaded",
): Promise<void> {
  const value = normalizeAppearanceContrast(contrast);
  await setSetting(APPEARANCE_TITLE_CONTRAST_SETTING_KEY, String(value), source);
  await emitAppearancePreferenceChanged({ kind: "title-contrast", value });
}

export async function setAppearanceGlassBlur(
  blur: unknown,
  source: DatabaseHandleSource = "loaded",
): Promise<void> {
  const value = normalizeGlassBlur(blur);
  await setSetting(APPEARANCE_GLASS_BLUR_SETTING_KEY, String(value), source);
  await emitAppearancePreferenceChanged({ kind: "glass-blur", value });
}

export async function setNightLightPreferences(
  preferences: unknown,
  source: DatabaseHandleSource = "loaded",
): Promise<void> {
  const value = normalizeNightLightPreferences(preferences);
  const database = await getDatabase(source);
  // Uma unica instrucao mantem reset/snapshot completo atomico entre as duas
  // chaves, sem exigir comando Rust nem transacao distribuida no frontend.
  await database.execute(
    `INSERT INTO app_settings (key, value) VALUES ($1, $2), ($3, $4)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    [
      APPEARANCE_NIGHT_LIGHT_SETTING_KEY,
      serializeNightLightPreferences(value),
      APPEARANCE_NIGHT_LIGHT_STRENGTH_SETTING_KEY,
      String(value.strength),
    ],
  );
  await emitAppearancePreferenceChanged({ kind: "night-light", value });
}

function nightLightSettings(value: NightLightPreferences): NightLightSettings {
  return {
    enabled: value.enabled,
    scheduleEnabled: value.scheduleEnabled,
    startTime: value.startTime,
    endTime: value.endTime,
  };
}

export async function setNightLightStrength(
  strength: unknown,
  source: DatabaseHandleSource = "loaded",
): Promise<void> {
  const value = normalizeNightLightStrength(strength);
  await setSetting(APPEARANCE_NIGHT_LIGHT_STRENGTH_SETTING_KEY, String(value), source);
  await emitAppearancePreferenceChanged({ kind: "night-light-strength", value });
}

export async function setNightLightSettings(
  preferences: unknown,
  source: DatabaseHandleSource = "loaded",
): Promise<void> {
  const value = normalizeNightLightPreferences(preferences);
  await setSetting(
    APPEARANCE_NIGHT_LIGHT_SETTING_KEY,
    serializeNightLightPreferences(value),
    source,
  );
  await emitAppearancePreferenceChanged({
    kind: "night-light-settings",
    value: nightLightSettings(value),
  });
}

// Remapeamento de atalhos. JSON versionado em app_settings: nao ha schema novo
// e o contrato normaliza fora ids desconhecidos, atalhos fixos e bindings
// invalidos antes de qualquer uso.
const KEYBOARD_SHORTCUT_OVERRIDES_SETTING_KEY = "keyboard_shortcut_overrides";

export async function getShortcutOverrides(
  source: DatabaseHandleSource = "loaded",
): Promise<ShortcutOverrides> {
  return normalizeShortcutOverrides(
    await getSetting(KEYBOARD_SHORTCUT_OVERRIDES_SETTING_KEY, source),
  );
}

export async function setShortcutOverrides(
  overrides: unknown,
  source: DatabaseHandleSource = "loaded",
): Promise<void> {
  const value = normalizeShortcutOverrides(overrides);
  await setSetting(
    KEYBOARD_SHORTCUT_OVERRIDES_SETTING_KEY,
    serializeShortcutOverrides(value),
    source,
  );

  try {
    await emit<KeyboardShortcutsChangedPayload>(KEYBOARD_SHORTCUTS_CHANGED_EVENT, {
      overrides: value,
      origin: getCurrentWebviewWindow().label,
    });
  } catch (error) {
    // A gravacao ja terminou; a janela de origem aplica localmente e nao
    // desfaz uma operacao confirmada por falha do evento.
    console.warn("Nao foi possivel sincronizar os atalhos entre as janelas.", error);
  }
}

// Papel de parede do app. Como o material, vive em app_settings e nao em
// localStorage: e uma preferencia global, compartilhada pelas janelas nativas,
// e precisa sobreviver a uma troca feita com a janela fechada.
//
// Duas chaves, no padrao chave-valor que a tabela ja tem — nenhuma migration
// e necessaria:
//
// - wallpaper_file    -> NOME do arquivo dentro da pasta wallpaper/ do
//                        diretorio de dados. Nunca o caminho absoluto: ele
//                        muda entre maquinas e entre o perfil .dev e o de
//                        producao. Quem traduz nome -> caminho e o comando
//                        resolve_wallpaper_path, no Rust.
// - wallpaper_opacity    -> inteiro de 0 a 100, o valor do slider.
// - wallpaper_brightness -> inteiro de 50 a 150; 100 preserva a imagem.
const WALLPAPER_FILE_SETTING_KEY = "wallpaper_file";
const WALLPAPER_OPACITY_SETTING_KEY = "wallpaper_opacity";
const WALLPAPER_BRIGHTNESS_SETTING_KEY = "wallpaper_brightness";

export const MIN_WALLPAPER_OPACITY = 0;
export const MAX_WALLPAPER_OPACITY = 100;

// Meio termo: um papel de parede recem-escolhido precisa aparecer (senao o
// usuario acha que a importacao falhou), mas ele fica ATRAS das superficies do
// app e nao pode competir com o conteudo. O ajuste fino e do usuario.
export const DEFAULT_WALLPAPER_OPACITY = 50;

export const MIN_WALLPAPER_BRIGHTNESS = 50;
export const MAX_WALLPAPER_BRIGHTNESS = 150;
export const DEFAULT_WALLPAPER_BRIGHTNESS = 100;

export async function getWallpaperFile(source: DatabaseHandleSource = "loaded"): Promise<string | null> {
  const value = await getSetting(WALLPAPER_FILE_SETTING_KEY, source);
  const fileName = value?.trim() ?? "";
  return fileName.length > 0 ? fileName : null;
}

export async function setWallpaperFile(
  fileName: string,
  source: DatabaseHandleSource = "loaded",
): Promise<void> {
  await setSetting(WALLPAPER_FILE_SETTING_KEY, fileName, source);
  await emitWallpaperSettingsChanged();
}

// Apaga a linha em vez de gravar string vazia: "sem wallpaper" e a ausencia da
// chave, o mesmo estado de quem nunca escolheu uma imagem. Guardar "" criaria
// um segundo jeito de dizer a mesma coisa, que todo leitor teria de tratar.
export async function clearWallpaperFile(source: DatabaseHandleSource = "loaded"): Promise<void> {
  const database = await getDatabase(source);
  await database.execute("DELETE FROM app_settings WHERE key = $1", [WALLPAPER_FILE_SETTING_KEY]);
  await emitWallpaperSettingsChanged();
}

// Valor gravado por uma versao futura, editado a mao ou corrompido nao pode
// derrubar a tela de Ajustes: fora da faixa vira o padrao.
export function normalizeWallpaperOpacity(value: string | number | null): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(value ?? "", 10);

  if (!Number.isFinite(parsed)) {
    return DEFAULT_WALLPAPER_OPACITY;
  }

  return Math.min(MAX_WALLPAPER_OPACITY, Math.max(MIN_WALLPAPER_OPACITY, Math.round(parsed)));
}

export async function getWallpaperOpacity(source: DatabaseHandleSource = "loaded"): Promise<number> {
  return normalizeWallpaperOpacity(await getSetting(WALLPAPER_OPACITY_SETTING_KEY, source));
}

export async function setWallpaperOpacity(
  opacity: number,
  source: DatabaseHandleSource = "loaded",
): Promise<void> {
  await setSetting(
    WALLPAPER_OPACITY_SETTING_KEY,
    String(normalizeWallpaperOpacity(opacity)),
    source,
  );
  await emitWallpaperSettingsChanged();
}

export function normalizeWallpaperBrightness(value: string | number | null): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(value ?? "", 10);

  if (!Number.isFinite(parsed)) {
    return DEFAULT_WALLPAPER_BRIGHTNESS;
  }

  return Math.min(
    MAX_WALLPAPER_BRIGHTNESS,
    Math.max(MIN_WALLPAPER_BRIGHTNESS, Math.round(parsed)),
  );
}

export async function getWallpaperBrightness(source: DatabaseHandleSource = "loaded"): Promise<number> {
  return normalizeWallpaperBrightness(await getSetting(WALLPAPER_BRIGHTNESS_SETTING_KEY, source));
}

export async function setWallpaperBrightness(
  brightness: number,
  source: DatabaseHandleSource = "loaded",
): Promise<void> {
  await setSetting(
    WALLPAPER_BRIGHTNESS_SETTING_KEY,
    String(normalizeWallpaperBrightness(brightness)),
    source,
  );
  await emitWallpaperSettingsChanged();
}
