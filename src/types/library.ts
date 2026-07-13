export type Tone = "violet" | "indigo" | "blue" | "teal" | "rose" | "amber";

export type SubjectTag = string;

export type DocumentStatus =
  | "in-progress"
  | "completed"
  | "not-started"
  | "error"
  | "trashed";

export type ReadingLocation = {
  scrollTop: number;
  scrollRatio: number;
  scrollMax: number;
  canMeasure: boolean;
  page: number;
  pageOffset: number;
  zoom: number;
  savedAt: string;
};

export type LibraryDocument = {
  id: string;
  title: string;
  description: string;
  authors: string[];
  source: string;
  year: number;
  tags: SubjectTag[];
  status: DocumentStatus;
  progress: number;
  favorite: boolean;
  collection: string;
  updatedAt: string;
  lastOpenedAt?: string;
  deletedAt?: string;
  fileName?: string;
  filePath?: string;
  fileUrl?: string;
  readingLocation?: ReadingLocation;
  notes?: string;
  timeSpentSeconds: number;
};

export type ReaderDocumentDetails = Pick<
  LibraryDocument,
  | "id"
  | "title"
  | "description"
  | "authors"
  | "source"
  | "year"
  | "tags"
  | "status"
  | "progress"
  | "favorite"
  | "fileName"
  | "readingLocation"
  | "lastOpenedAt"
>;

export type LibraryCollection = {
  id: string;
  name: string;
  color: string;
  description: string;
};

// Caderno de anotacoes pertencente a uma colecao. pageCount e updatedAt
// (ultima edicao, considerando tambem as paginas) chegam agregados pela
// query de listagem — nao sao colunas diretas da tabela notebooks.
export type Notebook = {
  id: number;
  collectionId: string;
  title: string;
  pageCount: number;
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
};

// Quadro (whiteboard) de uma colecao. So os metadados por enquanto — o schema
// do conteudo sera definido quando a biblioteca de canvas for escolhida.
export type Canvas = {
  id: number;
  collectionId: string;
  title: string;
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
};

// Pagina de um caderno. title e null quando o usuario nunca renomeou — o
// fallback "Pagina sem titulo N" e calculado na UI a partir de position, nunca
// persistido como texto generico.
export type NotebookPage = {
  id: number;
  notebookId: number;
  title: string | null;
  content: string;
  position: number;
  createdAt: string;
  updatedAt: string;
};

export type ExtractedPdfMetadata = {
  title: string;
  authors: string;
  source: string;
  year: string;
};

export type SortMode = "recentes" | "titulo" | "progresso";

// Layout da listagem de documentos: grade de cards ou linhas horizontais.
export type ViewMode = "grid" | "list";

export type LibraryRoute =
  | { type: "all" }
  | { type: "recent" }
  | { type: "reading-list" }
  | { type: "favorites" }
  | { type: "collection"; collectionName: string }
  | { type: "trash" };
