// Helpers compartilhados pelos dois testes de INVENTARIO de contraste
// (mutedForegroundContrast.test.ts e borderTokenContrast.test.ts).
//
// Existe como modulo proprio, e nao duplicado nos dois arquivos, porque
// resolver um token do index.css agora exige seguir `var()` e calcular
// `color-mix()` — os niveis da escada `data-ui-contrast` sao declarados como
// mistura, nao como hex. Duas copias dessa resolucao divergiriam.

// @ts-expect-error - sem @types/node no projeto; resolvido em runtime pelo Node.
import { readFileSync } from "node:fs";

export const css: string = readFileSync(new URL("./index.css", import.meta.url), "utf8");

export type Tema = "claro" | "escuro";

function paraRgb(hex: string): [number, number, number] {
  const valor = Number.parseInt(hex.slice(1), 16);
  return [(valor >> 16) & 255, (valor >> 8) & 255, valor & 255];
}

function paraHex(canais: readonly number[]): string {
  return "#" + canais.map((v) => Math.round(v).toString(16).toUpperCase().padStart(2, "0")).join("");
}

function luminancia(hex: string): number {
  const canais = paraRgb(hex).map((valor) => {
    const s = valor / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * canais[0] + 0.7152 * canais[1] + 0.0722 * canais[2];
}

export function contraste(corA: string, corB: string): number {
  const a = luminancia(corA);
  const b = luminancia(corB);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// color-mix(in srgb, A p%, B) interpola em sRGB GAMA-CODIFICADO, nao em luz
// linear. Conferido contra o motor do WebView2 do app: os quatro valores da
// escada batem exatamente com esta implementacao.
function misturarSrgb(corA: string, porcentagem: number, corB: string): string {
  const a = paraRgb(corA);
  const b = paraRgb(corB);
  return paraHex([0, 1, 2].map((i) => (a[i] * porcentagem + b[i] * (100 - porcentagem)) / 100));
}

function corpoDoBloco(seletor: string): string {
  const escapado = seletor.replace(/[[\]"^$.*+?()|{}\\]/g, "\\$&");
  const achado = css.match(new RegExp(`${escapado}\\s*\\{([^}]*)\\}`));
  if (!achado) {
    throw new Error(`Bloco nao encontrado no index.css: ${seletor}`);
  }
  return achado[1];
}

function declaracaoCrua(seletor: string, token: string): string | null {
  const achado = corpoDoBloco(seletor).match(new RegExp(`${token}:\\s*([^;]+);`));
  return achado ? achado[1].trim() : null;
}

// Os blocos que definem a base de cada tema. O claro mora em :root; o escuro
// sobrescreve em .dark, e o que ele nao sobrescreve continua vindo do :root.
const BLOCOS: Record<Tema, readonly string[]> = {
  claro: [":root"],
  escuro: [".dark", ":root"],
};

/**
 * Resolve um token do index.css ate um hex, seguindo `var()` e calculando
 * `color-mix()`. `seletoresExtras` entra na frente da cascata do tema — e como
 * os niveis de `data-ui-contrast` sobrescrevem a base.
 */
export function resolver(token: string, tema: Tema, seletoresExtras: readonly string[] = []): string {
  const cascata = [...seletoresExtras, ...BLOCOS[tema]];

  let valor: string | null = null;
  for (const seletor of cascata) {
    valor = declaracaoCrua(seletor, token);
    if (valor) break;
  }
  if (!valor) {
    throw new Error(`Token ${token} nao encontrado para o tema ${tema}`);
  }

  return resolverValor(valor, tema, seletoresExtras);
}

function resolverValor(valor: string, tema: Tema, seletoresExtras: readonly string[]): string {
  const bruto = valor.trim();

  if (/^#[0-9A-Fa-f]{6}$/.test(bruto)) {
    return bruto.toUpperCase();
  }

  const referencia = bruto.match(/^var\(\s*(--[\w-]+)\s*\)$/);
  if (referencia) {
    // Um var() dentro do bloco .dark pode apontar para um token que o proprio
    // .dark redefine (--color-sidebar-raised: var(--card)), entao a resolucao
    // recomeca do topo da cascata do tema.
    return resolver(referencia[1], tema, seletoresExtras);
  }

  const mistura = bruto.match(/^color-mix\(\s*in\s+srgb\s*,\s*(.+?)\s+([\d.]+)%\s*,\s*(.+?)\s*\)$/);
  if (mistura) {
    const corA = resolverValor(mistura[1], tema, seletoresExtras);
    const corB = resolverValor(mistura[3], tema, seletoresExtras);
    return misturarSrgb(corA, Number(mistura[2]), corB);
  }

  throw new Error(`Nao sei resolver o valor: ${bruto}`);
}

/** Uma linha do inventario: o par token x superficie e o que ele mede hoje. */
export type LinhaInventario = {
  onde: string;
  cor: string;
  fundo: string;
  razao: number;
  passaAA: boolean;
};

export function medir(onde: string, cor: string, fundo: string, minimo: number): LinhaInventario {
  const razao = Number(contraste(cor, fundo).toFixed(2));
  return { onde, cor, fundo, razao, passaAA: razao >= minimo };
}
