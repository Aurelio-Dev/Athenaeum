export type EditorAction =
  | "bold"
  | "italic"
  | "h1"
  | "h2"
  | "h3"
  | "unordered-list"
  | "ordered-list"
  | "blockquote"
  | "code";

export const blockActions = ["h1", "h2", "h3", "blockquote"] as const;
export type BlockAction = (typeof blockActions)[number];

export const execCommandByAction: Partial<Record<EditorAction, string>> = {
  bold: "bold",
  italic: "italic",
  "unordered-list": "insertUnorderedList",
  "ordered-list": "insertOrderedList",
};

export type ToolbarButton = {
  action: EditorAction;
  title: string;
  icon: JSX.Element;
};

const iconProps = {
  width: 15,
  height: 15,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

function BoldIcon() {
  return (
    <svg {...iconProps}>
      <path d="M7 4h7a3.5 3.5 0 0 1 0 7H7z" />
      <path d="M7 11h8a3.5 3.5 0 0 1 0 7H7z" />
      <path d="M7 4v14" />
    </svg>
  );
}

function ItalicIcon() {
  return (
    <svg {...iconProps}>
      <line x1="19" x2="10" y1="4" y2="4" />
      <line x1="14" x2="5" y1="20" y2="20" />
      <line x1="15" x2="9" y1="4" y2="20" />
    </svg>
  );
}

// H1/H2/H3 como glifos de texto (icone textual e mais legivel que um desenho
// abstrato para niveis de titulo).
function HeadingGlyph({ level }: { level: 1 | 2 | 3 }) {
  return <span className="text-[11px] font-bold leading-none">H{level}</span>;
}

function UnorderedListIcon() {
  return (
    <svg {...iconProps}>
      <line x1="9" x2="20" y1="6" y2="6" />
      <line x1="9" x2="20" y1="12" y2="12" />
      <line x1="9" x2="20" y1="18" y2="18" />
      <circle cx="4.5" cy="6" r="1" fill="currentColor" stroke="none" />
      <circle cx="4.5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="4.5" cy="18" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function OrderedListIcon() {
  return (
    <svg {...iconProps}>
      <line x1="10" x2="21" y1="6" y2="6" />
      <line x1="10" x2="21" y1="12" y2="12" />
      <line x1="10" x2="21" y1="18" y2="18" />
      <path d="M4 6h1v4" />
      <path d="M4 10h2" />
      <path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1" />
    </svg>
  );
}

function BlockquoteIcon() {
  return (
    <svg {...iconProps}>
      <path d="M9 7H6a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h1a2 2 0 0 1 2 2 4 4 0 0 1-2 3" />
      <path d="M19 7h-3a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h1a2 2 0 0 1 2 2 4 4 0 0 1-2 3" />
    </svg>
  );
}

function CodeIcon() {
  return (
    <svg {...iconProps}>
      <path d="m8 8-4 4 4 4" />
      <path d="m16 8 4 4-4 4" />
    </svg>
  );
}

export function CitationIcon() {
  return (
    <svg {...iconProps}>
      <path d="M7 8h10" />
      <path d="M7 12h6" />
      <path d="M5 19a7 7 0 1 1 4 0l-4 2z" />
    </svg>
  );
}

export function LinkIcon() {
  return (
    <svg {...iconProps}>
      <path d="M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1" />
      <path d="M14 11a5 5 0 0 0-7.1 0l-2 2A5 5 0 0 0 12 20.1l1.1-1.1" />
    </svg>
  );
}

export function AttachmentIcon() {
  return (
    <svg {...iconProps}>
      <path d="m21.4 11.6-8.5 8.5a6 6 0 0 1-8.5-8.5l8.5-8.5a4 4 0 0 1 5.7 5.7l-8.5 8.5a2 2 0 1 1-2.8-2.8l7.8-7.8" />
    </svg>
  );
}

export function AlignLeftIcon() {
  return (
    <svg {...iconProps}>
      <path d="M4 6h14" />
      <path d="M4 10h10" />
      <path d="M4 14h14" />
      <path d="M4 18h9" />
    </svg>
  );
}

export function AlignCenterIcon() {
  return (
    <svg {...iconProps}>
      <path d="M6 6h12" />
      <path d="M8 10h8" />
      <path d="M6 14h12" />
      <path d="M9 18h6" />
    </svg>
  );
}

export function AlignRightIcon() {
  return (
    <svg {...iconProps}>
      <path d="M6 6h14" />
      <path d="M10 10h10" />
      <path d="M6 14h14" />
      <path d="M11 18h9" />
    </svg>
  );
}

export function AlignJustifyIcon() {
  return (
    <svg {...iconProps}>
      <path d="M4 6h16" />
      <path d="M4 10h16" />
      <path d="M4 14h16" />
      <path d="M4 18h16" />
    </svg>
  );
}

export function PdfToolbarIcon() {
  return (
    <svg {...iconProps}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M8 14h8" />
      <path d="M8 17h5" />
    </svg>
  );
}

export function TableIcon() {
  return (
    <svg {...iconProps}>
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <path d="M4 10h16" />
      <path d="M10 5v14" />
    </svg>
  );
}

export function CalloutIcon() {
  return (
    <svg {...iconProps}>
      <path d="M5 5h14v10H8l-3 3z" />
      <path d="M9 9h6" />
      <path d="M9 12h4" />
    </svg>
  );
}

export function FigureIcon() {
  return (
    <svg {...iconProps}>
      <rect x="4" y="5" width="16" height="12" rx="2" />
      <path d="m8 14 3-3 2 2 2-3 3 4" />
      <circle cx="9" cy="9" r="1" fill="currentColor" stroke="none" />
      <path d="M7 20h10" />
    </svg>
  );
}

export function EquationIcon() {
  return (
    <svg {...iconProps}>
      <path d="M5 7h14" />
      <path d="M5 17h14" />
      <path d="M8 12h8" />
    </svg>
  );
}

export function MoreIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function ChevronDownIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export const toolbarButtons: ToolbarButton[] = [
  { action: "bold", title: "Negrito", icon: <BoldIcon /> },
  { action: "italic", title: "Itálico", icon: <ItalicIcon /> },
  { action: "h1", title: "Título 1", icon: <HeadingGlyph level={1} /> },
  { action: "h2", title: "Título 2", icon: <HeadingGlyph level={2} /> },
  { action: "h3", title: "Título 3", icon: <HeadingGlyph level={3} /> },
  { action: "unordered-list", title: "Lista com marcadores", icon: <UnorderedListIcon /> },
  { action: "ordered-list", title: "Lista numerada", icon: <OrderedListIcon /> },
  { action: "blockquote", title: "Citação", icon: <BlockquoteIcon /> },
  { action: "code", title: "Bloco de código", icon: <CodeIcon /> },
];

export const toolbarButtonGroups: ToolbarButton[][] = [
  [toolbarButtons[2], toolbarButtons[3], toolbarButtons[4]],
  [toolbarButtons[0], toolbarButtons[1]],
  [toolbarButtons[5], toolbarButtons[6]],
  [toolbarButtons[7], toolbarButtons[8]],
];
