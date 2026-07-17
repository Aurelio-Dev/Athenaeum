// Sanitizador do HTML das notas livres do leitor (aba Notas / NotesTab).
//
// documents.notes recebe escrita de mais de uma superficie (NotesTab rica;
// painel de detalhes e import como texto plano), e a NotesTab renderiza o
// valor via innerHTML. Este modulo e a defesa central: tudo que entra no
// editor (load) e tudo que sai para o banco (save) passa por aqui.
//
// A política desta superfície continua inline-only e com unwrap: o motor
// compartilhado cuida do parse isolado, namespace, limite de profundidade e
// reconstrução; esta política decide as tags e mantém zero atributos.

import { parseHtmlIntoIsolatedDocument, sanitizeHtmlFragment } from "../../lib/htmlSanitizer";
import { flattenBlockElements } from "./richTextShared";

// Modelo de linha da NotesTab: so formatacao inline + <br>. Nada de blocos,
// links, imagens ou tabelas — ver docs/reader-notes-contenteditable-discovery.md.
// Os pares b/strong, i/em e s/strike/del existem porque o execCommand emite
// as formas curtas, mas dado legado pode carregar as longas.
const allowedElements = new Set(["b", "strong", "i", "em", "u", "s", "strike", "del", "sub", "sup", "code", "br"]);

// Caminho HTML da heuristica. Antes da allowlist, achata <div>/<p> (linhas
// geradas por paste/drop/legado) em texto + <br> com o mesmo helper do
// editor — o modelo de linha das Notas e inline-only, entao blocos nunca
// devem sobreviver ao save.
export function sanitizeHtmlWithAllowlist(rawHtml: string): string {
  return sanitizeHtmlFragment(rawHtml, {
    allowedElements,
    // Decisão deliberada das Notas: perder formatação é aceitável; perder o
    // texto que estava dentro de uma tag desconhecida não é.
    defaultElementDisposition: "unwrap",
    preprocessFragment: (fragment) => flattenBlockElements(fragment),
  });
}

// Caminho legado (texto plano) da heuristica. Decodifica entidades via
// parser e devolve o texto reescapado pelo serializador — e NAO um escape
// ingenuo de "&": o sanitizador roda no load E no save, entao a saida de um
// ciclo vira entrada do proximo; escapar sem decodificar corromperia a nota
// a cada ciclo ("AT&T" -> "AT&amp;T" -> "AT&amp;amp;T"...). Com o par
// decodifica-reescapa a operacao e estavel (idempotente).
export function escapeLegacyPlainText(rawText: string): string {
  const parsedDocument = parseHtmlIntoIsolatedDocument(rawText);
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
