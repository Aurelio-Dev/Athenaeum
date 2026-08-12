import { Copy, Highlighter, MessageSquareText, Underline } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import {
  highlightColors,
  isHighlightColor,
  type AnnotationMarkStyle,
  type HighlightColor,
} from "../../types/annotation";
import type { SelectionAnchor } from "./anchor";
import { highlightPalette } from "./highlightPalette";

type SelectionToolbarProps = {
  anchor: SelectionAnchor;
  onApplyMark: (style: AnnotationMarkStyle, color: HighlightColor) => void;
  onAnotar: () => void;
  onCopy: () => void;
};

type MarkTool = AnnotationMarkStyle;

const highlightStorageKey = "athenaeum:last-highlight-color";

// Memoria efemera do WebView: sobrevive a novas selecoes, mas nao cria uma
// preferencia persistente entre sessoes do aplicativo.
let lastUnderlineColorInReaderSession: HighlightColor = highlightColors[0];

function readLastHighlightColor(): HighlightColor {
  const storedColor = window.localStorage.getItem(highlightStorageKey);
  return storedColor && isHighlightColor(storedColor) ? storedColor : highlightColors[0];
}

type ToolButtonProps = {
  label: string;
  icon: ReactNode;
  active?: boolean;
  onClick: () => void;
};

function ToolButton({ label, icon, active, onClick }: ToolButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold transition ${
        active
          ? "bg-white/10 text-white"
          : "text-[#9E8878] hover:bg-white/5 hover:text-white"
      }`}
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

// Toolbar flutuante que aparece sobre o texto selecionado. Posicao `fixed`
// usando coordenadas de viewport vindas do bounding rect da selecao.
export function SelectionToolbar({ anchor, onApplyMark, onAnotar, onCopy }: SelectionToolbarProps) {
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const [activeTool, setActiveTool] = useState<MarkTool | null>(null);
  const [paletteTool, setPaletteTool] = useState<MarkTool | null>(null);
  const [lastHighlightColor, setLastHighlightColor] = useState<HighlightColor>(readLastHighlightColor);
  const [lastUnderlineColor, setLastUnderlineColor] = useState<HighlightColor>(
    lastUnderlineColorInReaderSession,
  );

  function colorForTool(tool: MarkTool) {
    return tool === "highlight" ? lastHighlightColor : lastUnderlineColor;
  }

  function selectTool(tool: MarkTool) {
    if (activeTool === tool) {
      setPaletteTool(tool);
      return;
    }

    onApplyMark(tool, colorForTool(tool));
    setActiveTool(tool);
    setPaletteTool(null);
  }

  function selectColor(color: HighlightColor) {
    if (!paletteTool) {
      return;
    }

    const currentColor = colorForTool(paletteTool);
    if (color !== currentColor) {
      if (paletteTool === "highlight") {
        setLastHighlightColor(color);
        window.localStorage.setItem(highlightStorageKey, color);
      } else {
        setLastUnderlineColor(color);
        lastUnderlineColorInReaderSession = color;
      }
      onApplyMark(paletteTool, color);
    }

    setActiveTool(paletteTool);
    setPaletteTool(null);
  }

  return (
    <div
      ref={toolbarRef}
      role="toolbar"
      aria-label="Ferramentas da seleção"
      className="fixed z-[60] flex items-center gap-2 rounded-xl bg-[var(--surface-elevated)] px-3 py-2 shadow-2xl ring-1 ring-white/10"
      style={{
        top: anchor.top,
        left: anchor.left + anchor.width / 2,
        transform: "translate(-50%, calc(-100% - 8px))",
      }}
      // Impede que clicar na toolbar limpe a selecao antes da acao rodar.
      onMouseDown={(event) => event.preventDefault()}
    >
      {paletteTool ? (
        <div className="flex items-center gap-2" aria-label={`Cores de ${paletteTool === "highlight" ? "Marca-texto" : "Sublinhar"}`}>
          {highlightColors.map((color) => {
            const palette = highlightPalette[color];
            const isSelected = color === colorForTool(paletteTool);

            return (
              <button
                key={color}
                type="button"
                aria-label={`${palette.label} para ${paletteTool === "highlight" ? "Marca-texto" : "Sublinhar"}`}
                aria-pressed={isSelected}
                title={palette.label}
                className={`h-5 w-5 rounded-full transition ${
                  isSelected
                    ? "ring-2 ring-white ring-offset-2 ring-offset-[var(--surface-elevated)]"
                    : "hover:scale-110"
                }`}
                style={{ backgroundColor: palette.bg }}
                onClick={() => selectColor(color)}
              />
            );
          })}
        </div>
      ) : (
        <div className="flex items-center gap-1">
          <ToolButton
            label="Marca-texto"
            icon={<Highlighter size={18} aria-hidden="true" />}
            active={activeTool === "highlight"}
            onClick={() => selectTool("highlight")}
          />
          <ToolButton
            label="Sublinhar"
            icon={<Underline size={18} aria-hidden="true" />}
            active={activeTool === "underline"}
            onClick={() => selectTool("underline")}
          />
          <ToolButton
            label="Anotar"
            icon={<MessageSquareText size={18} aria-hidden="true" />}
            onClick={onAnotar}
          />
        </div>
      )}

      <div className="h-6 w-px bg-white/10" aria-hidden="true" />

      <ToolButton
        label="Copiar"
        icon={<Copy size={18} aria-hidden="true" />}
        onClick={onCopy}
      />
    </div>
  );
}
