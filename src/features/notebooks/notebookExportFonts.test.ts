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

  it("declares the Medium (500) and Bold (700) weights used by the export typography", async () => {
    const css = await loadNotebookExportLoraFontFaceCss();

    expect(css).toContain("font-weight:500");
    expect(css).toContain("font-weight:700");
    expect(css.match(/@font-face/g)?.length).toBe(2);
  });

  it("is deterministic", async () => {
    await expect(loadNotebookExportLoraFontFaceCss()).resolves.toBe(await loadNotebookExportLoraFontFaceCss());
  });
});
