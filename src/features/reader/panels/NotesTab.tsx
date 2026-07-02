import { useCallback, useEffect, useRef, useState } from "react";

type NotesTabProps = {
  notesText: string;
  onNotesChange: (notes: string) => void;
  onBlur: () => void;
};

type FormatAction = "bold" | "italic" | "underline" | "strike" | "sub" | "sup" | "code";

const formatButtons: Array<{ action: FormatAction; label: string; title: string }> = [
  { action: "bold", label: "B", title: "Negrito" },
  { action: "italic", label: "I", title: "Italico" },
  { action: "underline", label: "U", title: "Sublinhado" },
  { action: "strike", label: "S", title: "Tachado" },
  { action: "sub", label: "T1", title: "Subscrito" },
  { action: "sup", label: "T2", title: "Sobrescrito" },
  { action: "code", label: "</>", title: "Bloco de codigo" },
];

// Acoes cobertas diretamente pela API nativa de edicao do browser. Bloco de
// codigo nao tem comando nativo — e tratado a parte, envolvendo a selecao num
// <code> em bloco (ver wrapSelectionInCode).
// Sub/sobrescrito tambem ficam fora: o comando nativo pode ANINHAR <sub><sub>
// em cliques repetidos (cada camada encolhe a fonte de novo), entao usam o
// toggle manual de toggleWrapTag.
const execCommandByAction: Partial<Record<FormatAction, string>> = {
  bold: "bold",
  italic: "italic",
  underline: "underline",
  strike: "strikeThrough",
};

// Estilo inline no proprio <code> para o trecho renderizar igual mesmo depois de
// recarregar do banco (o innerHTML salvo carrega o estilo junto, sem depender de
// CSS externo). Fundo escuro, monospace, sem syntax highlighting.
// display:block faz o trecho renderizar como UMA caixa continua que cresce e
// encolhe com o conteudo — um <code> inline com <br> dentro viraria fragmentos
// de caixa empilhados por linha, e o WebView2 pode ate dividir o elemento
// inline ao Enter, criando <code>s irmaos separados. white-space:pre-wrap
// preserva quebras e espacamentos de trechos multilinhas.
const codeBlockStyle =
  "display:block;background:#1E2130;color:#F0E6DC;font-family:'IBM Plex Mono',Consolas,monospace;font-size:0.85em;padding:0.5em 0.75em;border-radius:8px;margin:0.4em 0;white-space:pre-wrap;";

function isNotesEmpty(notesText: string) {
  return notesText.replace(/<[^>]*>/g, "").replace(/ /g, " ").trim().length === 0;
}

// Sobe do no ate o editor procurando um ancestral com a tag dada. Devolve null
// se a selecao nao estiver dentro dessa formatacao.
function findEnclosingTag(node: Node | null, tagName: string, editor: HTMLElement): HTMLElement | null {
  let current = node;
  while (current && current !== editor) {
    if (current.nodeType === Node.ELEMENT_NODE && (current as HTMLElement).tagName === tagName.toUpperCase()) {
      return current as HTMLElement;
    }
    current = current.parentNode;
  }
  return null;
}

// Remove o elemento preservando o conteudo (os filhos sobem para o lugar dele).
function unwrapElement(element: HTMLElement) {
  const parent = element.parentNode;
  if (!parent) {
    return;
  }
  while (element.firstChild) {
    parent.insertBefore(element.firstChild, element);
  }
  parent.removeChild(element);
}

// Toggle real de <sub>/<sup>: se a selecao ja esta dentro da tag, desfaz com
// unwrap em vez de aninhar outra camada (aninhar encolheria a fonte
// cumulativamente, ja que <sub>/<sup> tem font-size:smaller por padrao).
function toggleWrapTag(selection: Selection, tagName: "sub" | "sup", editor: HTMLElement) {
  const range = selection.getRangeAt(0);
  const commonAncestor = range.commonAncestorContainer;
  const existingTag = findEnclosingTag(commonAncestor, tagName, editor);

  if (existingTag) {
    const rangeToRestore = document.createRange();
    rangeToRestore.selectNodeContents(existingTag);
    unwrapElement(existingTag);
    selection.removeAllRanges();
    selection.addRange(rangeToRestore);
    return;
  }

  const wrapper = document.createElement(tagName);
  try {
    range.surroundContents(wrapper);
  } catch {
    // surroundContents falha quando a selecao cruza fronteiras de elementos;
    // nesse caso extraimos o conteudo e o reinserimos dentro do wrapper.
    const extracted = range.extractContents();
    stripNestedFormattingTags(extracted, ["code", "sub", "sup"]);
    wrapper.appendChild(extracted);
    range.insertNode(wrapper);
  }
  selection.removeAllRanges();
  const nextRange = document.createRange();
  nextRange.selectNodeContents(wrapper);
  selection.addRange(nextRange);
}

// Converte <div>/<p> (linhas geradas por paste) em texto + quebras de linha
// simples, para o conteudo final ser so texto + <br>, compativel com um
// elemento inline como <code>.
function flattenBlockElements(fragment: DocumentFragment) {
  const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_ELEMENT);
  const blocksToUnwrap: HTMLElement[] = [];
  let node = walker.nextNode();
  while (node) {
    const element = node as HTMLElement;
    if (element.tagName === "DIV" || element.tagName === "P") {
      blocksToUnwrap.push(element);
    }
    node = walker.nextNode();
  }
  blocksToUnwrap.forEach((block) => {
    const br = document.createElement("br");
    block.after(br);
    unwrapElement(block);
  });
}

// Remove qualquer <code>/<sub>/<sup> encontrado DENTRO do fragmento
// extraido antes de envolve-lo numa formatacao nova. Sem isso, quando
// a selecao cruza a fronteira de uma formatacao ja existente (ex.:
// uma linha ja em codigo + linhas novas sem formatacao), a tag antiga
// fica ANINHADA dentro da nova em vez de virar texto puro, somando
// estilos (ex.: 0.85em de font-size dentro de outro 0.85em).
function stripNestedFormattingTags(fragment: DocumentFragment, tagNames: string[]) {
  const upperTagNames = tagNames.map((name) => name.toUpperCase());
  const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_ELEMENT);
  const tagsToUnwrap: HTMLElement[] = [];
  let node = walker.nextNode();
  while (node) {
    const element = node as HTMLElement;
    if (upperTagNames.includes(element.tagName)) {
      tagsToUnwrap.push(element);
    }
    node = walker.nextNode();
  }
  tagsToUnwrap.forEach((tag) => unwrapElement(tag));
}

function wrapSelectionInCode(selection: Selection, editor: HTMLElement) {
  const range = selection.getRangeAt(0);
  const existingCode = findEnclosingTag(range.commonAncestorContainer, "code", editor);

  if (existingCode) {
    // Selecao ja esta dentro de um <code>: desfaz removendo o wrapper e
    // preservando o conteudo, em vez de aninhar outro <code> (cada camada
    // aninhada somaria o proprio padding/border-radius do codeBlockStyle,
    // inflando a caixa visual a cada clique).
    const rangeToRestore = document.createRange();
    rangeToRestore.selectNodeContents(existingCode);
    unwrapElement(existingCode);
    selection.removeAllRanges();
    selection.addRange(rangeToRestore);
    return;
  }

  const code = document.createElement("code");
  code.setAttribute("style", codeBlockStyle);

  try {
    range.surroundContents(code);
  } catch {
    // surroundContents falha quando a selecao cruza fronteiras de elementos
    // (ex.: texto colado multilinha vira um <div> por linha). Achatamos os
    // blocos em texto + <br> antes de inserir: <div> (bloco) dentro de <code>
    // (inline) seria HTML invalido e renderizaria quebrado.
    const extracted = range.extractContents();
    stripNestedFormattingTags(extracted, ["code", "sub", "sup"]);
    flattenBlockElements(extracted);
    code.appendChild(extracted);
    range.insertNode(code);
  }

  // Sem um no de texto DEPOIS do bloco, nao haveria onde clicar/ancorar o
  // cursor para sair dele quando o bloco e o ultimo elemento do editor. O
  // espaco (NBSP, que nao colapsa se o HTML salvo for renderizado sem
  // pre-wrap) da ao cursor um destino fora do <code>.
  const trailingSpace = document.createTextNode("\u00A0");
  code.after(trailingSpace);

  // Cursor colapsado no FIM do conteudo do bloco: o usuario continua digitando
  // dentro dele (a caixa cresce com o conteudo) e sai clicando fora, voltando
  // a digitacao padrao.
  selection.removeAllRanges();
  const nextRange = document.createRange();
  nextRange.selectNodeContents(code);
  nextRange.collapse(false);
  selection.addRange(nextRange);
}

export function NotesTab({ notesText, onNotesChange, onBlur }: NotesTabProps) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const lastEmittedRef = useRef<string>(notesText);
  const [hasSelection, setHasSelection] = useState(false);
  const [activeFormats, setActiveFormats] = useState<Set<FormatAction>>(new Set());

  const syncSelectionState = useCallback(() => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    const isSelectionInEditor = Boolean(
      editor &&
        selection &&
        selection.rangeCount > 0 &&
        !selection.isCollapsed &&
        selection.anchorNode &&
        selection.focusNode &&
        editor.contains(selection.anchorNode) &&
        editor.contains(selection.focusNode),
    );

    setHasSelection(isSelectionInEditor);

    if (!isSelectionInEditor) {
      setActiveFormats(new Set());
      return;
    }

    // O execCommand nativo ja faz toggle; queryCommandState informa quais
    // formatos cobrem a selecao atual para o botao refletir isso. Codigo inline
    // fica de fora: nao ha comando nativo correspondente.
    const nextActive = new Set<FormatAction>();
    (Object.keys(execCommandByAction) as FormatAction[]).forEach((action) => {
      const command = execCommandByAction[action];
      if (command && document.queryCommandState(command)) {
        nextActive.add(action);
      }
    });

    // Sub/sobrescrito e codigo inline nao usam execCommand (ver toggleWrapTag e
    // wrapSelectionInCode), entao o estado ativo deles vem de uma busca direta
    // na arvore da selecao.
    if (editor && selection) {
      if (findEnclosingTag(selection.anchorNode, "sub", editor)) {
        nextActive.add("sub");
      }
      if (findEnclosingTag(selection.anchorNode, "sup", editor)) {
        nextActive.add("sup");
      }
      if (findEnclosingTag(selection.anchorNode, "code", editor)) {
        nextActive.add("code");
      }
    }

    setActiveFormats(nextActive);
  }, []);

  // Carrega o HTML inicial no contentEditable uma vez.
  useEffect(() => {
    const editor = editorRef.current;
    if (editor) {
      editor.innerHTML = notesText;
    }
    // Intencional: so no mount. Atualizacoes externas sao tratadas abaixo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Atualizacoes EXTERNAS de notesText (ex.: trocar de documento) reescrevem o
  // editor. Mudancas vindas da propria digitacao (iguais ao ultimo emitido) sao
  // ignoradas para nao reposicionar o cursor a cada tecla.
  useEffect(() => {
    const editor = editorRef.current;
    if (editor && notesText !== lastEmittedRef.current) {
      editor.innerHTML = notesText;
      lastEmittedRef.current = notesText;
    }
  }, [notesText]);

  useEffect(() => {
    document.addEventListener("selectionchange", syncSelectionState);
    return () => document.removeEventListener("selectionchange", syncSelectionState);
  }, [syncSelectionState]);

  function emitChange() {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    // Se o usuario apagou todo o texto, tags de formatacao vazias podem
    // sobrar no DOM (ex.: <code></code>), fazendo o proximo caractere
    // digitado herdar aquela formatacao sem o usuario ter escolhido isso.
    // Limpar o editor por completo restaura o estado "em branco" real.
    if (editor.textContent?.trim().length === 0) {
      editor.innerHTML = "";
      editor.focus();

      // execCommand("removeFormat") so tem efeito com uma SELECAO NAO
      // COLAPSADA (algo realmente selecionado). Com o cursor apenas
      // piscando num editor vazio, o comando nao faz nada e o "estilo
      // de digitacao" interno do browser (ex.: proximo caractere sai em
      // negrito) continua ativo. O truque: criar um no de texto
      // temporario, seleciona-lo por inteiro, aplicar removeFormat
      // nele, e entao remove-lo, deixando o editor limpo de verdade.
      const temporaryAnchor = document.createTextNode("\u200B");
      editor.appendChild(temporaryAnchor);

      const anchorRange = document.createRange();
      anchorRange.selectNodeContents(temporaryAnchor);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(anchorRange);

      document.execCommand("removeFormat", false);

      editor.innerHTML = "";
      const finalRange = document.createRange();
      finalRange.selectNodeContents(editor);
      finalRange.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(finalRange);

      setActiveFormats(new Set());
    }

    lastEmittedRef.current = editor.innerHTML;
    onNotesChange(editor.innerHTML);
  }

  function applyFormat(action: FormatAction) {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    editor.focus();
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return;
    }

    if (action === "code") {
      wrapSelectionInCode(selection, editor);
    } else if (action === "sub" || action === "sup") {
      toggleWrapTag(selection, action, editor);
    } else {
      const command = execCommandByAction[action];
      if (command) {
        document.execCommand(command, false);
      }
    }

    emitChange();
    syncSelectionState();
  }

  // Cola apenas texto puro: evita injetar markup/scripts arbitrarios no HTML
  // salvo (sanitizacao pratica sem biblioteca externa).
  function handlePaste(event: React.ClipboardEvent<HTMLDivElement>) {
    event.preventDefault();
    const text = event.clipboardData.getData("text/plain");
    document.execCommand("insertText", false, text);
    emitChange();
  }

  // Enter insere uma quebra de linha simples (<br>) via execCommand, em vez
  // de deixar o browser criar um novo bloco (<div>) \u2014 um bloco novo herdaria
  // o padding/border-radius de uma formatacao ativa como <code> em caixas
  // separadas empilhadas, e o browser para de replicar a formatacao apos
  // algumas quebras. insertLineBreak e o MESMO comando nativo que ja roda
  // corretamente quando o usuario aperta Shift+Enter (o cursor fica visivel
  // e correto porque o proprio browser gerencia a posicao, sem manipulacao
  // manual de Range). Shift/Ctrl/Meta/Alt+Enter caem no comportamento padrao.
  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }

    event.preventDefault();
    document.execCommand("insertLineBreak", false);
    emitChange();
  }

  return (
    <div className="relative h-full">
      {hasSelection ? (
        <div className="absolute right-5 top-20 z-10 flex items-center gap-1 rounded-xl bg-[var(--surface-elevated)] px-3 py-2 text-sm font-bold shadow-2xl ring-1 ring-white/10">
          {formatButtons.map((button, index) => (
            <div key={button.action} className="flex items-center gap-1">
              {index === 4 || index === 6 ? <span className="mx-1 h-6 w-px bg-white/10" /> : null}
              <button
                type="button"
                className={`min-w-7 rounded-md px-2 py-1 transition ${
                  activeFormats.has(button.action)
                    ? "bg-primary text-white"
                    : "text-[#9E8878] hover:bg-white/5 hover:text-white"
                }`}
                title={button.title}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => applyFormat(button.action)}
              >
                {button.label}
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {isNotesEmpty(notesText) ? (
        <span className="pointer-events-none absolute left-0 top-0 px-5 py-6 text-sm leading-7 text-[var(--muted-foreground)]">
          Anotações gerais sobre este documento...
        </span>
      ) : null}

      <div
        ref={editorRef}
        role="textbox"
        aria-multiline="true"
        aria-label="Anotações do documento"
        contentEditable
        suppressContentEditableWarning
        onInput={emitChange}
        onBlur={onBlur}
        onPaste={handlePaste}
        onMouseUp={syncSelectionState}
        onKeyDown={handleKeyDown}
        onKeyUp={syncSelectionState}
        className="h-full w-full overflow-y-auto whitespace-pre-wrap break-words border-0 bg-transparent px-5 py-6 text-sm leading-7 text-[var(--foreground)] outline-none"
      />
    </div>
  );
}
