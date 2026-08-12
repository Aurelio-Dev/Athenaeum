// Marcador de pagina associado a um documento do Reader.
export interface DocumentBookmark {
  id: string;
  documentId: string;
  pageNumber: number;
  label: string | null;
  createdAt: string;
}
