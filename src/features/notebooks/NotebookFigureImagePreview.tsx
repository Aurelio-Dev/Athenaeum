import { NotebookImageResizableFrame } from "./NotebookImageResizableFrame";

type NotebookFigureImagePreviewProps = {
  src: string;
  alt: string;
};

// Imagens usam resize livre (largura e altura independentes); diagramas e
// equacoes continuam no NotebookResizableFrame proporcional.
export function NotebookFigureImagePreview({ src, alt }: NotebookFigureImagePreviewProps) {
  return <NotebookImageResizableFrame src={src} alt={alt} />;
}
