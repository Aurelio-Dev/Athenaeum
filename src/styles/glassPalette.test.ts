import { describe, expect, it } from "vitest";
// @ts-expect-error - sem @types/node no projeto; resolvido em runtime pelo Node.
import { createHash } from "node:crypto";
import { contraste, css } from "./tokenContrast.helpers";

// A INVARIANTE PRINCIPAL DESTA LEVA E O ISOLAMENTO.
//
// O material glass ganhou paleta propria (fundo estratificado, texto
// secundario e capas). O tema padrao — material flat — esta fechado e
// aprovado por decisao de produto, depois de uma reversao inteira. Nenhum
// valor de flat pode mudar, em nenhum tema.
//
// Por isso o teste central aqui nao e sobre os valores novos: e sobre os
// ANTIGOS continuarem exatamente onde estavam. Todo valor novo tem de viver
// sob [data-material="glass"].

type Regra = { seletor: string; corpo: string };

// Todas as regras do arquivo, com os comentarios fora do caminho — eles
// citam tokens de proposito e envenenariam qualquer varredura por texto.
const REGRAS: Regra[] = [
  ...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g),
].map((m: RegExpMatchArray) => ({ seletor: m[1].trim(), corpo: m[2] }));

function declaracoes(corpo: string): string[] {
  return corpo
    .split(";")
    .map((d: string) => d.trim().replace(/\s+/g, " "))
    .filter((d: string) => d.startsWith("--"));
}

function regra(seletor: string): Regra {
  const achada = REGRAS.find((r: Regra) => r.seletor === seletor);
  if (!achada) throw new Error(`Regra nao encontrada: ${seletor}`);
  return achada;
}

const ESCOPO_GLASS = '[data-material="glass"]';

// ---------------------------------------------------------------------------
// Matematica de cor compartilhada pelos describes abaixo.
//
// Vive aqui, e nao em tokenContrast.helpers, porque HSL-com-alpha, composicao
// sobre fundo nao-branco e L* do CIELAB so aparecem neste arquivo. Vive no
// escopo do MODULO, e nao dentro de um describe, porque tres blocos precisam
// da mesma luminancia — tres copias divergiriam.
// ---------------------------------------------------------------------------

function hslParaRgb(hue: number, satPct: number, luzPct: number): [number, number, number] {
  const s = satPct / 100;
  const l = luzPct / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

function hexParaRgb(hex: string): [number, number, number] {
  const v = Number.parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function paraHex(rgb: readonly number[]): string {
  return "#" + rgb.map((v) => Math.round(v).toString(16).toUpperCase().padStart(2, "0")).join("");
}

function compositar(frente: readonly number[], alpha: number, fundo: readonly number[]): [number, number, number] {
  return [0, 1, 2].map((i) => frente[i] * alpha + fundo[i] * (1 - alpha)) as [number, number, number];
}

function luminancia(rgb: readonly number[]): number {
  const canais = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * canais[0] + 0.7152 * canais[1] + 0.0722 * canais[2];
}

function contrasteRgb(a: readonly number[], b: readonly number[]): number {
  const x = luminancia(a);
  const y = luminancia(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

function estrelaL(rgb: readonly number[]): number {
  const y = luminancia(rgb);
  return y > 0.008856 ? 116 * Math.cbrt(y) - 16 : 903.3 * y;
}

/** DeltaL* COM SINAL: positivo = `a` e mais CLARA que `b`. O sinal e o que
 *  distingue "aresta" (borda mais escura que as vizinhas, no claro) de "vao"
 *  (borda mais clara) — uma metrica sem sinal nao responde a pergunta. */
function deltaLAssinado(a: readonly number[], b: readonly number[]): number {
  return estrelaL(a) - estrelaL(b);
}

// Pior caso ao longo de TODO o hue (0-359): --document-cover-hue e por
// documento, entao a garantia so vale se valer para qualquer hue, nao so
// para um hue nomeado.
function piorCaso(medir: (hue: number) => number): { valor: number; hue: number } {
  let piorValor = Infinity;
  let piorHue = 0;
  for (let hue = 0; hue < 360; hue += 1) {
    const valor = medir(hue);
    if (valor < piorValor) {
      piorValor = valor;
      piorHue = hue;
    }
  }
  return { valor: piorValor, hue: piorHue };
}

/** Extrai o alpha de uma declaracao `rgb(... / 0.NN)` do bloco pedido. */
function alphaDaBorda(seletor: string): number {
  const achado = regra(seletor).corpo.match(/--glass-border:\s*rgb\([^)]*\/\s*([\d.]+)\s*\)/);
  if (!achado) throw new Error(`--glass-border nao encontrado em ${seletor}`);
  return Number(achado[1]);
}

describe("isolamento: o material flat nao muda em nenhum valor", () => {
  // Impressao digital do inventario COMPLETO de tokens do tema padrao. Cobre
  // os dois blocos que definem flat, com as declaracoes normalizadas e
  // ordenadas — insensivel a comentario e espaco, sensivel a qualquer valor.
  //
  // Se este teste falhar, um valor de flat mudou. Isso e regressao ate prova
  // em contrario: rode `git diff src/styles/index.css` e olhe :root e .dark.
  // So atualize o hash abaixo quando a mudanca no tema padrao for
  // deliberada e aprovada.
  // ATUALIZADO em 18/08/2026 (chore: remove orphan tokens): a remocao dos 11
  // tokens --reader-header-* (22 declaracoes, dois blocos de tema) e do
  // --floating-header-divider (2 declaracoes) tirou 24 do total — 207 -> 183.
  // Zero consumidores reconfirmados em .tsx/.css antes da remocao; ver o
  // commit. Nao e regressao: e a mudanca deliberada que este teste existe
  // para distinguir de uma acidental.
  const IMPRESSAO_FLAT = "91bfe4525c20782eb71dfe4bb041fd67";
  const TOTAL_FLAT = 183;

  function inventarioFlat(): string[] {
    return [":root", ".dark"]
      .flatMap((sel) => declaracoes(regra(sel).corpo).map((d: string) => `${sel} ${d}`))
      .sort();
  }

  it("o inventario completo de tokens do flat esta intacto", () => {
    const inventario = inventarioFlat();
    const impressao = createHash("sha256").update(inventario.join("\n")).digest("hex").slice(0, 32);

    expect(
      { total: inventario.length, impressao },
      "um valor do tema padrao mudou — ver o comentario acima deste teste",
    ).toEqual({ total: TOTAL_FLAT, impressao: IMPRESSAO_FLAT });
  });

  it("os tokens que esta leva encosta seguem com o valor de flat", () => {
    // Redundante com o hash de proposito: quando um DESTES quebra, a
    // mensagem diz qual e o valor, em vez de so "a impressao mudou".
    const raiz = declaracoes(regra(":root").corpo);
    const escuro = declaracoes(regra(".dark").corpo);

    expect(raiz).toContain("--background: #F5EDE4");
    expect(raiz).toContain("--color-surface-app: var(--background)");
    expect(raiz).toContain("--muted-foreground: #7A6558");
    expect(raiz).toContain("--color-sidebar-muted: #7A6558");
    expect(escuro).toContain("--background: #1A1410");
    expect(escuro).toContain("--muted-foreground: #9E8878");
  });

  it("as capas do flat seguem em 28%/30% de saturacao", () => {
    expect(regra(".document-cover-swatch").corpo).toContain("hsl(var(--document-cover-hue) 28% 74%)");
    expect(regra(".document-cover-line").corpo).toContain("hsl(var(--document-cover-hue) 28% 34% / 0.24)");
    expect(regra(".document-cover-line-strong").corpo).toContain("hsl(var(--document-cover-hue) 30% 30% / 0.34)");
    expect(regra(".dark .document-cover-swatch").corpo).toContain("hsl(var(--document-cover-hue) 30% 18%)");
  });
});

describe("isolamento: todo token novo vive sob [data-material=\"glass\"]", () => {
  it("nenhum token --glass-* e declarado fora do escopo de material", () => {
    const foraDoEscopo = REGRAS.filter(
      (r: Regra) => declaracoes(r.corpo).some((d: string) => d.startsWith("--glass-")) && !r.seletor.includes(ESCOPO_GLASS),
    ).map((r: Regra) => r.seletor);

    expect(foraDoEscopo, "token --glass-* declarado fora do seletor de material").toEqual([]);
  });

  it("nenhuma regra de capa em saturacao 12% escapa do escopo de material", () => {
    const foraDoEscopo = REGRAS.filter(
      (r: Regra) => /document-cover/.test(r.seletor) && /12%/.test(r.corpo) && !r.seletor.includes(ESCOPO_GLASS),
    ).map((r: Regra) => r.seletor);

    expect(foraDoEscopo).toEqual([]);
  });

  it("as capas claras clareadas (86%, alpha 0.40/0.57) nao escapam do escopo de material", () => {
    // Mesmo racional do teste acima, para os valores da leva de 18/08/2026
    // (segunda leva): se um deles aparecer fora do escopo glass, ou vazou
    // para o flat, ou foi escrito no seletor errado.
    const foraDoEscopo = REGRAS.filter(
      (r: Regra) =>
        /document-cover/.test(r.seletor) &&
        (/\b86%/.test(r.corpo) || /\/ 0\.40\b/.test(r.corpo) || /\/ 0\.57\b/.test(r.corpo)) &&
        !r.seletor.includes(ESCOPO_GLASS),
    ).map((r: Regra) => r.seletor);

    expect(foraDoEscopo).toEqual([]);
  });

  it("a troca de consumo do fundo raiz acontece so dentro do escopo", () => {
    // --background continua intocado; o que muda e o alias que body, as
    // utilitarias bg-surface-app e a barra de rolagem leem.
    expect(declaracoes(regra(ESCOPO_GLASS).corpo)).toContain("--color-surface-app: var(--glass-surface-app)");
    expect(declaracoes(regra(":root").corpo)).toContain("--color-surface-app: var(--background)");
  });

  it("o par escuro das capas existe, senao o claro venceria no escuro", () => {
    // [data-material="glass"] .document-cover-* empata com .dark
    // .document-cover-* (0,2,0) e vem depois. Sem o par 0,3,0 abaixo, o
    // escuro receberia luminosidade de tema claro.
    for (const alvo of ["swatch", "line", "line-strong"]) {
      expect(
        REGRAS.some((r: Regra) => r.seletor === `.dark${ESCOPO_GLASS} .document-cover-${alvo}`),
        `falta o par escuro de .document-cover-${alvo}`,
      ).toBe(true);
    }
    expect(regra(`.dark${ESCOPO_GLASS} .document-cover-swatch`).corpo).toContain("12% 18%");
  });

  it("o glass ESCURO das capas fica exatamente como estava (fora de escopo desta leva)", () => {
    // Follow-up de 7631155, so no CLARO: a capa escura ja lia bem por
    // julgamento visual. Trava os tres valores herdados, para que uma
    // mudanca aqui — mesmo acidental, tipo copiar/colar o bloco claro por
    // engano — reprove imediatamente.
    expect(regra(`.dark${ESCOPO_GLASS} .document-cover-swatch`).corpo).toContain(
      "hsl(var(--document-cover-hue) 12% 18%)",
    );
    expect(regra(`.dark${ESCOPO_GLASS} .document-cover-line`).corpo).toContain("rgb(255 255 255 / 0.08)");
    expect(regra(`.dark${ESCOPO_GLASS} .document-cover-line-strong`).corpo).toContain("rgb(255 255 255 / 0.15)");
  });
});

describe("capas no glass CLARO: clareadas para respirar (follow-up de 7631155)", () => {
  // Julgamento visual, nao metrica: a 74% a capa dominava a tela mesmo com
  // saturacao ja em 12% — o problema era AREA (~2/3 do card), nao cor.
  // Subida para 86% de luminosidade; sat e hue ficam.

  it("1. --document-cover-swatch: 86% de luminosidade, sat 12% mantida", () => {
    expect(regra(`${ESCOPO_GLASS} .document-cover-swatch`).corpo).toContain(
      "hsl(var(--document-cover-hue) 12% 86%)",
    );

    // Os tres hues nomeados no brief (verde, roxo, terracota), confirmados
    // por varredura completa de hue — nao contra um palpite de hue exato.
    const casos: Array<[string, number, string]> = [
      ["verde", 90, "#DBE0D7"],
      ["roxo", 275, "#DCD7E0"],
      ["terracota", 28, "#E0DBD7"],
    ];
    for (const [nome, hue, esperado] of casos) {
      expect(paraHex(hslParaRgb(hue, 12, 86)), nome).toBe(esperado);
    }
  });

  it("2. as linhas internas sobem de alpha, na mesma razao que ja existia entre as duas", () => {
    expect(regra(`${ESCOPO_GLASS} .document-cover-line`).corpo).toContain(
      "hsl(var(--document-cover-hue) 12% 34% / 0.40)",
    );
    expect(regra(`${ESCOPO_GLASS} .document-cover-line-strong`).corpo).toContain(
      "hsl(var(--document-cover-hue) 12% 30% / 0.57)",
    );

    // 0.40 * (0.34/0.24) = 0.5666... arredondado para 0.57 (a precisao de 2
    // casas decimais que o resto do arquivo usa) reproduz a razao original
    // (1.4167) a 0.008 de distancia.
    expect(Number((0.57 / 0.4).toFixed(3))).toBeCloseTo(0.34 / 0.24, 1);

    const contrasteLine = piorCaso(
      (hue) => contrasteRgb(compositar(hslParaRgb(hue, 12, 34), 0.4, hslParaRgb(hue, 12, 86)), hslParaRgb(hue, 12, 86)),
    );
    const contrasteStrong = piorCaso(
      (hue) => contrasteRgb(compositar(hslParaRgb(hue, 12, 30), 0.57, hslParaRgb(hue, 12, 86)), hslParaRgb(hue, 12, 86)),
    );

    expect(Number(contrasteLine.valor.toFixed(2))).toBe(1.7);
    expect(Number(contrasteStrong.valor.toFixed(2))).toBe(2.39);
    expect(contrasteLine.valor).toBeGreaterThan(1.65);
    expect(contrasteStrong.valor).toBeGreaterThan(contrasteLine.valor);
  });

  it("3. a capa clareada continua distinguivel do card (>=1.15:1 contra #F7F0E8)", () => {
    // #F7F0E8 e a parada mais escura de --glass-surface-elevated claro — o
    // pior caso de fundo contra o qual a capa aparece (card da grade).
    const cardMaisEscuro: [number, number, number] = [0xf7, 0xf0, 0xe8];
    const distincao = piorCaso((hue) => contrasteRgb(hslParaRgb(hue, 12, 86), cardMaisEscuro));

    expect(Number(distincao.valor.toFixed(3))).toBe(1.18);
    expect(distincao.valor).toBeGreaterThanOrEqual(1.15);
  });
});

describe("--glass-text-secondary", () => {
  const ORIGEM = "#7A6558";

  // LIDO do CSS, nao repetido aqui: se fosse constante local, mudar o valor
  // no index.css passaria batido por todas as assercoes abaixo — o teste
  // afirmaria a si mesmo em vez de afirmar o produto.
  const TOM = (() => {
    const achado = regra(`${ESCOPO_GLASS}:not(.dark)`).corpo.match(/--glass-text-secondary:\s*(#[0-9A-Fa-f]{6})/);
    if (!achado) throw new Error("--glass-text-secondary nao e um hex fixo no glass claro");
    return achado[1].toUpperCase();
  })();

  it("e declarado so no glass CLARO, e o escuro nao ganha token proprio", () => {
    expect(declaracoes(regra(`${ESCOPO_GLASS}:not(.dark)`).corpo)).toContain(`--glass-text-secondary: ${TOM}`);
    // O escuro nao precisa: #9E8878 ja fecha sobre o fundo novo. Um token
    // escuro aqui seria valor morto — e uma copia do flat esperando divergir.
    expect(declaracoes(regra(`.dark${ESCOPO_GLASS}`).corpo).join(" ")).not.toContain("--glass-text-secondary");
  });

  it("fecha 4.5:1 nas tres superficies do glass claro", () => {
    const medido = [
      ["fundo app", "#EDE2D4"],
      ["surface, parada escura", "#F4ECE3"],
      ["elevated, parada escura", "#F7F0E8"],
    ].map(([onde, sup]) => ({ onde, razao: Number(contraste(TOM, sup).toFixed(2)) }));

    // O limiar vem primeiro: e ele que e a exigencia. Os valores exatos
    // logo abaixo travam o tom escolhido — com folga real sobre #EDE2D4
    // (0.07, nao os 0.003 da primeira versao deste token, #766255).
    for (const linha of medido) {
      expect(linha.razao, `${linha.onde} abaixo de AA`).toBeGreaterThanOrEqual(4.5);
    }
    expect(medido).toEqual([
      { onde: "fundo app", razao: 4.57 },
      { onde: "surface, parada escura", razao: 5.0 },
      { onde: "elevated, parada escura", razao: 5.17 },
    ]);
  });

  it("preserva hue e saturacao da origem (nao foi derivado por color-mix)", () => {
    // color-mix rumo a um neutro dessatura: e assim que a regressao de
    // identidade entra sem o contraste acusar. Tolerancia igual a dos outros
    // testes de tom cromatico do projeto.
    const hsl = (hexCor: string) => {
      const v = Number.parseInt(hexCor.slice(1), 16);
      const [r, g, b] = [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const luz = (max + min) / 2;
      if (max === min) return { hue: 0, sat: 0 };
      const d = max - min;
      const sat = luz > 0.5 ? d / (2 - max - min) : d / (max + min);
      const hue = (max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
      return { hue, sat };
    };

    const alvo = hsl(ORIGEM);
    const real = hsl(TOM);
    expect(Math.abs(real.hue - alvo.hue), `hue ${real.hue.toFixed(1)} vs ${alvo.hue.toFixed(1)}`).toBeLessThanOrEqual(4);
    expect(Math.abs(real.sat - alvo.sat), `sat ${real.sat.toFixed(3)} vs ${alvo.sat.toFixed(3)}`).toBeLessThanOrEqual(0.02);
  });

  it("o glass ESCURO dispensa token proprio — #9E8878 fecha sobre o fundo novo", () => {
    expect(Number(contraste("#9E8878", "#120E0C").toFixed(2))).toBe(5.71);
  });
});

describe("--glass-border: aresta, nao vao (Leva 5)", () => {
  // A borda separa a superficie de FORA (o fundo da pagina) da de DENTRO
  // (a capa, nos ~2/3 de cima do card; o proprio card, no terco de baixo).
  // Para ler como ARESTA no tema claro, ela tem de ser mais ESCURA que as
  // duas. E o SINAL do DeltaL* que responde isso — modulo nao serve.
  //
  // A regressao que este teste trava: a Leva 4 recuou --glass-surface-app
  // para #EDE2D4 sem reavaliar a borda, e a 0.08 ela passou a ficar mais
  // CLARA que o fundo (+2.8). Duas superficies escuras com uma linha palida
  // no meio leem como fresta.
  const FUNDO_CLARO = hexParaRgb("#EDE2D4");
  const CARD_CLARO_TOPO = hexParaRgb("#FFFDFA");
  const FUNDO_ESCURO = hexParaRgb("#120E0C");
  const CARD_ESCURO_TOPO = hexParaRgb("#292521");

  it("CLARO: a borda fica MAIS ESCURA que o fundo e que a capa", () => {
    const alpha = alphaDaBorda(ESCOPO_GLASS);
    expect(alpha).toBe(0.2);

    const borda = compositar(hexParaRgb("#2C1A10"), alpha, CARD_CLARO_TOPO);
    expect(paraHex(borda)).toBe("#D5D0CB");

    // Sinal negativo = mais escura. Se algum destes virar positivo, a borda
    // voltou a ler como vao.
    expect(Number(deltaLAssinado(borda, FUNDO_CLARO).toFixed(1))).toBe(-6.8);

    // Contra a capa, no hue de MENOR separacao — e o pior caso real, ja que
    // o hue e determinístico por documento.
    const contraCapa = piorCaso((hue) => Math.abs(deltaLAssinado(borda, hslParaRgb(hue, 12, 86))));
    expect(Number(contraCapa.valor.toFixed(1))).toBe(2.6);
    for (let hue = 0; hue < 360; hue += 1) {
      expect(deltaLAssinado(borda, hslParaRgb(hue, 12, 86)), `hue ${hue} nao ficou mais escura que a capa`).toBeLessThan(0);
    }
  });

  it("ESCURO: preto nao resolve, entao a borda e de LUZ", () => {
    // O fundo escuro (#120E0C) ja esta perto do preto: uma borda preta
    // composta sobre o card ainda fica MAIS CLARA que ele. Registrado como
    // teste para que a inversao de estrategia no escuro nao pareca arbitraria.
    const bordaPretaAntiga = compositar([0, 0, 0], 0.35, CARD_ESCURO_TOPO);
    expect(Number(deltaLAssinado(bordaPretaAntiga, FUNDO_ESCURO).toFixed(1))).toBe(4.2);

    const declaracao = regra(`.dark${ESCOPO_GLASS}`).corpo.match(/--glass-border:\s*([^;]+);/);
    expect(declaracao?.[1].trim()).toBe("rgb(255 255 255 / 0.10)");

    const borda = compositar([255, 255, 255], 0.1, CARD_ESCURO_TOPO);
    expect(paraHex(borda)).toBe("#3E3B37");
    expect(Number(deltaLAssinado(borda, FUNDO_ESCURO).toFixed(1))).toBe(20.8);
    expect(Number(deltaLAssinado(borda, CARD_ESCURO_TOPO).toFixed(1))).toBe(10.0);
  });

  it("o --border do FLAT nao foi tocado por esta leva", () => {
    // Redundante com a impressao digital, de proposito: quando este quebra a
    // mensagem diz o valor, e nao so "a impressao mudou".
    expect(declaracoes(regra(":root").corpo)).toContain("--border: #D9CBBF");
    expect(declaracoes(regra(".dark").corpo)).toContain("--border: #3D2E22");
  });
});

describe("fundo estratificado: separacao de camadas por DeltaL*", () => {
  // DeltaL* (CIELAB), nao contraste WCAG. Sao perguntas diferentes: WCAG
  // responde "da para LER este texto sobre este fundo", e entre dois cremes
  // vizinhos a razao fica ~1.0 sem dizer nada sobre se as camadas se
  // distinguem. Separacao de camada e percepcao de luminosidade.
  // Aqui a separacao interessa em MODULO (as camadas se distinguem ou nao),
  // ao contrario do teste de borda, onde o SINAL e o que importa.
  const dL = (a: string, b: string) =>
    Number(Math.abs(deltaLAssinado(hexParaRgb(a), hexParaRgb(b))).toFixed(1));

  it("CLARO: o fundo novo abre a camada que o fundo do flat nao abria", () => {
    // Era DeltaL* 0.3 contra a parada escura de --glass-surface; virou 3.4.
    expect(dL("#F5EDE4", "#F4ECE3")).toBe(0.3);
    expect(dL("#EDE2D4", "#F4ECE3")).toBe(3.4);
    expect(dL("#EDE2D4", "#F7F0E8")).toBe(4.7);
    expect(dL("#EDE2D4", "#FFFDFA")).toBe(9.0);
  });

  it("ESCURO: idem", () => {
    expect(dL("#1A1410", "#1C1815")).toBe(1.8);
    expect(dL("#120E0C", "#1C1815")).toBe(4.4);
    expect(dL("#120E0C", "#292521")).toBe(10.7);
  });
});
