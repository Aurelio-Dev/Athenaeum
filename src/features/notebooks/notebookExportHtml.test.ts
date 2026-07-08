import { describe, expect, it } from "vitest";

import {
  createNotebookExportSlotSentinel,
  formatNotebookExportDisplayDate,
  parseNotebookExportSlotSentinels,
  renderExportStyles,
  validateNotebookExportManifestSlots,
  type NotebookExportManifest,
} from "./notebookExportHtml";

function manifest(slots: NotebookExportManifest["slots"], nonce = "nonce-2026") {
  return {
    version: 1,
    nonce,
    notebookId: 1,
    notebookTitle: "Caderno",
    scope: "full-notebook",
    pageIds: [10],
    createdAt: "2026-07-07T12:00:00.000Z",
    slots,
  } satisfies NotebookExportManifest;
}

describe("createNotebookExportSlotSentinel", () => {
  it("serializes the slot marker with nonce and slot id", () => {
    expect(createNotebookExportSlotSentinel("nonce-2026", "slot-1")).toBe("<!--ATHENAEUM_SLOT:nonce-2026:slot-1-->");
  });

  it("rejects invalid nonce and slot id", () => {
    expect(() => createNotebookExportSlotSentinel("bad:value", "slot-1")).toThrow();
    expect(() => createNotebookExportSlotSentinel("nonce-2026", "asset-1")).toThrow();
  });
});

describe("parseNotebookExportSlotSentinels", () => {
  it("finds sentinels in HTML order", () => {
    expect(
      parseNotebookExportSlotSentinels(
        "<figure><!--ATHENAEUM_SLOT:nonce-2026:slot-1--></figure><p><!--ATHENAEUM_SLOT:nonce-2026:slot-2--></p>",
      ),
    ).toMatchObject([
      { nonce: "nonce-2026", slotId: "slot-1" },
      { nonce: "nonce-2026", slotId: "slot-2" },
    ]);
  });
});

describe("validateNotebookExportManifestSlots", () => {
  it("accepts multiple slots for the same resource id", () => {
    const exportManifest = manifest([
      { slotId: "slot-1", kind: "notebook-asset", resourceId: "asset-a", pageId: 10, occurrence: 1 },
      { slotId: "slot-2", kind: "notebook-asset", resourceId: "asset-a", pageId: 10, occurrence: 2 },
    ]);
    const validation = validateNotebookExportManifestSlots(
      "<!--ATHENAEUM_SLOT:nonce-2026:slot-1--><!--ATHENAEUM_SLOT:nonce-2026:slot-2-->",
      exportManifest,
    );

    expect(validation.errors).toEqual([]);
    expect(validation.consumedSlotIds).toEqual(["slot-1", "slot-2"]);
  });

  it("reports duplicate sentinels", () => {
    const exportManifest = manifest([{ slotId: "slot-1", kind: "notebook-asset", resourceId: "asset-a", pageId: 10, occurrence: 1 }]);
    const validation = validateNotebookExportManifestSlots(
      "<!--ATHENAEUM_SLOT:nonce-2026:slot-1--><!--ATHENAEUM_SLOT:nonce-2026:slot-1-->",
      exportManifest,
    );

    expect(validation.errors).toContain("Sentinela duplicada para slot-1.");
  });

  it("reports sentinels without manifest entries", () => {
    const validation = validateNotebookExportManifestSlots("<!--ATHENAEUM_SLOT:nonce-2026:slot-9-->", manifest([]));

    expect(validation.errors).toContain("Sentinela slot-9 nao existe no manifest.");
  });

  it("reports manifest entries not consumed by the HTML", () => {
    const exportManifest = manifest([{ slotId: "slot-1", kind: "notebook-attachment", resourceId: "attachment-a", pageId: 10, occurrence: 1 }]);
    const validation = validateNotebookExportManifestSlots("<p>sem slots</p>", exportManifest);

    expect(validation.errors).toContain("Slot slot-1 do manifest nao foi consumido no HTML.");
  });

  it("reports nonce mismatch", () => {
    const exportManifest = manifest([{ slotId: "slot-1", kind: "notebook-asset", resourceId: "asset-a", pageId: 10, occurrence: 1 }]);
    const validation = validateNotebookExportManifestSlots("<!--ATHENAEUM_SLOT:nonce-errado:slot-1-->", exportManifest);

    expect(validation.errors).toContain("Sentinela slot-1 usa nonce inesperado.");
  });
});

describe("renderExportStyles", () => {
  it("keeps exported diagrams visually clean and neutral", () => {
    const styles = renderExportStyles();

    expect(styles).toContain(".athenaeum-export__diagram {");
    expect(styles).toContain("border: 0");
    expect(styles).toContain("background: transparent");
    expect(styles).toContain("stroke: #1f1a17");
    expect(styles).toContain("fill: #ffffff");
    expect(styles).not.toContain(".athenaeum-export__diagram {\n      border: 1px solid #d8cdc2");
    expect(styles).not.toContain("stroke: #8a6042");
    expect(styles).not.toContain("fill: #7d5336");
  });

  it("does not include KaTeX font CSS by default", () => {
    const styles = renderExportStyles();

    expect(styles).not.toContain("@font-face{font-display:block;font-family:KaTeX");
    expect(styles).not.toContain("data:font/woff2;base64,");
    expect(styles).toContain(".athenaeum-export__equation-fallback");
  });

  it("includes KaTeX font CSS only when supplied by the async export flow", () => {
    const styles = renderExportStyles({ katexStyles: '@font-face{font-family:KaTeX_Main;src:url("data:font/woff2;base64,AA==") format("woff2")}.katex{}' });

    expect(styles).toContain("@font-face{font-family:KaTeX_Main");
    expect(styles).toContain("data:font/woff2;base64,");
    expect(styles).toContain(".katex{}");
  });

  it("aligns the export typography to the notebook visual (Lora titles, Segoe UI body)", () => {
    const styles = renderExportStyles();

    expect(styles).toContain('--ax-serif: "Lora"');
    expect(styles).toContain('--ax-sans: "Segoe UI"');
    expect(styles).toMatch(/\.athenaeum-export__title \{[^}]*font-family: var\(--ax-serif\)/);
    expect(styles).toMatch(/\.athenaeum-export__page-title \{[^}]*font-family: var\(--ax-serif\)/);
    expect(styles).toMatch(/body \{[^}]*font-family: var\(--ax-sans\)/);
  });

  it("does not embed the Lora font faces by default", () => {
    const styles = renderExportStyles();

    expect(styles).not.toContain("data:font/ttf;base64,");
    expect(styles).not.toContain('@font-face{font-family:"Lora"');
  });

  it("embeds the Lora font faces only when supplied by the async export flow", () => {
    const fontFaceStyles = '@font-face{font-family:"Lora";font-weight:500;src:url("data:font/ttf;base64,AA==") format("truetype")}';
    const styles = renderExportStyles({ fontFaceStyles });

    expect(styles).toContain('@font-face{font-family:"Lora"');
    expect(styles).toContain("data:font/ttf;base64,");
  });

  it("separates block code, pre child code and inline code styles", () => {
    const styles = renderExportStyles();

    expect(styles).toContain(".athenaeum-export pre {");
    expect(styles).toContain("background: var(--ax-code-block-bg)");
    expect(styles).toContain("white-space: pre");
    expect(styles).toContain(".athenaeum-export pre code {");
    expect(styles).toContain("background: transparent");
    expect(styles).toContain(".athenaeum-export :not(pre) > code {");
    expect(styles).toContain("background: var(--ax-code-inline-bg)");
  });

  it("adds print protection for large notebook blocks", () => {
    const styles = renderExportStyles();

    expect(styles).toContain("@media print");
    expect(styles).toContain(".athenaeum-export__diagram");
    expect(styles).toContain(".athenaeum-export__equation");
    expect(styles).toContain(".athenaeum-export__figure");
    expect(styles).toContain("break-inside: avoid");
    expect(styles).toContain("page-break-inside: avoid");
  });

  it("keeps exported image figures proportional", () => {
    const styles = renderExportStyles();

    expect(styles).toContain(".athenaeum-export__figure img");
    expect(styles).toContain("width: 100%");
    expect(styles).toContain("max-width: 100%");
    expect(styles).toContain("height: auto");
  });
});

describe("formatNotebookExportDisplayDate", () => {
  it("formats the date in localized pt-BR with local time", () => {
    // Componentes locais: getHours() devolve 14 independente do fuso do runner.
    const date = new Date(2026, 6, 8, 14, 30);

    expect(formatNotebookExportDisplayDate(date)).toBe("8 de julho de 2026 às 14h30");
  });

  it("zero-pads hours and minutes", () => {
    const date = new Date(2026, 0, 3, 9, 5);

    expect(formatNotebookExportDisplayDate(date)).toBe("3 de janeiro de 2026 às 09h05");
  });

  it("returns an empty string for an invalid date", () => {
    expect(formatNotebookExportDisplayDate(new Date("data-invalida"))).toBe("");
  });
});
