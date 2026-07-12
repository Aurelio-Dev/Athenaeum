// Sanitizador do HTML das notas livres do leitor (aba Notas / NotesTab).
//
// documents.notes recebe escrita de mais de uma superficie (NotesTab rica;
// painel de detalhes e import como texto plano), e a NotesTab renderiza o
// valor via innerHTML. Este modulo e a defesa central: tudo que entra no
// editor (load) e tudo que sai para o banco (save) passa por aqui.
//
// Disciplina (mesmo padrao do notebookExportHtml.ts, sem reutilizar aquele
// modulo): parse em documento isolado via DOMParser — nunca innerHTML num
// no vivo da aplicacao —, caminhada no a no com allowlist fechada e
// reconstrucao da arvore. Elemento permitido renasce SEM nenhum atributo;
// elemento fora da allowlist sofre unwrap (os filhos sobem — o conteudo do
// usuario nunca e descartado); comentarios e demais tipos de no sao
// removidos. O estilo canonico de <code> nao e responsabilidade daqui: e
// reimposto por prepareCodeElement no load da NotesTab.

import { flattenBlockElements } from "./richTextShared";

// Modelo de linha da NotesTab: so formatacao inline + <br>. Nada de blocos,
// links, imagens ou tabelas — ver docs/reader-notes-contenteditable-discovery.md.
// Os pares b/strong, i/em e s/strike/del existem porque o execCommand emite
// as formas curtas, mas dado legado pode carregar as longas.
const allowedElements = new Set(["b", "strong", "i", "em", "u", "s", "strike", "del", "sub", "sup", "code", "br"]);

// So elementos do namespace HTML podem casar com a allowlist. Conteudo
// estrangeiro (SVG/MathML) cujo nome coincide com um permitido — ex.:
// <svg><del>, ja que "del" nao esta na lista de breakout de foreign content
// do parser e permanece no namespace SVG — sofre unwrap como qualquer nao
// permitido. Mesmo sem esta checagem nenhum atributo ou namespace
// sobreviveria (o elemento renasce limpo via createElement), mas o unwrap e
// mais previsivel do que promover a tag estrangeira a HTML.
const htmlNamespace = "http://www.w3.org/1999/xhtml";

// Limite explicito de profundidade da recursao do walk. Payload adversarial
// com milhares de elementos aninhados nao pode estourar a pilha: alem do
// limite, o subtree inteiro e preservado como texto plano (conteudo do
// usuario nunca some; so a formatacao degrada). Em producao o parser do
// Blink ja achata arvores com mais de 512 niveis, entao nota legitima nunca
// chega perto disto — o limite protege o walk tambem fora do WebView.
const maxSanitizeDepth = 256;

// O prefixo "<body>" forca o parser direto para o modo "in body": sem ele,
// texto e espacos ANTES do primeiro elemento seriam descartados pelos modos
// iniciais do parser HTML (uma nota legada comecando com "\n" perderia a
// quebra). Tags <body>/</body> extras vindas do dado sao neutralizadas pelo
// proprio algoritmo do parser (atributos mesclados / reprocessamento em
// body), entao nada "escapa" do documento isolado.
function parseIntoIsolatedDocument(html: string): Document {
  return new DOMParser().parseFromString(`<body>${html}`, "text/html");
}

// Reconstroi a versao segura de um no. Texto e copiado literalmente (o
// serializador reescapa &, < e > na saida); elemento permitido renasce sem
// atributo nenhum; elemento fora da allowlist e substituido pelos proprios
// filhos sanitizados (unwrap); qualquer outro tipo de no (comentario,
// processing instruction) e descartado.
function sanitizeNode(node: Node, targetDocument: Document, depth: number): Node[] {
  if (node.nodeType === Node.TEXT_NODE) {
    return [targetDocument.createTextNode((node as Text).data)];
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return [];
  }

  const element = node as Element;

  // Alem do limite de profundidade, o subtree vira texto plano de uma vez
  // (textContent e iterativo no engine — nao ha recursao adicional aqui).
  if (depth >= maxSanitizeDepth) {
    const flattenedText = element.textContent ?? "";
    return flattenedText.length > 0 ? [targetDocument.createTextNode(flattenedText)] : [];
  }

  const tagName = element.tagName.toLowerCase();

  if (element.namespaceURI !== htmlNamespace || !allowedElements.has(tagName)) {
    const promotedChildren: Node[] = [];
    element.childNodes.forEach((child) => {
      promotedChildren.push(...sanitizeNode(child, targetDocument, depth + 1));
    });
    return promotedChildren;
  }

  const safeElement = targetDocument.createElement(tagName);
  element.childNodes.forEach((child) => {
    sanitizeNode(child, targetDocument, depth + 1).forEach((safeChild) => safeElement.appendChild(safeChild));
  });
  return [safeElement];
}

// Caminho HTML da heuristica. Antes da allowlist, achata <div>/<p> (linhas
// geradas por paste/drop/legado) em texto + <br> com o mesmo helper do
// editor — o modelo de linha das Notas e inline-only, entao blocos nunca
// devem sobreviver ao save.
export function sanitizeHtmlWithAllowlist(rawHtml: string): string {
  const parsedDocument = parseIntoIsolatedDocument(rawHtml);
  const body = parsedDocument.body;

  const fragment = parsedDocument.createDocumentFragment();
  while (body.firstChild) {
    fragment.appendChild(body.firstChild);
  }
  flattenBlockElements(fragment);

  const container = parsedDocument.createElement("div");
  fragment.childNodes.forEach((child) => {
    sanitizeNode(child, parsedDocument, 0).forEach((safeChild) => container.appendChild(safeChild));
  });
  return container.innerHTML;
}

// Caminho legado (texto plano) da heuristica. Decodifica entidades via
// parser e devolve o texto reescapado pelo serializador — e NAO um escape
// ingenuo de "&": o sanitizador roda no load E no save, entao a saida de um
// ciclo vira entrada do proximo; escapar sem decodificar corromperia a nota
// a cada ciclo ("AT&T" -> "AT&amp;T" -> "AT&amp;amp;T"...). Com o par
// decodifica-reescapa a operacao e estavel (idempotente).
export function escapeLegacyPlainText(rawText: string): string {
  const parsedDocument = parseIntoIsolatedDocument(rawText);
  const container = parsedDocument.createElement("div");
  container.appendChild(parsedDocument.createTextNode(parsedDocument.body.textContent ?? ""));
  return container.innerHTML;
}

// Heuristica de legado (Opcao A do discovery): string sem "<" e texto plano
// da era textarea (ou das superficies de texto plano atuais); com "<" e
// tratada como HTML e passa pela allowlist. Limitacao conhecida e aceita:
// texto plano contendo "<" seguido de LETRA e interpretado como tag pelo
// parser (ex.: "se x<abc" perde a cauda), enquanto "x<10" sobrevive intacto
// porque "<" + nao-letra e texto literal para o parser HTML.
export function sanitizeNotesHtml(rawHtml: string): string {
  if (!rawHtml.includes("<")) {
    return escapeLegacyPlainText(rawHtml);
  }

  return sanitizeHtmlWithAllowlist(rawHtml);
}
