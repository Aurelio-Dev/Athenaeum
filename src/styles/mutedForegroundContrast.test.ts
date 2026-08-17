import { describe, expect, it } from "vitest";
// O `?raw` do Vite nao serve aqui: o pipeline de CSS intercepta a importacao e
// devolve string vazia. O projeto nao tem @types/node e adicionar a dependencia
// so para este teste nao se justifica — o import existe em runtime.
// @ts-expect-error - sem @types/node no projeto; resolvido em runtime pelo Node.
import { readFileSync } from "node:fs";

const css: string = readFileSync(new URL("./index.css", import.meta.url), "utf8");

// Trava DUAS coisas sobre --muted-foreground e --color-sidebar-muted:
//
// 1. Contraste AA em toda superficie sobre a qual o token aparece — nao so
//    --card, que era a unica validada quando o bug original (4.39:1 e
//    3.47:1 em quatro das seis superficies) passou despercebido.
//
// 2. Identidade cromatica: os dois tokens sao HEX FIXOS, derivados em HSL a
//    partir da cor de origem (#7A6558 no claro, #9E8878 no escuro),
//    preservando hue e saturacao. Isso existe porque a primeira correcao
//    (color-mix rumo a --foreground/--background) tecnicamente passava no
//    teste de contraste mas dessaturava o tom de sat 0.162 para 0.074 —
//    warm taupe virando cinza frio, contra a premissa do design system. O
//    teste de contraste sozinho NAO capturava essa regressao; por isso
//    tambem trava hue/saturacao aqui.
//
// O teste le o proprio index.css e recalcula: se alguem trocar um hex, mexer
// numa superficie, ou voltar a usar color-mix num token cromatico, ele
// quebra aqui em vez de na tela.

const AA_TEXTO_NORMAL = 4.5;

// Tolerancia de deriva de hue/saturacao entre niveis: a busca em HSL escolhe
// a luminosidade minima que fecha AA, e arredondamento pro hex de 8 bits
// desloca hue/sat um pouco a cada nivel. Ver o quanto: no pior nivel
// calculado (dark 110) o hue desvia ~1° e a sat ~0.005 do valor da origem.
const TOLERANCIA_HUE_GRAUS = 4;
const TOLERANCIA_SATURACAO = 0.02;

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

const superficiesEscuras: ReadonlyArray<readonly [string, string]> = [
  ["--background (surface-app)", "#1A1410"],
  ["--card (surface-card/panel)", "#231C16"],
  ["--sidebar", "#140F0B"],
  ["--muted (surface-muted)", "#2E2018"],
  ["--input (surface-subtle)", "#2E2018"],
  ["--color-sidebar-raised (= --card no escuro)", "#231C16"],
  ["--notebook-focus-bar-bg", "#1D1712"],
];

// As duas superficies da sidebar, para --color-sidebar-muted.
const superficiesSidebarClaras: ReadonlyArray<readonly [string, string]> = [
  ["--sidebar", "#EDE5DA"],
  ["--color-sidebar-raised", "#D8CCBD"],
];

const superficiesSidebarEscuras: ReadonlyArray<readonly [string, string]> = [
  ["--sidebar", "#140F0B"],
  ["--color-sidebar-raised (= --card no escuro)", "#231C16"],
];

function paraRgb(hex: string): [number, number, number] {
  const valor = Number.parseInt(hex.slice(1), 16);
  return [(valor >> 16) & 255, (valor >> 8) & 255, valor & 255];
}

function paraHsl(hex: string): { hue: number; saturacao: number; luz: number } {
  let [r, g, b] = paraRgb(hex);
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let hue = 0;
  let saturacao = 0;
  const luz = (max + min) / 2;

  if (max !== min) {
    const delta = max - min;
    saturacao = luz > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    switch (max) {
      case r:
        hue = (g - b) / delta + (g < b ? 6 : 0);
        break;
      case g:
        hue = (b - r) / delta + 2;
        break;
      default:
        hue = (r - g) / delta + 4;
    }
    hue /= 6;
  }

  return { hue: hue * 360, saturacao, luz };
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

function piorContraste(hex: string, superficies: ReadonlyArray<readonly [string, string]>): number {
  return Math.min(...superficies.map(([, superficie]) => contraste(hex, superficie)));
}

// Le um valor hexadecimal fixo declarado no CSS, dentro de um bloco.
function lerHex(bloco: string, token: string): string {
  const regexBloco = new RegExp(`${bloco.replace(/[[\]"^$.*+?()|{}\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`);
  const corpo = css.match(regexBloco);
  if (!corpo) {
    throw new Error(`Bloco nao encontrado no index.css: ${bloco}`);
  }

  const regexToken = new RegExp(`${token}:\\s*(#[0-9A-Fa-f]{6})`);
  const encontrado = corpo[1].match(regexToken);
  if (!encontrado) {
    throw new Error(`${token} nao e um hex fixo em ${bloco}`);
  }

  return encontrado[1];
}

function esperarHueSatProximos(hex: string, origem: string, rotulo: string) {
  const alvo = paraHsl(origem);
  const real = paraHsl(hex);

  const deltaHue = Math.min(Math.abs(real.hue - alvo.hue), 360 - Math.abs(real.hue - alvo.hue));
  expect(deltaHue, `${rotulo}: hue de ${hex} (${real.hue.toFixed(1)}°) deveria ficar perto de ${origem} (${alvo.hue.toFixed(1)}°)`).toBeLessThanOrEqual(
    TOLERANCIA_HUE_GRAUS,
  );

  const deltaSat = Math.abs(real.saturacao - alvo.saturacao);
  expect(
    deltaSat,
    `${rotulo}: saturacao de ${hex} (${real.saturacao.toFixed(3)}) deveria ficar perto de ${origem} (${alvo.saturacao.toFixed(3)})`,
  ).toBeLessThanOrEqual(TOLERANCIA_SATURACAO);
}

describe("contraste e identidade cromatica do texto secundario", () => {
  describe("--muted-foreground", () => {
    it("nivel 100 (base) passa AA nas sete superficies claras, sem perder o tom original", () => {
      const cor = lerHex(":root", "--muted-foreground");
      expect(piorContraste(cor, superficiesClaras)).toBeGreaterThanOrEqual(AA_TEXTO_NORMAL);
      esperarHueSatProximos(cor, "#7A6558", "muted-foreground claro 100");
    });

    it("nivel 100 (base) do escuro continua o literal #9E8878", () => {
      // O .dark tem de continuar fixando este token: a mudanca de contraste foi
      // so do tema claro. Se sair, o escuro herda algum override e muda de cor
      // sem ninguem pedir.
      const blocoDark = css.match(/\n\.dark\s*\{([\s\S]*?)\n\}/);
      expect(blocoDark).not.toBeNull();
      expect(blocoDark?.[1]).toContain("--muted-foreground: #9E8878;");
      expect(piorContraste("#9E8878", superficiesEscuras)).toBeGreaterThanOrEqual(AA_TEXTO_NORMAL);
    });

    it("niveis 110/120 CLAROS sobem em contraste e preservam hue/sat", () => {
      let anterior = piorContraste(lerHex(":root", "--muted-foreground"), superficiesClaras);

      for (const nivel of ["110", "120"]) {
        const cor = lerHex(`html[data-ui-contrast="${nivel}"]`, "--muted-foreground");
        const pior = piorContraste(cor, superficiesClaras);

        expect(pior, `nivel ${nivel} claro, cor ${cor}`).toBeGreaterThanOrEqual(AA_TEXTO_NORMAL);
        expect(pior, `nivel ${nivel} deve subir em relacao ao anterior`).toBeGreaterThan(anterior);
        esperarHueSatProximos(cor, "#7A6558", `muted-foreground claro ${nivel}`);

        anterior = pior;
      }
    });

    it("niveis 110/120 ESCUROS sobem em contraste e preservam hue/sat", () => {
      let anterior = piorContraste("#9E8878", superficiesEscuras);

      for (const nivel of ["110", "120"]) {
        const cor = lerHex(`.dark[data-ui-contrast="${nivel}"]`, "--muted-foreground");
        const pior = piorContraste(cor, superficiesEscuras);

        expect(pior, `nivel ${nivel} escuro, cor ${cor}`).toBeGreaterThanOrEqual(AA_TEXTO_NORMAL);
        expect(pior, `nivel ${nivel} deve subir em relacao ao anterior`).toBeGreaterThan(anterior);
        esperarHueSatProximos(cor, "#9E8878", `muted-foreground escuro ${nivel}`);

        anterior = pior;
      }
    });
  });

  describe("--color-sidebar-muted", () => {
    it("nivel 100 (base) passa AA nas duas superficies da sidebar, claro e escuro", () => {
      const corClara = lerHex(":root", "--color-sidebar-muted");
      expect(piorContraste(corClara, superficiesSidebarClaras)).toBeGreaterThanOrEqual(AA_TEXTO_NORMAL);
      esperarHueSatProximos(corClara, "#7A6558", "sidebar-muted claro 100");

      const blocoDark = css.match(/\n\.dark\s*\{([\s\S]*?)\n\}/);
      expect(blocoDark?.[1]).toContain("--color-sidebar-muted: #9E8878;");
      expect(piorContraste("#9E8878", superficiesSidebarEscuras)).toBeGreaterThanOrEqual(AA_TEXTO_NORMAL);
    });

    it("niveis 110/120 sobem em contraste e preservam hue/sat, claro e escuro", () => {
      let anteriorClaro = piorContraste(lerHex(":root", "--color-sidebar-muted"), superficiesSidebarClaras);
      let anteriorEscuro = piorContraste("#9E8878", superficiesSidebarEscuras);

      for (const nivel of ["110", "120"]) {
        const corClara = lerHex(`html[data-ui-contrast="${nivel}"]`, "--color-sidebar-muted");
        const piorClaro = piorContraste(corClara, superficiesSidebarClaras);
        expect(piorClaro, `nivel ${nivel} claro, cor ${corClara}`).toBeGreaterThanOrEqual(AA_TEXTO_NORMAL);
        expect(piorClaro, `nivel ${nivel} claro deve subir`).toBeGreaterThan(anteriorClaro);
        esperarHueSatProximos(corClara, "#7A6558", `sidebar-muted claro ${nivel}`);
        anteriorClaro = piorClaro;

        const corEscura = lerHex(`.dark[data-ui-contrast="${nivel}"]`, "--color-sidebar-muted");
        const piorEscuro = piorContraste(corEscura, superficiesSidebarEscuras);
        expect(piorEscuro, `nivel ${nivel} escuro, cor ${corEscura}`).toBeGreaterThanOrEqual(AA_TEXTO_NORMAL);
        expect(piorEscuro, `nivel ${nivel} escuro deve subir`).toBeGreaterThan(anteriorEscuro);
        esperarHueSatProximos(corEscura, "#9E8878", `sidebar-muted escuro ${nivel}`);
        anteriorEscuro = piorEscuro;
      }
    });
  });

  it("nao existe nivel de contraste abaixo do default", () => {
    // O nivel 90 levava as superficies claras a 2.95:1-3.74:1. Se voltar — por
    // reversao ou por copiar-colar de um bloco vizinho — o teste barra aqui.
    expect(css).not.toContain('data-ui-contrast="90"');

    const blocos = [...css.matchAll(/\[data-ui-contrast="(\d+)"\]/g)].map((m) => Number(m[1]));
    expect(blocos.length).toBeGreaterThan(0);
    for (const nivel of blocos) {
      expect(nivel, "todo nivel declarado tem de estar acima do default 100").toBeGreaterThan(100);
    }
  });

  it("todo nivel declarado no CSS (claro) tem opcao no stepper, e vice-versa", () => {
    // Um bloco CSS sem opcao no stepper e codigo morto; uma opcao sem bloco
    // aplica o default silenciosamente e o usuario ve o numero mudar sem efeito.
    // So os blocos SEM .dark contam aqui — sao o conjunto que define quais
    // niveis existem; os blocos .dark[data-ui-contrast] sao o override de tema
    // desses mesmos niveis, nao niveis novos.
    const doCss = [...css.matchAll(/(?<!\.dark)html\[data-ui-contrast="(\d+)"\]/g)]
      .map((m) => Number(m[1]))
      .sort((a, b) => a - b);

    const hook: string = readFileSync(new URL("../hooks/useAppearancePreferences.tsx", import.meta.url), "utf8");
    const declaradas = hook.match(/uiContrastOptions: readonly UiContrast\[\] = \[([^\]]+)\]/);
    expect(declaradas, "uiContrastOptions nao encontrado no hook").not.toBeNull();

    const doStepper = declaradas![1].split(",").map((n) => Number(n.trim())).sort((a, b) => a - b);

    // O default 100 nao tem bloco proprio de proposito: ele E a ausencia de
    // override, definida no :root/.dark. Os demais precisam de bloco.
    expect(doStepper[0], "o primeiro nivel do stepper e o default 100").toBe(100);
    expect(doCss).toEqual(doStepper.slice(1));
  });

  it("todo nivel claro > 100 tem o override .dark correspondente", () => {
    // Hex fixo nao se adapta ao tema como color-mix fazia: cada nivel > 100
    // precisa de um bloco .dark[data-ui-contrast=N] proprio, ou o escuro cai
    // no bloco claro (que so existe sem .dark, entao nem se aplicaria) e o
    // usuario nao ve nenhum efeito ao subir o contraste no tema escuro.
    const niveisClaros = [...css.matchAll(/(?<!\.dark)html\[data-ui-contrast="(\d+)"\]/g)].map((m) => Number(m[1]));
    const niveisEscuros = [...css.matchAll(/\.dark\[data-ui-contrast="(\d+)"\]/g)].map((m) => Number(m[1]));

    expect(niveisEscuros.sort((a, b) => a - b)).toEqual(niveisClaros.sort((a, b) => a - b));
  });

  it("--border continua usando color-mix (nao e texto, nao precisa preservar hue/sat)", () => {
    // Trava a decisao documentada: --border e traco/divisor, nao texto, entao
    // o mecanismo antigo continua servindo para ele. Se alguem tentar
    // "consertar" --border do mesmo jeito que os tokens de texto, este teste
    // avisa que a premissa e diferente.
    for (const nivel of ["110", "120"]) {
      const bloco = css.match(new RegExp(`html\\[data-ui-contrast="${nivel}"\\]\\s*\\{([^}]*)\\}`));
      expect(bloco?.[1]).toMatch(/--border:\s*color-mix\(in srgb, var\(--foreground\)/);
    }
  });
});
