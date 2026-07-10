import { useEffect, useRef, useState } from "react";
import type { CanvasShapeType } from "./canvasScene";

// Vocabulario de ferramentas do Quadro. Alem das formas persistidas
// (CanvasShapeType), existem os modos nao-persistidos "select", "pan" e
// "eraser" (a borracha remove/corta formas, nao cria).
export type CanvasTool = "select" | "pan" | "eraser" | CanvasShapeType;

// Guarda de tipo: verdadeiro quando a ferramenta desenha uma forma.
export function isShapeTool(tool: CanvasTool): tool is CanvasShapeType {
  return tool !== "select" && tool !== "pan" && tool !== "eraser";
}

// As formas que vivem dentro do popup "Formas". A Linha fica fora (botao proprio
// na barra), como pedido no layout.
const popupShapeTools: readonly CanvasShapeType[] = ["rect", "diamond", "ellipse", "arrow"];

type CanvasToolbarProps = {
  tool: CanvasTool;
  // Ativa Selecionar, Linha ou uma forma do popup.
  onSelectTool: (tool: CanvasTool) => void;
  // Alterna o modo Mover (pan): clicar de novo (ou Esc) volta ao modo anterior.
  onTogglePan: () => void;
};

const iconBase = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

type IconProps = { size?: number };

function SelectIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} {...iconBase}>
      <path d="M5 4l6 15 2.2-6.2L19.5 10 5 4z" />
    </svg>
  );
}

function MoveIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} {...iconBase}>
      <polyline points="5 9 2 12 5 15" />
      <polyline points="9 5 12 2 15 5" />
      <polyline points="15 19 12 22 9 19" />
      <polyline points="19 9 22 12 19 15" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <line x1="12" y1="2" x2="12" y2="22" />
    </svg>
  );
}

function LineIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} {...iconBase}>
      <line x1="5" y1="19" x2="19" y2="5" />
    </svg>
  );
}

function PencilIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} {...iconBase}>
      <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
    </svg>
  );
}

function EraserIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} {...iconBase}>
      <path d="m7 21-4.3-4.3a1.5 1.5 0 0 1 0-2.1l9.6-9.6a1.5 1.5 0 0 1 2.1 0l5.6 5.6a1.5 1.5 0 0 1 0 2.1L13 19.6" />
      <path d="M21 21H7" />
      <path d="m5.5 11.5 7 7" />
    </svg>
  );
}

function TextIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} {...iconBase}>
      <path d="M5 5h14" />
      <path d="M12 5v14" />
      <path d="M8.5 19h7" />
    </svg>
  );
}

function RectIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} {...iconBase}>
      <rect x="4" y="6" width="16" height="12" rx="1.5" />
    </svg>
  );
}

function DiamondIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} {...iconBase}>
      <path d="M12 3l9 9-9 9-9-9 9-9z" />
    </svg>
  );
}

function EllipseIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} {...iconBase}>
      <ellipse cx="12" cy="12" rx="9" ry="6" />
    </svg>
  );
}

function ArrowIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} {...iconBase}>
      <line x1="5" y1="19" x2="19" y2="5" />
      <polyline points="11 5 19 5 19 13" />
    </svg>
  );
}

function ShapesIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} {...iconBase}>
      <rect x="3" y="3" width="11" height="11" rx="1.5" />
      <circle cx="16" cy="16" r="5" />
    </svg>
  );
}

function ImageIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} {...iconBase}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9" r="1.5" />
      <path d="m5 18 5-5 3 3 2-2 4 4" />
    </svg>
  );
}

function FrameIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} {...iconBase}>
      <rect x="4" y="5" width="16" height="14" rx="1" strokeDasharray="3 2" />
      <path d="M7 9h4" />
    </svg>
  );
}

function ChevronIcon({ size = 12 }: IconProps) {
  return (
    <svg width={size} height={size} {...iconBase}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

// Inclui todos os tipos (Record exige as chaves), mesmo os que nao aparecem no
// popup "Formas" (line e um botao proprio; freedraw e o Lapis).
const shapeIcons: Record<CanvasShapeType, (props: IconProps) => JSX.Element> = {
  rect: RectIcon,
  diamond: DiamondIcon,
  ellipse: EllipseIcon,
  arrow: ArrowIcon,
  line: LineIcon,
  freedraw: PencilIcon,
  text: TextIcon,
  image: ImageIcon,
  frame: FrameIcon,
};

const shapeLabels: Record<CanvasShapeType, string> = {
  rect: "Retângulo",
  diamond: "Losango",
  ellipse: "Elipse",
  arrow: "Seta",
  line: "Linha",
  freedraw: "Lápis",
  text: "Texto",
  image: "Imagem",
  frame: "Frame",
};

// Botao de ferramenta da barra. Estilo de pilula com destaque quando ativo.
function ToolButton({
  label,
  active,
  onClick,
  children,
  extra,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  extra?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={onClick}
      className={`flex h-9 items-center justify-center gap-0.5 rounded-xl px-2.5 transition ${
        active
          ? "bg-[var(--color-accent-tint-bg)] text-[var(--accent)]"
          : "text-[var(--floating-header-control)] hover:bg-[var(--floating-header-hover-bg)] hover:text-[var(--card-foreground)]"
      }`}
    >
      {children}
      {extra}
    </button>
  );
}

// Barra de ferramentas flutuante do Quadro (pilula inferior). Substitui os
// botoes temporarios V/R da Fase 2. Preparada para receber mais grupos nas
// proximas fases (3B lapis/borracha, 3C texto, 3D imagem/frame) — novos botoes
// entram apenas quando implementados, sem placeholders desabilitados.
export function CanvasToolbar({ tool, onSelectTool, onTogglePan }: CanvasToolbarProps) {
  const [isShapesOpen, setIsShapesOpen] = useState(false);
  const shapesWrapperRef = useRef<HTMLDivElement | null>(null);

  const isPopupShapeActive = isShapeTool(tool) && (popupShapeTools as readonly string[]).includes(tool);

  // Fecha o popup ao clicar fora dele ou apertar Esc.
  useEffect(() => {
    if (!isShapesOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (!shapesWrapperRef.current?.contains(event.target as Node)) {
        setIsShapesOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsShapesOpen(false);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isShapesOpen]);

  function chooseShape(shape: CanvasShapeType) {
    onSelectTool(shape);
    setIsShapesOpen(false);
  }

  return (
    <div
      className="pointer-events-auto absolute bottom-4 left-1/2 flex h-[52px] -translate-x-1/2 items-center gap-1 rounded-[28px] border border-[var(--color-border-subtle)] bg-[var(--card)] p-2 shadow-[0_10px_28px_-8px_rgba(60,36,20,0.35)]"
      // Nao deixa cliques na barra chegarem ao Stage (evitaria deselecionar/desenhar).
      onMouseDown={(event) => event.stopPropagation()}
    >
      <ToolButton label="Selecionar" active={tool === "select"} onClick={() => onSelectTool("select")}>
        <SelectIcon />
      </ToolButton>
      <ToolButton label="Mover" active={tool === "pan"} onClick={onTogglePan}>
        <MoveIcon />
      </ToolButton>

      <div className="mx-1 h-6 w-px bg-[var(--color-border-subtle)]" />

      <ToolButton label="Lápis" active={tool === "freedraw"} onClick={() => onSelectTool("freedraw")}>
        <PencilIcon />
      </ToolButton>
      <ToolButton label="Borracha" active={tool === "eraser"} onClick={() => onSelectTool("eraser")}>
        <EraserIcon />
      </ToolButton>
      <ToolButton label="Texto" active={tool === "text"} onClick={() => onSelectTool("text")}>
        <TextIcon />
      </ToolButton>
      <ToolButton label="Linha" active={tool === "line"} onClick={() => onSelectTool("line")}>
        <LineIcon />
      </ToolButton>

      <div className="relative" ref={shapesWrapperRef}>
        <button
          type="button"
          aria-label="Formas"
          title="Formas"
          aria-haspopup="true"
          aria-expanded={isShapesOpen}
          aria-pressed={isPopupShapeActive}
          onClick={() => setIsShapesOpen((current) => !current)}
          className={`flex h-9 items-center justify-center gap-0.5 rounded-xl px-2.5 transition ${
            isPopupShapeActive || isShapesOpen
              ? "bg-[var(--color-accent-tint-bg)] text-[var(--accent)]"
              : "text-[var(--floating-header-control)] hover:bg-[var(--floating-header-hover-bg)] hover:text-[var(--card-foreground)]"
          }`}
        >
          <ShapesIcon />
          <ChevronIcon />
        </button>

        {isShapesOpen ? (
          // w-max e essencial: o popup e absoluto dentro do wrapper estreito do
          // botao "Formas" (~54px). Sem largura de conteudo, as trilhas 1fr do
          // grid-cols-2 colapsariam ate caber nesse contexto, sobrepondo os botoes.
          // w-max faz o popup se medir pelo proprio conteudo (bloco 2x2 de 44px).
          <div className="absolute bottom-full left-1/2 mb-2 grid w-max -translate-x-1/2 grid-cols-2 gap-1 rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--card)] p-2 shadow-[0_10px_28px_-8px_rgba(60,36,20,0.35)]">
            {popupShapeTools.map((shape) => {
              const Icon = shapeIcons[shape];
              const active = tool === shape;
              return (
                <button
                  key={shape}
                  type="button"
                  aria-label={shapeLabels[shape]}
                  title={shapeLabels[shape]}
                  aria-pressed={active}
                  onClick={() => chooseShape(shape)}
                  className={`flex h-11 w-11 items-center justify-center rounded-xl transition ${
                    active
                      ? "bg-[var(--color-accent-tint-bg)] text-[var(--accent)]"
                      : "text-[var(--floating-header-control)] hover:bg-[var(--floating-header-hover-bg)] hover:text-[var(--card-foreground)]"
                  }`}
                >
                  <Icon size={32} />
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      <ToolButton label="Imagem" active={tool === "image"} onClick={() => onSelectTool("image")}>
        <ImageIcon />
      </ToolButton>

      <div className="mx-1 h-6 w-px bg-[var(--color-border-subtle)]" />

      <ToolButton label="Frame" active={tool === "frame"} onClick={() => onSelectTool("frame")}>
        <FrameIcon />
      </ToolButton>
    </div>
  );
}
