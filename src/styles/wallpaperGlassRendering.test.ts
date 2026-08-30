// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error - sem @types/node no projeto; resolvido em runtime pelo Node.
import { createHash } from "node:crypto";
// @ts-expect-error - sem @types/node no projeto; resolvido em runtime pelo Node.
import { readFileSync } from "node:fs";
import {
  applyWallpaperPresentation,
  wallpaperScrimAlpha,
} from "../hooks/useWallpaperBackdrop";
const css = readFileSync("src/styles/index.css", "utf8");
const appShell = readFileSync("src/components/AppShell.tsx", "utf8");

// Os comentarios citam seletores e classes de proposito e usam virgula em
// prosa normal. Toda leitura estrutural do CSS parte da versao sem eles, como
// nos demais testes de estilo do projeto.
const semComentarios = css.replace(/\/\*[\s\S]*?\*\//g, "");

function regra(seletor: string): string {
  const escapado = seletor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const achada = semComentarios.match(new RegExp(`${escapado}\\s*\\{([^}]*)\\}`));
  if (!achada) {
    throw new Error(`Regra nao encontrada: ${seletor}`);
  }
  return achada[1];
}

afterEach(() => {
  applyWallpaperPresentation(null, 0, 100);
  document.documentElement.style.removeProperty("--glass-wallpaper-image-opacity");
});

describe("wallpaper: isolamento do material", () => {
  it("sem wallpaper, os dois temas glass preservam os gradientes opacos aprovados", () => {
    const claro = regra('[data-material="glass"]');
    const escuro = regra('.dark[data-material="glass"]');

    expect(claro).toContain(
      "--glass-surface: linear-gradient(180deg, #FDFAF7 0%, #F4ECE3 100%);",
    );
    expect(claro).toContain(
      "--glass-surface-elevated: linear-gradient(180deg, #FFFDFA 0%, #F7F0E8 100%);",
    );
    expect(escuro).toContain(
      "--glass-surface: linear-gradient(180deg, #262220 0%, #1C1815 100%);",
    );
    expect(escuro).toContain(
      "--glass-surface-elevated: linear-gradient(180deg, #292521 0%, #201C19 100%);",
    );
  });

  it("transparencia e imagem exigem wallpaper; blur tambem admite a acao primaria", () => {
    const ativo = regra('[data-material="glass"][data-wallpaper="active"]');
    const bodyAtivo = regra('[data-material="glass"][data-wallpaper="active"] body');
    const raizAtiva = regra(
      '[data-material="glass"][data-wallpaper="active"] .wallpaper-backdrop-root',
    );

    expect(ativo).not.toContain("--color-surface-app:");
    expect(ativo).toContain("/ var(--glass-wallpaper-scrim-alpha)");
    expect(bodyAtivo).toContain("background-image: var(--glass-wallpaper-image);");
    expect(bodyAtivo).toContain("background-size: cover;");
    expect(raizAtiva).toContain("background: transparent;");
    expect(appShell).toContain("wallpaper-backdrop-root");

    const seletoresComBlur = [...semComentarios.matchAll(/([^{}]+)\{([^{}]*backdrop-filter:[^{}]*)\}/g)]
      .filter((match: RegExpMatchArray) => match[2].includes("blur("))
      .map((match: RegExpMatchArray) => match[1]);
    expect(seletoresComBlur.length).toBeGreaterThan(0);
    // Action vale em todo material glass; optical exige wallpaper translucido.
    // Os dois papeis sao declarativos e nenhuma classe visual e excecao.
    expect(
      seletoresComBlur.every((seletor: string) =>
        seletor
          .split(",")
          .every((parte: string) =>
            parte.includes('[data-material="glass"]')
            && (
              parte.includes('[data-wallpaper="active"]')
              || parte.includes('[data-glass-backdrop="action"]')
            ),
          ),
      ),
    ).toBe(true);
  });

  it("--glass-immersive-* permanece opaco e fora do wallpaper", () => {
    for (const seletor of ['[data-material="glass"]', '.dark[data-material="glass"]']) {
      const bloco = regra(seletor);
      const surface = bloco.match(/--glass-immersive-surface:\s*([^;]+);/)?.[1] ?? "";
      const immersive = bloco
        .split(";")
        .filter((declaracao) => declaracao.includes("--glass-immersive-"))
        .join(";");
      expect(surface).not.toMatch(/#[0-9A-Fa-f]{8}\b|(?:rgb|hsl)a?\([^)]*\/|\b(?:rgba|hsla)\(/);
      expect(immersive).not.toContain("--glass-wallpaper-scrim-alpha");
      expect(immersive).not.toMatch(/rgb\([^)]*\/\s*var\(/);
    }

    const regrasAtivas = css.match(/\[data-material="glass"\]\[data-wallpaper="active"\][^{]*\{[^}]*\}/g) ?? [];
    expect(regrasAtivas.join("\n")).not.toContain("--glass-immersive-");
    expect(regrasAtivas.join("\n")).not.toContain("reader-selection-toolbar");
  });
});

describe("wallpaper: slider governa o alpha do scrim", () => {
  it("mapeia linearmente 0 -> 1.00, 50 -> 0.80 e 100 -> 0.60", () => {
    expect(wallpaperScrimAlpha(0)).toBe(1);
    expect(wallpaperScrimAlpha(50)).toBe(0.8);
    expect(wallpaperScrimAlpha(100)).toBe(0.6);
  });

  it("aplica alpha numa variavel do scrim e nunca opacidade na imagem", () => {
    applyWallpaperPresentation("asset://localhost/wallpaper/wallpaper-1.png", 50, 100);
    const root = document.documentElement;

    expect(root.dataset.wallpaper).toBe("active");
    expect(root.dataset.wallpaperTranslucent).toBe("true");
    expect(root.style.getPropertyValue("--glass-wallpaper-scrim-alpha")).toBe("0.800");
    expect(root.style.getPropertyValue("--glass-wallpaper-image")).toContain(
      "wallpaper-1.png",
    );
    expect(root.style.getPropertyValue("--glass-wallpaper-image-opacity")).toBe("");
    expect(root.style.opacity).toBe("");
    expect(css).not.toMatch(/wallpaper[^{}]*\{[^{}]*\bopacity\s*:/);
  });

  it("no extremo opaco nao marca a janela para backdrop-filter", () => {
    applyWallpaperPresentation("asset://localhost/wallpaper/wallpaper-1.png", 0, 100);
    const root = document.documentElement;

    expect(root.dataset.wallpaper).toBe("active");
    expect(root.dataset.wallpaperTranslucent).toBeUndefined();
    expect(root.style.getPropertyValue("--glass-wallpaper-scrim-alpha")).toBe("1.000");
  });
});

describe("wallpaper: brilho isolado na camada da imagem", () => {
  const ESCOPO_AJUSTADO = '[data-material="glass"][data-wallpaper="active"][data-wallpaper-brightness-adjusted="true"]';

  it("mantem o caminho historico sem filtro em 100%", () => {
    applyWallpaperPresentation("asset://localhost/wallpaper/wallpaper-1.png", 50, 100);
    const root = document.documentElement;

    expect(root.dataset.wallpaperBrightnessAdjusted).toBeUndefined();
    expect(root.style.getPropertyValue("--glass-wallpaper-brightness")).toBe("");
    expect(regra('[data-material="glass"][data-wallpaper="active"] body')).toContain(
      "background-image: var(--glass-wallpaper-image);",
    );
  });

  it("mapeia 50% e 150% para os fatores CSS da imagem", () => {
    applyWallpaperPresentation("asset://localhost/wallpaper/wallpaper-1.png", 50, 50);
    expect(document.documentElement.dataset.wallpaperBrightnessAdjusted).toBe("true");
    expect(
      document.documentElement.style.getPropertyValue("--glass-wallpaper-brightness"),
    ).toBe("0.500");

    applyWallpaperPresentation("asset://localhost/wallpaper/wallpaper-1.png", 50, 150);
    expect(
      document.documentElement.style.getPropertyValue("--glass-wallpaper-brightness"),
    ).toBe("1.500");
  });

  it("remove o estado de brilho junto com o papel de parede", () => {
    applyWallpaperPresentation("asset://localhost/wallpaper/wallpaper-1.png", 50, 150);
    applyWallpaperPresentation(null, 50, 150);

    const root = document.documentElement;
    expect(root.dataset.wallpaperBrightnessAdjusted).toBeUndefined();
    expect(root.style.getPropertyValue("--glass-wallpaper-brightness")).toBe("");
  });

  it("aplica brightness somente no pseudo-elemento que pinta a imagem", () => {
    const corpoAjustado = regra(`${ESCOPO_AJUSTADO} body`);
    const camadaDaImagem = regra(`${ESCOPO_AJUSTADO} body::before`);

    expect(corpoAjustado).toContain("background-image: none;");
    expect(corpoAjustado).toContain("isolation: isolate;");
    expect(camadaDaImagem).toContain("background-image: var(--glass-wallpaper-image);");
    expect(camadaDaImagem).toContain(
      "filter: brightness(var(--glass-wallpaper-brightness));",
    );
    expect(camadaDaImagem).toContain("pointer-events: none;");

    const seletoresComBrilho = [...semComentarios.matchAll(/([^{}]+)\{([^{}]*filter:\s*brightness\([^{}]*)\}/g)]
      .map((match: RegExpMatchArray) => match[1].trim());
    expect(seletoresComBrilho).toEqual([`${ESCOPO_AJUSTADO} body::before`]);
  });
});

describe("flat: os PNGs de producao permanecem byte-identicos", () => {
  const PNGS: ReadonlyArray<readonly [string, string]> = [
    ["src-tauri/app-icon.png", "e1d1c74bd03d78b7087415c51c19af550bb98680e352fe128c4a139d9565824b"],
    ["src-tauri/icons/128x128.png", "8491699390833a3a5893d4da9b47200a6c1474d9fda7d7bd13419343a8972f0f"],
    ["src-tauri/icons/128x128@2x.png", "edf23031ef76421595756d51b9828b1a63abc74ac6a4aeb586e44bcb2ee20d7d"],
    ["src-tauri/icons/32x32.png", "8f75c6d42b9d099c5a1bce52d5ab8e4f86acc4999cc1aa17b981dfbe96f6b8d3"],
    ["src-tauri/icons/Square107x107Logo.png", "1fbc7b1f40137e1830a5a178f42f94aa81bfb3d3bcd20c419930bdde74a54090"],
    ["src-tauri/icons/Square142x142Logo.png", "e0d751af850362fa48a230219c7b23b13723d0c0d19eb378e7102572a0fd0e06"],
    ["src-tauri/icons/Square150x150Logo.png", "741bd479eec3f305a4280f83a93eeca2f84b632bba0dde15763da5e4abf750e3"],
    ["src-tauri/icons/Square284x284Logo.png", "7b23878b683eb63f5a893d69402767585209f97752112f0cf4a394506c071b5c"],
    ["src-tauri/icons/Square30x30Logo.png", "7462ae4769473c4405a094efbba594b642fdf237ee881058c2da058faa085d01"],
    ["src-tauri/icons/Square310x310Logo.png", "749935843c2256b1cb9ee9b13796fa4e4bacd1373da2a652db32bdc0b3082431"],
    ["src-tauri/icons/Square44x44Logo.png", "bb6a7081a254707b85ceb005166f0be2814001fb4c4093351f3a1f0599923741"],
    ["src-tauri/icons/Square71x71Logo.png", "834ab3fe5227ec37a730d50ed41131c84a793a77b4b6f45425714e504812ba50"],
    ["src-tauri/icons/Square89x89Logo.png", "244a4c0141ef904b09192091b08ca7984bb6c848095d1d690477937237244489"],
    ["src-tauri/icons/StoreLogo.png", "9e06f49bcef3363f8a76c0a5da9aabe38a6b6839f6b182baf77a5be8c9fc753d"],
    ["src-tauri/icons/icon.png", "105fda8e1b72d8834714584bd48c2b90a4c275b2d3a65eca19c08c45261e424e"],
    ["src/assets/images/empty-library.png", "dd5749ac5bfc2594e7e09cc2a24e7ded26a5064a09ec22f4cafd750e26db8897"],
  ];

  it.each(PNGS)("%s conserva o SHA-256 capturado antes da leva", (path, expected) => {
    const bytes = readFileSync(path);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(expected);
  });

  it("uma mutacao controlada de um byte e detectada pelo fingerprint", () => {
    const [path, expected] = PNGS[0];
    const bytesMutados = Uint8Array.from(readFileSync(path));
    bytesMutados[bytesMutados.length - 1] ^= 0x01;

    expect(createHash("sha256").update(bytesMutados).digest("hex")).not.toBe(expected);
  });
});
