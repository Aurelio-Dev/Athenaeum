// @ts-expect-error - sem @types/node no projeto; resolvido em runtime pelo Node.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function ler(caminho: string): string {
  return readFileSync(new URL(`../../${caminho}`, import.meta.url), "utf8");
}

const css = ler("src/styles/index.css").replace(/\/\*[\s\S]*?\*\//g, "");

type Regra = { seletor: string; corpo: string };

const REGRAS: Regra[] = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(
  (achado: RegExpMatchArray) => ({
    seletor: achado[1].trim(),
    corpo: achado[2].replace(/\s+/g, " ").trim(),
  }),
);

// Onde cada titulo de pagina/secao vive hoje. Um titulo que sair desta lista
// deixa de acompanhar o slider sem ninguem perceber; um titulo novo tem de
// entrar aqui de propria vontade.
const TITULOS_NO_JSX: ReadonlyArray<readonly [string, string, number]> = [
  ["src/features/library/LibraryHeader.tsx", "app-title-page", 1],
  ["src/features/notebooks/NotebookContent.tsx", "app-title", 1],
  ["src/features/reader/ReaderAnnotationsDock.tsx", "app-title", 1],
  ["src/features/settings/AppearanceSettings.tsx", "app-title", 1],
  ["src/features/settings/KeyboardShortcutsSettings.tsx", "app-title", 1],
  ["src/features/settings/LocalAiSettings.tsx", "app-title", 1],
  ["src/features/settings/SettingsPanel.tsx", "app-title", 2],
];

// Os comentarios do codigo citam as classes de proposito e envenenariam a
// contagem.
function semComentarios(fonte: string): string {
  return fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");
}

function regra(seletor: string): Regra {
  const achada = REGRAS.find((candidata) => candidata.seletor === seletor);
  if (!achada) throw new Error(`Regra CSS ausente: ${seletor}`);
  return achada;
}

describe("contraste dos titulos", () => {
  it("aplica somente cor, sem tocar em tamanho ou espacamento", () => {
    // O eixo e de contraste: mexer em font-size aqui mudaria o layout de
    // cabecalhos e cartoes por tabela.
    for (const seletor of [".app-title", ".app-title-page", ".dark .app-title-page"]) {
      const corpo = regra(seletor).corpo;
      expect(corpo, `${seletor}: deve declarar cor`).toContain("color:");
      expect(corpo, `${seletor}: nao pode alterar tipografia`).not.toMatch(
        /font-size|line-height|padding|letter-spacing/,
      );
    }
  });

  it("cai no fallback historico de cada tema quando nao ha override", () => {
    // O padrao 100% nao publica nada: o visual historico tem de sobreviver
    // inteiro pelo fallback do var().
    expect(regra(".app-title").corpo).toBe(
      "color: var(--appearance-title-text, var(--foreground));",
    );
    expect(regra(".app-title-page").corpo).toBe(
      "color: var(--appearance-title-page-text, #2C1810);",
    );
    expect(regra(".dark .app-title-page").corpo).toBe(
      "color: var(--appearance-title-page-text, #F0E8DF);",
    );
  });

  it("mantem fechado o inventario de titulos que acompanham o slider", () => {
    for (const [caminho, classe, quantidade] of TITULOS_NO_JSX) {
      const fonte = semComentarios(ler(caminho));
      // `app-title-page` contem `app-title`: a contagem usa limite de palavra
      // para as duas classes nao se confundirem.
      const ocorrencias = fonte.match(new RegExp(`${classe}(?![-\w])`, "g"))?.length ?? 0;
      expect(ocorrencias, `${caminho}: ${classe}`).toBe(quantidade);
    }
  });

  it("nao deixa utilitaria de cor competindo com a classe no mesmo elemento", () => {
    // Duas classes simples empatariam em especificidade e a vitoria passaria a
    // depender da ordem do CSS gerado pelo Tailwind.
    for (const [caminho] of TITULOS_NO_JSX) {
      // Todo className de titulo cabe numa linha; a checagem e por linha para
      // nao depender de casar a tag inteira, que contem expressoes JSX com `>`.
      const linhas = semComentarios(ler(caminho))
        .split("\n")
        .filter((linha) => linha.includes("app-title"));
      expect(linhas.length, `${caminho}: titulo nao encontrado`).toBeGreaterThan(0);

      for (const linha of linhas) {
        // `placeholder:text-[...]` pinta o placeholder, nao o titulo.
        expect(linha, `${caminho}: utilitaria de cor no titulo`).not.toMatch(
          /(?<!placeholder:)\btext-(?:text-primary\b|\[var\(--foreground\)\]|\[#)/,
        );
      }
    }
  });

  it("nao aplica o eixo a titulos de cartao nem a marca do app", () => {
    for (const caminho of [
      "src/features/library/DocumentCard.tsx",
      "src/features/notebooks/NotebookCard.tsx",
      "src/features/canvases/CanvasCard.tsx",
      "src/components/Sidebar.tsx",
    ]) {
      expect(ler(caminho), `${caminho}: cartao/marca fora do eixo`).not.toContain("app-title");
    }
  });
});
