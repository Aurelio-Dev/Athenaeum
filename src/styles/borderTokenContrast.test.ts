import { describe, expect, it } from "vitest";
// @ts-expect-error - sem @types/node no projeto; resolvido em runtime pelo Node.
import { readFileSync } from "node:fs";
import { css, medir, resolver, type Tema } from "./tokenContrast.helpers";

// ATENCAO — ESTE TESTE NAO VALIDA CONFORMIDADE.
//
// Ele era um teste de conformidade: exigia 3:1 (WCAG 1.4.11, Non-text
// Contrast) de todo limite de componente, e travava a separacao entre
// `--color-border-strong` (limite de componente) e `--color-border-subtle`
// (divisoria). Essa separacao foi REVERTIDA por decisao de produto, junto com
// as correcoes de texto: era escopo excedente sobre o trabalho de material
// glass que a originou.
//
// O que restou aqui e um REGISTRO DE DIVIDA CONHECIDA E ACEITA: os tres nomes
// de borda voltaram a ser o MESMO valor (`var(--border)`), e nenhuma das
// combinacoes borda x superficie alcanca 3:1 — a maior fica em 1.46:1. Todas
// as linhas do inventario abaixo estao marcadas com `passa1411: false`, e
// continuam assim de proposito.
//
// O teste quebra se qualquer valor mudar, para cima OU para baixo.
//
// Os hexes ja calculados que faziam a borda passar em 1.4.11 (#987F6F claro,
// #7D695A escuro, derivados em HSL da origem dos tokens de texto) estao no
// changelog de docs/design/athenaeum-design-tokens-cores.md.

const MINIMO_1411 = 3;

const tailwind: string = readFileSync(new URL("../../tailwind.config.cjs", import.meta.url), "utf8");

const SUPERFICIES: Record<Tema, ReadonlyArray<readonly [string, string]>> = {
  claro: [
    ["--card / --popover", "--card"],
    ["--background", "--background"],
    ["--sidebar / --muted / --input", "--muted"],
  ],
  escuro: [
    ["--card / --popover", "--card"],
    ["--background", "--background"],
    ["--muted / --input", "--muted"],
  ],
};

function inventariarBorda(tema: Tema) {
  const cor = resolver("--border", tema);
  return SUPERFICIES[tema].map(([rotulo, superficie]) =>
    medir(rotulo, cor, resolver(superficie, tema), MINIMO_1411),
  );
}

describe("inventario de --border (divida aceita, nao conformidade)", () => {
  it("CLARO — nenhuma superficie alcanca o minimo de 3:1", () => {
    expect(inventariarBorda("claro")).toEqual([
      { onde: "--card / --popover", cor: "#D9CBBF", fundo: "#FAF5EF", razao: 1.46, passaAA: false },
      { onde: "--background", cor: "#D9CBBF", fundo: "#F5EDE4", razao: 1.37, passaAA: false },
      // O pior par do tema claro: a borda de um campo contra o proprio
      // preenchimento do campo.
      { onde: "--sidebar / --muted / --input", cor: "#D9CBBF", fundo: "#EDE5DA", razao: 1.27, passaAA: false },
    ]);
  });

  it("ESCURO — nenhuma superficie alcanca o minimo de 3:1", () => {
    expect(inventariarBorda("escuro")).toEqual([
      { onde: "--card / --popover", cor: "#3D2E22", fundo: "#231C16", razao: 1.29, passaAA: false },
      { onde: "--background", cor: "#3D2E22", fundo: "#1A1410", razao: 1.4, passaAA: false },
      { onde: "--muted / --input", cor: "#3D2E22", fundo: "#2E2018", razao: 1.21, passaAA: false },
    ]);
  });
});

describe("os tres nomes de borda voltaram a ser um valor so", () => {
  it("subtle, muted e strong sao todos alias de --border, nos dois temas", () => {
    // Enquanto os tres apontarem para o mesmo lugar, a distincao entre eles e
    // nome sem semantica: trocar um pelo outro no JSX nao muda pixel algum.
    // E o estado que a reversao restaurou de proposito — nao um descuido.
    for (const tema of ["claro", "escuro"] as const) {
      const border = resolver("--border", tema);
      expect(resolver("--color-border-subtle", tema)).toBe(border);
      expect(resolver("--color-border-muted", tema)).toBe(border);
      expect(resolver("--color-border-strong", tema)).toBe(border);
    }
  });

  it("--color-border-muted existe de novo, no CSS e no tailwind", () => {
    // A correcao revertida tinha eliminado este token por ser um terceiro
    // nivel sem semantica. Ele voltou, e os 22 usos de `border-border-muted`
    // no JSX dependem do mapeamento do tailwind para nao virarem classe morta.
    expect(css).toMatch(/^\s*--color-border-muted\s*:/m);
    expect(tailwind).toMatch(/muted:\s*["']var\(--color-border-muted\)["']/);
  });
});
