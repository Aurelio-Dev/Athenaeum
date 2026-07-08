import { NotebookResizableFrame } from "./NotebookDiagramFrame";
import { applyFigureScale, parseFigureScale } from "./notebookDiagramScale";

type NotebookFigureImagePreviewProps = {
  src: string;
  alt: string;
};

export function NotebookFigureImagePreview({ src, alt }: NotebookFigureImagePreviewProps) {
  return (
    <NotebookResizableFrame
      blockSelector='[data-athenaeum-block="figure"][data-figure-subtype="image"]'
      scaleAttributeName="data-figure-scale"
      parseScale={parseFigureScale}
      applyScale={applyFigureScale}
      ariaLabel="Redimensionar imagem"
    >
      <img className="notebook-figure-preview-image" src={src} alt={alt} draggable={false} />
    </NotebookResizableFrame>
  );
}
