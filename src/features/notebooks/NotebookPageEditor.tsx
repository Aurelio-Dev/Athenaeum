import { useCallback, useEffect, useRef, useState } from "react";
import { findEnclosingTag, wrapSelectionInCode } from "../reader/richTextShared";

// Editor block-aware das paginas de caderno. Diferente do editor de Notas do
// leitor (inline-only, Enter = <br>), aqui os blocos nativos do browser sao
// bem-vindos: H1-H3, listas e citacao SAO blocos, entao o Enter padrao
// (novo <div>/<li>) e o comportamento correto. Os helpers de baixo nivel
// (bloco de codigo, busca de ancestral) vem de richTextShared.
type EditorAction =
  | "bold"
  | "italic"
  | "h1"
  | "h2"
  | "h3"
  | "unordered-list"
  | "ordered-list"
  | "blockquote"
  | "code";

const blockActions = ["h1", "h2", "h3", "blockquote"] as const;
type BlockAction = (typeof blockActions)[number];

function isBlockAction(action: EditorAction): action is BlockAction {
  return (blockActions as readonly string[]).includes(action);
}

const execCommandByAction: Partial<Record<EditorAction, string>> = {
  bold: "bold",
  italic: "italic",
  "unordered-list": "insertUnorderedList",
  "ordered-list": "insertOrderedList",
};

type ToolbarButton = {
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

const toolbarButtons: ToolbarButton[] = [
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

type NotebookPageEditorProps = {
  // O componente carrega initialContent UMA vez (mount). O pai troca de pagina
  // remontando via key={page.id} — sem sincronizacao externa de conteudo.
  initialContent: string;
  contentInsetClassName?: string;
  onContentChange: (html: string) => void;
  onBlur: () => void;
};

export function NotebookPageEditor({ initialContent, contentInsetClassName = "pl-16", onContentChange, onBlur }: NotebookPageEditorProps) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const [activeActions, setActiveActions] = useState<Set<EditorAction>>(new Set());
  const [isEmpty, setIsEmpty] = useState(
    initialContent.replace(/<[^>]*>/g, "").trim().length === 0,
  );

  const syncActiveActions = useCallback(() => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    const isSelectionInEditor = Boolean(
      editor && selection && selection.rangeCount > 0 && selection.anchorNode && editor.contains(selection.anchorNode),
    );

    if (!isSelectionInEditor || !editor || !selection) {
      setActiveActions(new Set());
      return;
    }

    const nextActive = new Set<EditorAction>();

    (Object.keys(execCommandByAction) as EditorAction[]).forEach((action) => {
      const command = execCommandByAction[action];
      if (command && document.queryCommandState(command)) {
        nextActive.add(action);
      }
    });

    // Blocos (h1/h2/h3/blockquote) nao tem queryCommandState confiavel;
    // queryCommandValue("formatBlock") informa a tag do bloco atual.
    const currentBlock = document.queryCommandValue("formatBlock").toLowerCase();
    blockActions.forEach((action) => {
      if (currentBlock === action) {
        nextActive.add(action);
      }
    });

    if (findEnclosingTag(selection.anchorNode, "code", editor)) {
      nextActive.add("code");
    }

    setActiveActions(nextActive);
  }, []);

  // Conteudo inicial carregado uma unica vez — ver comentario nas props.
  useEffect(() => {
    const editor = editorRef.current;
    if (editor) {
      editor.innerHTML = initialContent;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    document.addEventListener("selectionchange", syncActiveActions);
    return () => document.removeEventListener("selectionchange", syncActiveActions);
  }, [syncActiveActions]);

  function emitChange() {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    setIsEmpty((editor.textContent ?? "").trim().length === 0);
    onContentChange(editor.innerHTML);
  }

  function applyAction(action: EditorAction) {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    editor.focus();
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return;
    }

    if (action === "code") {
      // Bloco de codigo exige um trecho selecionado para envolver.
      if (selection.isCollapsed) {
        return;
      }
      wrapSelectionInCode(selection, editor);
    } else if (isBlockAction(action)) {
      // Toggle: reaplicar o mesmo bloco volta para paragrafo comum (<div>,
      // o separador padrao do Chromium/WebView2 em contentEditable).
      const currentBlock = document.queryCommandValue("formatBlock").toLowerCase();
      document.execCommand("formatBlock", false, currentBlock === action ? "<div>" : `<${action}>`);
    } else {
      const command = execCommandByAction[action];
      if (command) {
        document.execCommand(command, false);
      }
    }

    emitChange();
    syncActiveActions();
  }

  // Cola apenas texto puro: mesma sanitizacao pratica do editor de Notas.
  function handlePaste(event: React.ClipboardEvent<HTMLDivElement>) {
    event.preventDefault();
    const text = event.clipboardData.getData("text/plain");
    document.execCommand("insertText", false, text);
    emitChange();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }

    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection || selection.rangeCount === 0 || !selection.anchorNode || !editor.contains(selection.anchorNode)) {
      return;
    }

    const anchorCode = findEnclosingTag(selection.anchorNode, "code", editor);
    const focusCode = findEnclosingTag(selection.focusNode, "code", editor);
    if (!anchorCode || anchorCode !== focusCode) {
      return;
    }

    event.preventDefault();
    document.execCommand("insertLineBreak", false);
    emitChange();
    syncActiveActions();
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={`flex h-8 shrink-0 items-center gap-0.5 border-b border-border-subtle pr-2 ${contentInsetClassName}`}>
        {toolbarButtons.map((button) => (
          <button
            key={button.action}
            type="button"
            title={button.title}
            aria-label={button.title}
            aria-pressed={activeActions.has(button.action)}
            // mousedown com preventDefault: nao rouba o foco/selecao do editor.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => applyAction(button.action)}
            className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition ${
              activeActions.has(button.action)
                ? "bg-primary-soft text-primary"
                : "text-text-secondary hover:bg-surface-muted hover:text-text-primary"
            }`}
          >
            {button.icon}
          </button>
        ))}
      </div>

      <div className="relative min-h-0 flex-1">
        {isEmpty ? (
          <span className={`pointer-events-none absolute left-0 top-0 py-4 pr-5 text-sm leading-7 text-[var(--muted-foreground)] ${contentInsetClassName}`}>
            Escreva suas anotações...
          </span>
        ) : null}
        <div
          ref={editorRef}
          role="textbox"
          aria-multiline="true"
          aria-label="Conteúdo da página"
          contentEditable
          suppressContentEditableWarning
          onInput={emitChange}
          onBlur={onBlur}
          onPaste={handlePaste}
          onKeyDown={handleKeyDown}
          className={`notebook-editor h-full w-full overflow-y-auto break-words border-0 bg-transparent py-4 pr-5 text-sm leading-7 text-[var(--foreground)] outline-none ${contentInsetClassName}`}
        />
      </div>
    </div>
  );
}
