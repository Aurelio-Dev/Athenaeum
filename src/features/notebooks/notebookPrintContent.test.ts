// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { sanitizeNotebookPrintContent } from "./notebookPrintContent";

describe("sanitizeNotebookPrintContent", () => {
  it("preserva a estrutura semântica necessária para os normalizadores do Caderno", () => {
    const output = sanitizeNotebookPrintContent(`
      <aside data-athenaeum-block="callout" data-callout-type="tip">
        <div data-callout-icon="true">+</div><div data-callout-content="true"><strong>Dica</strong></div>
      </aside>
      <figure data-athenaeum-block="diagram" data-diagram-kind="flowchart" data-diagram-scale="90">
        <div data-diagram-preview="true">runtime</div>
        <figcaption data-diagram-source="true">A -&gt; B</figcaption>
      </figure>
      <figure data-athenaeum-block="equation" data-equation-scale="110">
        <div data-equation-preview="true">runtime</div>
        <figcaption data-equation-source="true">E = mc^2</figcaption>
      </figure>
      <figure data-athenaeum-block="figure" data-figure-subtype="image" data-figure-width="640" data-figure-height="480">
        <img data-notebook-asset-id="asset-123" src="data:image/png;base64,perigoso" onerror="alert(1)" alt="Figura">
        <figcaption>Legenda</figcaption>
      </figure>
    `);

    expect(output).toContain('data-athenaeum-block="callout"');
    expect(output).toContain('data-diagram-source="true"');
    expect(output).toContain('data-equation-source="true"');
    expect(output).toContain('data-notebook-asset-id="asset-123"');
    expect(output).not.toContain("data-diagram-preview");
    expect(output).not.toContain("data-equation-preview");
    expect(output).not.toContain("src=");
    expect(output).not.toContain("onerror");
  });

  it("remove anexos por completo em vez de deixar um cartão quebrado", () => {
    expect(
      sanitizeNotebookPrintContent(
        'antes<figure data-athenaeum-block="file-attachment"><strong>arquivo.pdf</strong></figure>depois',
      ),
    ).toBe("antesdepois");
  });

  it("faz unwrap de tags desconhecidas e preserva seu conteúdo", () => {
    expect(sanitizeNotebookPrintContent("<article>antes <strong>texto</strong> depois</article>")).toBe(
      "antes <strong>texto</strong> depois",
    );
  });

  it("remove imagens externas e links javascript, preservando texto inerte", () => {
    const output = sanitizeNotebookPrintContent(
      '<img src="https://example.com/x.png" onerror="x"><a href="javascript:alert(1)" onclick="x">abrir</a>',
    );
    expect(output).toBe("<a>abrir</a>");
  });

  it("preserva somente declarações de estilo necessárias ao conteúdo", () => {
    const output = sanitizeNotebookPrintContent(
      '<div style="text-align: center; background: url(javascript:x)">centro</div><code style="display:block;color:red">x</code>',
    );
    expect(output).toBe('<div style="text-align: center">centro</div><code style="display: block">x</code>');
  });
});
