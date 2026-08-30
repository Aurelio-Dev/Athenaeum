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
      && !seletor.includes('[data-chrome="floating"]')
      // A acao primaria tem contrato proprio em materialGlassSurfaces.test;
      // ela nao faz parte da referencia historica dos paineis da Library.
      && !seletor.includes('.material-surface-action')
      // O contrato declarativo de backdrop e ortogonal a pintura historica:
      // em 100 seus fallbacks reproduzem 12px/16px sem mudar o baseline.
      && !seletor.includes('[data-glass-backdrop')
      && !seletor.includes('[data-glass-blur')
      && !seletor.includes('[data-interface-contrast-adjusted'),
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
      expect(regra[1]).toContain('[data-material="glass"]');
      expect(regra[1]).toContain('[data-wallpaper="active"]');
    }
  });

  it("glass docado sem wallpaper preserva a impressao digital do baseline 869952d", () => {
    const normalizado = regrasGlassSemWallpaper(css);
    expect(normalizado.split("\n")).toHaveLength(25);
    // Hash anterior: 14efc6b05c250a9c51f92df13bb1cb01b11fc6d31cfe41eb220e68f33f129063.
    // A família --glass-action-* passou a ser declarada nos blocos
    // [data-material="glass"] e .dark[data-material="glass"], que integram a
    // string normalizada. As regras consumidoras da ação permanecem fora deste
    // baseline pelo filtro de .material-surface-action acima.
    //
    // ATUALIZADO (indicador por luz do controle segmentado): 17 -> 21 regras,
    // hash anterior d1ccac9dc01e7227c1c1676937b66b07429a7d272f9e966b7a47dcf4417fa8ea.
    // Duas mudancas distintas, ambas deliberadas:
    //  1. os sete tokens --glass-control-* entram nos dois blocos glass
    //     compartilhados, exatamente como a familia --glass-action-* fez antes;
    //  2. as QUATRO regras de .material-surface-segment entram na contagem.
    // Diferente da acao primaria, o segmento NAO foi excluido por filtro: ele
    // muda de verdade o glass docado sem wallpaper (terracota -> luz), e e
    // esse tipo de mudanca que este baseline existe para registrar. Esconde-la
    // atras de um filtro deixaria o baseline cego para a proxima. Se a
    // contagem subir sem uma linha nova aqui, e regressao.
    //
    // ATUALIZADO (trilho de vidro das abas): 21 -> 23 regras, hash anterior
    // f7dab5c16d4ceb8901a685cabcdc05390fc4d252860c2a59f4a02dc61b3ae759.
    // Mesma natureza da entrada acima: os cinco tokens --glass-track-* entram
    // nos dois blocos glass, e as DUAS regras de .material-surface-track (o
    // trilho e a aba ativa) entram na contagem. O trilho nao declara filtro
    // proprio, entao nada muda no grupo :is(...) do reset aninhado.
    //
    // ATUALIZADO (fix: largura do trilho): 23 regras mantidas, hash anterior
    // d0132e0aaa2ab2d4d648346ef69518f4ba386594c96d0ec9b133ca4b5be63ecb. Sem
    // regra nova — `width: fit-content` entrou como propriedade a mais na
    // regra ja existente de `.material-surface-track`. O trilho e um `flex`
    // (display block-level) sem largura propria: no flat isso e invisivel,
    // mas com pintura ele esticava para 100% do container, com as tres abas
    // encostadas a esquerda e uma barra vazia a direita.
    //
    // ATUALIZADO (fix: rotulo da aba ativa lavado no escuro): 23 -> 24
    // regras, hash anterior:
    // 1df54267de549ba82272fdc5a68b783a7ad9c3c4ca4591f53be12f8d65dca7c3.
    // Duas mudancas:
    //  1. dois tokens --glass-track-label / --glass-track-label-idle entram
    //     nos dois blocos glass compartilhados;
    //  2. uma regra NOVA para o rotulo inativo entra na contagem (a regra da
    //     aba ativa ja existia — so trocou `color: var(--glass-control-icon)`
    //     por `color: var(--glass-track-label)`, sem mudar a CONTAGEM de
    //     regras, so o hash).
    // --glass-control-icon foi calibrado para o substrato do TOGGLE, escuro
    // no tema escuro; a pilula da aba e sempre tinta branca nos dois temas, e
    // reusar o icone deixava o rotulo do escuro claro sobre pilula clara.
    //
    // ATUALIZADO (fix: hover das abas inativas): 24 -> 25 regras, hash
    // anterior:
    // 0c9532c7c8a465c33ca116967e812dba10fb3d86833444190f2a6edb2af809b5.
    // Um token --glass-track-hover nos dois blocos glass e UMA regra nova
    // para o hover da aba inativa. O JSX pinta `hover:bg-surface-muted`
    // (opaco, cor de --muted), que sob glass viraria um retangulo chapado
    // sobre o trilho translucido; a utilitaria permanece no className porque
    // e o que o flat usa, e o CSS glass a sobrescreve por especificidade
    // (0,4,0 contra 0,2,0), sem !important.
    //
    // ATUALIZADO (base de composicao da familia do trilho): 25 regras
    // mantidas, hash anterior:
    // 59c2cd7b66f9d20bf1845ad6cf6b608dab7d8e8c3ac28bd90828cab832262bce.
    // Nenhuma regra nova — a familia --glass-track-* trocou de FORMA. Era
    // alpha de branco puro (0.38 claro / 0.08 escuro), fora da composicao
    // optica do sistema; passou a ser cor solida de tema com o scrim no canal
    // alpha, como --glass-optical-tint, mais um token novo
    // (--glass-track-selected) e o piso proprio de 0.85.
    // O piso e MAIS ALTO que o 0.6 compartilhado porque o trilho e a unica
    // superficie de vidro que hospeda texto pequeno diretamente sobre o
    // wallpaper. Sem ele, o rotulo caia a 2.18:1 no tema escuro conforme a
    // imagem, e a ordem trilho < hover < ativa chegava a inverter. Medido: o
    // pior dos oito cenarios foi de 4.19 para 8.52 — travado por teste em
    // materialGlassSurfaces.test.ts.
    expect(createHash("sha256").update(normalizado).digest("hex")).toBe(
      "7ee72f1b7d79775d1136cbae5c31312d63c5b177946186c3ddd7dc05e0815750",
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
    const seletoresComFiltro = [...semComentarios.matchAll(/([^{}]*)\{[^{}]*backdrop-filter:\s*[^;]*blur\(var\(--glass-effective-optical-blur,\s*var\(--glass-optical-blur\)\)\)[^;]*saturate\(var\(--glass-optical-saturation\)\)[^{}]*\}/g)]
      .map((match: RegExpMatchArray) => match[1].replace(/\s+/g, " ").trim());

    expect(seletoresComFiltro).toEqual([
      '[data-material="glass"]:where([data-wallpaper="active"][data-wallpaper-translucent="true"]) [data-glass-backdrop="optical"]',
    ]);
    expect(seletoresComFiltro[0]).not.toMatch(/material-liquid-control|immersive|\b(?:input|textarea|form)\b/);
  });

  it("qualquer superficie aninhada desliga o segundo filtro", () => {
    const regraAninhada = [...semComentarios.matchAll(/([^{}]*)\{([^{}]*(?<!-)backdrop-filter:\s*none[^{}]*)\}/g)]
      .map((match: RegExpMatchArray) => ({
        seletor: match[1].replace(/\s+/g, " ").trim(),
        corpo: match[2],
      }))
      .find((regra) => regra.seletor === '[data-material="glass"] [data-glass-backdrop] [data-glass-backdrop]');

    expect(regraAninhada).toBeDefined();
    expect(regraAninhada?.corpo).toContain("-webkit-backdrop-filter: none;");
    expect(regraAninhada?.corpo).toContain("backdrop-filter: none;");
    expect(semComentarios).not.toContain(":is(.material-surface, .material-surface-elevated");
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
