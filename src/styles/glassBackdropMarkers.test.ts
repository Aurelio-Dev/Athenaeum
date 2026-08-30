// @ts-expect-error - sem @types/node no projeto; resolvido em runtime pelo Node.
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

function ler(caminho: string): string {
  return readFileSync(new URL(`../../${caminho}`, import.meta.url), "utf8");
}

type CssRule = {
  selector: string;
  body: string;
};

function normalizeCss(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function cssRules(source: string): CssRule[] {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map((match: RegExpMatchArray) => ({
      selector: normalizeCss(match[1]),
      body: normalizeCss(match[2]),
    }));
}

function arquivosDeProducao(): string[] {
  const raiz = new URL("../../src/", import.meta.url);
  const encontrados: string[] = [];

  function varrer(diretorio: URL, prefixo: string) {
    for (const entrada of readdirSync(diretorio, { withFileTypes: true }) as Array<{
      name: string;
      isDirectory: () => boolean;
    }>) {
      const caminho = `${prefixo}${entrada.name}`;
      if (entrada.isDirectory()) {
        varrer(new URL(`${entrada.name}/`, diretorio), `${caminho}/`);
      } else if (/\.tsx$/.test(entrada.name) && !/\.test\.tsx$/.test(entrada.name)) {
        encontrados.push(caminho);
      }
    }
  }

  varrer(raiz, "src/");
  return encontrados.sort();
}

function arquivosDeProducaoComMarcador(): string[] {
  return arquivosDeProducao().filter((arquivo) => ler(arquivo).includes("data-glass-backdrop"));
}

// Extrai tags de abertura respeitando expressoes JSX. Assim, o `>` de uma
// arrow function dentro de onClick nao encerra a tag antes da hora.
function tagsDeAbertura(fonte: string): string[] {
  const tags: string[] = [];

  for (let inicio = 0; inicio < fonte.length; inicio += 1) {
    if (fonte[inicio] !== "<" || !/[A-Za-z]/.test(fonte[inicio + 1] ?? "")) {
      continue;
    }

    let profundidadeDeChaves = 0;
    let aspas: '"' | "'" | "`" | null = null;

    for (let cursor = inicio + 1; cursor < fonte.length; cursor += 1) {
      const caractere = fonte[cursor];
      const anterior = fonte[cursor - 1];

      if (aspas !== null) {
        if (caractere === aspas && anterior !== "\\") {
          aspas = null;
        }
        continue;
      }

      if (caractere === '"' || caractere === "'" || caractere === "`") {
        aspas = caractere;
      } else if (caractere === "{") {
        profundidadeDeChaves += 1;
      } else if (caractere === "}") {
        profundidadeDeChaves -= 1;
      } else if (caractere === ">" && profundidadeDeChaves === 0) {
        tags.push(fonte.slice(inicio, cursor + 1));
        inicio = cursor;
        break;
      }
    }
  }

  return tags;
}

const PADRAO_DE_SUPERFICIE_OPTICA = /\bmaterial-(?:surface(?:-elevated|-card|-overlay)?|liquid-(?:card|overlay|bar))(?![-\w])/;

type SuperficieOptica = {
  arquivo: string;
  tag: string;
};

function superficiesOpticasDeProducao(): SuperficieOptica[] {
  return arquivosDeProducao().flatMap((arquivo) =>
    tagsDeAbertura(ler(arquivo))
      .filter((tag) => PADRAO_DE_SUPERFICIE_OPTICA.test(tag))
      .map((tag) => ({ arquivo, tag: normalizeCss(tag) })),
  );
}

// Excecoes fechadas: toda superficie optica literal sem marker precisa provar
// por que nao e dona. A lista e deliberadamente pequena e auditavel; um novo
// material-liquid-* esquecido passa a falhar em vez de ficar fora do slider.
const EXCECOES_SEM_DONO: ReadonlyArray<{
  arquivo: string;
  fragmento: string;
  quantidade: number;
  categoria: "aninhada" | "paint-only";
  justificativa: string;
}> = [
  {
    arquivo: "src/components/ui/TagInput.tsx",
    fragmento: "material-liquid-overlay",
    quantidade: 1,
    categoria: "aninhada",
    justificativa: "O menu vive exclusivamente dentro do modal de importacao, que ja possui o backdrop.",
  },
  {
    arquivo: "src/features/library/DocumentDetailsPanel.tsx",
    fragmento: "material-liquid-overlay absolute left-0 right-0 top-full",
    quantidade: 1,
    categoria: "aninhada",
    justificativa: "O seletor de tags permanece dentro da caixa filtrada do painel de detalhes.",
  },
  {
    arquivo: "src/features/library/LibraryToolbar.tsx",
    fragmento: "material-liquid-control material-surface-elevated",
    quantidade: 2,
    categoria: "paint-only",
    justificativa: "Busca e toggle recebem apenas tinta e reutilizam o backdrop da barra; nao criam filtros.",
  },
];

const INVENTARIO: ReadonlyArray<readonly [string, number]> = [
  ["src/components/ConfirmationDialog.tsx", 1],
  ["src/components/EmptyState.tsx", 1],
  ["src/components/InfoDialog.tsx", 1],
  ["src/components/NewCollectionModal.tsx", 1],
  ["src/components/Sidebar.tsx", 3],
  ["src/components/ui/ContextMenu.tsx", 1],
  ["src/features/canvases/CanvasCard.tsx", 1],
  ["src/features/library/AddDocumentModal.tsx", 1],
  ["src/features/library/DocumentCard.tsx", 1],
  ["src/features/library/DocumentDetailsPanel.tsx", 2],
  ["src/features/library/DocumentPickerModal.tsx", 1],
  ["src/features/library/LibraryToolbar.tsx", 1],
  ["src/features/library/LibraryView.tsx", 4],
  ["src/features/library/RenameLibraryItemModal.tsx", 1],
  ["src/features/notebooks/NotebookCard.tsx", 1],
];

describe("LiquidGlass: contrato declarativo dos backdrops", () => {
  it("mantem fechado o inventario de componentes e ocorrencias", () => {
    expect(arquivosDeProducaoComMarcador()).toEqual(
      INVENTARIO.map(([arquivo]) => arquivo).sort(),
    );

    for (const [arquivo, quantidade] of INVENTARIO) {
      const marcados = tagsDeAbertura(ler(arquivo)).filter((tag) =>
        tag.includes("data-glass-backdrop"),
      );
      expect(marcados, `${arquivo}: quantidade inesperada de proprietarios`).toHaveLength(
        quantidade,
      );
    }
  });

  it("aceita apenas os papeis optical e action nos elementos que podem filtrar", () => {
    for (const [arquivo] of INVENTARIO) {
      const marcados = tagsDeAbertura(ler(arquivo)).filter((tag) =>
        tag.includes("data-glass-backdrop"),
      );

      for (const tag of marcados) {
        expect(tag, `${arquivo}: papel desconhecido`).toMatch(
          /data-glass-backdrop=(?:"(?:optical|action)"|\{[^}]*(?:"optical"|"action")[^}]*\})/,
        );
        expect(tag, `${arquivo}: input, textarea ou form nao pode possuir backdrop`).not.toMatch(
          /^<(?:input|textarea|form)\b/,
        );
        expect(tag, `${arquivo}: controle paint-only nao pode possuir backdrop`).not.toContain(
          "material-liquid-control",
        );
        expect(tag, `${arquivo}: superficie imersiva nao pode possuir backdrop`).not.toMatch(
          /(?:material|glass)-immersive|reader-selection-toolbar/,
        );

        if (tag.includes('"action"')) {
          expect(tag, `${arquivo}: action fora de uma acao material`).toContain(
            "material-surface-action",
          );
        } else {
          const possuiClasseOptica = PADRAO_DE_SUPERFICIE_OPTICA.test(tag);
          // A lista alterna a classe inteira entre grid e superficie elevada;
          // o teste condicional abaixo trava a correspondencia com viewMode.
          expect(
            possuiClasseOptica || tag.includes("className={listClassName}"),
            `${arquivo}: optical fora de uma superficie optica`,
          ).toBe(true);
        }
      }
    }
  });

  it("reprova superficies opticas literais sem marker ou excecao revisada", () => {
    const semDono = superficiesOpticasDeProducao().filter(({ tag }) =>
      !tag.includes("data-glass-backdrop"),
    );
    const justificadas = new Set<SuperficieOptica>();

    for (const excecao of EXCECOES_SEM_DONO) {
      expect(excecao.justificativa.length, `${excecao.arquivo}: justificativa vazia`).toBeGreaterThan(20);
      const correspondencias = semDono.filter(({ arquivo, tag }) =>
        arquivo === excecao.arquivo && tag.includes(excecao.fragmento),
      );
      expect(
        correspondencias,
        `${excecao.arquivo}: inventario ${excecao.categoria} divergiu`,
      ).toHaveLength(excecao.quantidade);
      correspondencias.forEach((superficie) => justificadas.add(superficie));
    }

    const semRevisao = semDono
      .filter((superficie) => !justificadas.has(superficie))
      .map(({ arquivo, tag }) => `${arquivo}: ${tag}`);
    expect(
      semRevisao,
      "Superficie LiquidGlass sem data-glass-backdrop nem excecao explicita",
    ).toEqual([]);
  });
});

describe("LiquidGlass: proprietarios condicionais", () => {
  it("marca a barra apenas quando ela gera caixa no chrome docado", () => {
    const libraryView = ler("src/features/library/LibraryView.tsx");
    const barra = tagsDeAbertura(libraryView).find((tag) =>
      tag.includes("material-liquid-bar contents"),
    ) ?? "";

    expect(libraryView).toContain('const { chrome } = useTheme();');
    expect(barra).toContain(
      'data-glass-backdrop={chrome === "docked" ? "optical" : undefined}',
    );
    expect(barra).not.toContain('data-glass-backdrop="optical"');
  });

  it("devolve a propriedade do backdrop para a acao quando a barra vira contents", () => {
    const libraryView = ler("src/features/library/LibraryView.tsx");
    const acaoDoTopo = tagsDeAbertura(libraryView).find((tag) =>
      tag.includes("material-surface-action"),
    ) ?? "";

    expect(acaoDoTopo).toContain(
      'data-glass-backdrop={chrome === "floating" ? "action" : undefined}',
    );
  });

  it("devolve a propriedade do backdrop para o dropdown quando a barra vira contents", () => {
    const toolbar = ler("src/features/library/LibraryToolbar.tsx");
    const libraryView = ler("src/features/library/LibraryView.tsx");
    const dropdown = tagsDeAbertura(toolbar).find((tag) =>
      tag.includes("material-liquid-overlay material-surface-overlay"),
    ) ?? "";

    expect(dropdown).toContain(
      'data-glass-backdrop={chrome === "floating" ? "optical" : undefined}',
    );
    expect(libraryView).toContain("chrome={chrome}");
  });

  it("marca o container de lista somente quando a classe filtravel esta presente", () => {
    const libraryView = ler("src/features/library/LibraryView.tsx");
    const lista = tagsDeAbertura(libraryView).find((tag) =>
      tag.includes("className={listClassName}"),
    ) ?? "";

    expect(lista).toContain(
      'data-glass-backdrop={viewMode === "list" ? "optical" : undefined}',
    );
  });

  it("portais fixed saem dos donos filtrados e assumem o backdrop real", () => {
    const modal = ler("src/components/NewCollectionModal.tsx");
    const sidebar = ler("src/components/Sidebar.tsx");
    const detalhes = ler("src/features/library/DocumentDetailsPanel.tsx");

    expect(modal).toContain('data-glass-backdrop="optical"');
    expect(modal).toContain("return createPortal(");
    expect(modal).toContain("window.document.body");
    expect(modal).not.toContain("ownsGlassBackdrop");

    expect(sidebar.match(/createPortal\(/g)).toHaveLength(2);
    expect(sidebar.match(/window\.document\.body/g)).toHaveLength(2);
    expect(detalhes.match(/createPortal\(/g)).toHaveLength(1);
    expect(detalhes.match(/window\.document\.body/g)).toHaveLength(1);
  });
});

describe("LiquidGlass: consumo CSS dos marcadores", () => {
  const css = ler("src/styles/index.css");
  const rules = cssRules(css);
  const glassScope = '[data-material="glass"]';
  const opticalSelector = `${glassScope}:where([data-wallpaper="active"][data-wallpaper-translucent="true"]) [data-glass-backdrop="optical"]`;
  const actionSelector = `${glassScope} [data-glass-backdrop="action"]`;
  const nestedSelector = `${glassScope} [data-glass-backdrop] [data-glass-backdrop]`;
  const offSelector = `${glassScope}[data-glass-blur="off"] [data-glass-backdrop]`;
  const adjustedSelector = `${glassScope}:is([data-glass-blur="adjusted"], [data-glass-blur="off"])`;
  const adjustedContrastSelector = `${glassScope}[data-interface-contrast-adjusted="true"]`;

  function bodyOf(selector: string): string {
    const found = rules.find((rule) => rule.selector === selector);
    if (!found) throw new Error(`Regra CSS ausente: ${selector}`);
    return found.body;
  }

  function backdropValues(body: string): { webkit?: string; standard?: string } {
    return {
      webkit: body.match(/-webkit-backdrop-filter:\s*([^;]+);/)?.[1],
      standard: body.match(/(?:^|;\s*)backdrop-filter:\s*([^;]+);/)?.[1],
    };
  }

  it("aplica os filtros somente pelos papeis optical e action, com paridade WebKit", () => {
    const expected = [
      [
        opticalSelector,
        "blur(var(--glass-effective-optical-blur, var(--glass-optical-blur))) saturate(var(--glass-optical-saturation))",
      ],
      [
        actionSelector,
        "blur(var(--glass-effective-action-blur, var(--glass-action-blur))) saturate(var(--glass-action-saturation))",
      ],
    ] as const;

    for (const [selector, filter] of expected) {
      const values = backdropValues(bodyOf(selector));
      expect(values.webkit, `${selector}: filtro WebKit`).toBe(filter);
      expect(values.standard, `${selector}: filtro padrao`).toBe(filter);
    }

    const ownersWithBlur = rules
      .filter((rule) => /(?:^|;)\s*(?:-webkit-)?backdrop-filter:\s*[^;]*blur\(/.test(rule.body))
      .map((rule) => rule.selector)
      .sort();
    expect(ownersWithBlur).toEqual([actionSelector, opticalSelector].sort());
    expect(ownersWithBlur.some((selector) => /material-(?:surface|liquid)-/.test(selector)))
      .toBe(false);
  });

  it("impede empilhamento por marcador e desliga todos os filtros no zero", () => {
    for (const selector of [nestedSelector, offSelector]) {
      expect(backdropValues(bodyOf(selector))).toEqual({
        webkit: "none",
        standard: "none",
      });
    }

    expect(css).not.toContain(
      ":is(.material-surface, .material-surface-elevated, .material-surface-card",
    );
    expect(css).not.toMatch(/data-glass-blur="off"[^{}]*\{[^{}]*blur\(0/);
  });

  it("mapeia ajustes neutros so em glass e preserva os defaults de 100", () => {
    const adjusted = bodyOf(adjustedSelector);
    expect(adjusted).toContain(
      "--glass-effective-action-blur: var(--appearance-glass-action-blur);",
    );
    expect(adjusted).toContain(
      "--glass-effective-optical-blur: var(--appearance-glass-optical-blur);",
    );

    const appearanceConsumers = rules.filter((rule) =>
      rule.body.includes("--appearance-glass-"),
    );
    expect(appearanceConsumers).toHaveLength(2);
    expect(appearanceConsumers.every((rule) => rule.selector.includes(glassScope))).toBe(true);

    const adjustedContrast = bodyOf(adjustedContrastSelector);
    expect(adjustedContrast).toContain(
      "--glass-border: var(--appearance-glass-border);",
    );
    expect(adjustedContrast).toContain(
      "--glass-border-top: var(--appearance-glass-border-top);",
    );
    expect(adjustedContrast).toContain(
      "--glass-border-top-elevated: var(--appearance-glass-border-top-elevated);",
    );

    expect(bodyOf(glassScope)).toContain("--glass-action-blur: 12px;");
    expect(bodyOf(`.dark${glassScope}`)).toContain("--glass-action-blur: 12px;");
    expect(bodyOf(`${glassScope}[data-wallpaper="active"]`)).toContain(
      "--glass-optical-blur: 16px;",
    );
    expect(bodyOf(`.dark${glassScope}[data-wallpaper="active"]`)).toContain(
      "--glass-optical-blur: 16px;",
    );
    expect(css).not.toContain('data-glass-blur="100"');
  });

  it("reduz somente as tints de action pela retention, sem opacity no elemento", () => {
    const adjusted = bodyOf(adjustedSelector);
    for (const state of ["", "-hover", "-active"]) {
      expect(adjusted).toContain(
        `--glass-effective-action-tint${state}: color-mix( in srgb, var(--glass-action-tint${state}) var(--appearance-glass-action-retention), transparent );`,
      );
    }

    const actionBodies = rules
      .filter((rule) => rule.selector.includes("material-surface-action"))
      .map((rule) => rule.body)
      .join(" ");
    expect(actionBodies).not.toMatch(/(?:^|;)\s*opacity\s*:/);
    expect(bodyOf(`${glassScope} .material-surface-action`)).toContain(
      "background-color: var(--glass-effective-action-tint, var(--glass-action-tint));",
    );
  });

  it("remove os hacks de filtro da barra flutuante e oculta a luz noturna na impressao", () => {
    const floatingBar = bodyOf(
      `${glassScope}[data-chrome="floating"] .material-liquid-bar`,
    );
    expect(floatingBar).not.toContain("backdrop-filter");
    expect(
      rules.filter((rule) =>
        rule.selector.includes('[data-chrome="floating"]')
        && rule.body.includes("backdrop-filter"),
      ),
    ).toEqual([]);
    expect(css).toMatch(
      /@media\s+print\s*\{[\s\S]*?\.night-light-layer\s*,[\s\S]*?display:\s*none;/,
    );
  });
});
