import { describe, expect, it } from "vitest";
// O `?raw` do Vite nao serve aqui: o pipeline de CSS intercepta a importacao e
// devolve string vazia. O projeto nao tem @types/node e adicionar a dependencia
// so para este teste nao se justifica — o import existe em runtime.
// @ts-expect-error - sem @types/node no projeto; resolvido em runtime pelo Node.
import { readFileSync } from "node:fs";

const css: string = readFileSync(new URL("./index.css", import.meta.url), "utf8");

// Trava o contraste do texto secundario do tema claro contra TODAS as
// superficies sobre as quais ele aparece — nao apenas --card, que era a unica
// superficie validada quando o token era o literal #7A6558 e falhava AA em
// quatro das seis.
//
// O teste le o proprio index.css e recalcula: se alguem baixar a porcentagem
// do color-mix, ou mexer numa superficie, ele quebra aqui em vez de na tela.

const AA_TEXTO_NORMAL = 4.5;

// Superficies do tema claro sobre as quais --muted-foreground (via
// --color-text-secondary / --color-text-subtle) aparece hoje.
const superficiesClaras: ReadonlyArray<readonly [string, string]> = [
  ["--background (surface-app)", "#F5EDE4"],
  ["--card (surface-card/panel)", "#FAF5EF"],
  ["--sidebar", "#EDE5DA"],
  ["--muted (surface-muted)", "#EDE5DA"],
  ["--input (surface-subtle)", "#EDE5DA"],
  ["--color-sidebar-raised", "#D8CCBD"],
  ["--notebook-focus-bar-bg", "#F6F0E8"],
];

// As duas superficies da sidebar, para --color-sidebar-muted.
const superficiesSidebar: ReadonlyArray<readonly [string, string]> = [
  ["--sidebar", "#EDE5DA"],
  ["--color-sidebar-raised", "#D8CCBD"],
];

function paraRgb(hex: string): [number, number, number] {
  const valor = Number.parseInt(hex.slice(1), 16);
  return [(valor >> 16) & 255, (valor >> 8) & 255, valor & 255];
}

// color-mix(in srgb, ...) interpola nos valores sRGB gama-codificados.
function misturar(corA: string, porcentagem: number, corB: string): string {
  const a = paraRgb(corA);
  const b = paraRgb(corB);
  const fator = porcentagem / 100;
  const canais = [0, 1, 2].map((i) => Math.round(a[i] * fator + b[i] * (1 - fator)));
  return `#${canais.map((c) => c.toString(16).toUpperCase().padStart(2, "0")).join("")}`;
}

function luminancia(hex: string): number {
  const canais = paraRgb(hex).map((valor) => {
    const s = valor / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * canais[0] + 0.7152 * canais[1] + 0.0722 * canais[2];
}

function contraste(corA: string, corB: string): number {
  const a = luminancia(corA);
  const b = luminancia(corB);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// Le a porcentagem de um color-mix declarado no CSS, dentro de um bloco.
function lerPorcentagem(bloco: string, token: string): number {
  const regexBloco = new RegExp(`${bloco.replace(/[[\]"^$.*+?()|{}\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`);
  const corpo = css.match(regexBloco);
  if (!corpo) {
    throw new Error(`Bloco nao encontrado no index.css: ${bloco}`);
  }

  const regexToken = new RegExp(`${token}:\\s*color-mix\\(in srgb, var\\([^)]+\\) (\\d+)%`);
  const encontrado = corpo[1].match(regexToken);
  if (!encontrado) {
    throw new Error(`${token} nao e um color-mix com porcentagem em ${bloco}`);
  }

  return Number(encontrado[1]);
}

describe("contraste do texto secundario no tema claro", () => {
  it("--muted-foreground base passa AA nas sete superficies claras", () => {
    const porcentagem = lerPorcentagem(":root", "--muted-foreground");
    const cor = misturar("#1A1410", porcentagem, "#F5EDE4");

    const falhas = superficiesClaras
      .map(([nome, superficie]) => ({ nome, superficie, razao: contraste(cor, superficie) }))
      .filter((linha) => linha.razao < AA_TEXTO_NORMAL);

    expect(falhas, `cor resolvida ${cor} (mix ${porcentagem}%)`).toEqual([]);
  });

  it("--color-sidebar-muted base passa AA nas duas superficies da sidebar", () => {
    const porcentagem = lerPorcentagem(":root", "--color-sidebar-muted");
    const cor = misturar("#2C1810", porcentagem, "#EDE5DA");

    const falhas = superficiesSidebar
      .map(([nome, superficie]) => ({ nome, superficie, razao: contraste(cor, superficie) }))
      .filter((linha) => linha.razao < AA_TEXTO_NORMAL);

    expect(falhas, `cor resolvida ${cor} (mix ${porcentagem}%)`).toEqual([]);
  });

  it("cada nivel do stepper passa AA e sobe em relacao ao anterior", () => {
    const niveis = [
      { rotulo: "100 (base)", bloco: ":root" },
      { rotulo: "110", bloco: 'html[data-ui-contrast="110"]' },
      { rotulo: "120", bloco: 'html[data-ui-contrast="120"]' },
    ];

    let anterior = 0;
    for (const nivel of niveis) {
      const porcentagem = lerPorcentagem(nivel.bloco, "--muted-foreground");

      // Monotonico: um nivel de contraste mais alto nao pode render menos
      // contraste que o anterior — foi exatamente o bug que a base de 72%
      // criou no bloco 110, que usava 68%.
      expect(porcentagem, `nivel ${nivel.rotulo} deve subir em relacao ao anterior`).toBeGreaterThan(anterior);
      anterior = porcentagem;

      const cor = misturar("#1A1410", porcentagem, "#F5EDE4");
      const pior = Math.min(...superficiesClaras.map(([, superficie]) => contraste(cor, superficie)));
      expect(pior, `nivel ${nivel.rotulo}, cor ${cor}`).toBeGreaterThanOrEqual(AA_TEXTO_NORMAL);
    }
  });

  it("nao existe nivel de contraste abaixo do default", () => {
    // O nivel 90 levava as superficies claras a 2.95:1-3.74:1. Se voltar — por
    // reversao ou por copiar-colar de um bloco vizinho — o teste barra aqui.
    expect(css).not.toContain('html[data-ui-contrast="90"]');

    const blocos = [...css.matchAll(/html\[data-ui-contrast="(\d+)"\]/g)].map((m) => Number(m[1]));
    expect(blocos.length).toBeGreaterThan(0);
    for (const nivel of blocos) {
      expect(nivel, "todo nivel declarado tem de estar acima do default 100").toBeGreaterThan(100);
    }
  });

  it("todo nivel declarado no CSS tem opcao no stepper, e vice-versa", () => {
    // Um bloco CSS sem opcao no stepper e codigo morto; uma opcao sem bloco
    // aplica o default silenciosamente e o usuario ve o numero mudar sem efeito.
    const doCss = [...css.matchAll(/html\[data-ui-contrast="(\d+)"\]/g)].map((m) => Number(m[1])).sort((a, b) => a - b);

    const hook: string = readFileSync(new URL("../hooks/useAppearancePreferences.tsx", import.meta.url), "utf8");
    const declaradas = hook.match(/uiContrastOptions: readonly UiContrast\[\] = \[([^\]]+)\]/);
    expect(declaradas, "uiContrastOptions nao encontrado no hook").not.toBeNull();

    const doStepper = declaradas![1].split(",").map((n) => Number(n.trim())).sort((a, b) => a - b);

    // O default 100 nao tem bloco proprio de proposito: ele E a ausencia de
    // override, definida no :root. Os demais precisam de bloco.
    expect(doStepper[0], "o primeiro nivel do stepper e o default 100").toBe(100);
    expect(doCss).toEqual(doStepper.slice(1));
  });

  it("o tema escuro segue nos literais, sem passar pelo mix da base", () => {
    // O .dark tem de continuar fixando os dois tokens: a mudanca de contraste
    // foi so do tema claro. Se um destes sair, o escuro passa a herdar o mix
    // da base e muda de cor sem ninguem pedir.
    const blocoDark = css.match(/\n\.dark\s*\{([\s\S]*?)\n\}/);
    expect(blocoDark).not.toBeNull();
    expect(blocoDark?.[1]).toContain("--muted-foreground: #9E8878;");
    expect(blocoDark?.[1]).toContain("--color-sidebar-muted: #9E8878;");
  });
});
