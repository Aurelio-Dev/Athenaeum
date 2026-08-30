import { describe, expect, it } from "vitest";
import { medir, resolver, type LinhaInventario, type Tema } from "./tokenContrast.helpers";

// Registro da dívida aceita do tema Padrão no valor neutro. Os níveis de
// contraste deixaram de ser blocos CSS discretos: agora são uma curva 90–150
// aplicada pelo provider global e testada em appearancePresentation.test.ts.
// Este inventário continua impedindo que o baseline mude silenciosamente.

const AA_TEXTO = 4.5;

const SUPERFICIES: Record<Tema, ReadonlyArray<readonly [string, string]>> = {
  claro: [
    ["--background", "--background"],
    ["--card / --popover", "--card"],
    ["--sidebar / --muted / --input", "--muted"],
    ["--color-sidebar-raised", "--color-sidebar-raised"],
  ],
  escuro: [
    ["--background", "--background"],
    ["--card / --popover / --color-sidebar-raised", "--card"],
    ["--sidebar", "--sidebar"],
    ["--muted / --input", "--muted"],
  ],
};

function inventariar(token: string, tema: Tema): LinhaInventario[] {
  const cor = resolver(token, tema);
  return SUPERFICIES[tema].map(([rotulo, superficie]) =>
    medir(rotulo, cor, resolver(superficie, tema), AA_TEXTO),
  );
}

describe("inventario neutro de --muted-foreground", () => {
  it("CLARO — duas das quatro superficies ficam abaixo de AA", () => {
    expect(inventariar("--muted-foreground", "claro")).toEqual([
      { onde: "--background", cor: "#7A6558", fundo: "#F5EDE4", razao: 4.73, passaAA: true },
      { onde: "--card / --popover", cor: "#7A6558", fundo: "#FAF5EF", razao: 5.06, passaAA: true },
      { onde: "--sidebar / --muted / --input", cor: "#7A6558", fundo: "#EDE5DA", razao: 4.39, passaAA: false },
      { onde: "--color-sidebar-raised", cor: "#7A6558", fundo: "#D8CCBD", razao: 3.47, passaAA: false },
    ]);
  });

  it("ESCURO — passa em todas as superficies inventariadas", () => {
    expect(inventariar("--muted-foreground", "escuro")).toEqual([
      { onde: "--background", cor: "#9E8878", fundo: "#1A1410", razao: 5.42, passaAA: true },
      { onde: "--card / --popover / --color-sidebar-raised", cor: "#9E8878", fundo: "#231C16", razao: 5.0, passaAA: true },
      { onde: "--sidebar", cor: "#9E8878", fundo: "#140F0B", razao: 5.66, passaAA: true },
      { onde: "--muted / --input", cor: "#9E8878", fundo: "#2E2018", razao: 4.68, passaAA: true },
    ]);
  });
});

describe("inventario neutro de --color-sidebar-muted", () => {
  function naSidebar(tema: Tema): LinhaInventario {
    return medir(
      "--sidebar",
      resolver("--color-sidebar-muted", tema),
      resolver("--sidebar", tema),
      AA_TEXTO,
    );
  }

  it("mantem os valores aprovados dos dois temas", () => {
    expect(naSidebar("claro")).toEqual({
      onde: "--sidebar",
      cor: "#7A6558",
      fundo: "#EDE5DA",
      razao: 4.39,
      passaAA: false,
    });
    expect(naSidebar("escuro")).toEqual({
      onde: "--sidebar",
      cor: "#9E8878",
      fundo: "#140F0B",
      razao: 5.66,
      passaAA: true,
    });
  });
});

describe("a superficie que motivou a investigacao original", () => {
  it("o material glass passa AA por conta propria no valor neutro", () => {
    expect(
      medir(
        "glass mais escuro do claro",
        resolver("--muted-foreground", "claro"),
        "#F4ECE3",
        AA_TEXTO,
      ),
    ).toEqual({
      onde: "glass mais escuro do claro",
      cor: "#7A6558",
      fundo: "#F4ECE3",
      razao: 4.69,
      passaAA: true,
    });
  });
});
