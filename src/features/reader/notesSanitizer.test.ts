// @vitest-environment jsdom
//
// Unico arquivo de teste do projeto que exige DOM (DOMParser real): roda em
// jsdom via pragma acima; o restante da suite continua em Node puro.

import { describe, expect, it } from "vitest";

import { escapeLegacyPlainText, sanitizeHtmlWithAllowlist, sanitizeNotesHtml } from "./notesSanitizer";

// Nenhum elemento da saida pode carregar atributo algum — vale para todos os
// testes, inclusive os de payload (on*, style, href etc.).
function expectNoAttributes(output: string) {
  expect(output).not.toMatch(/<[a-z][a-z0-9]*\s/i);
}

// Os 11 elementos permitidos que envolvem conteudo; <br> (void) e testado a
// parte. Cada um tem round-trip individual para uma remocao acidental da
// allowlist apontar exatamente qual elemento quebrou.
const wrappingAllowedElements = ["b", "strong", "i", "em", "u", "s", "strike", "del", "sub", "sup", "code"] as const;

describe("sanitizeNotesHtml — allowlist estrutural", () => {
  it.each(wrappingAllowedElements)("preserva <%s> individualmente (round-trip exato)", (tag) => {
    const input = `<${tag}>conteudo</${tag}>`;
    expect(sanitizeNotesHtml(input)).toBe(input);
  });

  it("preserva <br> individualmente (elemento void)", () => {
    expect(sanitizeNotesHtml("a<br>b")).toBe("a<br>b");
  });

  it("preserva os 12 elementos permitidos combinados", () => {
    const input =
      "<b>1</b><strong>2</strong><i>3</i><em>4</em><u>5</u><s>6</s>" +
      "<strike>7</strike><del>8</del><sub>9</sub><sup>10</sup><code>11</code>a<br>b";
    expect(sanitizeNotesHtml(input)).toBe(input);
  });

  it("faz unwrap de elementos fora da allowlist preservando o texto", () => {
    expect(sanitizeNotesHtml("<article><h1>titulo</h1><span>corpo</span></article>")).toBe("titulocorpo");
  });

  it("preserva formatacao permitida aninhada dentro de elemento removido", () => {
    expect(sanitizeNotesHtml("<section><b>negrito</b> e <em>enfase</em></section>")).toBe("<b>negrito</b> e <em>enfase</em>");
  });

  it("remove todos os atributos de elementos permitidos", () => {
    const input = '<strong style="color:red" class="x" id="y" contenteditable="true" data-foo="1">a</strong>';
    const output = sanitizeNotesHtml(input);
    expect(output).toBe("<strong>a</strong>");
    expectNoAttributes(output);
  });

  it("achata div e p em texto + <br> (flattenBlockElements)", () => {
    expect(sanitizeNotesHtml("<div>linha um</div><p>linha dois</p>")).toBe("linha um<br>linha dois<br>");
  });

  it("achata div preservando formatacao inline interna", () => {
    expect(sanitizeNotesHtml('<div><b style="color:red">a</b></div>')).toBe("<b>a</b><br>");
  });

  it("descarta comentarios HTML", () => {
    expect(sanitizeNotesHtml("antes<!-- comentario -->depois")).toBe("antesdepois");
  });

  it("preserva texto e espacos antes do primeiro elemento", () => {
    expect(sanitizeNotesHtml("\n  inicio <b>fim</b>")).toBe("\n  inicio <b>fim</b>");
  });

  it("e idempotente no caminho HTML", () => {
    const once = sanitizeNotesHtml('<div>a</div><article><b class="x">b</b></article>x<10 & AT&T');
    expect(sanitizeNotesHtml(once)).toBe(once);
  });
});

describe("sanitizeNotesHtml — heuristica de legado (texto plano)", () => {
  it("preserva texto plano com quebras de linha sem alteracao", () => {
    expect(sanitizeNotesHtml("linha um\nlinha dois\n\nlinha quatro")).toBe("linha um\nlinha dois\n\nlinha quatro");
  });

  it("escapa & de texto plano legado (AT&T)", () => {
    expect(sanitizeNotesHtml("AT&T")).toBe("AT&amp;T");
  });

  it("nao escapa duas vezes em ciclos repetidos de load/save (idempotencia)", () => {
    const once = sanitizeNotesHtml("AT&T");
    expect(sanitizeNotesHtml(once)).toBe(once);
    expect(sanitizeNotesHtml(sanitizeNotesHtml(once))).toBe(once);
  });

  it('preserva "x<10" como texto: "<" + nao-letra e literal para o parser', () => {
    // Contem "<", entao cai no caminho HTML — mas o parser trata "<1" como
    // texto, nao como tag. O valor sobrevive integro (escapado na saida).
    expect(sanitizeNotesHtml("x<10")).toBe("x&lt;10");
  });

  it('documenta a limitacao conhecida: "<" + letra em texto legado vira tag e perde a cauda', () => {
    // Comportamento aceito no discovery (Opcao A): "<abc" abre um tag que
    // nunca fecha; o parser descarta o token incompleto no fim da entrada.
    expect(sanitizeNotesHtml("se x<abc entao")).toBe("se x");
  });

  it("mantem literal texto duplamente escapado (&lt;script&gt;)", () => {
    const input = "&lt;script&gt;alert(1)&lt;/script&gt;";
    const output = sanitizeNotesHtml(input);
    expect(output).toBe(input);
    expect(output).not.toContain("<script");
  });

  it("remove caracteres nulos em vez de repassa-los", () => {
    // Em texto de body o tokenizer HTML IGNORA U+0000 (a substituicao por
    // U+FFFD vale para estados como RAWTEXT) — o caractere some da saida,
    // sem jamais ser repassado cru. Chromium faz o mesmo em producao.
    const output = sanitizeNotesHtml("a\u0000b");
    expect(output).not.toContain("\u0000");
    expect(output).toBe("ab");
  });

  it("devolve string vazia para entrada vazia", () => {
    expect(sanitizeNotesHtml("")).toBe("");
  });
});

describe("sanitizeNotesHtml — payloads de XSS", () => {
  it("elimina <img onerror> por completo (elemento void fora da allowlist)", () => {
    const output = sanitizeNotesHtml('<img src=x onerror=alert(1)>');
    expect(output).toBe("");
    expect(output).not.toMatch(/onerror/i);
  });

  it("elimina <svg onload> e descendentes com on*, preservando so o texto", () => {
    const output = sanitizeNotesHtml('<svg onload=alert(1)><animate onbegin=alert(1)></animate>payload</svg>');
    expect(output).toBe("payload");
    expect(output).not.toMatch(/on(load|begin)/i);
    expectNoAttributes(output);
  });

  it("faz unwrap de <a href=javascript:> sem preservar o href", () => {
    const output = sanitizeNotesHtml('<a href="javascript:alert(1)">click</a>');
    expect(output).toBe("click");
    expect(output).not.toMatch(/javascript:/i);
  });

  it("descarta style malicioso de <code> (o canonico e reimposto no load, fora deste modulo)", () => {
    const output = sanitizeNotesHtml('<code style="background:url(javascript:alert(1))">texto</code>');
    expect(output).toBe("<code>texto</code>");
    expectNoAttributes(output);
  });

  it("nenhum atributo on* sobrevive em payload composto", () => {
    const output = sanitizeNotesHtml(
      '<div onclick="alert(1)"><b onmouseover="alert(2)">a</b><iframe src="https://x"></iframe>' +
        '<form action="javascript:alert(3)"><input value="v"></form></div>',
    );
    expect(output).toBe("<b>a</b><br>");
    expect(output).not.toMatch(/on\w+\s*=/i);
    expectNoAttributes(output);
  });

  it("conteudo de <script> vira texto inerte via unwrap (decisao: nunca descartar conteudo)", () => {
    // O texto sobrevive como no de texto — sem elemento <script>, nada
    // executa. Registrado aqui para a consequencia ficar explicita.
    const output = sanitizeNotesHtml("antes<script>alert(1)</script>depois");
    expect(output).not.toContain("<script");
    expect(output).toContain("antes");
    expect(output).toContain("depois");
  });

  it("nao promove elemento de namespace estrangeiro cujo nome coincide com a allowlist", () => {
    // "del" NAO esta na lista de breakout de foreign content do parser HTML,
    // entao <svg><del> permanece no namespace SVG. Deve sofrer unwrap (com os
    // atributos descartados junto), nao virar um <del> HTML.
    const output = sanitizeNotesHtml('<svg><del onclick="alert(1)">t</del></svg>');
    expect(output).toBe("t");
    expect(output).not.toContain("<del");
    expect(output).not.toMatch(/onclick/i);
  });

  it("limita a profundidade do walk em aninhamento adversarial (cap de 256)", () => {
    // 2000 niveis: bem alem do cap de 256 do walk. O proprio jsdom tem
    // manipulacao de DOM recursiva (estoura a pilha ao MOVER arvores de
    // ~5000 niveis, antes do sanitizador rodar), entao o teste usa uma
    // profundidade que o ambiente suporta e prova o engajamento do cap pela
    // SAIDA exata: 256 niveis de <b> preservados e, alem do limite, o
    // subtree degradado para texto plano — conteudo nunca se perde. Em
    // producao o parser do Blink ainda achata arvores com mais de 512
    // niveis antes de o walk ver qualquer coisa.
    const depth = 2000;
    const input = "<b>".repeat(depth) + "x" + "</b>".repeat(depth);
    const expected = "<b>".repeat(256) + "x" + "</b>".repeat(256);
    expect(sanitizeNotesHtml(input)).toBe(expected);
  });
});

describe("funcoes internas expostas para teste", () => {
  it("sanitizeHtmlWithAllowlist processa mesmo sem '<' na entrada", () => {
    expect(sanitizeHtmlWithAllowlist("texto & simples")).toBe("texto &amp; simples");
  });

  it("escapeLegacyPlainText escapa os tres caracteres sensiveis do serializador", () => {
    expect(escapeLegacyPlainText("a & b")).toBe("a &amp; b");
    expect(escapeLegacyPlainText("a > b")).toBe("a &gt; b");
  });

  it("escapeLegacyPlainText preserva quebras de linha e espacos iniciais", () => {
    expect(escapeLegacyPlainText("\n  comeca com espacos")).toBe("\n  comeca com espacos");
  });
});
