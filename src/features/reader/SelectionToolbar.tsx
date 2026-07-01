import { useEffect, useRef, useState } from "react";
import { highlightColors, isHighlightColor, type HighlightColor } from "../../types/annotation";
import type { SelectionAnchor } from "./anchor";
import { highlightPalette } from "./highlightPalette";

type SelectionToolbarProps = {
  anchor: SelectionAnchor;
  onHighlight: (color: HighlightColor) => void;
  onComment: (color: HighlightColor) => void;
  onCopy: () => void;
};

const highlightStorageKey = "athenaeum:last-highlight-color";

const iconProps = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

function CopyIcon() {
  return (
    <svg {...iconProps}>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

// Toolbar flutuante que aparece sobre o texto selecionado. Posicao `fixed`
// usando coordenadas de viewport vindas do bounding rect da selecao.
export function SelectionToolbar({ anchor, onHighlight, onCopy }: SelectionToolbarProps) {
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const [activeColor, setActiveColor] = useState<HighlightColor>(() => {
    const storedColor = window.localStorage.getItem(highlightStorageKey);
    return storedColor && isHighlightColor(storedColor) ? storedColor : "amber";
  });

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (!toolbarRef.current?.contains(event.target as Node)) {
        return;
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  function selectHighlightColor(color: HighlightColor) {
    setActiveColor(color);
    window.localStorage.setItem(highlightStorageKey, color);
    onHighlight(color);
  }

  return (
    <div
      ref={toolbarRef}
      className="fixed z-[60] flex items-center gap-3 rounded-xl bg-[var(--surface-elevated)] px-3 py-2 shadow-2xl ring-1 ring-white/10"
      style={{
        top: anchor.top,
        left: anchor.left + anchor.width / 2,
        transform: "translate(-50%, calc(-100% - 8px))",
      }}
      // Impede que clicar na toolbar limpe a selecao antes da acao rodar.
      onMouseDown={(event) => event.preventDefault()}
    >
      <div className="flex items-center gap-2">
        {highlightColors.map((color) => {
          const palette = highlightPalette[color];
          const isActive = color === activeColor;

          return (
            <button
              key={color}
              type="button"
              aria-label={`Marcar com ${palette.label}`}
              title={palette.label}
              className={`h-5 w-5 rounded-full transition ${isActive ? "ring-2 ring-white ring-offset-2 ring-offset-[var(--surface-elevated)]" : "hover:scale-110"}`}
              style={{ backgroundColor: palette.bg }}
              onClick={() => selectHighlightColor(color)}
            />
          );
        })}
      </div>

      <div className="h-6 w-px bg-white/10" />

      <button
        type="button"
        aria-label="Copiar"
        title="Copiar"
        className="rounded-lg p-1.5 text-[#9E8878] transition hover:bg-white/5 hover:text-white"
        onClick={onCopy}
      >
        <CopyIcon />
      </button>
    </div>
  );
}
