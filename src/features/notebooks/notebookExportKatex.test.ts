import { describe, expect, it, vi } from "vitest";

import { loadNotebookExportKatexStyles, renderNotebookEquationStaticHtml, resolveNotebookExportKatexStyles } from "./notebookExportKatex";

const forbiddenHtmlFragments = ["<script", "<img", "onerror=", "onclick=", "javascript:", "file:", "blob:"];

function expectNoActiveHtmlOrUrl(html: string) {
  const normalizedHtml = html.toLowerCase();

  for (const forbiddenFragment of forbiddenHtmlFragments) {
    expect(normalizedHtml).not.toContain(forbiddenFragment);
  }
}

describe("loadNotebookExportKatexStyles", () => {
  it("embeds KaTeX fonts as WOFF2 data URLs without unsafe references", async () => {
    const styles = await loadNotebookExportKatexStyles();

    expect(styles).toContain("@font-face");
    expect(styles).toContain("data:font/woff2;base64,");
    expect(styles).toContain(".katex-display");
    expect(styles).not.toContain("url(fonts/");
    expect(styles).not.toContain("http://");
    expect(styles).not.toContain("https://");
    expect(styles).not.toContain("file:");
    expect(styles).not.toContain("blob:");
    expect(styles).not.toMatch(/@import/i);
    expect(styles).not.toContain("node_modules");
  });

  it("is deterministic", async () => {
    await expect(loadNotebookExportKatexStyles()).resolves.toBe(await loadNotebookExportKatexStyles());
  });

  it("defines font faces for every KaTeX family used by the CSS", async () => {
    const styles = await loadNotebookExportKatexStyles();
    const fontFaceFamilies = new Set(
      Array.from(styles.matchAll(/@font-face\{[^}]*font-family:"?(KaTeX_[^";}]+)"?/g), (match) => match[1]),
    );
    const usedFamilies = new Set(
      Array.from(styles.matchAll(/font-family:([^;}]+)/g), (match) => match[1])
        .flatMap((fontList) => fontList.split(","))
        .map((fontFamily) => fontFamily.trim().replace(/^"|"$/g, ""))
        .filter((fontFamily) => fontFamily.startsWith("KaTeX_")),
    );

    expect(fontFaceFamilies).toEqual(
      new Set([
        "KaTeX_AMS",
        "KaTeX_Caligraphic",
        "KaTeX_Fraktur",
        "KaTeX_Main",
        "KaTeX_Math",
        "KaTeX_SansSerif",
        "KaTeX_Script",
        "KaTeX_Size1",
        "KaTeX_Size2",
        "KaTeX_Size3",
        "KaTeX_Size4",
        "KaTeX_Typewriter",
      ]),
    );

    for (const usedFamily of usedFamilies) {
      expect(fontFaceFamilies.has(usedFamily)).toBe(true);
    }
  });
});

describe("resolveNotebookExportKatexStyles", () => {
  it("does not load the font CSS when no equation rendered successfully", async () => {
    const loadStyles = vi.fn(async () => "katex css");

    await expect(resolveNotebookExportKatexStyles(false, loadStyles)).resolves.toBe("");
    expect(loadStyles).not.toHaveBeenCalled();
  });

  it("loads the font CSS only when at least one equation rendered successfully", async () => {
    const loadStyles = vi.fn(async () => "katex css");

    await expect(resolveNotebookExportKatexStyles(true, loadStyles)).resolves.toBe("katex css");
    expect(loadStyles).toHaveBeenCalledTimes(1);
  });
});

describe("renderNotebookEquationStaticHtml", () => {
  it("renders valid equations as static KaTeX HTML and MathML", () => {
    const result = renderNotebookEquationStaticHtml("E = mc^2");

    expect(result.status).toBe("rendered");
    expect(result.html).toContain("athenaeum-export__equation-rendered");
    expect(result.html).toContain('class="katex');
    expect(result.html).toContain("katex-display");
    expect(result.html).toContain("<math");
    expect(result.html).not.toContain("katex-error");
    expect(result.html).not.toContain("athenaeum-export__equation-source");
    expect(result.html).not.toContain("<code");
  });

  it("renders a visible escaped fallback for invalid equations", () => {
    const result = renderNotebookEquationStaticHtml("\\frac{1}{<script>");

    expect(result.status).toBe("fallback");
    expect(result.html).toContain("Equacao nao renderizada");
    expect(result.html).toContain("Sintaxe LaTeX invalida");
    expect(result.html).toContain("&lt;script&gt;");
    expect(result.html).not.toContain("<script>");
  });

  it("renders a visible fallback for empty equation source", () => {
    const result = renderNotebookEquationStaticHtml("   ");

    expect(result.status).toBe("fallback");
    expect(result.html).toContain("A equacao nao possui fonte LaTeX.");
  });

  it.each([
    "<script>alert(1)</script>",
    "\"><img src=x onerror=alert(1)>",
    "\\href{javascript:alert(1)}{teste}",
    "\\url{file:///C:/segredo}",
    "\\htmlClass{qualquer}{x}",
    "\\htmlId{id}{x}",
    "\\includegraphics{arquivo}",
  ])("does not emit active HTML or unsafe URLs for %s", (source) => {
    const result = renderNotebookEquationStaticHtml(source);

    expectNoActiveHtmlOrUrl(result.html);
  });
});
