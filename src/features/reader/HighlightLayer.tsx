import type { Annotation, AnnotationSaveState } from "../../types/annotation";
import { highlightPalette } from "./highlightPalette";

type HighlightLayerProps = {
  // Anotacoes desta pagina.
  annotations: Annotation[];
  // Estado de persistencia por id de anotacao.
  saveStates: Map<string, AnnotationSaveState>;
  // Re-tenta persistir uma anotacao que falhou ao salvar.
  onRetry: (annotationId: string) => void;
  // Abre o editor de nota da anotacao (clique no highlight).
  onSelect: (annotation: Annotation) => void;
};

function AlertIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    </svg>
  );
}

// Desenha os highlights sobre a pagina. Os retangulos sao pointer-events-none
// para nao atrapalhar a selecao — so o emblema de "nao salvo" captura clique.
//
// IMPORTANTE: o container NAO pode ter z-index nem opacity, e os rects nao podem
// ter opacity. Qualquer um desses cria um stacking context que ISOLA o
// mix-blend-multiply, fazendo o ambar virar cor solida em vez de marca-texto.
// Sem isolamento, o multiply blenda com o canvas (texto preto continua legivel).
//
// Posicionamento por porcentagem: como os rects sao fracoes 0..1 do tamanho da
// pagina, left/top/width/height em % caem certo em qualquer zoom sem precisar
// saber o tamanho em pixels.
export function HighlightLayer({ annotations, saveStates, onRetry, onSelect }: HighlightLayerProps) {
  if (annotations.length === 0) {
    return null;
  }

  return (
    <div className="pointer-events-none absolute inset-0">
      {annotations.map((annotation) => {
        const isUnsaved = (saveStates.get(annotation.id) ?? "saved") === "unsaved";
        const firstRect = annotation.rects[0];
        const palette = highlightPalette[annotation.color];

        return (
          <div key={annotation.id}>
            {annotation.rects.map((rect, index) => (
              // pointer-events-auto so para o clique abrir o editor; o container
              // continua none para nao bloquear a selecao de texto fora do highlight.
              <button
                key={index}
                type="button"
                aria-label="Abrir anotacao"
                className={`pointer-events-auto absolute cursor-pointer ${
                  isUnsaved ? "outline-dashed outline-2 outline-status-red-text" : ""
                }`}
                style={{
                  left: `${rect.x * 100}%`,
                  top: `${rect.y * 100}%`,
                  width: `${rect.w * 100}%`,
                  height: `${rect.h * 100}%`,
                  backgroundColor: palette.bg,
                  opacity: 0.3,
                }}
                onClick={() => onSelect(annotation)}
              />
            ))}

            {isUnsaved && firstRect ? (
              <button
                type="button"
                className="pointer-events-auto absolute z-[6] inline-flex items-center gap-1 rounded-md bg-status-red px-1.5 py-1 text-xs font-bold text-status-red-text shadow-card"
                style={{
                  left: `${firstRect.x * 100}%`,
                  top: `${firstRect.y * 100}%`,
                  transform: "translateY(-115%)",
                }}
                title="Falha ao salvar. Clique para tentar novamente."
                onClick={() => onRetry(annotation.id)}
              >
                <AlertIcon />
                Tentar novamente
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
