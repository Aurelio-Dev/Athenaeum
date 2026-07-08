export const notebookExportFileNameSlugLimit = 80;
export const notebookExportFileNameFallback = "caderno";

function formatExportDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export function getNotebookExportDefaultFileName(title: string, date = new Date()) {
  const titleWithoutHtmlExtension = title.trim().replace(/(?:\.html?)+$/i, "");
  const slug = titleWithoutHtmlExtension
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, notebookExportFileNameSlugLimit)
    .replace(/-+$/g, "");

  return `${slug || notebookExportFileNameFallback}-${formatExportDate(date)}.html`;
}
