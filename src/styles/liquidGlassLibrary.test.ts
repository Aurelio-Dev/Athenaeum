// @ts-expect-error - sem @types/node no projeto; resolvido em runtime pelo Node.
import { createHash } from "node:crypto";
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
const ESCOPO_FLUTUANTE = '[data-material="glass"][data-chrome="floating"]';

function regrasGlassSemWallpaper(codigo: string): string {
  const limpo = codigo.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...limpo.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map((match: RegExpMatchArray) => [match[1].trim(), match[2].trim()] as const)
    .filter(([seletor]) =>
      seletor.includes('[data-material="glass"]')
      && !seletor.includes('[data-wallpaper="active"]')
      // O baseline é o glass docado. O chrome flutuante tem regras próprias
      // deliberadamente fora do wallpaper e não pode alterar esta referência.
      && !seletor.includes('[data-chrome="floating"]'),
    )
    .map(([seletor, corpo]) =>
      `${seletor.replace(/\s+/g, " ")} { ${corpo.replace(/\s+/g, " ")} }`,
    )
    .join("\n");
}

describe("Liquid Glass da Library: isolamento", () => {
  it("todo marcador liquid so recebe CSS sob glass com wallpaper", () => {
    const seletores = [...semComentarios.matchAll(/([^{}]*)\{/g)]
      .map((match: RegExpMatchArray) => match[1].trim())
      .filter((seletor: string) => seletor.includes(".material-liquid-"));

    expect(seletores.length).toBeGreaterThan(0);
    expect(
      seletores.filter(
        (seletor: string) =>
          !seletor.includes(ESCOPO_ATIVO)
          && !(seletor.includes(ESCOPO_FLUTUANTE) && seletor.includes(".material-liquid-bar")),
      ),
    ).toEqual([]);
  });

  it("tokens opticos nao vazam para flat nem para glass sem imagem", () => {
    const regrasComToken = [...semComentarios.matchAll(/([^{}]*)\{([^{}]*--glass-optical-[^{}]*)\}/g)];

    expect(regrasComToken.length).toBeGreaterThan(0);
    for (const regra of regrasComToken) {
      expect(regra[1]).toContain(ESCOPO_ATIVO);
    }
  });

  it("glass docado sem wallpaper preserva a impressao digital do baseline 869952d", () => {
    const normalizado = regrasGlassSemWallpaper(css);
    expect(normalizado.split("\n")).toHaveLength(17);
    expect(createHash("sha256").update(normalizado).digest("hex")).toBe(
      "14efc6b05c250a9c51f92df13bb1cb01b11fc6d31cfe41eb220e68f33f129063",
    );
  });

  it("separa os sete papeis opticos em tokens explicitos", () => {
    const tokens = [
      "--glass-optical-tint",
      "--glass-optical-edge-specular",
      "--glass-optical-edge-shadow",
      "--glass-optical-inner-glow",
      "--glass-optical-outer-shadow",
      "--glass-optical-blur",
      "--glass-optical-saturation",
    ];

    const blocoClaro = semComentarios.match(
      /\[data-material="glass"\]\[data-wallpaper="active"\]\s*\{([^}]*)\}/,
    )?.[1] ?? "";
    const blocoEscuro = semComentarios.match(
      /\.dark\[data-material="glass"\]\[data-wallpaper="active"\]\s*\{([^}]*)\}/,
    )?.[1] ?? "";

    for (const token of tokens) {
      expect(blocoClaro, `${token} ausente no claro`).toContain(`${token}:`);
      expect(blocoEscuro, `${token} ausente no escuro`).toContain(`${token}:`);
    }
    expect(`${blocoClaro}\n${blocoEscuro}`).not.toContain("--glass-liquid-filter");
    expect(`${blocoClaro}\n${blocoEscuro}`).not.toContain("brightness(");
  });

  it("usa dois backgrounds para a borda direcional, sem pseudo-elemento", () => {
    expect(css).toContain(
      "linear-gradient(var(--glass-optical-tint-elevated), var(--glass-optical-tint-elevated)) padding-box",
    );
    expect(css).toMatch(
      /linear-gradient\(\s*135deg,\s*var\(--glass-optical-edge-specular\) 0%,\s*var\(--glass-optical-edge-specular-fade\) 40%,\s*var\(--glass-optical-edge-shadow\) 100%\s*\) border-box/,
    );
    expect(css).toContain("border-color: transparent;");
    expect(css).not.toMatch(/\.material-liquid-[^{:]*(?:::before|::after)/);
  });

  it("mantem blur e saturacao dentro da faixa aprovada", () => {
    const blurs = [...css.matchAll(/--glass-optical-blur:\s*([\d.]+)px/g)]
      .map((match: RegExpMatchArray) => Number(match[1]));
    const saturacoes = [...css.matchAll(/--glass-optical-saturation:\s*([\d.]+)/g)]
      .map((match: RegExpMatchArray) => Number(match[1]));

    expect(blurs).toHaveLength(2);
    expect(saturacoes).toHaveLength(2);
    expect(blurs.every((valor) => valor >= 14 && valor <= 18)).toBe(true);
    expect(saturacoes.every((valor) => valor >= 1.1 && valor <= 1.2)).toBe(true);
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
    const seletoresComFiltro = [...semComentarios.matchAll(/([^{}]*)\{[^{}]*backdrop-filter:\s*[^;]*blur\(var\(--glass-optical-blur\)\)[^;]*saturate\(var\(--glass-optical-saturation\)\)[^{}]*\}/g)]
      .map((match: RegExpMatchArray) => match[1]);

    expect(seletoresComFiltro.length).toBeGreaterThan(0);
    for (const seletor of seletoresComFiltro) {
      for (const parte of seletor.split(",")) {
        expect(parte).toContain(ESCOPO_TRANSLUCIDO);
        expect(parte.replace(":not(.material-liquid-control)", "")).not.toContain(
          ".material-liquid-control",
        );
        expect(parte).not.toContain("immersive");
        expect(parte).not.toMatch(/\b(?:input|textarea|form)\b/);
      }
    }
  });

  it("qualquer superficie aninhada desliga o segundo filtro", () => {
    const regrasSemFiltro = [...semComentarios.matchAll(/([^{}]*)\{[^{}]*(?<!-)backdrop-filter:\s*none[^{}]*\}/g)]
      .map((match: RegExpMatchArray) => match[1])
      .join("\n");

    expect(regrasSemFiltro).toContain(ESCOPO_TRANSLUCIDO);
    const grupo = ":is(.material-surface, .material-surface-elevated, .material-surface-card, .material-surface-overlay, .material-liquid-card, .material-liquid-overlay, .material-liquid-bar)";
    expect(regrasSemFiltro.split(grupo)).toHaveLength(3);
  });
});

describe("Liquid Glass da Library: cobertura semantica", () => {
  const ALVOS: ReadonlyArray<readonly [string, string, string]> = [
    ["src/features/library/LibraryView.tsx", "material-liquid-bar", "faixa superior"],
    ["src/features/library/LibraryView.tsx", "material-liquid-control", "busca"],
    ["src/features/library/LibraryHeader.tsx", "material-liquid-control", "editar colecao"],
    ["src/features/library/LibraryToolbar.tsx", "material-liquid-control", "toolbar"],
    ["src/features/library/LibraryToolbar.tsx", "material-liquid-overlay", "menu de ordenacao"],
    ["src/features/library/DocumentCard.tsx", "material-liquid-card", "card de documento"],
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

  it("os tres tipos de card acumulam os marcadores do mesmo papel semantico", () => {
    for (const arquivo of [
      "src/features/library/DocumentCard.tsx",
      "src/features/notebooks/NotebookCard.tsx",
      "src/features/canvases/CanvasCard.tsx",
    ]) {
      expect(ler(arquivo)).toContain("material-liquid-card material-surface-card");
    }
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

  it("inputs, textarea, formularios e preview nao carregam marcador filtravel", () => {
    for (const arquivo of [
      "src/features/library/AddDocumentModal.tsx",
      "src/features/library/DocumentDetailsPanel.tsx",
      "src/features/library/DocumentPreview.tsx",
      "src/components/ui/TagInput.tsx",
    ]) {
      const fonte = ler(arquivo);
      const inicios = [...fonte.matchAll(/<(?:input|textarea|form)\b/g)]
        .map((match: RegExpMatchArray) => match.index ?? -1);

      for (const inicio of inicios) {
        const trecho = fonte.slice(inicio, inicio + 1_500);
        const primeiraClasse = trecho.match(/className\s*=\s*["'`]([^"'`]*)["'`]/)?.[1] ?? "";
        expect(primeiraClasse).not.toMatch(/material-(?:surface|liquid)-(?:card|overlay|bar)/);
      }
    }
  });
});
