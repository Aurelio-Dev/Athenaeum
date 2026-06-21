import type { SelectionAnchor } from "./anchor";

type SelectionToolbarProps = {
  anchor: SelectionAnchor;
  onHighlight: () => void;
  onComment: () => void;
  onCopy: () => void;
};

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

function HighlighterIcon() {
  return (
    <svg {...iconProps}>
      <path d="m9 11-6 6v3h3l6-6" />
      <path d="m13 7 4 4" />
      <path d="m21 3-5 5-8 8 4 4 8-8 5-5a2.83 2.83 0 0 0-4-4z" />
    </svg>
  );
}

function CommentIcon() {
  return (
    <svg {...iconProps}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <path d="M12 8v4" />
      <path d="M10 10h4" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg {...iconProps}>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function SparkleIcon() {
  return (
    <svg {...iconProps}>
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
    </svg>
  );
}

// Toolbar flutuante que aparece sobre o texto selecionado. Posicao `fixed`
// usando coordenadas de viewport vindas do bounding rect da selecao.
export function SelectionToolbar({ anchor, onHighlight, onComment, onCopy }: SelectionToolbarProps) {
  return (
    <div
      className="fixed z-[60] flex items-center gap-1 rounded-xl bg-surface-elevated p-1.5 shadow-2xl ring-1 ring-sidebar-border"
      style={{
        top: anchor.top,
        left: anchor.left + anchor.width / 2,
        transform: "translate(-50%, calc(-100% - 8px))",
      }}
      // Impede que clicar na toolbar limpe a selecao antes da acao rodar.
      onMouseDown={(event) => event.preventDefault()}
    >
      <button
        type="button"
        aria-label="Marcar"
        title="Marcar"
        className="rounded-lg p-1.5 text-accent-icon-amber hover:bg-sidebar-raised"
        onClick={onHighlight}
      >
        <HighlighterIcon />
      </button>
      <button
        type="button"
        aria-label="Comentar"
        title="Comentar"
        className="rounded-lg p-1.5 text-sidebar-text hover:bg-sidebar-raised"
        onClick={onComment}
      >
        <CommentIcon />
      </button>
      <button
        type="button"
        aria-label="Copiar"
        title="Copiar"
        className="rounded-lg p-1.5 text-sidebar-text hover:bg-sidebar-raised"
        onClick={onCopy}
      >
        <CopyIcon />
      </button>

      <div className="mx-0.5 h-6 w-px bg-sidebar-border" />

      <button
        type="button"
        aria-label="Perguntar a IA (em breve)"
        title="Perguntar a IA (em breve)"
        className="cursor-not-allowed rounded-lg p-1.5 text-sidebar-muted"
        disabled
      >
        <SparkleIcon />
      </button>
    </div>
  );
}
