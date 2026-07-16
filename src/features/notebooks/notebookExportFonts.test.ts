import { describe, expect, it } from "vitest";

import { loadNotebookExportLoraFontFaceCss } from "./notebookExportFonts";

describe("loadNotebookExportLoraFontFaceCss", () => {
  it("embeds the Lora font as self-contained data URLs without unsafe references", async () => {
    const css = await loadNotebookExportLoraFontFaceCss();

    expect(css).toContain("@font-face");
    expect(css).toContain('font-family:"Lora"');
    expect(css).toContain("data:font/ttf;base64,");
    expect(css).not.toContain("url(../assets/fonts/");
    expect(css).not.toContain(".ttf");
    expect(css).not.toContain("http://");
    expect(css).not.toContain("https://");
    expect(css).not.toContain("file:");
    expect(css).not.toContain("blob:");
    expect(css).not.toMatch(/@import/i);
  });

  it("declares the 400-700 weight range in both normal and italic styles", async () => {
    const css = await loadNotebookExportLoraFontFaceCss();

    // Fontes variaveis: um arquivo por estilo cobre todo o eixo wght, entao a
    // exportacao ganha Regular/Medium/Bold e o italico real do corpo serifado.
    expect(css).toContain("font-weight:400 700");
    expect(css).toContain("font-style:normal");
    expect(css).toContain("font-style:italic");
    expect(css.match(/@font-face/g)?.length).toBe(2);
  });

  it("is deterministic", async () => {
    await expect(loadNotebookExportLoraFontFaceCss()).resolves.toBe(await loadNotebookExportLoraFontFaceCss());
  });
});
