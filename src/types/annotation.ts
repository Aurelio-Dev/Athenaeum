// Tipos da tela de leitura: highlights e comentarios ancorados ao PDF.

// Por enquanto a unica cor de highlight validada para este uso e Amber.
// Se no futuro abrirmos para mais cores, a extensao natural sao os tons ja
// validados em WCAG AA (violet/indigo/blue/teal/rose) — nunca cores novas sem
// validar contraste, e nunca green (reservado a status "concluido").
export type HighlightColor = "amber";

// Retangulo normalizado em fracoes 0..1 do tamanho da pagina renderizada.
// Independente de zoom/DPR/tamanho de janela: para desenhar, basta multiplicar
// por largura/altura atuais da pagina.
export type NormalizedRect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type Annotation = {
  id: string;
  documentId: string;
  // Pagina 1-based onde a anotacao vive.
  page: number;
  color: HighlightColor;
  // Texto exato selecionado (para a lista do painel, copiar e verificacao).
  selectedText: string;
  // Comentario do usuario. "" = highlight puro, sem comentario.
  note: string;
  // Geometria do highlight (um ou mais retangulos para selecao multilinha).
  rects: NormalizedRect[];
  createdAt: string;
  updatedAt: string;
};

// Estado de persistencia de uma anotacao na UI. Uma anotacao recem-criada fica
// "saving" ate o banco confirmar; se a escrita falhar vira "unsaved" (visivel
// com indicador de alerta + opcao de retry), nunca some silenciosamente.
export type AnnotationSaveState = "saved" | "saving" | "unsaved";
