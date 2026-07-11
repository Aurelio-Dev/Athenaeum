import type { CanvasShapeType } from "./canvasScene";
import type { CanvasTool } from "./CanvasToolbar";

export type CanvasPropertiesSections = {
  cor: boolean;
  traco: boolean;
  preenchimento: boolean;
};

const completeSections: CanvasPropertiesSections = { cor: true, traco: true, preenchimento: true };
const strokeSections: CanvasPropertiesSections = { cor: true, traco: true, preenchimento: false };
const textSections: CanvasPropertiesSections = { cor: true, traco: false, preenchimento: false };

// O mesmo mapeamento atende tanto uma forma selecionada quanto a ferramenta
// ativa, pois as ferramentas de desenho reutilizam os tipos persistidos.
export function getCanvasPropertiesSections(
  target: CanvasShapeType | CanvasTool,
): CanvasPropertiesSections | null {
  switch (target) {
    case "rect":
    case "diamond":
    case "ellipse":
      return completeSections;
    case "arrow":
    case "line":
    case "freedraw":
      return strokeSections;
    case "text":
      return textSections;
    case "image":
    case "frame":
    case "select":
    case "pan":
    case "eraser":
      return null;
    default: {
      const exhaustive: never = target;
      return exhaustive;
    }
  }
}
