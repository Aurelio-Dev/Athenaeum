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

const MARCADORES = [
  "material-surface",
  "material-surface-elevated",
  "material-surface-card",
  "material-surface-overlay",
] as const;

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

describe("material glass: cada papel consome o token certo", () => {
  function blocoDaRegra(seletor: string): string {
    const achado = css.match(new RegExp(`\\[data-material="glass"\\]\\s+\\.${seletor}\\s*\\{([^}]*)\\}`));
    if (!achado) {
      throw new Error(`Regra glass nao encontrada para .${seletor}`);
    }
    return achado[1];
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
    const escopoGlass = (
      css.match(/\[data-material="glass"\]\s+\.material-surface[\w-]*\s*\{[^}]*\}/g) ?? []
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

describe("material glass: as superficies da Library carregam o marcador certo", () => {
  // Papel esperado de cada superficie, com a utilitaria de fundo que ela ja
  // tinha no flat — o par prova que o marcador foi para o elemento certo, e
  // nao para um filho qualquer que por acaso tem a mesma classe.
  const ALVOS: ReadonlyArray<readonly [string, string, string, string]> = [
    ["src/components/Sidebar.tsx", "material-surface", "bg-sidebar", "sidebar (raiz)"],
    ["src/components/Sidebar.tsx", "material-surface-overlay", "bg-surface-panel", "dialogo de colecao"],
    ["src/features/library/LibraryToolbar.tsx", "material-surface-elevated", "bg-surface-panel", "controles da toolbar"],
    ["src/features/library/LibraryToolbar.tsx", "material-surface-overlay", "bg-surface-panel", "menu de ordenacao"],
    ["src/features/library/LibraryView.tsx", "material-surface-elevated", "bg-surface-card", "container da lista"],
    ["src/features/library/DocumentCard.tsx", "material-surface-card", "bg-surface-card", "card da grade"],
    ["src/features/library/DocumentDetailsPanel.tsx", "material-surface-elevated", "bg-surface-panel", "painel Detalhes docado"],
    ["src/features/library/DocumentDetailsPanel.tsx", "material-surface-overlay", "bg-surface-panel", "painel Detalhes em modal"],
    ["src/features/library/AddDocumentModal.tsx", "material-surface-overlay", "bg-surface-panel", "modal de adicionar"],
    ["src/features/library/DocumentPickerModal.tsx", "material-surface-overlay", "bg-surface-panel", "modal de escolher documento"],
    ["src/features/library/RenameLibraryItemModal.tsx", "material-surface-overlay", "bg-surface-panel", "modal de renomear"],
    ["src/components/NewCollectionModal.tsx", "material-surface-overlay", "bg-surface-panel", "modal de nova colecao"],
    ["src/components/ConfirmationDialog.tsx", "material-surface-overlay", "bg-surface-panel", "dialogo de confirmacao"],
  ];

  it.each(ALVOS)("%s: %s em %s (%s)", (arquivo, marcador, fundo, papel) => {
    const fonte = ler(arquivo);
    // Casa por PROXIMIDADE, nao extraindo o atributo className: varios destes
    // sao template literals multilinha com interpolacao, que nenhum regex
    // simples de atributo pega inteiro. O marcador precisa terminar ali (\b
    // nao serve: -elevated tem -surface como prefixo), dai o delimitador
    // explicito; a utilitaria de fundo tem de estar na mesma vizinhanca.
    const JANELA = 700;
    const ocorrencias = [...fonte.matchAll(new RegExp(`${marcador}(?=[\\s"\`])`, "g"))];
    const casou = ocorrencias.some((m) =>
      fonte.slice(m.index ?? 0, (m.index ?? 0) + JANELA).includes(fundo),
    );
    expect(casou, `${papel}: nenhum "${marcador}" perto de "${fundo}"`).toBe(true);
  });

  it("nenhum marcador escapou para fora do inventario acima", () => {
    // Um marcador solto em outro componente pinta de vidro algo que nao foi
    // analisado — e o modo mais provavel de esta leva vazar escopo. Varre a
    // arvore inteira e compara com o inventario declarado acima.
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
          if (readFileSync(new URL(entrada.name, dir), "utf8").includes("material-surface")) {
            encontrados.add(caminho);
          }
        }
      }
    }
    varrer(raiz, "src/");

    expect([...encontrados].sort()).toEqual([...new Set(ALVOS.map(([arquivo]) => arquivo))].sort());
  });
});

describe("material glass: contraste do texto secundario sobre as superficies", () => {
  // Valores ja validados quando os tokens foram criados; aqui ficam travados
  // contra a pior parada de cada gradiente — a mais escura no claro, a mais
  // clara no escuro, que e onde o texto secundario tem menos margem.
  it("as quatro combinacoes seguem acima de 4.5:1", () => {
    const medido = [
      ["surface claro", "#7A6558", "#F4ECE3"],
      ["surface-elevated claro", "#7A6558", "#F7F0E8"],
      ["surface escuro", "#9E8878", "#262220"],
      ["surface-elevated escuro", "#9E8878", "#292521"],
    ].map(([onde, cor, fundo]) => ({ onde, razao: Number(contraste(cor, fundo).toFixed(2)) }));

    expect(medido).toEqual([
      { onde: "surface claro", razao: 4.69 },
      { onde: "surface-elevated claro", razao: 4.85 },
      { onde: "surface escuro", razao: 4.69 },
      { onde: "surface-elevated escuro", razao: 4.52 },
    ]);
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
