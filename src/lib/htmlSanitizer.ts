export type HtmlElementDisposition = "preserve" | "unwrap" | "discard";

export type HtmlSanitizerPolicy = {
  allowedElements: ReadonlySet<string>;
  defaultElementDisposition: Exclude<HtmlElementDisposition, "preserve">;
  getElementDisposition?: (element: Element) => HtmlElementDisposition | null;
  sanitizeAttribute?: (element: Element, attribute: Attr) => string | null;
  preprocessFragment?: (fragment: DocumentFragment) => void;
};

const htmlNamespace = "http://www.w3.org/1999/xhtml";
const maxSanitizeDepth = 256;

// O prefixo <body> força o parser diretamente para o modo "in body" e
// preserva texto e espaços anteriores ao primeiro elemento.
export function parseHtmlIntoIsolatedDocument(html: string): Document {
  return new DOMParser().parseFromString(`<body>${html}`, "text/html");
}

function resolveElementDisposition(element: Element, policy: HtmlSanitizerPolicy): HtmlElementDisposition {
  const configuredDisposition = policy.getElementDisposition?.(element);
  if (configuredDisposition) {
    // Elementos de namespaces estrangeiros nunca podem ser promovidos a HTML,
    // mesmo que uma política os classifique por engano como preserváveis.
    return element.namespaceURI === htmlNamespace || configuredDisposition !== "preserve"
      ? configuredDisposition
      : policy.defaultElementDisposition;
  }

  if (element.namespaceURI !== htmlNamespace) {
    return policy.defaultElementDisposition;
  }

  return policy.allowedElements.has(element.tagName.toLowerCase()) ? "preserve" : policy.defaultElementDisposition;
}

function copySanitizedAttributes(source: Element, target: HTMLElement, policy: HtmlSanitizerPolicy) {
  if (!policy.sanitizeAttribute) {
    return;
  }

  for (const attribute of Array.from(source.attributes)) {
    const name = attribute.name.toLowerCase();

    // Esta barreira pertence ao motor, não às políticas: mesmo uma política
    // permissiva não pode recolocar handlers ou atributos de namespace.
    if (name.startsWith("on") || name === "xmlns" || name.startsWith("xmlns:")) {
      continue;
    }

    const sanitizedValue = policy.sanitizeAttribute(source, attribute);
    if (sanitizedValue !== null) {
      target.setAttribute(name, sanitizedValue);
    }
  }
}

function sanitizeNode(node: Node, targetDocument: Document, policy: HtmlSanitizerPolicy, depth: number): Node[] {
  if (node.nodeType === Node.TEXT_NODE) {
    return [targetDocument.createTextNode((node as Text).data)];
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return [];
  }

  const element = node as Element;

  // Acima do limite, o subtree degrada para texto de uma vez. Assim payloads
  // adversariais não estouram a pilha e o conteúdo do usuário não desaparece.
  if (depth >= maxSanitizeDepth) {
    const flattenedText = element.textContent ?? "";
    return flattenedText.length > 0 ? [targetDocument.createTextNode(flattenedText)] : [];
  }

  const disposition = resolveElementDisposition(element, policy);
  if (disposition === "discard") {
    return [];
  }

  if (disposition === "unwrap") {
    const promotedChildren: Node[] = [];
    element.childNodes.forEach((child) => {
      promotedChildren.push(...sanitizeNode(child, targetDocument, policy, depth + 1));
    });
    return promotedChildren;
  }

  const safeElement = targetDocument.createElement(element.tagName.toLowerCase());
  copySanitizedAttributes(element, safeElement, policy);
  element.childNodes.forEach((child) => {
    sanitizeNode(child, targetDocument, policy, depth + 1).forEach((safeChild) => safeElement.appendChild(safeChild));
  });
  return [safeElement];
}

export function sanitizeHtmlFragment(rawHtml: string, policy: HtmlSanitizerPolicy): string {
  const parsedDocument = parseHtmlIntoIsolatedDocument(rawHtml);
  const fragment = parsedDocument.createDocumentFragment();

  while (parsedDocument.body.firstChild) {
    fragment.appendChild(parsedDocument.body.firstChild);
  }

  policy.preprocessFragment?.(fragment);

  const container = parsedDocument.createElement("div");
  fragment.childNodes.forEach((child) => {
    sanitizeNode(child, parsedDocument, policy, 0).forEach((safeChild) => container.appendChild(safeChild));
  });
  return container.innerHTML;
}
