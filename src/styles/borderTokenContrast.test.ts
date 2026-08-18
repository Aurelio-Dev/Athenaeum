import { describe, expect, it } from "vitest";
// Mesmo racional de mutedForegroundContrast.test.ts: le o CSS como texto para
// quebrar quando alguem mexe no valor, e nao so re-afirmar numeros declarados
// aqui. Sem @types/node no projeto; o import existe em runtime.
// @ts-expect-error - sem @types/node no projeto; resolvido em runtime pelo Node.
import { readFileSync } from "node:fs";

const css: string = readFileSync(new URL("./index.css", import.meta.url), "utf8");
const tailwind: string = readFileSync(new URL("../../tailwind.config.cjs", import.meta.url), "utf8");

// 1.4.11 (Non-text Contrast): limite de componente de interface precisa de
// 3:1 contra o que o cerca. Nao se aplica a divisoria decorativa.
const AA_NAO_TEXTO = 3;

// Superficies contra as quais um limite de componente aparece: o preenchimento
// do proprio controle (--card na maioria dos campos) e o fundo de campo
// (--input, que tambem e --muted).
const superficiesClaras: ReadonlyArray<readonly [string, string]> = [
  ["--card", "#FAF5EF"],
  ["--input / --muted", "#EDE5DA"],
];

const superficiesEscuras: ReadonlyArray<readonly [string, string]> = [
  ["--card", "#231C16"],
  ["--input / --muted", "#2E2018"],
];

// A origem de onde --color-border-strong e derivado em HSL, por tema.
//
// NAO e --border (#D9CBBF claro / #3D2E22 escuro): a primeira versao desta
// correcao (17/08/2026, primeira leva) derivou dali e produziu sat 0.257 —
// quase o dobro da sat ~0.166 de todo o resto do sistema (texto secundario,
// sidebar-muted), e proxima demais do accent #9C5A2E (sat 0.545). A origem
// certa e a mesma dos tokens de TEXTO cromatico: e a saturacao, nao a
// luminancia, que separa a borda de componente do accent.
const ORIGEM_CLARA = "#7A6558";
const ORIGEM_ESCURA = "#9E8878";

// Mesma tolerancia do teste de texto cromatico: arredondar para hex de 8 bits
// desloca hue/sat um pouco.
const TOLERANCIA_HUE_GRAUS = 4;
const TOLERANCIA_SATURACAO = 0.02;

function paraRgb(hex: string): [number, number, number] {
  const valor = Number.parseInt(hex.slice(1), 16);
  return [(valor >> 16) & 255, (valor >> 8) & 255, valor & 255];
}

function paraHsl(hex: string): { hue: number; saturacao: number } {
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

  return { hue: hue * 360, saturacao };
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

function lerHex(bloco: string, token: string): string {
  const regexBloco = new RegExp(`${bloco.replace(/[[\]"^$.*+?()|{}\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`);
  const corpo = css.match(regexBloco);
  if (!corpo) {
    throw new Error(`Bloco nao encontrado no index.css: ${bloco}`);
  }

  const encontrado = corpo[1].match(new RegExp(`${token}:\\s*(#[0-9A-Fa-f]{6})`));
  if (!encontrado) {
    throw new Error(`${token} nao e um hex fixo em ${bloco}`);
  }

  return encontrado[1];
}

function esperarHueSatProximos(hex: string, origem: string, rotulo: string) {
  const alvo = paraHsl(origem);
  const real = paraHsl(hex);

  const deltaHue = Math.min(Math.abs(real.hue - alvo.hue), 360 - Math.abs(real.hue - alvo.hue));
  expect(
    deltaHue,
    `${rotulo}: hue de ${hex} (${real.hue.toFixed(1)}°) deveria ficar perto de ${origem} (${alvo.hue.toFixed(1)}°)`,
  ).toBeLessThanOrEqual(TOLERANCIA_HUE_GRAUS);

  const deltaSat = Math.abs(real.saturacao - alvo.saturacao);
  expect(
    deltaSat,
    `${rotulo}: saturacao de ${hex} (${real.saturacao.toFixed(3)}) deveria ficar perto de ${origem} (${alvo.saturacao.toFixed(3)})`,
  ).toBeLessThanOrEqual(TOLERANCIA_SATURACAO);
}

describe("--color-border-strong: limite de componente", () => {
  it("passa 3:1 sobre --card e --input no tema CLARO", () => {
    const cor = lerHex(":root", "--color-border-strong");

    const falhas = superficiesClaras
      .map(([nome, superficie]) => ({ nome, superficie, razao: Number(contraste(cor, superficie).toFixed(3)) }))
      .filter((linha) => linha.razao < AA_NAO_TEXTO);

    expect(falhas, `cor ${cor}`).toEqual([]);
  });

  it("passa 3:1 sobre --card e --input no tema ESCURO", () => {
    const cor = lerHex(".dark", "--color-border-strong");

    const falhas = superficiesEscuras
      .map(([nome, superficie]) => ({ nome, superficie, razao: Number(contraste(cor, superficie).toFixed(3)) }))
      .filter((linha) => linha.razao < AA_NAO_TEXTO);

    expect(falhas, `cor ${cor}`).toEqual([]);
  });

  it("preserva hue e saturacao da origem de TEXTO nos dois temas", () => {
    // Duas armadilhas distintas que este teste barra:
    //  1. color-mix rumo a --foreground dessatura o tom (documentado nos
    //     tokens de texto cromatico).
    //  2. derivar de --border em vez da origem de texto: --border tem sat
    //     0.255/0.284, quase o dobro da sat ~0.166 do resto do sistema — foi
    //     exatamente o erro da primeira versao desta correcao (#9A785B),
    //     que passava em contraste mas ficava proxima demais do accent.
    esperarHueSatProximos(lerHex(":root", "--color-border-strong"), ORIGEM_CLARA, "strong claro");
    esperarHueSatProximos(lerHex(".dark", "--color-border-strong"), ORIGEM_ESCURA, "strong escuro");
  });

  it("tem contraste maior que a divisoria, nos dois temas", () => {
    // Se os dois convergirem, a distincao de papel virou nome sem semantica
    // outra vez — que e exatamente o estado do qual esta leva saiu.
    const strongClaro = lerHex(":root", "--color-border-strong");
    const strongEscuro = lerHex(".dark", "--color-border-strong");

    expect(contraste(strongClaro, "#FAF5EF")).toBeGreaterThan(contraste("#D9CBBF", "#FAF5EF"));
    expect(contraste(strongEscuro, "#231C16")).toBeGreaterThan(contraste("#3D2E22", "#231C16"));
  });
});

describe("--color-border-muted foi removido", () => {
  it("nao e mais DECLARADO no CSS", () => {
    // Checa a declaracao (`--color-border-muted:`), nao qualquer mencao: o
    // comentario que explica a remocao cita o nome de proposito, e proibir a
    // string inteira tornaria o proprio registro historico impossivel.
    expect(css).not.toMatch(/^\s*--color-border-muted\s*:/m);
  });

  it("nao e mais mapeado no tailwind.config", () => {
    // Sem o mapeamento, `border-border-muted` deixa de existir como classe.
    // Se alguem reintroduzir o mapeamento, volta o terceiro nivel sem
    // semantica que esta leva eliminou.
    expect(tailwind).not.toMatch(/muted:\s*["']var\(--color-border-muted\)["']/);
  });
});

describe("--color-border-subtle: divisoria", () => {
  it("continua derivando de --border, sem valor proprio", () => {
    // A divisoria nao mudou de valor nesta leva. Se ganhar hex fixo, perde a
    // adaptacao automatica ao tema que o .dark faz em --border.
    const raiz = css.match(/:root\s*\{([\s\S]*?)\n\}/);
    expect(raiz?.[1]).toContain("--color-border-subtle: var(--border);");
  });
});
