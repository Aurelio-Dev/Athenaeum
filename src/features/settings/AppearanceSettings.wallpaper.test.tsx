// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppearanceSettings } from "./AppearanceSettings";

const tauriMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn((path: string) => `http://asset.localhost/${encodeURIComponent(path)}`),
}));

const databaseMocks = vi.hoisted(() => ({
  getWallpaperFile: vi.fn(),
  setWallpaperFile: vi.fn(),
  clearWallpaperFile: vi.fn(),
  getWallpaperOpacity: vi.fn(),
  setWallpaperOpacity: vi.fn(),
}));

const presentationMocks = vi.hoisted(() => ({
  applyWallpaperPresentation: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: tauriMocks.invoke,
  convertFileSrc: tauriMocks.convertFileSrc,
}));

vi.mock("../../lib/database", () => ({
  MIN_WALLPAPER_OPACITY: 0,
  MAX_WALLPAPER_OPACITY: 100,
  DEFAULT_WALLPAPER_OPACITY: 50,
  getWallpaperFile: databaseMocks.getWallpaperFile,
  setWallpaperFile: databaseMocks.setWallpaperFile,
  clearWallpaperFile: databaseMocks.clearWallpaperFile,
  getWallpaperOpacity: databaseMocks.getWallpaperOpacity,
  setWallpaperOpacity: databaseMocks.setWallpaperOpacity,
}));

vi.mock("../../hooks/useWallpaperBackdrop", () => ({
  applyWallpaperPresentation: presentationMocks.applyWallpaperPresentation,
}));

vi.mock("../../hooks/useTheme", () => ({
  useTheme: () => ({
    theme: "light",
    setTheme: vi.fn(),
    toggleTheme: vi.fn(),
    material: "glass",
    setMaterial: vi.fn(),
  }),
}));

vi.mock("../../hooks/useDividerLines", () => ({
  useDividerLines: () => ({ showDividerLines: true, setShowDividerLines: vi.fn() }),
}));

vi.mock("../../hooks/useAppearancePreferences", () => ({
  uiContrastOptions: [90, 100, 110],
  uiFontScaleOptions: [90, 100, 110],
  useAppearancePreferences: () => ({
    uiContrast: 100,
    setUiContrast: vi.fn(),
    uiFontScale: 100,
    setUiFontScale: vi.fn(),
  }),
}));

let container: HTMLDivElement | null = null;
let root: Root | null = null;

// O hook do wallpaper carrega o estado num efeito assincrono; sem esperar o
// microtask a primeira renderizacao ainda esta em "carregando".
async function render() {
  await act(async () => {
    root?.render(<AppearanceSettings />);
  });
}

function button(label: string) {
  const element = Array.from(container?.querySelectorAll("button") ?? []).find(
    (candidate) => candidate.textContent === label,
  );
  if (!element) {
    throw new Error(`Botao nao encontrado: ${label}`);
  }
  return element;
}

function queryButton(label: string) {
  return Array.from(container?.querySelectorAll("button") ?? []).find(
    (candidate) => candidate.textContent === label,
  );
}

function preview() {
  return container?.querySelector<HTMLImageElement>('img[alt="Prévia do papel de parede"]') ?? null;
}

function opacitySlider() {
  const element = container?.querySelector<HTMLInputElement>(
    'input[aria-label="Opacidade do papel de parede"]',
  );
  if (!element) {
    throw new Error("Slider de opacidade nao encontrado.");
  }
  return element;
}

// Um input controlado do React ignora atribuicao direta em .value: o setter
// nativo precisa ser chamado para o evento carregar o valor novo.
function setSliderValue(slider: HTMLInputElement, value: number) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(slider, String(value));
  slider.dispatchEvent(new Event("input", { bubbles: true }));
}

function click(element: Element) {
  element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  tauriMocks.invoke.mockReset();
  tauriMocks.convertFileSrc.mockClear();
  databaseMocks.getWallpaperFile.mockReset().mockResolvedValue(null);
  databaseMocks.setWallpaperFile.mockReset().mockResolvedValue(undefined);
  databaseMocks.clearWallpaperFile.mockReset().mockResolvedValue(undefined);
  databaseMocks.getWallpaperOpacity.mockReset().mockResolvedValue(50);
  databaseMocks.setWallpaperOpacity.mockReset().mockResolvedValue(undefined);
  presentationMocks.applyWallpaperPresentation.mockReset();

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
  vi.useRealTimers();
});

describe("controle de papel de parede em Aparencia", () => {
  it("sem wallpaper: oferece escolher, sem previa e sem remover", async () => {
    await render();

    expect(preview()).toBeNull();
    expect(queryButton("Remover")).toBeUndefined();
    expect(button("Escolher imagem")).toBeTruthy();
    expect(opacitySlider().disabled).toBe(true);
  });

  it("importa a imagem escolhida e so entao grava a chave", async () => {
    tauriMocks.invoke.mockImplementation(async (command: string) => {
      if (command === "select_wallpaper_image") {
        return { file_name: "montanha.png", file_path: "D:\\Imagens\\montanha.png" };
      }
      if (command === "import_wallpaper") {
        return {
          file_name: "wallpaper-1755648000.png",
          file_path: "C:\\dados\\wallpaper\\wallpaper-1755648000.png",
          file_size: 2048,
        };
      }
      throw new Error(`comando inesperado: ${command}`);
    });
    await render();

    await act(async () => click(button("Escolher imagem")));

    expect(tauriMocks.invoke).toHaveBeenCalledWith("import_wallpaper", {
      sourcePath: "D:\\Imagens\\montanha.png",
    });
    // A ORDEM importa: o arquivo primeiro, a chave depois. Uma chave apontando
    // para um arquivo que nunca foi copiado o app nao tem como consertar.
    const ordemImport = tauriMocks.invoke.mock.invocationCallOrder[1];
    const ordemChave = databaseMocks.setWallpaperFile.mock.invocationCallOrder[0];
    expect(ordemChave).toBeGreaterThan(ordemImport);

    // Persiste o NOME devolvido pelo Rust, nao o nome do arquivo de origem.
    expect(databaseMocks.setWallpaperFile).toHaveBeenCalledWith("wallpaper-1755648000.png");
    expect(preview()?.getAttribute("src")).toBe(
      "http://asset.localhost/C%3A%5Cdados%5Cwallpaper%5Cwallpaper-1755648000.png",
    );
    expect(button("Trocar imagem")).toBeTruthy();
    expect(opacitySlider().disabled).toBe(false);
  });

  it("mostra estado de carregamento enquanto a copia acontece", async () => {
    let concluirImportacao: (value: unknown) => void = () => {};
    tauriMocks.invoke.mockImplementation((command: string) => {
      if (command === "select_wallpaper_image") {
        return Promise.resolve({ file_name: "a.png", file_path: "D:\\a.png" });
      }
      return new Promise((resolve) => {
        concluirImportacao = resolve;
      });
    });
    await render();

    await act(async () => click(button("Escolher imagem")));

    // O dialogo ja fechou e a copia esta em curso: o botao anuncia isso e nao
    // aceita um segundo clique.
    const botaoOcupado = button("Copiando...");
    expect((botaoOcupado as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      concluirImportacao({
        file_name: "wallpaper-1.png",
        file_path: "C:\\dados\\wallpaper\\wallpaper-1.png",
        file_size: 10,
      });
    });

    expect(queryButton("Copiando...")).toBeUndefined();
  });

  it("cancelar o dialogo nao importa nem grava nada", async () => {
    tauriMocks.invoke.mockResolvedValue(null);
    await render();

    await act(async () => click(button("Escolher imagem")));

    expect(tauriMocks.invoke).toHaveBeenCalledTimes(1);
    expect(tauriMocks.invoke).not.toHaveBeenCalledWith("import_wallpaper", expect.anything());
    expect(databaseMocks.setWallpaperFile).not.toHaveBeenCalled();
    expect(preview()).toBeNull();
  });

  it("mostra o erro do backend e nao grava a chave quando a importacao e recusada", async () => {
    tauriMocks.invoke.mockImplementation(async (command: string) => {
      if (command === "select_wallpaper_image") {
        return { file_name: "planilha.png", file_path: "D:\\planilha.png" };
      }
      throw "Formato de imagem nao suportado. Use PNG, JPEG ou WebP.";
    });
    await render();

    await act(async () => click(button("Escolher imagem")));

    expect(container?.querySelector('[role="alert"]')?.textContent).toBe(
      "Formato de imagem nao suportado. Use PNG, JPEG ou WebP.",
    );
    expect(databaseMocks.setWallpaperFile).not.toHaveBeenCalled();
    expect(preview()).toBeNull();
    // O estado de carregamento nao pode ficar preso depois da falha.
    expect(queryButton("Copiando...")).toBeUndefined();
    expect((button("Escolher imagem") as HTMLButtonElement).disabled).toBe(false);
  });

  it("remover apaga o arquivo primeiro e so entao limpa a chave", async () => {
    databaseMocks.getWallpaperFile.mockResolvedValue("wallpaper-1755648000.png");
    tauriMocks.invoke.mockImplementation(async (command: string) => {
      if (command === "resolve_wallpaper_path") {
        return "C:\\dados\\wallpaper\\wallpaper-1755648000.png";
      }
      return undefined;
    });
    await render();
    expect(preview()).not.toBeNull();

    await act(async () => click(button("Remover")));

    expect(tauriMocks.invoke).toHaveBeenCalledWith("remove_wallpaper");
    // Se a ordem fosse a inversa e a remocao falhasse, a interface diria
    // "removido" com o arquivo ainda no disco e servido ao WebView.
    const ordemArquivo = tauriMocks.invoke.mock.invocationCallOrder[1];
    const ordemChave = databaseMocks.clearWallpaperFile.mock.invocationCallOrder[0];
    expect(ordemChave).toBeGreaterThan(ordemArquivo);

    expect(preview()).toBeNull();
    expect(queryButton("Remover")).toBeUndefined();
    expect(opacitySlider().disabled).toBe(true);
  });

  it("falha ao remover mantem a previa e nao limpa a chave", async () => {
    databaseMocks.getWallpaperFile.mockResolvedValue("wallpaper-1755648000.png");
    tauriMocks.invoke.mockImplementation(async (command: string) => {
      if (command === "resolve_wallpaper_path") {
        return "C:\\dados\\wallpaper\\wallpaper-1755648000.png";
      }
      throw "Nao foi possivel apagar a imagem.";
    });
    await render();

    await act(async () => click(button("Remover")));

    expect(databaseMocks.clearWallpaperFile).not.toHaveBeenCalled();
    expect(preview()).not.toBeNull();
    expect(container?.querySelector('[role="alert"]')?.textContent).toBe(
      "Nao foi possivel apagar a imagem.",
    );
  });

  it("limpa a chave quando o arquivo persistido sumiu do disco", async () => {
    databaseMocks.getWallpaperFile.mockResolvedValue("wallpaper-1755648000.png");
    tauriMocks.invoke.mockResolvedValue(null);
    await render();

    expect(tauriMocks.invoke).toHaveBeenCalledWith("resolve_wallpaper_path", {
      fileName: "wallpaper-1755648000.png",
    });
    expect(databaseMocks.clearWallpaperFile).toHaveBeenCalledTimes(1);
    expect(preview()).toBeNull();
    expect(button("Escolher imagem")).toBeTruthy();
  });

  it("restaura a opacidade persistida na abertura", async () => {
    databaseMocks.getWallpaperOpacity.mockResolvedValue(18);
    await render();

    expect(opacitySlider().value).toBe("18");
  });

  it("persiste a opacidade uma vez so quando o arrasto assenta", async () => {
    databaseMocks.getWallpaperFile.mockResolvedValue("wallpaper-1.png");
    tauriMocks.invoke.mockResolvedValue("C:\\dados\\wallpaper\\wallpaper-1.png");
    await render();

    const slider = opacitySlider();
    await act(async () => {
      setSliderValue(slider, 30);
      setSliderValue(slider, 20);
      setSliderValue(slider, 12);
    });

    // Enquanto o arrasto corre, o numero na tela ja acompanha, mas o SQLite
    // ainda nao foi tocado.
    expect(opacitySlider().value).toBe("12");
    expect(databaseMocks.setWallpaperOpacity).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(databaseMocks.setWallpaperOpacity).toHaveBeenCalledTimes(1);
    expect(databaseMocks.setWallpaperOpacity).toHaveBeenCalledWith(12);
  });

  it("nao perde a opacidade pendente se o painel fechar antes do debounce", async () => {
    databaseMocks.getWallpaperFile.mockResolvedValue("wallpaper-1.png");
    tauriMocks.invoke.mockResolvedValue("C:\\dados\\wallpaper\\wallpaper-1.png");
    await render();

    await act(async () => setSliderValue(opacitySlider(), 7));
    act(() => root?.unmount());

    expect(databaseMocks.setWallpaperOpacity).toHaveBeenCalledWith(7);
  });

  it("restaurar padroes devolve a opacidade sem apagar a imagem do usuario", async () => {
    databaseMocks.getWallpaperFile.mockResolvedValue("wallpaper-1.png");
    databaseMocks.getWallpaperOpacity.mockResolvedValue(90);
    tauriMocks.invoke.mockResolvedValue("C:\\dados\\wallpaper\\wallpaper-1.png");
    await render();

    await act(async () => click(button("Restaurar padrões")));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(opacitySlider().value).toBe("50");
    expect(databaseMocks.setWallpaperOpacity).toHaveBeenCalledWith(50);
    // Restaurar padroes de aparencia nao pode apagar um arquivo do disco.
    expect(tauriMocks.invoke).not.toHaveBeenCalledWith("remove_wallpaper");
    expect(databaseMocks.clearWallpaperFile).not.toHaveBeenCalled();
    expect(preview()).not.toBeNull();
  });

  it("NAO importa nem remove em hover, foco ou navegacao por setas", async () => {
    databaseMocks.getWallpaperFile.mockResolvedValue("wallpaper-1.png");
    tauriMocks.invoke.mockResolvedValue("C:\\dados\\wallpaper\\wallpaper-1.png");
    await render();
    tauriMocks.invoke.mockClear();

    await act(async () => {
      for (const alvo of [button("Trocar imagem"), button("Remover")]) {
        alvo.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
        alvo.dispatchEvent(new MouseEvent("mouseenter"));
        alvo.dispatchEvent(new PointerEvent("pointerenter"));
        (alvo as HTMLButtonElement).focus();
        alvo.dispatchEvent(new FocusEvent("focus"));
        alvo.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
        alvo.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
      }
    });

    // Escolher uma imagem copia um arquivo e apaga o anterior: aplicar isso em
    // hover deixaria o usuario com um wallpaper que nao escolheu e sem o que
    // tinha antes.
    expect(tauriMocks.invoke).not.toHaveBeenCalled();
    expect(databaseMocks.setWallpaperFile).not.toHaveBeenCalled();
    expect(databaseMocks.clearWallpaperFile).not.toHaveBeenCalled();
  });
});
