import {
  createNotebookPageWithContent,
  linkDocumentToNotebook,
  listAnnotations,
  type DatabaseHandleSource,
} from "../../lib/database";

// Envio de uma pagina do leitor para um Caderno: le as anotacoes da pagina
// direto do SQLite (fonte de verdade — funciona igual na janela principal e na
// popout), monta HTML semantico escapado e cria uma PAGINA NOVA no caderno.
// Criar pagina nova (em vez de concatenar numa existente) e deliberado: o
// editor de caderno mantem drafts com autosave, e escrever numa pagina aberta
// poderia ser sobrescrito pelo draft pendente.

type SendPageToNotebookInput = {
  notebookId: number;
  documentId: string;
  documentTitle: string;
  page: number;
  databaseSource?: DatabaseHandleSource;
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Notas vem de um textarea: preserva quebras de linha como <br> dentro do <p>.
function escapeMultilineText(value: string) {
  return escapeHtml(value).replace(/\r?\n/g, "<br>");
}

export async function sendReaderPageToNotebook({
  notebookId,
  documentId,
  documentTitle,
  page,
  databaseSource = "loaded",
}: SendPageToNotebookInput): Promise<void> {
  const annotations = (await listAnnotations(documentId, databaseSource)).filter(
    (annotation) => annotation.page === page,
  );

  if (annotations.length === 0) {
    throw new Error("Nenhuma anotação nesta página para enviar.");
  }

  const blocks: string[] = [
    `<p>Anotações de <strong>${escapeHtml(documentTitle)}</strong> — página ${page}.</p>`,
  ];

  for (const annotation of annotations) {
    blocks.push(`<blockquote>“${escapeMultilineText(annotation.selectedText)}”</blockquote>`);
    if (annotation.note.trim().length > 0) {
      blocks.push(`<p>${escapeMultilineText(annotation.note)}</p>`);
    }
  }

  await createNotebookPageWithContent(
    notebookId,
    `${documentTitle} — página ${page}`,
    blocks.join(""),
    databaseSource,
  );
  await linkDocumentToNotebook(notebookId, documentId, databaseSource);
}
