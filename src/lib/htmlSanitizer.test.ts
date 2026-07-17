// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { sanitizeHtmlFragment, type HtmlSanitizerPolicy } from "./htmlSanitizer";

const inlinePolicy: HtmlSanitizerPolicy = {
  allowedElements: new Set(["b", "em"]),
  defaultElementDisposition: "unwrap",
};

describe("sanitizeHtmlFragment", () => {
  it("faz unwrap por política sem perder texto nem formatação permitida", () => {
    expect(sanitizeHtmlFragment("<section>antes <b>forte</b> depois</section>", inlinePolicy)).toBe(
      "antes <b>forte</b> depois",
    );
  });

  it("permite descarte explícito de uma subárvore", () => {
    expect(
      sanitizeHtmlFragment("a<figure data-remove='true'><b>anexo</b></figure>z", {
        ...inlinePolicy,
        allowedElements: new Set(["b", "figure"]),
        getElementDisposition: (element) =>
          element.getAttribute("data-remove") === "true" ? "discard" : null,
      }),
    ).toBe("az");
  });

  it("não promove elemento de namespace estrangeiro permitido pela allowlist", () => {
    expect(
      sanitizeHtmlFragment("<svg><del onclick='x'>texto</del></svg>", {
        ...inlinePolicy,
        allowedElements: new Set(["b", "em", "del"]),
      }),
    ).toBe("texto");
  });

  it("bloqueia atributos on* no motor mesmo quando a política tenta aceitá-los", () => {
    expect(
      sanitizeHtmlFragment("<b onclick='alert(1)' title='ok'>texto</b>", {
        ...inlinePolicy,
        sanitizeAttribute: (_element, attribute) => attribute.value,
      }),
    ).toBe('<b title="ok">texto</b>');
  });

  it("limita a profundidade e preserva o conteúdo como texto", () => {
    const depth = 2000;
    const output = sanitizeHtmlFragment("<b>".repeat(depth) + "x" + "</b>".repeat(depth), inlinePolicy);
    expect(output).toBe("<b>".repeat(256) + "x" + "</b>".repeat(256));
  });
});
