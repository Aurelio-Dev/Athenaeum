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
  authors: string[];
  source: string;
  year: number;
  tags: SubjectTag[];
  status: DocumentStatus;
  progress: number;
  favorite: boolean;
  collection: string;
  updatedAt: string;
  deletedAt?: string;
  fileName?: string;
  filePath?: string;
  fileUrl?: string;
  readingLocation?: ReadingLocation;
  notes?: string;
  timeSpentSeconds: number;
};

export type LibraryCollection = {
  id: string;
  name: string;
  color: string;
  description: string;
};

export type ExtractedPdfMetadata = {
  title: string;
  authors: string;
  source: string;
  year: string;
};

export type SortMode = "recentes" | "titulo" | "progresso";
export type StatusFilter = "all" | DocumentStatus;

export type LibraryRoute =
  | { type: "all" }
  | { type: "recent" }
  | { type: "favorites" }
  | { type: "collection"; collectionName: string }
  | { type: "trash" };
