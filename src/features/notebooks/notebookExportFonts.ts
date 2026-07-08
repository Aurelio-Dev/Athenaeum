/**
 * Carregamento sob demanda dos assets tipograficos da exportacao.
 *
 * A fonte Lora e' incorporada como Data URLs num modulo gerado
 * (`notebookExportLoraFontCss.generated`) pesado (~350 KB). Para nao entrar no
 * bundle principal do app, esse asset so e' buscado por import dinamico quando
 * um caderno e' realmente exportado — mesmo padrao usado pelo CSS do KaTeX.
 */
export async function loadNotebookExportLoraFontFaceCss(): Promise<string> {
  const { loraFontFaceCss } = await import("./notebookExportLoraFontCss.generated");
  return loraFontFaceCss;
}
