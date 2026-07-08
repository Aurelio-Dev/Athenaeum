import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

import { parseFigureScale } from "./notebookDiagramScale";
import {
  applyFigureDimensions,
  computeImageResize,
  figureDimensionsFromScale,
  figureMaxDimensionPx,
  figureMinDimensionPx,
  imageResizeHandles,
  readFigureDimensions,
  type FigureDimensions,
  type ImageResizeHandle,
} from "./notebookFigureDimensions";

// Frame de redimensionamento livre exclusivo de figuras de imagem: largura e
// altura independentes por oito areas (quatro cantos + quatro lados). E uma
// especializacao separada do NotebookResizableFrame (que segue proporcional
// para diagramas e equacoes); toda a estrutura visual e runtime e some na
// serializacao junto com o preview React.

const imageFigureSelector = '[data-athenaeum-block="figure"][data-figure-subtype="image"]';

type NotebookImageResizableFrameProps = {
  src: string;
  alt: string;
};

type NaturalSize = {
  width: number;
  height: number;
};

type DragState = {
  pointerId: number;
  handle: ImageResizeHandle;
  startWidth: number;
  startHeight: number;
  startX: number;
  startY: number;
  pending: FigureDimensions;
  rafId: number | null;
};

const handleCursor: Record<ImageResizeHandle, string> = {
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  nw: "nwse-resize",
  se: "nwse-resize",
};

// Reduz proporcionalmente para caber na largura util (nunca estoura o editor);
// a mesma degradacao acontece no export via aspect-ratio.
function capToWidth(dimensions: FigureDimensions, availableWidth: number | null): FigureDimensions {
  if (availableWidth === null || availableWidth <= 0 || dimensions.width <= availableWidth) {
    return dimensions;
  }

  const ratio = availableWidth / dimensions.width;
  return {
    width: Math.round(availableWidth),
    height: Math.max(1, Math.round(dimensions.height * ratio)),
  };
}

export function NotebookImageResizableFrame({ src, alt }: NotebookImageResizableFrameProps) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const activeHandleRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const naturalSizeRef = useRef<NaturalSize | null>(null);
  const frameWidthRef = useRef<number | null>(null);
  const pointerInsideRef = useRef(false);

  const [dimensions, setDimensions] = useState<FigureDimensions | null>(null);
  const [naturalSize, setNaturalSize] = useState<NaturalSize | null>(null);
  const [frameWidth, setFrameWidth] = useState<number | null>(null);
  const [isActive, setIsActive] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [isHandleFocused, setIsHandleFocused] = useState(false);

  function findFigure(): HTMLElement | null {
    const figure = frameRef.current?.closest(imageFigureSelector);
    return figure instanceof HTMLElement ? figure : null;
  }

  // Tamanho de exibicao: dimensoes explicitas -> escala legada convertida ->
  // null (tamanho natural). A escala legada nunca e persistida de novo aqui: so
  // vira largura/altura num resize real.
  function resolveDisplaySize(): FigureDimensions | null {
    const figure = findFigure();
    if (!figure) {
      return null;
    }

    const explicit = readFigureDimensions(figure);
    if (explicit) {
      return explicit;
    }

    const legacyScale = parseFigureScale(figure.dataset.figureScale);
    const natural = naturalSizeRef.current;
    if (legacyScale !== null && natural) {
      const availableWidth = frameWidthRef.current ?? natural.width;
      const baseWidth = Math.min(natural.width, availableWidth);
      const baseHeight = natural.height * (baseWidth / natural.width);
      return figureDimensionsFromScale(legacyScale, baseWidth, baseHeight);
    }

    return null;
  }

  function syncDimensionsFromFigure() {
    setDimensions(resolveDisplaySize());
  }

  function applyRuntimeSize(size: FigureDimensions) {
    const box = boxRef.current;
    if (box) {
      box.style.width = `${size.width}px`;
      box.style.height = `${size.height}px`;
    }
  }

  function commitDimensions(next: FigureDimensions, updateReactState = true) {
    const figure = findFigure();
    if (!figure) {
      return;
    }

    applyFigureDimensions(figure, next);
    // Primeiro resize migra a escala legada para o novo formato.
    delete figure.dataset.figureScale;
    figure.dispatchEvent(new Event("input", { bubbles: true }));
    if (updateReactState) {
      setDimensions(next);
    }
  }

  function getCurrentSize(): FigureDimensions | null {
    const box = boxRef.current;
    if (box) {
      const rect = box.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        return { width: rect.width, height: rect.height };
      }
    }

    return dimensions ?? naturalSizeRef.current;
  }

  function finishActiveDrag(updateReactState = true) {
    const dragState = dragStateRef.current;
    if (!dragState) {
      return;
    }

    if (dragState.rafId !== null) {
      cancelAnimationFrame(dragState.rafId);
      applyRuntimeSize(dragState.pending);
    }

    const activeHandle = activeHandleRef.current;
    if (activeHandle?.hasPointerCapture(dragState.pointerId)) {
      activeHandle.releasePointerCapture(dragState.pointerId);
    }

    dragStateRef.current = null;
    activeHandleRef.current = null;

    if (updateReactState) {
      setIsResizing(false);
    }

    // Commit unico ao final da interacao (nunca durante o pointermove).
    commitDimensions(dragState.pending, updateReactState);
  }

  useEffect(() => {
    const frame = frameRef.current;
    const image = imageRef.current;
    if (!frame || !image) {
      return;
    }

    const figure = findFigure();

    function readNaturalFromImage(target: HTMLImageElement) {
      if (target.naturalWidth > 0 && target.naturalHeight > 0) {
        const next = { width: target.naturalWidth, height: target.naturalHeight };
        naturalSizeRef.current = next;
        setNaturalSize((previous) =>
          previous && previous.width === next.width && previous.height === next.height ? previous : next,
        );
        syncDimensionsFromFigure();
      }
    }

    readNaturalFromImage(image);
    function handleImageLoad() {
      const current = imageRef.current;
      if (current) {
        readNaturalFromImage(current);
      }
    }
    image.addEventListener("load", handleImageLoad);

    const frameObserver = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (typeof width === "number") {
        const rounded = Math.round(width);
        frameWidthRef.current = rounded;
        setFrameWidth(rounded);
      }
    });
    frameObserver.observe(frame);

    const attributeObserver = figure
      ? new MutationObserver(() => syncDimensionsFromFigure())
      : null;
    attributeObserver?.observe(figure as HTMLElement, {
      attributes: true,
      attributeFilter: ["data-figure-width", "data-figure-height", "data-figure-scale"],
    });

    syncDimensionsFromFigure();

    function handleDocumentPointerDown(event: Event) {
      const target = event.target;
      const inside = Boolean(figure && target instanceof Node && figure.contains(target));
      pointerInsideRef.current = inside;
      setIsActive(inside);
    }

    function handleDocumentFocusIn(event: Event) {
      if (!figure) {
        return;
      }

      const focusInside = event.target instanceof Node && figure.contains(event.target);
      if (focusInside) {
        setIsActive(true);
        return;
      }

      pointerInsideRef.current = false;
      setIsActive(false);
    }

    function finishBecauseInteractionWasInterrupted() {
      finishActiveDrag();
      pointerInsideRef.current = false;
      setIsActive(false);
    }

    function handleVisibilityChange() {
      if (document.visibilityState !== "visible") {
        finishBecauseInteractionWasInterrupted();
      }
    }

    document.addEventListener("pointerdown", handleDocumentPointerDown, true);
    document.addEventListener("focusin", handleDocumentFocusIn);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("blur", finishBecauseInteractionWasInterrupted);

    return () => {
      finishActiveDrag(false);
      image.removeEventListener("load", handleImageLoad);
      frameObserver.disconnect();
      attributeObserver?.disconnect();
      document.removeEventListener("pointerdown", handleDocumentPointerDown, true);
      document.removeEventListener("focusin", handleDocumentFocusIn);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("blur", finishBecauseInteractionWasInterrupted);
    };
    // O frame monta uma vez por preview runtime; os callbacks sao estaveis.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleHandlePointerDown(event: PointerEvent<HTMLDivElement>, handle: ImageResizeHandle) {
    const box = boxRef.current;
    const figure = findFigure();
    if (!box || !figure) {
      return;
    }

    const rect = box.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    activeHandleRef.current = event.currentTarget;

    dragStateRef.current = {
      pointerId: event.pointerId,
      handle,
      startWidth: rect.width,
      startHeight: rect.height,
      startX: event.clientX,
      startY: event.clientY,
      pending: { width: Math.round(rect.width), height: Math.round(rect.height) },
      rafId: null,
    };
    setIsResizing(true);
  }

  function handleHandlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const dragState = dragStateRef.current;
    if (!dragState || event.pointerId !== dragState.pointerId) {
      return;
    }

    dragState.pending = computeImageResize({
      handle: dragState.handle,
      startWidth: dragState.startWidth,
      startHeight: dragState.startHeight,
      deltaX: event.clientX - dragState.startX,
      deltaY: event.clientY - dragState.startY,
      // Shift avaliado a cada movimento: da para travar/soltar a proporcao no meio do drag.
      preserveAspect: event.shiftKey,
      maxWidth: frameWidthRef.current,
    });

    if (dragState.rafId !== null) {
      return;
    }

    dragState.rafId = requestAnimationFrame(() => {
      dragState.rafId = null;
      applyRuntimeSize(dragState.pending);
    });
  }

  function finishDrag(event: PointerEvent<HTMLDivElement>) {
    const dragState = dragStateRef.current;
    if (!dragState || event.pointerId !== dragState.pointerId) {
      return;
    }

    finishActiveDrag();
  }

  function handleHandleDoubleClick() {
    const figure = findFigure();
    if (!figure) {
      return;
    }

    // Duplo clique volta ao tamanho natural (remove dimensoes e escala legada).
    applyFigureDimensions(figure, null);
    delete figure.dataset.figureScale;
    figure.dispatchEvent(new Event("input", { bubbles: true }));
    setDimensions(null);
  }

  function handleHandleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.currentTarget.blur();
      pointerInsideRef.current = false;
      setIsActive(false);
      return;
    }

    const current = getCurrentSize();
    if (!current) {
      return;
    }

    const step = event.shiftKey ? 40 : 10;
    let deltaX = 0;
    let deltaY = 0;
    if (event.key === "ArrowRight") {
      deltaX = step;
    } else if (event.key === "ArrowLeft") {
      deltaX = -step;
    } else if (event.key === "ArrowDown") {
      deltaY = step;
    } else if (event.key === "ArrowUp") {
      deltaY = -step;
    } else {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    commitDimensions(
      computeImageResize({
        handle: "se",
        startWidth: current.width,
        startHeight: current.height,
        deltaX,
        deltaY,
        preserveAspect: false,
        maxWidth: frameWidthRef.current,
      }),
    );
  }

  const effective = dimensions ? capToWidth(dimensions, frameWidth) : null;
  const boxStyle: CSSProperties = effective
    ? { width: `${effective.width}px`, height: `${effective.height}px` }
    : {};
  const imageStyle: CSSProperties = effective
    ? { width: "100%", height: "100%" }
    : { maxWidth: "100%", height: "auto" };
  const showHandles = isActive || isHandleFocused || isResizing;
  const ariaValueText = effective ? `${effective.width} por ${effective.height} pixels` : "tamanho natural";

  return (
    <div
      ref={frameRef}
      className="notebook-image-frame"
      data-frame-active={showHandles ? "true" : undefined}
      data-frame-resizing={isResizing ? "true" : undefined}
    >
      <div ref={boxRef} className="notebook-image-frame-box" style={boxStyle} contentEditable={false}>
        <img ref={imageRef} className="notebook-figure-preview-image" src={src} alt={alt} draggable={false} style={imageStyle} />
        {imageResizeHandles.map((handle) => (
          <div
            key={handle}
            role="slider"
            tabIndex={0}
            contentEditable={false}
            className="notebook-image-resize-handle"
            data-handle-side={handle}
            aria-label="Redimensionar imagem"
            aria-valuemin={figureMinDimensionPx}
            aria-valuemax={figureMaxDimensionPx}
            aria-valuenow={effective?.width ?? 0}
            aria-valuetext={ariaValueText}
            style={{ cursor: handleCursor[handle] }}
            onPointerDown={(event) => handleHandlePointerDown(event, handle)}
            onPointerMove={handleHandlePointerMove}
            onPointerUp={finishDrag}
            onPointerCancel={finishDrag}
            onDoubleClick={handleHandleDoubleClick}
            onKeyDown={handleHandleKeyDown}
            onFocus={() => setIsHandleFocused(true)}
            onBlur={() => setIsHandleFocused(false)}
          />
        ))}
      </div>
    </div>
  );
}
