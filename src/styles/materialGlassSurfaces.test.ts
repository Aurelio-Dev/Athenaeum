import { describe, expect, it } from "vitest";
// @ts-expect-error - sem @types/node no projeto; resolvido em runtime pelo Node.
import { readFileSync, readdirSync } from "node:fs";
import { contraste, css } from "./tokenContrast.helpers";

// O material glass e aplicado 100% por CSS, sob [data-material="glass"]. Este
// teste trava os dois lados desse contrato, no mesmo espirito do bloco de
// testes de material da SelectionToolbar:
//
//  1. FLAT CONTINUA BYTE-IDENTICO. As classes .material-surface* nao podem ter
//     nenhuma regra fora do escopo glass. Se alguem der estilo proprio a elas,
//     o material flat muda sem que ninguem tenha pedido — e o eixo de material
//     deixa de ser ortogonal a paleta.
//  2. CADA SUPERFICIE CONSOME O TOKEN CERTO. O mapeamento e por papel
//     (base / elevada / card / overlay), nao por componente.
//
// Le os arquivos como texto pelo mesmo motivo dos testes de contraste: quebrar
// quando alguem mexe no valor, e nao so re-afirmar aqui o que ja foi escrito la.

function ler(caminho: string): string {
  return readFileSync(new URL(`../../${caminho}`, import.meta.url), "utf8");
}

function arquivosComMarcador(marcador: string): string[] {
  const raiz = new URL("../../src/", import.meta.url);
  const encontrados = new Set<string>();

  function varrer(dir: URL, prefixo: string) {
    for (const entrada of readdirSync(dir, { withFileTypes: true }) as Array<{
      name: string;
      isDirectory: () => boolean;
    }>) {
      const caminho = `${prefixo}${entrada.name}`;
      if (entrada.isDirectory()) {
        varrer(new URL(`${entrada.name}/`, dir), `${caminho}/`);
      } else if (/\.tsx?$/.test(entrada.name) && !/\.test\.tsx?$/.test(entrada.name)) {
        if (readFileSync(new URL(entrada.name, dir), "utf8").includes(marcador)) {
          encontrados.add(caminho);
        }
      }
    }
  }

  varrer(raiz, "src/");
  return [...encontrados].sort();
}

function ocorrenciasDaClasse(classe: string): string[] {
  const raiz = new URL("../../src/", import.meta.url);
  const encontrados: string[] = [];
  const padrao = new RegExp(`${classe}(?=[\\s"\`])`, "g");

  function varrer(dir: URL, prefixo: string) {
    for (const entrada of readdirSync(dir, { withFileTypes: true }) as Array<{
      name: string;
      isDirectory: () => boolean;
    }>) {
      const caminho = `${prefixo}${entrada.name}`;
      if (entrada.isDirectory()) {
        varrer(new URL(`${entrada.name}/`, dir), `${caminho}/`);
      } else if (/\.tsx?$/.test(entrada.name) && !/\.test\.tsx?$/.test(entrada.name)) {
        const fonte = readFileSync(new URL(entrada.name, dir), "utf8");
        for (const _ocorrencia of fonte.matchAll(padrao)) {
          encontrados.push(caminho);
        }
      }
    }
  }

  varrer(raiz, "src/");
  return encontrados.sort();
}

function coocorremMarcadorEConstanteComFundo(
  fonte: string,
  marcador: string,
  fundo: string,
): boolean {
  const valoresDeConstantes = [...fonte.matchAll(/const\s+[A-Z_]+\s*=\s*"([^"]*)"/g)]
    .map((m: RegExpMatchArray) => m[1].split(/\s+/));
  return fonte.includes(marcador)
    && valoresDeConstantes.some((classes) => classes.includes(fundo));
}

const MARCADORES = [
  "material-surface",
  "material-surface-elevated",
  "material-surface-card",
  "material-surface-overlay",
] as const;

const MARCADOR_DE_ILHA = "material-island";

describe("material island: marcador exclusivamente geometrico", () => {
  it("nao recebe propriedades de pintura", () => {
    // A Leva 2B pode usar este gancho para margem, padding, gap e raio. Fundo,
    // cor de borda e sombra continuam pertencendo aos marcadores de superficie.
    const semComentarios = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const regrasDaIlha = [...semComentarios.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter((m: RegExpMatchArray) => m[1].includes(`.${MARCADOR_DE_ILHA}`));
    const propriedadesProibidas = new Set(["background", "border-color", "box-shadow"]);
    const violacoes = regrasDaIlha.flatMap((regra: RegExpMatchArray) => {
      const seletor = regra[1].trim();
      const propriedades = [...regra[2].matchAll(/(?:^|;)\s*([\w-]+)\s*:/g)]
        .map((m: RegExpMatchArray) => m[1])
        .filter((propriedade: string) => propriedadesProibidas.has(propriedade));
      return propriedades.map((propriedade: string) => `${seletor}: ${propriedade}`);
    });

    expect(violacoes, "material-island recebeu propriedade de pintura").toEqual([]);
  });
});

describe("material glass: Library no chrome flutuante", () => {
  const ESCOPO_ILHAS = '[data-material="glass"][data-chrome="floating"]';
  const ESCOPO_ILHAS_ESCURAS = `.dark${ESCOPO_ILHAS}`;
  const regras = [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map((m: RegExpMatchArray) => ({ seletor: m[1].trim(), corpo: m[2].trim() }));

  function partesDoSeletor(seletor: string): string[] {
    return seletor.split(",").map((parte) => parte.trim());
  }

  function propriedades(corpo: string): string[] {
    return [...corpo.matchAll(/(?:^|;)\s*([\w-]+)\s*:/g)]
      .map((m: RegExpMatchArray) => m[1]);
  }

  function regraDaLeva(criterio: (regra: { seletor: string; corpo: string }) => boolean) {
    const encontrada = regras.find(criterio);
    if (!encontrada) throw new Error("Regra de ilhas da Library nao encontrada");
    return encontrada;
  }

  it("toda regra de chrome e consumo de token de ilha fica no escopo flutuante", () => {
    const regrasDaLeva = regras.filter((regra) =>
      regra.seletor.includes("[data-chrome")
      || regra.corpo.includes("--glass-island-")
      || regra.seletor.includes(`.${MARCADOR_DE_ILHA}`),
    );

    expect(regrasDaLeva, "nenhuma regra de ilhas encontrada").not.toEqual([]);
    const partesForaDoEscopo = regrasDaLeva.flatMap((regra) =>
      partesDoSeletor(regra.seletor).filter((parte) => !parte.includes(ESCOPO_ILHAS)),
    );
    expect(partesForaDoEscopo, "regra de ilhas fora do chrome flutuante").toEqual([]);
  });

  it("declara e consome os cinco tokens fechados das ilhas", () => {
    const blocoGlass = regraDaLeva((regra) => regra.seletor === ESCOPO_ILHAS).corpo;
    const blocoGlassEscuro = regraDaLeva((regra) => regra.seletor === ESCOPO_ILHAS_ESCURAS).corpo;
    const tokens = {
      "--glass-island-gutter": "24px",
      "--glass-island-window-inset": "24px",
      "--glass-island-radius": "16px",
      "--glass-island-outline": "rgb(44 26 16 / 0.14)",
      "--glass-island-shadow": "0 4px 16px -8px rgb(44 26 16 / 0.24)",
    };
    const variantesEscuras = {
      "--glass-island-outline": "rgba(255, 255, 255, 0.14)",
      "--glass-island-shadow": "0 4px 16px -8px rgb(0 0 0 / 0.55)",
    };

    const tokensDeclarados = [...blocoGlass.matchAll(/(--glass-island-[\w-]+)\s*:/g)]
      .map((m: RegExpMatchArray) => m[1]);
    expect(tokensDeclarados).toEqual(Object.keys(tokens));
    const tokensEscurosDeclarados = [...blocoGlassEscuro.matchAll(/(--glass-island-[\w-]+)\s*:/g)]
      .map((m: RegExpMatchArray) => m[1]);
    expect(tokensEscurosDeclarados).toEqual(Object.keys(variantesEscuras));

    for (const [token, valor] of Object.entries(tokens)) {
      expect(blocoGlass, `${token} ausente ou alterado`).toContain(`${token}: ${valor};`);
      const consumidores = regras.filter((regra) => regra.corpo.includes(`var(${token})`));
      expect(consumidores.length, `${token} sem consumidor`).toBeGreaterThan(0);
      expect(
        consumidores.every((regra) =>
          partesDoSeletor(regra.seletor).every((parte) => parte.includes(ESCOPO_ILHAS)),
        ),
      ).toBe(true);
    }

    for (const [token, valor] of Object.entries(variantesEscuras)) {
      expect(blocoGlassEscuro, `${token} escuro ausente ou alterado`).toContain(`${token}: ${valor};`);
    }
  });

  it("reserva a margem no AppShell e usa gap, nunca margem, entre as regioes", () => {
    const appShell = regraDaLeva((regra) =>
      regra.seletor === `${ESCOPO_ILHAS} .wallpaper-backdrop-root`,
    ).corpo;
    const workspace = regraDaLeva((regra) =>
      regra.seletor === `${ESCOPO_ILHAS} main > div:has(> .material-island)`,
    ).corpo;
    const raio = regraDaLeva((regra) => regra.corpo.includes("var(--glass-island-radius)"));

    expect(appShell).toContain("padding: var(--glass-island-window-inset);");
    expect(appShell).toContain("gap: var(--glass-island-gutter);");
    expect(appShell).not.toContain("margin:");
    expect(workspace).toContain("gap: var(--glass-island-gutter);");
    expect(workspace).not.toContain("margin:");
    expect(partesDoSeletor(raio.seletor)).toEqual([
      `${ESCOPO_ILHAS} .material-island.material-surface`,
      `${ESCOPO_ILHAS} .material-island.material-surface-elevated`,
    ]);
    expect(raio.corpo).toBe("border-radius: var(--glass-island-radius);");

    const margensDaLeva = regras
      .filter((regra) => regra.seletor.includes(ESCOPO_ILHAS))
      .flatMap((regra) => propriedades(regra.corpo).filter((propriedade) => propriedade.startsWith("margin")));
    expect(margensDaLeva, "a calha nao pode vir de margem nos filhos").toEqual([]);
  });

  it("da acabamento somente as duas ilhas pintadas e neutraliza suas divisorias", () => {
    const regrasDasDuasSuperficies = regras.filter((regra) =>
      regra.seletor.includes("aside.material-surface"),
    );
    const acabamentosEsperados = [
      {
        superficie: "sidebar",
        seletor: `${ESCOPO_ILHAS} .wallpaper-backdrop-root > aside.material-surface`,
        tokenDeBrilho: "--glass-border-top",
      },
      {
        superficie: "painel Detalhes",
        seletor: `${ESCOPO_ILHAS} .wallpaper-backdrop-root main > div > aside.material-surface-elevated`,
        tokenDeBrilho: "--glass-border-top-elevated",
      },
    ];

    expect(regrasDasDuasSuperficies).toHaveLength(acabamentosEsperados.length);
    expect(
      regrasDasDuasSuperficies.every((regra) =>
        partesDoSeletor(regra.seletor).every((parte) => parte.includes(ESCOPO_ILHAS)),
      ),
      "acabamento das ilhas fora do escopo flutuante",
    ).toBe(true);

    for (const { superficie, seletor, tokenDeBrilho } of acabamentosEsperados) {
      const regra = regrasDasDuasSuperficies.find((candidata) => candidata.seletor === seletor);
      const corpo = regra?.corpo ?? "";
      const inset = `inset 0 1px 0 0 var(${tokenDeBrilho})`;
      const contorno = "0 0 0 1px var(--glass-island-outline)";
      const sombra = "var(--glass-island-shadow)";

      expect(regra, `regra de acabamento da ${superficie} ausente`).toBeDefined();
      expect(corpo, `${superficie}: borda deve ficar transparente`).toContain("border-color: transparent;");
      expect(corpo, `${superficie}: brilho especular incorreto ou ausente`).toContain(inset);
      expect(corpo, `${superficie}: contorno ausente`).toContain(contorno);
      expect(corpo, `${superficie}: sombra elevada ausente`).toContain(sombra);
      expect(corpo.indexOf(inset), `${superficie}: brilho deve vir antes do contorno`).toBeLessThan(corpo.indexOf(contorno));
      expect(corpo.indexOf(contorno), `${superficie}: contorno deve vir antes da sombra`).toBeLessThan(corpo.indexOf(sombra));
    }
  });

  it("a faixa superior nao vira painel no flutuante e permanece docada com wallpaper", () => {
    const barraFlutuante = regraDaLeva((regra) =>
      regra.seletor === `${ESCOPO_ILHAS} .material-liquid-bar`,
    ).corpo;
    expect(barraFlutuante).toContain("display: contents;");
    expect(barraFlutuante).toContain("background: none;");
    expect(barraFlutuante).toContain("box-shadow: none;");
    expect(barraFlutuante).not.toContain("backdrop-filter");
    expect(
      regras.filter((regra) =>
        regra.seletor.includes(ESCOPO_ILHAS)
        && regra.corpo.includes("backdrop-filter"),
      ),
      "chrome flutuante nao precisa de reset ou restauracao nominal",
    ).toEqual([]);
    expect(css).toMatch(
      /\[data-material="glass"\]\[data-wallpaper="active"\]\s+\.material-liquid-bar\s*\{[^}]*display:\s*block;/,
    );
  });
});

describe("material glass: flat permanece byte-identico", () => {
  it("nenhuma classe .material-surface* tem regra fora de [data-material=\"glass\"]", () => {
    // Extrai o SELETOR de cada regra (o texto antes de `{`), com os
    // comentarios fora do caminho — eles citam as classes de proposito. Toda
    // regra que estilize um .material-surface* tem de estar sob o escopo
    // glass; uma solta em qualquer ponto do arquivo reprova aqui.
    const semComentarios = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const seletores = [...semComentarios.matchAll(/([^{}]*)\{/g)]
      .map((m: RegExpMatchArray) => m[1].trim())
      .filter((s: string) => s.includes(".material-surface"));

    expect(seletores.length, "nenhuma regra .material-surface* encontrada").toBeGreaterThan(0);

    const foraDoEscopo = seletores.filter((s: string) => !s.includes('[data-material="glass"]'));
    expect(foraDoEscopo, "regra de .material-surface* fora do escopo glass").toEqual([]);
  });

  it("os marcadores nao aparecem no tailwind.config (nao sao utilitarias)", () => {
    // Se virarem utilitaria gerada, passam a ter estilo proprio no flat.
    const tailwind = ler("tailwind.config.cjs");
    for (const marcador of MARCADORES) {
      expect(tailwind).not.toContain(marcador);
    }
  });
});

describe("material glass: acao primaria da Library", () => {
  const MARCADOR_DE_ACAO = "material-surface-action";
  const ESCOPO_GLASS = '[data-material="glass"]';
  const SELETOR_DO_RESET_ANINHADO = `${ESCOPO_GLASS} [data-glass-backdrop] [data-glass-backdrop]`;
  const regras = [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map((m: RegExpMatchArray) => ({ seletor: m[1].trim(), corpo: m[2].trim() }));

  function corpoDoBloco(seletor: string): string {
    const regra = regras.find((candidata) => candidata.seletor === seletor);
    if (!regra) throw new Error(`Bloco glass nao encontrado: ${seletor}`);
    return regra.corpo;
  }

  it("o marcador de acao nao recebe declaracao fora do escopo glass", () => {
    // Flat nao conhece o marcador: toda regra que o cita precisa carregar o
    // escopo de material, para as classes Tailwind continuarem soberanas.
    const seletoresDaAcao = regras
      .map((regra) => regra.seletor)
      .filter((seletor) => seletor.includes(`.${MARCADOR_DE_ACAO}`));

    expect(seletoresDaAcao, "nenhuma regra para a acao foi encontrada").not.toEqual([]);
    expect(
      seletoresDaAcao.filter((seletor) => !seletor.includes(ESCOPO_GLASS)),
      "regra da acao fora do escopo glass",
    ).toEqual([]);
  });

  it("declara todos os tokens da acao nos dois blocos glass", () => {
    const tokensEsperados = [
      "--glass-action-tint",
      "--glass-action-tint-hover",
      "--glass-action-tint-active",
      "--glass-action-blur",
      "--glass-action-saturation",
      "--glass-action-rim",
      "--glass-action-rim-inner",
      "--glass-action-shadow",
      "--glass-action-shadow-hover",
      "--glass-action-shadow-active",
      "--glass-action-label",
      "--glass-action-label-shadow",
      "--glass-action-focus-ring",
      "--glass-action-focus-ring-outer",
    ];

    for (const seletor of [ESCOPO_GLASS, `.dark${ESCOPO_GLASS}`]) {
      const declarados = [...corpoDoBloco(seletor).matchAll(/(--glass-action-[\w-]+)\s*:/g)]
        .map((m: RegExpMatchArray) => m[1]);
      expect(declarados, `familia incompleta em ${seletor}`).toEqual(tokensEsperados);
    }
  });

  it("qualquer proprietario aninhado reutiliza o backdrop filtrado pelo ancestral", () => {
    const corpo = corpoDoBloco(SELETOR_DO_RESET_ANINHADO);
    expect(corpo).toContain("-webkit-backdrop-filter: none;");
    expect(corpo).toContain("backdrop-filter: none;");
  });

  it("a acao marcada recebe filtro generico sem restauracao do chrome", () => {
    const SELETOR_DA_ACAO = `${ESCOPO_GLASS} [data-glass-backdrop="action"]`;
    const corpo = corpoDoBloco(SELETOR_DA_ACAO);

    expect(corpo).toContain(
      "blur(var(--glass-effective-action-blur, var(--glass-action-blur)))",
    );
    expect(corpo).toContain("saturate(var(--glass-action-saturation))");
    expect(corpo).not.toContain("backdrop-filter: none");
    expect(
      regras.filter((regra) =>
        regra.seletor.includes('[data-chrome="floating"]')
        && regra.corpo.includes("backdrop-filter"),
      ),
      "nao deve haver hack nominal de filtro para o chrome flutuante",
    ).toEqual([]);
    expect(corpoDoBloco(`${ESCOPO_GLASS} .${MARCADOR_DE_ACAO}`)).not.toContain(
      "backdrop-filter",
    );
  });

  it("a acao nao escapa do inventario fechado de marcadores", () => {
    // Mantem o escopo dos dois botoes explicitamente pequeno; um terceiro
    // consumidor precisa entrar aqui antes de poder receber o material.
    expect(arquivosComMarcador(MARCADOR_DE_ACAO)).toEqual([
      "src/components/EmptyState.tsx",
      "src/features/library/LibraryView.tsx",
    ]);
  });

  it("os dois botoes preservam todas as utilitarias flat originais", () => {
    const libraryView = ler("src/features/library/LibraryView.tsx");
    const emptyState = ler("src/components/EmptyState.tsx");
    const classesDoTopbar = libraryView
      .match(/className="([^"]*material-surface-action[^"]*)"/)?.[1]
      .split(/\s+/) ?? [];
    const classesDoEmptyState = emptyState
      .match(/const\s+BASE_ACTION_BUTTON_CLASSES\s*=\s*"([^"]*)"/)?.[1]
      .split(/\s+/) ?? [];

    for (const classe of [
      "inline-flex",
      "shrink-0",
      "items-center",
      "gap-2",
      "rounded-lg",
      "border",
      "border-transparent",
      "bg-primary",
      "px-4",
      "py-2",
      "font-bold",
      "text-primary-foreground",
      "shadow-button",
      "transition",
      "hover:bg-primary-hover",
    ]) {
      expect(classesDoTopbar, `topbar perdeu a classe ${classe}`).toContain(classe);
    }

    for (const classe of [
      "inline-flex",
      "items-center",
      "gap-2",
      "rounded-lg",
      "bg-primary",
      "px-4",
      "py-2.5",
      "text-sm",
      "font-bold",
      "text-primary-foreground",
      "shadow-button",
      "transition",
      "hover:bg-primary-hover",
      "disabled:cursor-not-allowed",
      "disabled:opacity-60",
      "disabled:hover:bg-primary",
    ]) {
      expect(classesDoEmptyState, `EmptyState perdeu a classe ${classe}`).toContain(classe);
    }
  });
});

describe("material glass: cada papel consome o token certo", () => {
  // Junta TODAS as regras glass de um papel, nao so a primeira: desde que o
  // card passou a separar repouso de selecionado, um papel pode ocupar mais
  // de uma regra (`.material-surface-card`, `...:not([aria-pressed="true"])`
  // e `...[aria-pressed="true"]`). O sufixo tem de terminar ali — sem isso
  // "material-surface" casaria tambem com "material-surface-card".
  function blocoDaRegra(seletor: string): string {
    const padrao = new RegExp(
      `\\[data-material="glass"\\]\\s+\\.${seletor}(?![\\w-])[^{]*\\{([^}]*)\\}`,
      "g",
    );
    const blocos = [...css.matchAll(padrao)].map((m: RegExpMatchArray) => m[1]);
    if (blocos.length === 0) {
      throw new Error(`Regra glass nao encontrada para .${seletor}`);
    }
    return blocos.join("\n");
  }

  it("a superficie BASE (sidebar) usa --glass-surface, sem sombra propria", () => {
    const bloco = blocoDaRegra("material-surface");
    expect(bloco).toContain("background: var(--glass-surface);");
    expect(bloco).toContain("border-color: var(--glass-border);");
    expect(bloco).toContain("inset 0 1px 0 0 var(--glass-border-top)");
    // Docado nao ganha sombra: e o que separa "acabamento" de "flutuar".
    expect(bloco).not.toContain("var(--glass-shadow)");
    expect(bloco).not.toContain("var(--glass-shadow-elevated)");
  });

  it("a superficie ELEVADA docada usa --glass-surface-elevated, sem sombra propria", () => {
    const bloco = blocoDaRegra("material-surface-elevated");
    expect(bloco).toContain("background: var(--glass-surface-elevated);");
    expect(bloco).toContain("inset 0 1px 0 0 var(--glass-border-top-elevated)");
    expect(bloco).not.toContain("var(--glass-shadow)");
  });

  it("o CARD da grade usa a sombra leve, e o OVERLAY usa a pesada", () => {
    // A distincao de peso e o que impede a grade de virar uma pilha de
    // paineis flutuantes: o card ja flutuava pouco (shadow-card) e continua.
    expect(blocoDaRegra("material-surface-card")).toContain("var(--glass-shadow)");
    expect(blocoDaRegra("material-surface-card")).not.toContain("var(--glass-shadow-elevated)");
    expect(blocoDaRegra("material-surface-overlay")).toContain("var(--glass-shadow-elevated)");
  });

  it("surface-app (a raiz) nao vira superficie de vidro", () => {
    // E fundo. Se virasse GRADIENTE, as superficies acima perderiam o plano
    // contra o qual se destacam.
    //
    // Esta assercao foi ESTREITADA em 18/08/2026, junto com a paleta propria
    // do glass. Antes ela dizia que --color-surface-app nunca podia apontar
    // para um --glass-*; hoje ele aponta para --glass-surface-app, que e uma
    // cor CHAPADA e existe justamente para estratificar o fundo. A regra que
    // importa sempre foi "o fundo nao e uma das duas superficies de vidro", e
    // e essa que continua travada aqui — nao afrouxada, so dita com precisao.
    expect(css).not.toMatch(/--color-surface-app:\s*var\(--glass-surface\)/);
    expect(css).not.toMatch(/--color-surface-app:\s*var\(--glass-surface-elevated\)/);
    expect(css).not.toMatch(/--color-surface-app:\s*linear-gradient/);
    // E nao pode ganhar marcador de superficie por outro caminho.
    expect(css).not.toMatch(/\.material-surface[\w-]*\s*\{[^}]*--color-surface-app/);
  });

  it("os sete tokens --glass-* nao-immersive tem consumidor", () => {
    // A leva existe para tirar estes tokens do orfanato; se um ficar de fora,
    // o motivo tem de ser deliberado e visivel aqui.
    // `[^{]*` no meio para alcancar tambem as variantes por estado
    // (`:not([aria-pressed="true"])` / `[aria-pressed="true"]`).
    const escopoGlass = (
      css.match(/\[data-material="glass"\]\s+\.material-surface[\w-]*[^{]*\{[^}]*\}/g) ?? []
    ).join("\n");
    for (const token of [
      "--glass-surface",
      "--glass-surface-elevated",
      "--glass-border",
      "--glass-border-top",
      "--glass-border-top-elevated",
      "--glass-shadow",
      "--glass-shadow-elevated",
    ]) {
      expect(escopoGlass, `${token} sem consumidor`).toContain(`var(${token})`);
    }
  });
});

describe("material glass: o MATERIAL governa o repouso, o ESTADO governa o resto", () => {
  // ESTE TESTE EXISTE POR CAUSA DE UMA REGRESSAO QUE PASSOU POR REVISAO.
  //
  // A regra do card declarava border-color e box-shadow inteiros em (0,2,0) e
  // engolia o `border-primary ring-2 ring-primary-soft` do Tailwind (0,1,0):
  // sob glass, card SELECIONADO ficava com a borda palida do material e sem
  // anel — indistinguivel de um nao selecionado.
  //
  // O teste manual da leva que introduziu isso cobria quatro combinacoes de
  // modo x material, todas com o card em REPOUSO. O estado selecionado nao
  // estava na lista, entao a regressao passou. Por isso o alvo aqui e o
  // ESTADO, e nao mais uma variacao de material.
  const CARD = `\\[data-material="glass"\\] \\.material-surface-card`;

  function regraDo(sufixoRegex: string): string {
    const achado = css.match(new RegExp(`${CARD}${sufixoRegex}\\s*\\{([^}]*)\\}`));
    if (!achado) throw new Error(`Regra nao encontrada: .material-surface-card${sufixoRegex}`);
    return achado[1];
  }

  it("a regra de REPOUSO nao alcanca o card selecionado", () => {
    // O ponto nao e vencer por especificidade: e NAO CASAR. Se esta regra
    // voltar a alcancar o selecionado, a borda de accent some de novo.
    const repouso = regraDo(':not\\(\\[aria-pressed="true"\\]\\)');
    expect(repouso).toContain("border-color: var(--glass-border);");
    expect(repouso).toContain("var(--glass-shadow)");

    // E a regra sem qualificador de estado (que casa com os dois) so pode
    // pintar o FUNDO — material puro. Se ela declarar borda ou sombra, volta
    // a atropelar o estado.
    const ambos = regraDo("");
    expect(ambos).toContain("background: var(--glass-surface-elevated);");
    expect(ambos).not.toContain("border-color");
    expect(ambos).not.toContain("box-shadow");
  });

  it("o card SELECIONADO mantem o accent na borda e o anel visivel", () => {
    const selecionado = regraDo('\\[aria-pressed="true"\\]');

    // O anel tem de estar na sombra do selecionado.
    expect(selecionado).toContain("0 0 0 2px var(--color-primary-soft)");
    // E a sombra do material continua ali — selecionado nao perde o vidro.
    expect(selecionado).toContain("var(--glass-shadow)");
    // Sem border-color aqui: e o `border-primary` do JSX que pinta a borda.
    // Se esta regra declarar border-color, a borda de accent morre de novo.
    expect(selecionado).not.toContain("border-color");
  });

  it("o JSX ainda declara o par accent+anel que o CSS acima pressupoe", () => {
    // ACOPLAMENTO REGISTRADO: a regra glass do selecionado repete o anel
    // (`0 0 0 2px var(--color-primary-soft)`) porque box-shadow e uma
    // propriedade so. Se o JSX trocar a largura do ring, o glass fica para
    // tras em silencio — e este teste que acusa.
    const jsx = readFileSync(new URL("../features/library/DocumentCard.tsx", import.meta.url), "utf8");
    expect(jsx).toContain('"border-primary ring-2 ring-primary-soft"');
    expect(jsx).toContain('aria-pressed={isSelected}');
  });

  it("sem !important em nenhuma regra de material", () => {
    // A saida barata para este tipo de conflito e !important; ela resolve o
    // sintoma e deixa o proximo estado sem saida.
    const regrasMaterial = css.match(/\[data-material="glass"\][^{]*\{[^}]*\}/g) ?? [];
    const comImportant = regrasMaterial.filter((r: string) => r.includes("!important"));
    expect(comImportant).toEqual([]);
  });
});

describe("material glass: o segmento selecionado e LUZ, nao terracota", () => {
  const MARCADOR = "material-surface-segment";
  const ESCOPO_GLASS = '[data-material="glass"]';
  const regras = [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map((m: RegExpMatchArray) => ({ seletor: m[1].trim(), corpo: m[2].trim() }));

  function corpoDe(seletor: string): string {
    const regra = regras.find((candidata) => candidata.seletor === seletor);
    if (!regra) throw new Error(`Regra do segmento nao encontrada: ${seletor}`);
    return regra.corpo;
  }

  it("declara os sete tokens de controle nos dois blocos glass", () => {
    const esperados = [
      "--glass-control-selected",
      "--glass-control-selected-inner",
      "--glass-control-selected-shadow",
      "--glass-control-icon",
      "--glass-control-icon-idle",
      "--glass-control-stroke",
      "--glass-control-stroke-idle",
    ];

    for (const seletor of [ESCOPO_GLASS, `.dark${ESCOPO_GLASS}`]) {
      const declarados = [...corpoDe(seletor).matchAll(/(--glass-control-[\w-]+)\s*:/g)]
        .map((m: RegExpMatchArray) => m[1]);
      expect(declarados, `familia de controle incompleta em ${seletor}`).toEqual(esperados);
    }
  });

  it("o selecionado tem preenchimento e especular, e NENHUM anel externo", () => {
    // 32x32 com rim de 1px = ~12% da area so de borda, e o trilho ja tem o
    // anel dele. Dois aneis concentricos a 2px leem como desalinhamento.
    const corpo = corpoDe(`${ESCOPO_GLASS} .${MARCADOR}[aria-pressed="true"]`);

    expect(corpo).toContain("background-color: var(--glass-control-selected);");
    expect(corpo).toContain("inset 0 1px 0 var(--glass-control-selected-inner)");
    expect(corpo).toContain("var(--glass-control-selected-shadow)");
    expect(corpo).toContain("color: var(--glass-control-icon);");
    // Um anel externo seria uma sombra sem `inset` com spread. As unicas
    // sombras permitidas aqui sao o especular interno e a sombra de assento.
    const sombras = (corpo.match(/box-shadow:([^;]*);/)?.[1] ?? "").split(",");
    expect(
      sombras.filter((s: string) => !s.includes("inset") && !s.includes("--glass-control-selected-shadow")),
      "anel externo no segmento",
    ).toEqual([]);
    expect(corpo).not.toContain("--color-primary");
  });

  it("o inativo NAO alcanca o hover, para o Tailwind seguir soberano ali", () => {
    // Mesma doutrina da regra do card: o ganho e de ALCANCE, nao de
    // especificidade. Sem o :not(:hover) estes (0,4,0) atropelariam o
    // `hover:text-text-primary` (0,2,0) e o hover do inativo morreria.
    const seletorInativo = `${ESCOPO_GLASS} .${MARCADOR}:not([aria-pressed="true"]):not(:hover)`;
    expect(corpoDe(seletorInativo)).toContain("color: var(--glass-control-icon-idle);");

    const queCasamCorDoInativo = regras
      .map((regra) => regra.seletor)
      .filter((seletor) =>
        seletor.includes(`.${MARCADOR}`)
        && seletor.includes(':not([aria-pressed="true"])')
        && !seletor.includes("svg"),
      );
    expect(
      queCasamCorDoInativo.filter((seletor) => !seletor.includes(":not(:hover)")),
      "regra de cor do inativo sem :not(:hover) atropela o hover do Tailwind",
    ).toEqual([]);
  });

  it("o segundo sinal e o traco, mirado no <svg> e so sob glass", () => {
    // strokeWidth e atributo de apresentacao NO <svg> (nao nos paths): o
    // seletor precisa mirar o svg, e o valor desce por heranca. Se alguem
    // mover o atributo para os paths, o alvo deixa de valer.
    const jsx = ler("src/features/library/LibraryToolbar.tsx");
    const svgs = [...jsx.matchAll(/<svg[^>]*>/g)].map((m: RegExpMatchArray) => m[0]);
    expect(svgs.length).toBeGreaterThan(0);
    expect(
      svgs.filter((svg: string) => !svg.includes('strokeWidth="2"')),
      "algum <svg> da toolbar deixou de declarar o traco base",
    ).toEqual([]);
    // O flat continua em 2: o atributo do JSX nao muda.
    expect(jsx).not.toContain('strokeWidth="2.5"');

    expect(corpoDe(`${ESCOPO_GLASS} .${MARCADOR}[aria-pressed="true"] > svg`))
      .toBe("stroke-width: var(--glass-control-stroke);");
    expect(corpoDe(`${ESCOPO_GLASS} .${MARCADOR}:not([aria-pressed="true"]) > svg`))
      .toBe("stroke-width: var(--glass-control-stroke-idle);");
  });

  it("o marcador nao e da familia liquid e o trilho segue intocado", () => {
    // O preenchimento nao usa backdrop-filter, entao nao pode carregar um
    // marcador liquid: a familia .material-liquid-* so recebe CSS sob
    // [data-wallpaper="active"], e o segmento precisa valer tambem no glass
    // sem imagem, como a acao primaria.
    const doSegmento = regras.filter((regra) => regra.seletor.includes(`.${MARCADOR}`));
    expect(doSegmento.length).toBe(4);
    expect(
      doSegmento.filter((regra) => regra.corpo.includes("backdrop-filter")),
      "o segmento nao pode declarar filtro proprio",
    ).toEqual([]);
    expect(
      doSegmento.filter((regra) => regra.seletor.includes(".material-liquid-")),
      "o segmento nao pode depender do trilho liquid",
    ).toEqual([]);

    // O trilho e o gatilho "Recente" sao irmaos e nao podem divergir de
    // material nesta leva: os dois seguem com o mesmo par de marcadores.
    const jsx = ler("src/features/library/LibraryToolbar.tsx");
    expect(
      [...jsx.matchAll(/material-liquid-control material-surface-elevated/g)].length,
      "trilho e gatilho precisam manter o mesmo par de marcadores",
    ).toBe(2);
  });

  it("o segmento preserva todas as utilitarias flat originais", () => {
    const jsx = ler("src/features/library/LibraryToolbar.tsx");
    const classes = jsx
      .match(/className=\{`(material-surface-segment[^`]*)`/)?.[1]
      .replace(/\$\{[^}]*\}/g, " ")
      .split(/\s+/) ?? [];

    for (const classe of [
      "inline-flex",
      "h-8",
      "w-8",
      "items-center",
      "justify-center",
      "rounded-md",
      "transition",
    ]) {
      expect(classes, `o segmento perdeu a classe ${classe}`).toContain(classe);
    }
    // O ramo de estado do template literal segue sendo o do flat.
    expect(jsx).toContain('viewMode === mode ? "bg-primary text-primary-foreground" : "text-text-secondary hover:text-text-primary"');
    expect(jsx).toContain("aria-pressed={viewMode === mode}");
  });
});

describe("material glass: as superficies da Library carregam o marcador certo", () => {
  // Papel esperado de cada superficie, com a utilitaria de fundo que ela ja
  // tinha no flat — o par prova que o marcador foi para o elemento certo, e
  // nao para um filho qualquer que por acaso tem a mesma classe.
  // O terceiro campo aceita null: significa SUPERFICIE SEM UTILITARIA DE FUNDO
  // NO FLAT — a pintura inteira vem do CSS glass, entao nao existe par
  // marcador+fundo para provar posicionamento. Nesse caso a assercao troca de
  // forma (ver abaixo) em vez de aceitar o bg-* de um vizinho: o trilho das
  // abas tem um `bg-primary` de botao ativo a poucas linhas do marcador, bem
  // dentro da janela de 700 caracteres, e casar com ele seria falso positivo.
  const ALVOS: ReadonlyArray<readonly [string, string, string | null, string]> = [
    ["src/components/Sidebar.tsx", "material-surface", "bg-sidebar", "sidebar (raiz)"],
    ["src/components/Sidebar.tsx", "material-surface-overlay", "bg-surface-panel", "dialogo de colecao"],
    ["src/features/library/LibraryToolbar.tsx", "material-surface-elevated", "bg-surface-panel", "controles da toolbar"],
    ["src/features/library/LibraryToolbar.tsx", "material-surface-overlay", "bg-surface-panel", "menu de ordenacao"],
    // O segmento e o unico alvo cuja utilitaria de fundo so existe no estado
    // selecionado: `bg-primary` esta no ramo ativo do template literal. E o
    // fundo que ele tinha no flat, entao o par continua honesto.
    ["src/features/library/LibraryToolbar.tsx", "material-surface-segment", "bg-primary", "segmento grade/lista"],
    ["src/features/library/LibraryView.tsx", "material-surface-elevated", "bg-surface-card", "container da lista"],
    // O card da grade aparece nas tres abas mutuamente exclusivas da Library;
    // Documentos, Cadernos e Quadros carregam o mesmo marcador por decisao.
    ["src/features/library/DocumentCard.tsx", "material-surface-card", "bg-surface-card", "card da grade"],
    ["src/features/notebooks/NotebookCard.tsx", "material-surface-card", "bg-surface-card", "card da grade de cadernos"],
    ["src/features/canvases/CanvasCard.tsx", "material-surface-card", "bg-surface-card", "card da grade de quadros"],
    ["src/features/library/DocumentDetailsPanel.tsx", "material-surface-elevated", "bg-surface-panel", "painel Detalhes docado"],
    ["src/features/library/DocumentDetailsPanel.tsx", "material-surface-overlay", "bg-surface-panel", "painel Detalhes em modal"],
    ["src/features/library/AddDocumentModal.tsx", "material-surface-overlay", "bg-surface-panel", "modal de adicionar"],
    ["src/features/library/DocumentPickerModal.tsx", "material-surface-overlay", "bg-surface-panel", "modal de escolher documento"],
    ["src/features/library/RenameLibraryItemModal.tsx", "material-surface-overlay", "bg-surface-panel", "modal de renomear"],
    ["src/components/NewCollectionModal.tsx", "material-surface-overlay", "bg-surface-panel", "modal de nova colecao"],
    ["src/components/ConfirmationDialog.tsx", "material-surface-overlay", "bg-surface-panel", "dialogo de confirmacao"],
    ["src/components/InfoDialog.tsx", "material-surface-overlay", "bg-surface-panel", "dialogo informativo"],
    ["src/features/library/LibraryView.tsx", "material-surface-action", "bg-primary", "acao primaria do topo"],
    ["src/components/EmptyState.tsx", "material-surface-action", "bg-primary", "acao primaria do estado vazio"],
    ["src/features/library/CollectionTabs.tsx", "material-surface-track", null, "trilho das abas"],
  ];

  // Classes de todo elemento cujo className contem o marcador. Serve para os
  // dois ramos e nao conhece nome de arquivo nenhum.
  function classesDosElementosMarcados(fonte: string, marcador: string): string[][] {
    return [...fonte.matchAll(/className\s*=\s*\{?(?:"([^"]*)"|`([^`]*)`)\}?/g)]
      .map((m: RegExpMatchArray) => (m[1] ?? m[2] ?? "").split(/\s+/))
      .filter((classes: string[]) => classes.includes(marcador));
  }

  it.each(ALVOS)("%s: %s em %s (%s)", (arquivo, marcador, fundo, papel) => {
    const fonte = ler(arquivo);

    if (fundo === null) {
      // Prova pelo NEGATIVO: o elemento marcado existe e nao carrega nenhuma
      // utilitaria de fundo — nem `bg-x`, nem `hover:bg-x`. Se alguem
      // acrescentar uma, a pintura passa a ter duas origens e o flat deixa de
      // ser byte-identico; e este ramo que acusa.
      const marcados = classesDosElementosMarcados(fonte, marcador);
      expect(marcados.length, `${papel}: nenhum className com "${marcador}"`).toBeGreaterThan(0);
      expect(
        marcados.flat().filter((classe: string) => /^(?:[\w-]+:)*bg-/.test(classe)),
        `${papel}: alvo de fundo null nao pode carregar utilitaria bg-*`,
      ).toEqual([]);
      return;
    }
    // Casa por PROXIMIDADE, nao extraindo o atributo className: varios destes
    // sao template literals multilinha com interpolacao, que nenhum regex
    // simples de atributo pega inteiro. O marcador precisa terminar ali (\b
    // nao serve: -elevated tem -surface como prefixo), dai o delimitador
    // explicito; a utilitaria de fundo tem de estar na mesma vizinhanca.
    const JANELA = 700;
    const ocorrencias = [...fonte.matchAll(new RegExp(`${marcador}(?=[\\s"\`])`, "g"))];
    // O EmptyState deduplica as utilitarias numa constante anterior ao botao;
    // por isso este alvo nao usa a janela de 700 caracteres. A coocorrencia
    // confirma separadamente o marcador e o fundo dentro de uma constante.
    const usaBaseCompartilhada = arquivo === "src/components/EmptyState.tsx"
      && marcador === "material-surface-action";
    const casou = usaBaseCompartilhada
      ? coocorremMarcadorEConstanteComFundo(fonte, marcador, fundo)
      : ocorrencias.some((m) =>
        fonte.slice(m.index ?? 0, (m.index ?? 0) + JANELA).includes(fundo),
      );
    expect(casou, `${papel}: nenhum "${marcador}" perto de "${fundo}"`).toBe(true);
  });

  it("nenhum marcador escapou para fora do inventario acima", () => {
    // Um marcador solto em outro componente pinta de vidro algo que nao foi
    // analisado — e o modo mais provavel de esta leva vazar escopo. Varre a
    // arvore inteira e compara com o inventario declarado acima.
    expect(arquivosComMarcador("material-surface")).toEqual(
      [...new Set(ALVOS.map(([arquivo]) => arquivo))].sort(),
    );
  });
});

describe("material glass: trilho das abas", () => {
  const MARCADOR = "material-surface-track";
  const ESCOPO_GLASS = '[data-material="glass"]';
  const regras = [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map((m: RegExpMatchArray) => ({ seletor: m[1].trim(), corpo: m[2].trim() }));

  function corpoDe(seletor: string): string {
    const regra = regras.find((candidata) => candidata.seletor === seletor);
    if (!regra) throw new Error(`Regra do trilho nao encontrada: ${seletor}`);
    return regra.corpo;
  }

  it("declara os nove tokens de trilho nos dois blocos glass", () => {
    const esperados = [
      "--glass-track-surface",
      "--glass-track-hover",
      "--glass-track-selected",
      "--glass-track-rim",
      "--glass-track-shadow",
      "--glass-track-radius",
      "--glass-track-padding",
      "--glass-track-label",
      "--glass-track-label-idle",
    ];

    for (const seletor of [ESCOPO_GLASS, `.dark${ESCOPO_GLASS}`]) {
      const declarados = [...corpoDe(seletor).matchAll(/(--glass-track-[\w-]+)\s*:/g)]
        .map((m: RegExpMatchArray) => m[1]);
      expect(declarados, `familia de trilho incompleta em ${seletor}`).toEqual(esperados);
    }
  });

  it("NAO declara filtro proprio, seguindo o precedente do controle liquid", () => {
    // As abas ficam direto sobre o wallpaper, sem ancestral filtrado. Um
    // backdrop-filter aqui abriria mais uma camada de composicao por grupo — e
    // obrigaria a mexer no grupo :is(...) do reset aninhado, que esta fechado.
    const doTrilho = regras.filter((regra) => regra.seletor.includes(`.${MARCADOR}`));
    expect(doTrilho.length).toBe(4);
    expect(
      doTrilho.filter((regra) => regra.corpo.includes("backdrop-filter")),
      "o trilho das abas nao pode declarar filtro proprio",
    ).toEqual([]);
    // E, sem filtro, ele nao pertence a familia liquid nem depende dela.
    expect(
      doTrilho.filter((regra) => regra.seletor.includes(".material-liquid-")),
      "o trilho nao pode depender de um ancestral liquid",
    ).toEqual([]);
  });

  it("a caixa do trilho vem do CSS glass, nunca de utilitaria Tailwind", () => {
    // No flat o trilho nao e superficie nenhuma: se raio ou padding virarem
    // utilitaria, a caixa aparece tambem no flat e o material deixa de ser o
    // unico responsavel pela pintura.
    const corpo = corpoDe(`${ESCOPO_GLASS} .${MARCADOR}`);
    expect(corpo).toContain("background-color: var(--glass-track-surface);");
    expect(corpo).toContain("border-radius: var(--glass-track-radius);");
    expect(corpo).toContain("padding: var(--glass-track-padding);");
    expect(corpo).toContain("0 0 0 1px var(--glass-track-rim)");
    expect(corpo).toContain("var(--glass-track-shadow)");

    const jsx = ler("src/features/library/CollectionTabs.tsx");
    const classesDoTrilho = jsx
      .match(/className="([^"]*material-surface-track[^"]*)"/)?.[1]
      .split(/\s+/) ?? [];
    expect(classesDoTrilho.length).toBeGreaterThan(0);
    for (const proibida of [/^(?:[\w-]+:)*bg-/, /^rounded/, /^p[xytrbl]?-/, /^border/]) {
      expect(
        classesDoTrilho.filter((classe: string) => proibida.test(classe)),
        `o trilho recebeu utilitaria de caixa (${proibida})`,
      ).toEqual([]);
    }
  });

  it("FIX: o trilho tem largura de conteudo, nao a largura do container", () => {
    // O TSX ja tinha `flex` no className antes desta leva. display:flex e
    // block-level: sem largura propria, o bloco ocupa 100% do container.
    // No flat isso era invisivel (sem fundo nem borda); ao ganhar pintura
    // virou uma barra vazia com as tres abas encostadas a esquerda.
    const corpo = corpoDe(`${ESCOPO_GLASS} .${MARCADOR}`);
    expect(corpo).toContain("width: fit-content;");
  });

  it("a aba ativa reusa SOMBRA/ESPECULAR do controle, mas TINTA e ROTULO sao proprios", () => {
    // SOMBRA e ESPECULAR continuam do controle: mesmo papel semantico, e dois
    // vocabularios para as mesmas duas propriedades divergiriam na primeira
    // mudanca de valor. A TINTA divergiu porque o SUBSTRATO diverge — o
    // segmento do toggle vive dentro de uma .material-surface-elevated (opaca
    // ou scrim-based) e um branco em alpha baixo basta la; a aba assenta no
    // trilho, direto sobre o wallpaper.
    const corpo = corpoDe(`${ESCOPO_GLASS} .${MARCADOR} > [aria-selected="true"]`);
    expect(corpo).toContain("background-color: var(--glass-track-selected);");
    expect(corpo).not.toContain("var(--glass-control-selected)");
    expect(corpo).toContain("inset 0 1px 0 var(--glass-control-selected-inner)");
    // FIX: a cor NAO reusa --glass-control-icon. Esse token foi calibrado
    // para o substrato do toggle (escuro no tema escuro); a pilula da aba e
    // sempre tinta branca nos dois temas, entao reusar o icone deixava o
    // rotulo do tema escuro claro sobre pilula clara — lavado.
    expect(corpo).toContain("color: var(--glass-track-label);");
    expect(corpo).not.toContain("--glass-control-icon");
    expect(corpo).not.toContain("--color-primary");

    // Sem indicador deslizante: font-bold muda a largura intrinseca da aba e
    // reflui as tres. Nada aqui pode ANIMAR posicao ou tamanho — o que proibe
    // transition/transform/animation em toda regra do trilho, e position/left
    // especificamente na aba selecionada (so ali um indicador teria motivo
    // para se posicionar). `width` fica de fora da lista geral de proposito:
    // o container tem `width: fit-content` estatico (FIX de largura, sem
    // transition e sem depender do estado de nenhuma aba) — a ausencia de
    // transition/animation no mesmo corpo, provada no loop acima, e o que
    // garante que essa largura nao anima nada.
    const doTrilho = regras.filter((regra) => regra.seletor.includes(`.${MARCADOR}`));
    for (const regra of doTrilho) {
      for (const proibida of ["transition", "transform", "animation"]) {
        expect(
          regra.corpo.includes(`${proibida}:`),
          `${proibida} no trilho reintroduz indicador deslizante`,
        ).toBe(false);
      }
    }

    for (const proibida of ["position", "left", "width"]) {
      expect(
        corpo.includes(`${proibida}:`),
        `${proibida} na aba selecionada reintroduz indicador deslizante`,
      ).toBe(false);
    }
  });

  it("FIX: o rotulo inativo tem cor propria, sem atropelar o hover do Tailwind", () => {
    // `text-text-secondary` do JSX e (0,1,0); esta regra e (0,3,0) e venceria
    // mesmo sob hover se nao fosse o :not(:hover) — o ganho tem de ser de
    // ALCANCE, nao de especificidade, para o `hover:text-text-primary`
    // (0,2,0) do Tailwind continuar soberano no hover. Mesmo padrao do
    // segmento grade/lista do toggle (Bloco 2).
    const seletor = `${ESCOPO_GLASS} .${MARCADOR} > :not([aria-selected="true"]):not(:hover)`;
    expect(corpoDe(seletor)).toContain("color: var(--glass-track-label-idle);");

    // O alvo e a COR: uma regra que pinte `color` na aba inativa e alcance o
    // hover atropela o Tailwind. Regras que pintam OUTRA propriedade no hover
    // (o fundo, por exemplo) sao legitimas e nao entram aqui — por isso o
    // filtro le o corpo, nao so o seletor. `(^|;)\s*color:` e deliberado:
    // "color:" cru tambem casaria dentro de `background-color:`.
    const queCasamCorDoInativo = regras
      .filter((regra) =>
        regra.seletor.includes(`.${MARCADOR}`)
        && regra.seletor.includes(':not([aria-selected="true"])')
        && /(^|;)\s*color:/.test(regra.corpo),
      )
      .map((regra) => regra.seletor);
    expect(
      queCasamCorDoInativo.filter((s) => !s.includes(":not(:hover)")),
      "regra de cor do rotulo inativo sem :not(:hover) atropela o hover do Tailwind",
    ).toEqual([]);
  });

  it("FIX: o hover da aba inativa vence o Tailwind e nao alcanca a aba ativa", () => {
    // `hover:bg-surface-muted` do JSX e (0,2,0) e pintaria um retangulo OPACO
    // de --muted sobre o trilho translucido. Esta regra e (0,4,0) — atributo
    // + classe + atributo no :not + pseudo-classe :hover — e vence sem
    // !important, que materialGlassSurfaces proibe em regra de material.
    const seletor = `${ESCOPO_GLASS} .${MARCADOR} > :not([aria-selected="true"]):hover`;
    const corpo = corpoDe(seletor);
    expect(corpo).toContain("background-color: var(--glass-track-hover);");
    expect(corpo).not.toContain("!important");

    // O :not([aria-selected="true"]) protege a SELECAO, nao o Tailwind: sem
    // ele o seletor alcancaria a aba ativa sob o ponteiro e trocaria
    // --glass-control-selected pela tinta de hover, apagando a selecao
    // exatamente quando o usuario aponta para ela.
    const queAlcancamHover = regras
      .filter((regra) =>
        regra.seletor.includes(`.${MARCADOR}`)
        && regra.seletor.includes(":hover")
        && !regra.seletor.includes(":not(:hover)"),
      )
      .map((regra) => regra.seletor);
    expect(
      queAlcancamHover.filter((s) => !s.includes(':not([aria-selected="true"])')),
      "regra de hover do trilho alcanca a aba ativa e apaga a selecao",
    ).toEqual([]);
  });

  // ---------------------------------------------------------------------
  // COMPOSICAO ALPHA REAL
  // ---------------------------------------------------------------------
  // A familia do trilho segue a forma do sistema: cor solida de tema com o
  // scrim no canal alpha e um piso proprio. Comparar alphas crus nao diz mais
  // nada — o que importa e a cor COMPOSTA sobre o wallpaper. Estes helpers
  // reconstroem essa composicao a partir do CSS, para o teste medir o que o
  // usuario ve, e nao o que o token declara.
  const PISO_ESPERADO = 0.85;

  // `rgb(R G B / max(var(--glass-wallpaper-scrim-alpha, 1), P))`
  function tintaDe(bloco: string, token: string): { rgb: number[]; piso: number } {
    const achado = corpoDe(bloco).match(
      new RegExp(`${token}:\\s*rgb\\((\\d+) (\\d+) (\\d+) / max\\(var\\(--glass-wallpaper-scrim-alpha, 1\\), ([\\d.]+)\\)\\)`),
    );
    if (!achado) throw new Error(`${token} ausente ou fora da forma do sistema em ${bloco}`);
    return { rgb: [Number(achado[1]), Number(achado[2]), Number(achado[3])], piso: Number(achado[4]) };
  }

  // `rgb(R G B / 1)` — rotulos sao opacos.
  function corDe(bloco: string, token: string): number[] {
    const achado = corpoDe(bloco).match(new RegExp(`${token}:\\s*rgb\\((\\d+) (\\d+) (\\d+) / 1\\)`));
    if (!achado) throw new Error(`${token} ausente ou nao-opaco em ${bloco}`);
    return [Number(achado[1]), Number(achado[2]), Number(achado[3])];
  }

  function compor(tinta: number[], alpha: number, base: number[]): number[] {
    return tinta.map((canal, i) => alpha * canal + (1 - alpha) * base[i]);
  }

  function hex(canais: number[]): string {
    return "#" + canais.map((v) => Math.round(v).toString(16).toUpperCase().padStart(2, "0")).join("");
  }

  // Os quatro cenarios por tema. Sem wallpaper o JS nao declara o scrim e o
  // fallback `1` vale; com wallpaper o pior caso e o proprio piso, porque
  // max() nunca deixa o alpha cair abaixo dele.
  const WALLPAPERS: ReadonlyArray<readonly [string, number[] | null]> = [
    ["sem wallpaper", null],
    ["wallpaper escuro", [30, 25, 22]],
    ["wallpaper medio", [128, 120, 112]],
    ["wallpaper claro", [235, 230, 225]],
  ];

  // Empilha o grupo: o trilho compoe sobre o wallpaper; hover e pilula
  // compoem sobre o trilho ja composto.
  function estados(bloco: string, wallpaper: number[] | null) {
    const trilho = tintaDe(bloco, "--glass-track-surface");
    const hover = tintaDe(bloco, "--glass-track-hover");
    const pilula = tintaDe(bloco, "--glass-track-selected");
    const alpha = (t: { piso: number }) => (wallpaper === null ? 1 : t.piso);
    const fundoTrilho = wallpaper ?? [0, 0, 0];
    const cTrilho = wallpaper === null ? trilho.rgb : compor(trilho.rgb, alpha(trilho), fundoTrilho);
    return {
      trilho: cTrilho,
      hover: wallpaper === null ? hover.rgb : compor(hover.rgb, alpha(hover), cTrilho),
      pilula: wallpaper === null ? pilula.rgb : compor(pilula.rgb, alpha(pilula), cTrilho),
    };
  }

  const BLOCOS: ReadonlyArray<readonly [string, string]> = [
    ["claro", ESCOPO_GLASS],
    ["escuro", `.dark${ESCOPO_GLASS}`],
  ];

  it("a familia do trilho usa a forma do sistema com piso proprio de 0.85", () => {
    // A FORMA e o que esta travado: cor solida de tema, scrim no alpha,
    // fallback para o caso sem wallpaper. O piso e proprio desta superficie
    // porque ela e a unica de vidro que hospeda texto pequeno DIRETAMENTE
    // sobre a imagem — as demais tem painel opaco ou scrim-based no meio.
    for (const [tema, bloco] of BLOCOS) {
      for (const token of ["--glass-track-surface", "--glass-track-hover", "--glass-track-selected"]) {
        const { piso } = tintaDe(bloco, token);
        expect(piso, `${tema}: ${token} com piso diferente do da familia`).toBe(PISO_ESPERADO);
      }
    }
  });

  it("PISO DE CONTRASTE: rotulo ativo e inativo passam 4.5:1 nos oito cenarios", () => {
    // ESTE TESTE EXISTE POR CAUSA DE UMA REGRESSAO REAL.
    //
    // A familia do trilho nasceu com alpha de BRANCO PURO (0.38 claro / 0.08
    // escuro). No escuro a cobertura combinada ficava em ~28%, o backdrop
    // dominava, e a pilula da aba ativa saia ESCURA sobre wallpaper escuro —
    // 2.18:1 com o rotulo. O defeito so aparecia em parte dos wallpapers, que
    // e exatamente o tipo de coisa que teste manual nao pega.
    //
    // Mede a cor COMPOSTA, nao o token declarado: e a composicao que o
    // usuario le. AA_TEXTO = 4.5 e o mesmo piso que o projeto adota em
    // mutedForegroundContrast.test.ts, onde esta registrado que o material
    // glass passa AA por conta propria — premissa que esta familia quebrou.
    const AA_TEXTO = 4.5;
    const reprovados: string[] = [];

    for (const [tema, bloco] of BLOCOS) {
      const ativo = corDe(bloco, "--glass-track-label");
      const inativo = corDe(bloco, "--glass-track-label-idle");

      for (const [cenario, wallpaper] of WALLPAPERS) {
        const { trilho, hover, pilula } = estados(bloco, wallpaper);
        const medidas: ReadonlyArray<readonly [string, number[], number[]]> = [
          ["rotulo inativo sobre o trilho", inativo, trilho],
          ["rotulo inativo sobre o hover", inativo, hover],
          ["rotulo ativo sobre a pilula", ativo, pilula],
        ];

        for (const [papel, texto, fundo] of medidas) {
          const razao = contraste(hex(texto), hex(fundo));
          if (razao < AA_TEXTO) {
            reprovados.push(`${tema} / ${cenario} / ${papel}: ${razao.toFixed(2)}:1 sobre ${hex(fundo)}`);
          }
        }
      }
    }

    expect(reprovados, "contraste abaixo de AA em algum cenario de wallpaper").toEqual([]);
  });

  it("a ordem trilho < hover < pilula se mantem nos oito cenarios", () => {
    // O hover COMPOE sobre o trilho, entao `hover > trilho` exige que a tinta
    // do hover supere o COMPOSTO do trilho — que sobe junto com a imagem. Foi
    // por isso que o piso de 0.6 invertia a ordem sobre wallpaper claro: o
    // trilho composto ficava mais claro que a propria tinta de hover, e
    // apontar uma aba inativa a escurecia em vez de clarea-la.
    const invertidos: string[] = [];

    for (const [tema, bloco] of BLOCOS) {
      for (const [cenario, wallpaper] of WALLPAPERS) {
        const { trilho, hover, pilula } = estados(bloco, wallpaper);
        // Compara por contraste contra preto: monotonico na luminancia, e
        // reusa o helper de contraste do projeto em vez de duplicar a formula.
        const claridade = (c: number[]) => contraste(hex(c), "#000000");
        if (!(claridade(trilho) < claridade(hover) && claridade(hover) < claridade(pilula))) {
          invertidos.push(
            `${tema} / ${cenario}: trilho ${hex(trilho)} hover ${hex(hover)} pilula ${hex(pilula)}`,
          );
        }
      }
    }

    expect(invertidos, "ordem de leitura do grupo invertida").toEqual([]);
  });

  it("--glass-track-label e ESCURO nos dois temas — a pilula ativa e sempre tinta branca", () => {
    // Ao contrario de --glass-control-icon (que se inverte com o tema porque
    // o substrato do TOGGLE se inverte), o substrato da aba nao muda: e
    // sempre --glass-control-selected, rgb(255 255 255 / *) nos dois blocos.
    // O mesmo literal nos dois temas e o ponto — como --glass-action-label
    // (#FFFFFF) ja faz para o caso inverso. Se algum dia divergirem, e para
    // um substrato realmente diferente, nao para "seguir o tema".
    const claro = corpoDe(ESCOPO_GLASS).match(/--glass-track-label:\s*([^;]+);/)?.[1];
    const escuro = corpoDe(`.dark${ESCOPO_GLASS}`).match(/--glass-track-label:\s*([^;]+);/)?.[1];
    expect(claro).toBeDefined();
    expect(claro).toBe(escuro);
    expect(claro).toBe("rgb(44 24 16 / 1)");
  });

  it("as abas preservam todas as utilitarias flat originais", () => {
    const jsx = ler("src/features/library/CollectionTabs.tsx");

    // O trilho mantem as utilitarias de layout que ja tinha no flat.
    for (const classe of ["flex", "items-center", "gap-1"]) {
      expect(jsx, `o trilho perdeu a classe ${classe}`).toContain(classe);
    }
    // E os dois ramos de estado do botao seguem intactos: peso de fonte e
    // cores continuam vindo do TSX, porque o flat depende deles.
    expect(jsx).toContain('"bg-primary font-bold text-primary-foreground"');
    expect(jsx).toContain('"font-normal text-text-secondary hover:bg-surface-muted hover:text-text-primary"');
    expect(jsx).toContain("rounded-full px-4 py-2 text-[13px] leading-[19.5px] transition");
    expect(jsx).toContain("aria-selected={active}");
  });
});

describe("material glass: fechamento — os dois trilhos preservam todas as utilitarias flat", () => {
  // Mesmo formato de "os dois botoes preservam todas as utilitarias flat
  // originais" (acao primaria, acima): extrai as classes do className
  // literal e confere cada uma contra uma lista explicita. Fecha uma lacuna
  // especifica desta leva — o trilho do toggle (:118) nunca tinha guarda
  // propria; so era contado (linha ~715) como par do gatilho "Recente", nunca
  // verificado pelas SUAS proprias utilitarias flat.
  it("o trilho das abas preserva todas as utilitarias flat originais", () => {
    const collectionTabs = ler("src/features/library/CollectionTabs.tsx");
    const classesDoTrilho = collectionTabs
      .match(/className="([^"]*material-surface-track[^"]*)"/)?.[1]
      .split(/\s+/) ?? [];

    for (const classe of ["material-surface-track", "flex", "items-center", "gap-1"]) {
      expect(classesDoTrilho, `trilho das abas perdeu a classe ${classe}`).toContain(classe);
    }
  });

  it("o trilho do toggle preserva todas as utilitarias flat originais", () => {
    const libraryToolbar = ler("src/features/library/LibraryToolbar.tsx");
    // O gatilho "Recente" (:93) COMPARTILHA o mesmo par de marcadores e o
    // mesmo prefixo de classes ("material-liquid-control material-surface-
    // elevated flex items-center"); um match() sem ancora extra pega o
    // primeiro dos dois, que e o gatilho, nao o trilho. "items-center
    // rounded-lg" sem "gap-2" no meio so casa com o trilho (:118) — o
    // gatilho tem gap-2 ali. Travado por teste: se o JSX reaproximar as duas
    // classes a ponto de a ancora deixar de ser unica, este teste falha por
    // capturar o consumidor errado antes mesmo de checar a lista.
    const classesDoTrilho = libraryToolbar
      .match(/className="(material-liquid-control material-surface-elevated flex items-center rounded-lg[^"]*)"/)?.[1]
      .split(/\s+/) ?? [];

    for (const classe of [
      "material-liquid-control",
      "material-surface-elevated",
      "flex",
      "items-center",
      "rounded-lg",
      "border",
      "border-border-muted",
      "bg-surface-panel",
      "p-0.5",
    ]) {
      expect(classesDoTrilho, `trilho do toggle perdeu a classe ${classe}`).toContain(classe);
    }
  });
});

describe("material island: inventario fechado da Library", () => {
  // Ilhas sao ganchos de GEOMETRIA, nao superficies de material. A ancora e um
  // conjunto de classes preexistentes no mesmo className; comparar como conjunto
  // preserva a prova mesmo se a ordem das utilitarias mudar.
  const ILHAS_DA_LIBRARY: ReadonlyArray<readonly [string, string, readonly string[]]> = [
    ["src/components/Sidebar.tsx", "sidebar", ["material-surface", "bg-sidebar"]],
    [
      "src/features/library/LibraryView.tsx",
      "area central",
      ["min-h-0", "min-w-0", "flex-1", "flex-col"],
    ],
    [
      "src/features/library/DocumentDetailsPanel.tsx",
      "painel Detalhes",
      ["material-surface-elevated", "bg-surface-panel"],
    ],
  ];

  it.each(ILHAS_DA_LIBRARY)("%s: material-island na raiz (%s)", (arquivo, papel, ancoras) => {
    const atributosDeClasse = [...ler(arquivo).matchAll(/className\s*=\s*\{?(?:"([^"]*)"|`([^`]*)`)\}?/g)]
      .map((m: RegExpMatchArray) => (m[1] ?? m[2] ?? "").split(/\s+/));
    const casou = atributosDeClasse.some((classes) =>
      classes.includes(MARCADOR_DE_ILHA) && ancoras.every((ancora) => classes.includes(ancora)),
    );

    expect(
      casou,
      `${papel}: nenhum "${MARCADOR_DE_ILHA}" no className com ${ancoras.join(" + ")}`,
    ).toBe(true);
  });

  it("nenhuma quarta ilha escapou para fora do inventario", () => {
    // A lista preserva duplicatas: uma segunda ilha dentro de um arquivo ja
    // inventariado tambem e uma quarta ocorrencia e precisa reprovar.
    expect(ocorrenciasDaClasse(MARCADOR_DE_ILHA)).toEqual(
      ILHAS_DA_LIBRARY.map(([arquivo]) => arquivo).sort(),
    );
  });
});

describe("material glass: contraste do texto secundario sobre as superficies", () => {
  it("informa o contraste das quatro combinacoes", () => {
    const medido = [
      ["surface claro", "#7A6558", "#F4ECE3"],
      ["surface-elevated claro", "#7A6558", "#F7F0E8"],
      ["surface escuro", "#9E8878", "#262220"],
      ["surface-elevated escuro", "#9E8878", "#292521"],
    ].map(([onde, cor, fundo]) => ({ onde, razao: Number(contraste(cor, fundo).toFixed(2)) }));

    // O glass abriu mao do piso WCAG por decisao de produto. O calculo fica
    // visivel, e reativar o piso exige apenas recolocar uma assercao >= 4.5.
    console.log("[contraste informativo][glass][superficies]", medido);
  });

  it("as piores paradas continuam sendo as que o teto do bloco glass presume", () => {
    // Se alguem clarear o fundo do gradiente escuro para "elevar", o pior
    // caso muda de parada e os numeros acima param de descrever a tela.
    expect(css).toContain("--glass-surface: linear-gradient(180deg, #FDFAF7 0%, #F4ECE3 100%);");
    expect(css).toContain("--glass-surface-elevated: linear-gradient(180deg, #FFFDFA 0%, #F7F0E8 100%);");
    expect(css).toContain("--glass-surface: linear-gradient(180deg, #262220 0%, #1C1815 100%);");
    expect(css).toContain("--glass-surface-elevated: linear-gradient(180deg, #292521 0%, #201C19 100%);");
  });
});
