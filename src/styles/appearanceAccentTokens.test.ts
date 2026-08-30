// @ts-expect-error - sem @types/node no projeto; resolvido em runtime pelo Node.
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { calculateContrastRatio, deriveAccentPalette } from "../lib/appearancePreferences";

function ler(caminho: string): string {
  return readFileSync(new URL(`../../${caminho}`, import.meta.url), "utf8");
}

function arquivosTsx(): Array<{ caminho: string; fonte: string }> {
  const raiz = new URL("../../src/", import.meta.url);
  const encontrados: Array<{ caminho: string; fonte: string }> = [];

  function varrer(diretorio: URL, prefixo: string) {
    for (const entrada of readdirSync(diretorio, { withFileTypes: true }) as Array<{
      name: string;
      isDirectory: () => boolean;
    }>) {
      const caminho = `${prefixo}${entrada.name}`;
      if (entrada.isDirectory()) {
        varrer(new URL(`${entrada.name}/`, diretorio), `${caminho}/`);
      } else if (/\.tsx$/.test(entrada.name) && !/\.test\.tsx$/.test(entrada.name)) {
        encontrados.push({
          caminho,
          fonte: readFileSync(new URL(entrada.name, diretorio), "utf8"),
        });
      }
    }
  }

  varrer(raiz, "src/");
  return encontrados;
}

describe("tokens do destaque personalizavel", () => {
  it("separa foreground primario, inverso fixo e accent de conteudo", () => {
    const css = ler("src/styles/index.css");
    expect(css).toContain("--color-text-inverse: #FFFFFF;");
    expect(css).toContain("--color-primary-foreground: var(--primary-foreground);");
    expect(
      [...css.matchAll(/--color-primary-text:\s*([^;]+);/g)].map((match) => match[1]),
    ).toEqual(["#814A26", "#CE8757"]);
    expect(css).toContain("--color-content-accent: #9C5A2E;");
    expect(css).toContain("--diagram-accent: var(--color-content-accent);");

    const tailwind = ler("tailwind.config.cjs");
    expect(tailwind).toContain('foreground: "var(--color-primary-foreground)"');
    expect(tailwind).toContain('text: "var(--color-primary-text)"');
  });

  it("mantem Canvas e diagramas fora do destaque escolhido para a UI", () => {
    const canvas = ler("src/features/canvases/CanvasPanel.tsx");
    expect(canvas).toContain('getCanvasCssColor("--color-content-accent", "#9C5A2E")');
    expect(canvas).not.toContain('getCanvasCssColor("--accent"');
  });

  it("mantem os foregrounds padrao AA em todas as superficies dos temas", () => {
    for (const [name, expected, surface, additionalSurfaces] of [
      ["light", "#814A26", "#F5EDE4", ["#FAF5EF", "#EDE5DA", "#D8CCBD"]],
      ["dark", "#CE8757", "#1A1410", ["#231C16", "#2E2018", "#140F0B"]],
    ] as const) {
      const palette = deriveAccentPalette("#9C5A2E", surface, additionalSurfaces);
      expect(palette.text, name).toBe(expected);
      for (const target of [surface, palette.soft, ...additionalSurfaces]) {
        expect(calculateContrastRatio(palette.text, target), `${name}:${target}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("nao fixa branco sobre preenchimentos primarios personalizaveis", () => {
    const violacoes = arquivosTsx().flatMap(({ caminho, fonte }) => {
      const trechos = [
        ...fonte.matchAll(/bg-primary[^"'`\r\n]*(?:text-white|text-text-inverse)/g),
        ...fonte.matchAll(/hover:bg-primary[^"'`\r\n]*hover:text-(?:white|text-inverse)/g),
        ...fonte.matchAll(/bg-sidebar-active[^"'`\r\n]*(?:text-white|text-text-inverse)/g),
      ];
      return trechos.map((match) => `${caminho}: ${match[0]}`);
    });

    expect(violacoes).toEqual([]);
    expect(ler("src/components/CompactDocumentCard.tsx")).toContain(
      "bg-status-red px-1.5 py-1 text-text-inverse",
    );
  });

  it("nao usa a cor bruta do destaque como foreground da UI", () => {
    const violacoes = arquivosTsx().flatMap(({ caminho, fonte }) => {
      const trechos = [
        ...fonte.matchAll(/(?:^|[\s"'`])((?:[a-z-]+:)*text-primary)(?![-a-z0-9])/gim),
        ...fonte.matchAll(/text-\[[^\]\r\n]*var\(--(?:accent|color-primary)\)[^\]\r\n]*\]/g),
        ...fonte.matchAll(/\bcolor\s*:\s*["'`]var\(--(?:accent|color-primary)\)/g),
      ];
      return trechos.map((match) => `${caminho}: ${match[1] ?? match[0]}`);
    });

    expect(violacoes).toEqual([]);
    expect(ler("src/features/canvases/CanvasToolbar.tsx")).toContain(
      "text-[var(--color-primary-text)]",
    );
    expect(ler("src/styles/index.css")).toMatch(
      /\.notebook-editor a\s*{\s*color:\s*var\(--color-primary\);/,
    );
  });
});
