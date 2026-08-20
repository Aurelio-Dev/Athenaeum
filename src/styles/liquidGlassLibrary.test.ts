// @ts-expect-error - sem @types/node no projeto; resolvido em runtime pelo Node.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function ler(caminho: string): string {
  return readFileSync(new URL(`../../${caminho}`, import.meta.url), "utf8");
}

const css = ler("src/styles/index.css");
const semComentarios = css.replace(/\/\*[\s\S]*?\*\//g, "");
const ESCOPO_ATIVO = '[data-material="glass"][data-wallpaper="active"]';
const ESCOPO_TRANSLUCIDO = `${ESCOPO_ATIVO}[data-wallpaper-translucent="true"]`;

describe("Liquid Glass da Library: isolamento", () => {
  it("todo marcador liquid so recebe CSS sob glass com wallpaper", () => {
    const seletores = [...semComentarios.matchAll(/([^{}]*)\{/g)]
      .map((match: RegExpMatchArray) => match[1].trim())
      .filter((seletor: string) => seletor.includes(".material-liquid-"));

    expect(seletores.length).toBeGreaterThan(0);
    expect(
      seletores.filter((seletor: string) => !seletor.includes(ESCOPO_ATIVO)),
    ).toEqual([]);
  });

  it("tokens opticos nao vazam para flat nem para glass sem imagem", () => {
    const regrasComToken = [...semComentarios.matchAll(/([^{}]*)\{([^{}]*--glass-liquid-[^{}]*)\}/g)];

    expect(regrasComToken.length).toBeGreaterThan(0);
    for (const regra of regrasComToken) {
      expect(regra[1]).toContain(ESCOPO_ATIVO);
    }
  });

  it("usa borda especular sem pseudo-elemento", () => {
    expect(css).toContain("--glass-liquid-edge:");
    expect(css).toContain("--glass-liquid-inset-elevated:");
    expect(css).toContain("var(--glass-surface-elevated) padding-box");
    expect(css).toContain("var(--glass-liquid-edge-elevated) border-box");
    expect(css).not.toMatch(/\.material-liquid-[^{:]*(?:::before|::after)/);
  });

  it("o wrapper da faixa nao cria caixa nova fora do wallpaper", () => {
    const libraryView = ler("src/features/library/LibraryView.tsx");
    expect(libraryView).toContain('className="material-liquid-bar contents"');
    expect(css).toMatch(
      /\[data-material="glass"\]\[data-wallpaper="active"\]\s+\.material-liquid-bar\s*\{[^}]*display:\s*block;/,
    );
  });
});

describe("Liquid Glass da Library: composicao", () => {
  it("backdrop-filter exige alpha visivel e nunca alcanca controles", () => {
    const seletoresComFiltro = [...semComentarios.matchAll(/([^{}]*)\{[^{}]*backdrop-filter:\s*var\(--glass-liquid-filter\)[^{}]*\}/g)]
      .map((match: RegExpMatchArray) => match[1]);

    expect(seletoresComFiltro.length).toBeGreaterThan(0);
    for (const seletor of seletoresComFiltro) {
      for (const parte of seletor.split(",")) {
        expect(parte).toContain(ESCOPO_TRANSLUCIDO);
        expect(parte.replace(":not(.material-liquid-control)", "")).not.toContain(
          ".material-liquid-control",
        );
        expect(parte).not.toContain("immersive");
      }
    }
  });

  it("overlays aninhados desligam o segundo filtro", () => {
    const regrasSemFiltro = [...semComentarios.matchAll(/([^{}]*)\{[^{}]*backdrop-filter:\s*none[^{}]*\}/g)]
      .map((match: RegExpMatchArray) => `${match[1]} { ${match[0]} }`)
      .join("\n");

    expect(regrasSemFiltro).toContain(`${ESCOPO_TRANSLUCIDO} .material-liquid-bar .material-surface-overlay`);
    expect(regrasSemFiltro).toContain(`${ESCOPO_TRANSLUCIDO} .material-surface-elevated .material-liquid-overlay`);
  });
});

describe("Liquid Glass da Library: cobertura semantica", () => {
  const ALVOS: ReadonlyArray<readonly [string, string, string]> = [
    ["src/features/library/LibraryView.tsx", "material-liquid-bar", "faixa superior"],
    ["src/features/library/LibraryView.tsx", "material-liquid-control", "busca"],
    ["src/features/library/LibraryHeader.tsx", "material-liquid-control", "editar colecao"],
    ["src/features/library/LibraryToolbar.tsx", "material-liquid-control", "toolbar"],
    ["src/features/notebooks/NotebookCard.tsx", "material-liquid-card", "card de caderno"],
    ["src/features/canvases/CanvasCard.tsx", "material-liquid-card", "card de quadro"],
    ["src/components/ui/ContextMenu.tsx", "material-liquid-overlay", "menu contextual"],
    ["src/components/Sidebar.tsx", "material-liquid-overlay", "menu da sidebar"],
    ["src/components/ui/TagInput.tsx", "material-liquid-overlay", "sugestoes de tag"],
    ["src/features/library/DocumentDetailsPanel.tsx", "material-liquid-overlay", "seletor de tags"],
  ];

  it.each(ALVOS)("%s inclui %s (%s)", (arquivo, marcador) => {
    expect(ler(arquivo)).toContain(marcador);
  });

  it("menus contextuais nao mantem pintura inline que venceria o material", () => {
    const contextMenu = ler("src/components/ui/ContextMenu.tsx");
    expect(contextMenu).not.toContain('background: "var(--color-surface-card)"');
    expect(contextMenu).not.toContain('border: "1px solid var(--color-border-subtle)"');
    expect(contextMenu).not.toContain('boxShadow: "0 8px 24px');
  });

  it("preview e frames imersivos continuam fora do material liquid", () => {
    for (const arquivo of [
      "src/features/library/DocumentPreview.tsx",
      "src/components/floating/FloatingPanelFrame.tsx",
    ]) {
      expect(ler(arquivo)).not.toContain("material-liquid-");
    }
  });
});
