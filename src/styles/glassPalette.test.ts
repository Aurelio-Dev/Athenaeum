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

describe("isolamento: o material flat nao muda em nenhum valor", () => {
  // Impressao digital do inventario COMPLETO de tokens do tema padrao. Cobre
  // os dois blocos que definem flat, com as declaracoes normalizadas e
  // ordenadas — insensivel a comentario e espaco, sensivel a qualquer valor.
  //
  // Se este teste falhar, um valor de flat mudou. Isso e regressao ate prova
  // em contrario: rode `git diff src/styles/index.css` e olhe :root e .dark.
  // So atualize o hash abaixo quando a mudanca no tema padrao for
  // deliberada e aprovada.
  // Capturado com o diff desta leva contendo ZERO linhas removidas — so
  // adicoes —, o que prova que nenhuma declaracao existente foi tocada.
  const IMPRESSAO_FLAT = "b15abc70407c5211c600714f6de869f3";
  const TOTAL_FLAT = 207;

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
    // logo abaixo travam o tom escolhido — a margem sobre #EDE2D4 e de
    // 0.003, entao qualquer clareada quebra os dois de uma vez.
    for (const linha of medido) {
      expect(linha.razao, `${linha.onde} abaixo de AA`).toBeGreaterThanOrEqual(4.5);
    }
    expect(medido).toEqual([
      { onde: "fundo app", razao: 4.5 },
      { onde: "surface, parada escura", razao: 4.92 },
      { onde: "elevated, parada escura", razao: 5.09 },
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

describe("fundo estratificado: separacao de camadas por DeltaL*", () => {
  // DeltaL* (CIELAB), nao contraste WCAG. Sao perguntas diferentes: WCAG
  // responde "da para LER este texto sobre este fundo", e entre dois cremes
  // vizinhos a razao fica ~1.0 sem dizer nada sobre se as camadas se
  // distinguem. Separacao de camada e percepcao de luminosidade.
  const estrelaL = (hexCor: string) => {
    const v = Number.parseInt(hexCor.slice(1), 16);
    const canais = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    const y = 0.2126 * canais[0] + 0.7152 * canais[1] + 0.0722 * canais[2];
    return y > 0.008856 ? 116 * Math.cbrt(y) - 16 : 903.3 * y;
  };
  const dL = (a: string, b: string) => Number(Math.abs(estrelaL(a) - estrelaL(b)).toFixed(1));

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
