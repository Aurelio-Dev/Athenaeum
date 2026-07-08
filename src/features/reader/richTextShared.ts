// Helpers de edicao rich-text compartilhados entre o editor de Notas do
// leitor (NotesTab) e o editor de paginas de caderno (NotebookPageEditor).
// Sao utilitarios de baixo nivel sobre Selection/Range — cada editor decide
// o proprio modelo de linha (Notas e inline-only com <br>; cadernos usam
// blocos nativos para suportar H1-H3, listas e citacao).

// Estilo inline no proprio <code> para o trecho renderizar igual mesmo depois de
// recarregar do banco (o innerHTML salvo carrega o estilo junto, sem depender de
// CSS externo). Fundo escuro neutro, monospace, sem syntax highlighting.
// display:block faz o trecho ocupar a largura disponivel como UMA caixa continua
// (nao uma etiqueta com largura de conteudo) — um <code> inline com <br> dentro
// viraria fragmentos de caixa empilhados por linha, e o WebView2 pode ate
// dividir o elemento inline ao Enter, criando <code>s irmaos separados.
// white-space:pre + overflow-x:auto preservam espacos, tabulacoes e quebras e
// permitem scroll horizontal em linhas longas, sem quebrar o codigo
// arbitrariamente. line-height confortavel e borda discreta completam o visual;
// compartilhado com o editor de Notas do leitor.
export const codeBlockStyle =
  "display:block;overflow-x:auto;background:#1E2130;color:#F0E6DC;border:1px solid #34384B;font-family:'IBM Plex Mono',Consolas,monospace;font-size:0.9em;line-height:1.55;padding:0.7em 0.9em;border-radius:8px;margin:0.7em 0;white-space:pre;";

export function prepareCodeElement(code: HTMLElement) {
  code.setAttribute("style", codeBlockStyle);
  code.setAttribute("spellcheck", "false");
}

export function prepareCodeElements(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>("code").forEach(prepareCodeElement);
}

// Sobe do no ate o editor procurando um ancestral com a tag dada. Devolve null
// se a selecao nao estiver dentro dessa formatacao.
export function findEnclosingTag(node: Node | null, tagName: string, editor: HTMLElement): HTMLElement | null {
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
export function unwrapElement(element: HTMLElement) {
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
export function toggleWrapTag(selection: Selection, tagName: "sub" | "sup", editor: HTMLElement) {
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
export function flattenBlockElements(fragment: DocumentFragment) {
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

export function insertPlainTextWithLineBreaks(range: Range, text: string) {
  const normalizedText = text.replace(/\r\n?/g, "\n");

  if (normalizedText.length === 0) {
    return;
  }

  const fragment = document.createDocumentFragment();
  normalizedText.split("\n").forEach((line, index) => {
    if (index > 0) {
      fragment.appendChild(document.createElement("br"));
    }

    if (line.length > 0) {
      fragment.appendChild(document.createTextNode(line));
    }
  });

  const lastInsertedNode = fragment.lastChild;
  if (!lastInsertedNode) {
    return;
  }

  range.deleteContents();
  range.insertNode(fragment);

  const selection = window.getSelection();
  const nextRange = document.createRange();
  nextRange.setStartAfter(lastInsertedNode);
  nextRange.collapse(true);
  selection?.removeAllRanges();
  selection?.addRange(nextRange);
}

// Remove qualquer <code>/<sub>/<sup> encontrado DENTRO do fragmento
// extraido antes de envolve-lo numa formatacao nova. Sem isso, quando
// a selecao cruza a fronteira de uma formatacao ja existente (ex.:
// uma linha ja em codigo + linhas novas sem formatacao), a tag antiga
// fica ANINHADA dentro da nova em vez de virar texto puro, somando
// estilos (ex.: 0.85em de font-size dentro de outro 0.85em).
export function stripNestedFormattingTags(fragment: DocumentFragment, tagNames: string[]) {
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

export function wrapSelectionInCode(selection: Selection, editor: HTMLElement) {
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
  prepareCodeElement(code);

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
