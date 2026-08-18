import { describe, expect, it } from "vitest";
import { medir, resolver, type LinhaInventario, type Tema } from "./tokenContrast.helpers";

// ATENCAO — ESTE TESTE NAO VALIDA CONFORMIDADE.
//
// Ele era um teste de conformidade: exigia 4.5:1 (WCAG 1.4.3 / AA) de todo
// token de texto secundario sobre toda superficie. As correcoes que faziam
// esses valores passarem foram REVERTIDAS por decisao de produto (escopo
// excedente: o material glass, que motivou a investigacao, nunca dependeu
// delas — #7A6558 sobre #F4ECE3 da 4.69:1 e passa AA por conta propria).
//
// O que restou aqui e um REGISTRO DE DIVIDA CONHECIDA E ACEITA: o inventario
// medido do tema padrao, com cada par token x superficie declarado, e as
// violacoes de AA marcadas explicitamente com `passaAA: false`. Varias linhas
// abaixo estao ABAIXO de 4.5:1 e continuam assim de proposito.
//
// O teste quebra se qualquer valor mudar — para cima OU para baixo. Subir um
// contraste e uma mudanca de design tao real quanto baixar: se alguem mexer
// num token e o inventario nao for atualizado junto, o registro deixa de
// descrever o produto, e ai ele nao serve para mais nada.
//
// Os hexes ja calculados que faziam tudo passar em AA estao no changelog de
// docs/design/athenaeum-design-tokens-cores.md, para quem retomar isto.

const AA_TEXTO = 4.5;

// Superficies contra as quais o texto secundario efetivamente aparece, por
// tema. Rotulo agrupado onde varios tokens compartilham o mesmo hex — sao a
// mesma superficie, e listar tres vezes so inflaria o inventario.
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

// Cada nivel da escada data-ui-contrast. O 100 e o default e nao tem bloco
// proprio: cai direto na base do tema.
const NIVEIS: Record<number, readonly string[]> = {
  90: [`html[data-ui-contrast="90"]`],
  100: [],
  110: [`html[data-ui-contrast="110"]`],
};

function inventariar(token: string, tema: Tema, nivel: number): LinhaInventario[] {
  const seletores = NIVEIS[nivel];
  const cor = resolver(token, tema, seletores);
  return SUPERFICIES[tema].map(([rotulo, superficie]) =>
    medir(rotulo, cor, resolver(superficie, tema, seletores), AA_TEXTO),
  );
}

describe("inventario de --muted-foreground (divida aceita, nao conformidade)", () => {
  it("nivel 100 CLARO — 2 das 4 superficies estao abaixo de AA", () => {
    expect(inventariar("--muted-foreground", "claro", 100)).toEqual([
      { onde: "--background", cor: "#7A6558", fundo: "#F5EDE4", razao: 4.73, passaAA: true },
      { onde: "--card / --popover", cor: "#7A6558", fundo: "#FAF5EF", razao: 5.06, passaAA: true },
      // Esta e a superficie mais comum de texto secundario no app.
      { onde: "--sidebar / --muted / --input", cor: "#7A6558", fundo: "#EDE5DA", razao: 4.39, passaAA: false },
      { onde: "--color-sidebar-raised", cor: "#7A6558", fundo: "#D8CCBD", razao: 3.47, passaAA: false },
    ]);
  });

  it("nivel 100 ESCURO — passa em todas", () => {
    expect(inventariar("--muted-foreground", "escuro", 100)).toEqual([
      { onde: "--background", cor: "#9E8878", fundo: "#1A1410", razao: 5.42, passaAA: true },
      { onde: "--card / --popover / --color-sidebar-raised", cor: "#9E8878", fundo: "#231C16", razao: 5.0, passaAA: true },
      { onde: "--sidebar", cor: "#9E8878", fundo: "#140F0B", razao: 5.66, passaAA: true },
      { onde: "--muted / --input", cor: "#9E8878", fundo: "#2E2018", razao: 4.68, passaAA: true },
    ]);
  });

  it("nivel 90 CLARO — nenhuma superficie passa", () => {
    expect(inventariar("--muted-foreground", "claro", 90)).toEqual([
      { onde: "--background", cor: "#908982", fundo: "#F5EDE4", razao: 2.98, passaAA: false },
      { onde: "--card / --popover", cor: "#908982", fundo: "#FAF5EF", razao: 3.18, passaAA: false },
      { onde: "--sidebar / --muted / --input", cor: "#908982", fundo: "#EDE5DA", razao: 2.76, passaAA: false },
      { onde: "--color-sidebar-raised", cor: "#908982", fundo: "#D8CCBD", razao: 2.18, passaAA: false },
    ]);
  });

  it("nivel 90 ESCURO — nenhuma superficie passa", () => {
    expect(inventariar("--muted-foreground", "escuro", 90)).toEqual([
      { onde: "--background", cor: "#7C766F", fundo: "#1A1410", razao: 4.06, passaAA: false },
      { onde: "--card / --popover / --color-sidebar-raised", cor: "#7C766F", fundo: "#231C16", razao: 3.74, passaAA: false },
      { onde: "--sidebar", cor: "#7C766F", fundo: "#140F0B", razao: 4.24, passaAA: false },
      { onde: "--muted / --input", cor: "#7C766F", fundo: "#2E2018", razao: 3.5, passaAA: false },
    ]);
  });

  it("nivel 110 CLARO — so --color-sidebar-raised fica abaixo", () => {
    expect(inventariar("--muted-foreground", "claro", 110)).toEqual([
      { onde: "--background", cor: "#605954", fundo: "#F5EDE4", razao: 5.93, passaAA: true },
      { onde: "--card / --popover", cor: "#605954", fundo: "#FAF5EF", razao: 6.34, passaAA: true },
      { onde: "--sidebar / --muted / --input", cor: "#605954", fundo: "#EDE5DA", razao: 5.51, passaAA: true },
      { onde: "--color-sidebar-raised", cor: "#605954", fundo: "#D8CCBD", razao: 4.35, passaAA: false },
    ]);
  });

  it("nivel 110 ESCURO — passa em todas", () => {
    expect(inventariar("--muted-foreground", "escuro", 110)).toEqual([
      { onde: "--background", cor: "#ACA49D", fundo: "#1A1410", razao: 7.43, passaAA: true },
      { onde: "--card / --popover / --color-sidebar-raised", cor: "#ACA49D", fundo: "#231C16", razao: 6.85, passaAA: true },
      { onde: "--sidebar", cor: "#ACA49D", fundo: "#140F0B", razao: 7.75, passaAA: true },
      { onde: "--muted / --input", cor: "#ACA49D", fundo: "#2E2018", razao: 6.4, passaAA: true },
    ]);
  });
});

describe("inventario de --color-sidebar-muted (divida aceita, nao conformidade)", () => {
  // Este token so aparece sobre --sidebar; medir contra outra superficie
  // inventaria uma combinacao que nao existe na tela.
  function naSidebar(tema: Tema, nivel: number): LinhaInventario {
    const seletores = NIVEIS[nivel];
    return medir(
      "--sidebar",
      resolver("--color-sidebar-muted", tema, seletores),
      resolver("--sidebar", tema, seletores),
      AA_TEXTO,
    );
  }

  it("CLARO — o default e o nivel 90 ficam abaixo de AA", () => {
    expect([naSidebar("claro", 90), naSidebar("claro", 100), naSidebar("claro", 110)]).toEqual([
      { onde: "--sidebar", cor: "#988B81", fundo: "#EDE5DA", razao: 2.65, passaAA: false },
      { onde: "--sidebar", cor: "#7A6558", fundo: "#EDE5DA", razao: 4.39, passaAA: false },
      { onde: "--sidebar", cor: "#66564D", fundo: "#EDE5DA", razao: 5.6, passaAA: true },
    ]);
  });

  it("ESCURO — so o nivel 90 fica abaixo de AA", () => {
    expect([naSidebar("escuro", 90), naSidebar("escuro", 100), naSidebar("escuro", 110)]).toEqual([
      { onde: "--sidebar", cor: "#756E68", fundo: "#140F0B", razao: 3.8, passaAA: false },
      { onde: "--sidebar", cor: "#9E8878", fundo: "#140F0B", razao: 5.66, passaAA: true },
      { onde: "--sidebar", cor: "#AEA79F", fundo: "#140F0B", razao: 8.0, passaAA: true },
    ]);
  });
});

describe("a superficie que motivou a investigacao original", () => {
  it("o material glass passa AA por conta propria, sem as correcoes revertidas", () => {
    // #F4ECE3 e a superficie glass mais escura do tema claro. E o fato que
    // torna as correcoes revertidas dispensaveis para o glass — registrado
    // como teste para que a premissa da reversao nao vire folclore.
    const linha = medir("glass mais escuro do claro", resolver("--muted-foreground", "claro"), "#F4ECE3", AA_TEXTO);
    expect(linha).toEqual({
      onde: "glass mais escuro do claro",
      cor: "#7A6558",
      fundo: "#F4ECE3",
      razao: 4.69,
      passaAA: true,
    });
  });
});
