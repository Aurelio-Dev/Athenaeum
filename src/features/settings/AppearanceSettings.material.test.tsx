// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppearanceSettings } from "./AppearanceSettings";

type TestMaterial = "flat" | "glass";
type TestChrome = "docked" | "floating";

const hookMocks = vi.hoisted(() => ({
  setTheme: vi.fn(),
  setMaterial: vi.fn(),
  setChrome: vi.fn(),
  setShowDividerLines: vi.fn(),
  setUiFontScale: vi.fn(),
  setAccent: vi.fn(),
  setInterfaceContrast: vi.fn(),
  setTextContrast: vi.fn(),
  setTitleContrast: vi.fn(),
  setGlassBlur: vi.fn(),
  setNightLight: vi.fn(),
  resetAppearancePreferences: vi.fn(),
  material: { current: "flat" as TestMaterial },
  storedChrome: { current: null as TestChrome | null },
  nightLightActive: { current: false },
  appearance: {
    current: {
      accentLight: "#9C5A2E",
      accentDark: "#9C5A2E",
      interfaceContrast: 100,
      textContrast: 100,
      titleContrast: 100,
      glassBlur: 100,
      nightLight: {
        version: 1 as const,
        enabled: false,
        strength: 50,
        scheduleEnabled: false,
        startTime: "20:00",
        endTime: "07:00",
      },
    },
  },
}));

const databaseMocks = vi.hoisted(() => ({
  getGlassNoticeSeen: vi.fn(),
  setGlassNoticeSeen: vi.fn(),
  deleteSetting: vi.fn(),
}));

vi.mock("../../lib/database", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/database")>()),
  getGlassNoticeSeen: databaseMocks.getGlassNoticeSeen,
  setGlassNoticeSeen: databaseMocks.setGlassNoticeSeen,
  deleteSetting: databaseMocks.deleteSetting,
}));

vi.mock("../../hooks/useTheme", () => ({
  useTheme: () => ({
    theme: "light",
    setTheme: hookMocks.setTheme,
    toggleTheme: vi.fn(),
    material: hookMocks.material.current,
    setMaterial: hookMocks.setMaterial,
    storedChrome: hookMocks.storedChrome.current,
    setChrome: hookMocks.setChrome,
  }),
}));

vi.mock("../../hooks/useDividerLines", () => ({
  useDividerLines: () => ({
    showDividerLines: true,
    setShowDividerLines: hookMocks.setShowDividerLines,
  }),
}));

// O controle de wallpaper mora na mesma tela, mas tem teste proprio
// (AppearanceSettings.wallpaper.test.tsx). Aqui ele e stubado para este arquivo
// continuar sendo um teste do eixo de MATERIAL: sem stub, montar a tela abriria
// o banco e o IPC so para exercitar o controle ao lado.
vi.mock("../../hooks/useWallpaperSettings", () => ({
  useWallpaperSettings: () => ({
    fileName: null,
    previewUrl: null,
    opacity: 50,
    brightness: 100,
    isLoading: false,
    isImporting: false,
    error: null,
    chooseWallpaper: vi.fn(),
    removeWallpaper: vi.fn(),
    changeOpacity: vi.fn(),
    changeBrightness: vi.fn(),
  }),
}));

vi.mock("../../hooks/useAppearancePreferences", () => ({
  uiFontScaleOptions: [90, 95, 100, 105, 110, 115, 120],
  useAppearancePreferences: () => ({
    uiFontScale: 100,
    setUiFontScale: hookMocks.setUiFontScale,
  }),
}));

vi.mock("../../hooks/useGlobalAppearancePreferences", () => ({
  useGlobalAppearancePreferences: () => ({
    preferences: hookMocks.appearance.current,
    setAccent: hookMocks.setAccent,
    setInterfaceContrast: hookMocks.setInterfaceContrast,
    setTextContrast: hookMocks.setTextContrast,
    setTitleContrast: hookMocks.setTitleContrast,
    setGlassBlur: hookMocks.setGlassBlur,
    setNightLight: hookMocks.setNightLight,
    resetAppearancePreferences: hookMocks.resetAppearancePreferences,
    nightLightActive: hookMocks.nightLightActive.current,
  }),
}));

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function render() {
  act(() => root?.render(<AppearanceSettings />));
}

function materialButton(label: string) {
  const group = container?.querySelector<HTMLDivElement>('div[aria-label="Material da interface"]');
  if (!group) {
    throw new Error("Grupo de material nao encontrado.");
  }

  const element = Array.from(group.querySelectorAll("button")).find(
    (candidate) => candidate.textContent === label,
  );
  if (!element) {
    throw new Error(`Opcao de material nao encontrada: ${label}`);
  }
  return element;
}

function layoutButton(label: string) {
  const group = container?.querySelector<HTMLDivElement>('div[aria-label="Layout da interface"]');
  if (!group) {
    throw new Error("Grupo de layout nao encontrado.");
  }

  const element = Array.from(group.querySelectorAll("button")).find(
    (candidate) => candidate.textContent === label,
  );
  if (!element) {
    throw new Error(`Opcao de layout nao encontrada: ${label}`);
  }
  return element;
}

function glassNoticeDialog() {
  return container?.querySelector<HTMLElement>('[aria-labelledby="info-dialog-title"]') ?? null;
}

function glassNoticeButton() {
  const element = Array.from(glassNoticeDialog()?.querySelectorAll("button") ?? []).find(
    (candidate) => candidate.textContent === "Entendi",
  );
  if (!element) {
    throw new Error("Botao do aviso sobre Vidro nao encontrado.");
  }
  return element;
}

async function renderAfterGlassNoticeLoad() {
  await act(async () => {
    root?.render(<AppearanceSettings />);
  });
}

beforeEach(() => {
  hookMocks.setTheme.mockReset();
  hookMocks.setMaterial.mockReset();
  hookMocks.setChrome.mockReset();
  hookMocks.setShowDividerLines.mockReset();
  hookMocks.setUiFontScale.mockReset();
  hookMocks.setAccent.mockReset();
  hookMocks.setInterfaceContrast.mockReset();
  hookMocks.setTextContrast.mockReset();
  hookMocks.setTitleContrast.mockReset();
  hookMocks.setGlassBlur.mockReset();
  hookMocks.setNightLight.mockReset();
  hookMocks.resetAppearancePreferences.mockReset();
  hookMocks.material.current = "flat";
  hookMocks.storedChrome.current = null;
  hookMocks.nightLightActive.current = false;
  hookMocks.appearance.current = {
    accentLight: "#9C5A2E",
    accentDark: "#9C5A2E",
    interfaceContrast: 100,
    textContrast: 100,
    titleContrast: 100,
    glassBlur: 100,
    nightLight: {
      version: 1,
      enabled: false,
      strength: 50,
      scheduleEnabled: false,
      startTime: "20:00",
      endTime: "07:00",
    },
  };
  databaseMocks.getGlassNoticeSeen.mockReset().mockResolvedValue(false);
  databaseMocks.setGlassNoticeSeen.mockReset().mockResolvedValue(undefined);
  databaseMocks.deleteSetting.mockReset().mockResolvedValue(undefined);
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
});

describe("controle de material em Aparencia", () => {
  it("mostra as duas opcoes e marca a atual", () => {
    render();

    expect(materialButton("Padrão").getAttribute("aria-pressed")).toBe("true");
    expect(materialButton("Vidro").getAttribute("aria-pressed")).toBe("false");
  });

  it("aplica a opcao escolhida no clique", () => {
    render();

    act(() => materialButton("Vidro").dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(hookMocks.setMaterial).toHaveBeenCalledTimes(1);
    expect(hookMocks.setMaterial).toHaveBeenCalledWith("glass");
  });

  it("NAO aplica material em hover, foco ou navegacao por setas", () => {
    render();
    const glassOption = materialButton("Vidro");

    act(() => {
      glassOption.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      glassOption.dispatchEvent(new MouseEvent("mouseenter"));
      glassOption.dispatchEvent(new PointerEvent("pointerenter"));
      glassOption.focus();
      glassOption.dispatchEvent(new FocusEvent("focus"));
      glassOption.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      glassOption.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });

    // Preview vazaria para o espelho em localStorage (ver useTheme.tsx) e
    // deixaria o usuario com um material que ele nao escolheu.
    expect(hookMocks.setMaterial).not.toHaveBeenCalled();
  });

  it("nao usa um select nativo, que troca de valor com seta no estado fechado", () => {
    render();
    const group = container?.querySelector<HTMLDivElement>('div[aria-label="Material da interface"]');

    expect(group?.querySelector("select")).toBeNull();
  });

  it("volta para o material padrao ao restaurar padroes", () => {
    hookMocks.material.current = "glass";
    render();

    const restoreButton = Array.from(container?.querySelectorAll("button") ?? []).find(
      (candidate) => candidate.textContent === "Restaurar padrões",
    );
    act(() => restoreButton?.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(hookMocks.setMaterial).toHaveBeenCalledWith("flat");
    expect(hookMocks.setChrome).toHaveBeenCalledWith(null);
    expect(databaseMocks.deleteSetting).toHaveBeenCalledWith("glass_notice_seen");
  });
});

describe("aviso na primeira selecao do material Vidro", () => {
  it("abre o aviso e troca o material quando a chave esta ausente", async () => {
    await renderAfterGlassNoticeLoad();

    act(() => materialButton("Vidro").dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(hookMocks.setMaterial).toHaveBeenCalledWith("glass");
    expect(glassNoticeDialog()).not.toBeNull();
    expect(glassNoticeDialog()?.textContent).toContain("Sobre o material Vidro");
  });

  it("grava a chave ao fechar o aviso", async () => {
    await renderAfterGlassNoticeLoad();
    act(() => materialButton("Vidro").dispatchEvent(new MouseEvent("click", { bubbles: true })));

    act(() => glassNoticeButton().dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(databaseMocks.setGlassNoticeSeen).toHaveBeenCalledOnce();
    expect(glassNoticeDialog()).toBeNull();
  });

  it("nao reaparece ao trocar para Padrao e voltar para Vidro", async () => {
    await renderAfterGlassNoticeLoad();
    act(() => materialButton("Vidro").dispatchEvent(new MouseEvent("click", { bubbles: true })));
    act(() => glassNoticeButton().dispatchEvent(new MouseEvent("click", { bubbles: true })));

    hookMocks.material.current = "glass";
    render();
    act(() => materialButton("Padrão").dispatchEvent(new MouseEvent("click", { bubbles: true })));

    hookMocks.material.current = "flat";
    render();
    act(() => materialButton("Vidro").dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(glassNoticeDialog()).toBeNull();
  });

  it("nao abre o aviso quando a chave ja foi gravada", async () => {
    databaseMocks.getGlassNoticeSeen.mockResolvedValue(true);
    await renderAfterGlassNoticeLoad();

    act(() => materialButton("Vidro").dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(hookMocks.setMaterial).toHaveBeenCalledWith("glass");
    expect(glassNoticeDialog()).toBeNull();
  });

  it("nunca abre o aviso ao selecionar o material Padrao", async () => {
    hookMocks.material.current = "glass";
    await renderAfterGlassNoticeLoad();

    act(() => materialButton("Padrão").dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(hookMocks.setMaterial).toHaveBeenCalledWith("flat");
    expect(glassNoticeDialog()).toBeNull();
  });

  it("nao faz nada ao clicar em Vidro quando Vidro ja esta selecionado", async () => {
    hookMocks.material.current = "glass";
    await renderAfterGlassNoticeLoad();

    act(() => materialButton("Vidro").dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(hookMocks.setMaterial).not.toHaveBeenCalled();
    expect(glassNoticeDialog()).toBeNull();
  });
});

describe("controle de layout em Aparencia", () => {
  it("persiste automatico, docado e ilhas pelos tres botoes", () => {
    hookMocks.material.current = "glass";
    render();

    act(() => layoutButton("Automático").dispatchEvent(new MouseEvent("click", { bubbles: true })));
    act(() => layoutButton("Docado").dispatchEvent(new MouseEvent("click", { bubbles: true })));
    act(() => layoutButton("Ilhas").dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(hookMocks.setChrome.mock.calls).toEqual([[null], ["docked"], ["floating"]]);
  });

  it("marca a preferencia crua, inclusive automatico quando ela e nula", () => {
    render();
    expect(layoutButton("Automático").getAttribute("aria-pressed")).toBe("true");
    expect(layoutButton("Docado").getAttribute("aria-pressed")).toBe("false");
    expect(layoutButton("Ilhas").getAttribute("aria-pressed")).toBe("false");

    hookMocks.storedChrome.current = "docked";
    render();
    expect(layoutButton("Automático").getAttribute("aria-pressed")).toBe("false");
    expect(layoutButton("Docado").getAttribute("aria-pressed")).toBe("true");

    hookMocks.storedChrome.current = "floating";
    render();
    expect(layoutButton("Docado").getAttribute("aria-pressed")).toBe("false");
    expect(layoutButton("Ilhas").getAttribute("aria-pressed")).toBe("true");
  });

  it("desabilita as tres opcoes quando o material e flat", () => {
    render();

    expect(["Automático", "Docado", "Ilhas"].map((label) => layoutButton(label).disabled)).toEqual([
      true,
      true,
      true,
    ]);
  });
});

describe("novas preferencias de Aparencia", () => {
  function input(label: string) {
    const element = container?.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
    if (!element) throw new Error(`Controle nao encontrado: ${label}`);
    return element;
  }

  function changeInput(element: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  it("expoe destaques independentes para os temas claro e escuro", () => {
    render();

    act(() => changeInput(input("Cor de destaque do tema claro"), "#339cff"));
    act(() => changeInput(input("Cor de destaque do tema escuro"), "#56a4ed"));

    expect(hookMocks.setAccent).toHaveBeenCalledWith("light", "#339CFF");
    expect(hookMocks.setAccent).toHaveBeenCalledWith("dark", "#56A4ED");
  });

  it("libera os dois contrastes ate 150 e mantem seus callbacks separados", () => {
    render();
    const interfaceSlider = input("Contraste da interface");
    const textSlider = input("Contraste dos textos");

    expect(interfaceSlider.min).toBe("90");
    expect(interfaceSlider.max).toBe("150");
    expect(textSlider.min).toBe("90");
    expect(textSlider.max).toBe("150");

    act(() => changeInput(interfaceSlider, "135"));
    act(() => changeInput(textSlider, "125"));
    expect(hookMocks.setInterfaceContrast).toHaveBeenCalledWith(135);
    expect(hookMocks.setTextContrast).toHaveBeenCalledWith(125);
  });

  it("habilita o blur somente no material Vidro e cobre todo o intervalo", () => {
    render();
    expect(input("Desfoque do material Vidro").disabled).toBe(true);

    hookMocks.material.current = "glass";
    render();
    const blurSlider = input("Desfoque do material Vidro");
    expect(blurSlider.disabled).toBe(false);
    expect(blurSlider.min).toBe("0");
    expect(blurSlider.max).toBe("100");

    act(() => changeInput(blurSlider, "35"));
    expect(hookMocks.setGlassBlur).toHaveBeenCalledWith(35);
  });

  it("mantem o toggle mestre sobre forca e agenda da luz noturna", () => {
    render();
    const master = container?.querySelector<HTMLButtonElement>(
      'button[aria-label="Ativar luz noturna"]',
    );
    expect(master).not.toBeNull();
    expect(input("Força da luz noturna").disabled).toBe(true);
    expect(container?.querySelector<HTMLButtonElement>(
      'button[aria-label="Ativar agendamento da luz noturna"]',
    )?.disabled).toBe(true);

    act(() => master?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(hookMocks.setNightLight).toHaveBeenCalledWith({
      ...hookMocks.appearance.current.nightLight,
      enabled: true,
    });
  });

  it("edita forca e horario quando a luz e a agenda estao habilitadas", () => {
    hookMocks.appearance.current = {
      ...hookMocks.appearance.current,
      nightLight: {
        ...hookMocks.appearance.current.nightLight,
        enabled: true,
        scheduleEnabled: true,
      },
    };
    render();

    act(() => changeInput(input("Força da luz noturna"), "72"));
    act(() => changeInput(input("Início da luz noturna"), "21:30"));
    act(() => changeInput(input("Fim da luz noturna"), "06:15"));

    expect(hookMocks.setNightLight).toHaveBeenCalledWith({
      ...hookMocks.appearance.current.nightLight,
      strength: 72,
    });
    expect(hookMocks.setNightLight).toHaveBeenCalledWith({
      ...hookMocks.appearance.current.nightLight,
      startTime: "21:30",
    });
    expect(hookMocks.setNightLight).toHaveBeenCalledWith({
      ...hookMocks.appearance.current.nightLight,
      endTime: "06:15",
    });
  });

  it("mantem o contraste dos titulos como eixo proprio, separado do dos textos", () => {
    render();
    const slider = input("Contraste dos títulos");

    expect(slider.min).toBe("90");
    expect(slider.max).toBe("150");
    expect(slider.disabled).toBe(false);

    act(() => changeInput(slider, "130"));
    expect(hookMocks.setTitleContrast).toHaveBeenCalledWith(130);
    expect(hookMocks.setTextContrast).not.toHaveBeenCalled();
    expect(hookMocks.setInterfaceContrast).not.toHaveBeenCalled();
  });

  it("avisa reducao de legibilidade tambem no eixo dos titulos", () => {
    hookMocks.appearance.current = { ...hookMocks.appearance.current, titleContrast: 95 };
    render();

    expect(avisosVivos()).toEqual(["Abaixo de 100%, os títulos ficam menos legíveis."]);
  });

  function valorDoSlider(ariaLabel: string): HTMLButtonElement {
    const botao = Array.from(container?.querySelectorAll("button") ?? []).find((candidato) =>
      candidato.getAttribute("aria-label")?.startsWith(`${ariaLabel}: `),
    );
    if (!botao) throw new Error(`Botao de valor nao encontrado: ${ariaLabel}`);
    return botao as HTMLButtonElement;
  }

  function duploClique(elemento: Element) {
    act(() => {
      elemento.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
  }

  function tecla(elemento: Element, key: string) {
    act(() => {
      elemento.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    });
  }

  it("abre a entrada manual no duplo clique e aplica o valor digitado", () => {
    render();
    duploClique(valorDoSlider("Contraste da interface"));

    const campo = input("Contraste da interface em porcentagem, de 90 a 150");
    act(() => changeInput(campo, "137"));
    tecla(campo, "Enter");

    expect(hookMocks.setInterfaceContrast).toHaveBeenCalledWith(137);
  });

  it("prende o valor digitado a faixa do proprio controle", () => {
    render();
    duploClique(valorDoSlider("Contraste dos textos"));

    const campo = input("Contraste dos textos em porcentagem, de 90 a 150");
    act(() => changeInput(campo, "999"));
    tecla(campo, "Enter");

    expect(hookMocks.setTextContrast).toHaveBeenCalledWith(150);
  });

  it("descarta a digitacao no Escape e mantem o valor anterior", () => {
    render();
    duploClique(valorDoSlider("Contraste da interface"));

    const campo = input("Contraste da interface em porcentagem, de 90 a 150");
    act(() => changeInput(campo, "120"));
    tecla(campo, "Escape");

    expect(hookMocks.setInterfaceContrast).not.toHaveBeenCalled();
    expect(valorDoSlider("Contraste da interface").textContent).toBe("100%");
  });

  it("abre a entrada manual tambem pelo teclado, sem depender do duplo clique", () => {
    render();
    tecla(valorDoSlider("Contraste da interface"), "Enter");

    expect(
      container?.querySelector('input[aria-label="Contraste da interface em porcentagem, de 90 a 150"]'),
    ).not.toBeNull();
  });

  it("nao abre a entrada manual num controle desabilitado", () => {
    render();
    const botao = valorDoSlider("Desfoque do material Vidro");
    expect(botao.disabled).toBe(true);

    duploClique(botao);
    expect(
      container?.querySelector('input[aria-label^="Desfoque do material Vidro em porcentagem"]'),
    ).toBeNull();
  });

  function linhas(): HTMLHeadingElement[] {
    return Array.from(container?.querySelectorAll("h3") ?? []);
  }

  function temLinha(rotulo: string): boolean {
    return linhas().some((titulo) => titulo.textContent === rotulo);
  }

  function descricaoDaLinha(rotulo: string): string {
    const titulo = linhas().find((candidato) => candidato.textContent === rotulo);
    if (!titulo) throw new Error(`Linha nao encontrada: ${rotulo}`);
    return titulo.nextElementSibling?.textContent ?? "";
  }

  function avisosVivos(): string[] {
    return Array.from(container?.querySelectorAll('[role="status"]') ?? [])
      .map((elemento) => elemento.textContent ?? "")
      .filter((texto) => texto.length > 0);
  }

  it("promove somente um hexadecimal completo digitado no campo do destaque", () => {
    render();
    const hex = input("Hexadecimal do destaque do tema claro");
    expect(hex.value).toBe("#9C5A2E");

    act(() => changeInput(hex, "#33"));
    expect(hookMocks.setAccent).not.toHaveBeenCalled();

    act(() => changeInput(hex, "#3399ff"));
    expect(hookMocks.setAccent).toHaveBeenCalledWith("light", "#3399FF");
  });

  it("devolve a cor vigente quando o campo hexadecimal sai incompleto do foco", () => {
    render();
    const hex = input("Hexadecimal do destaque do tema escuro");

    act(() => changeInput(hex, "#12"));
    expect(hex.value).toBe("#12");

    act(() => hex.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    expect(hex.value).toBe("#9C5A2E");
    expect(hookMocks.setAccent).not.toHaveBeenCalled();
  });

  it("descreve a luz ativa agora e a proxima ativacao agendada", () => {
    render();
    expect(descricaoDaLinha("Luz azul")).toBe(
      "Reduza a luz azul com uma camada de tonalidade quente.",
    );

    hookMocks.appearance.current = {
      ...hookMocks.appearance.current,
      nightLight: {
        ...hookMocks.appearance.current.nightLight,
        enabled: true,
        scheduleEnabled: true,
        startTime: "21:30",
      },
    };
    render();
    expect(descricaoDaLinha("Luz azul")).toBe("A luz noturna ativa automaticamente às 21:30.");

    hookMocks.nightLightActive.current = true;
    render();
    expect(descricaoDaLinha("Luz azul")).toBe("A luz noturna está ativa agora.");
  });

  it("mantem as regioes vivas e avisa reducao de legibilidade so abaixo de 100", () => {
    render();
    // As duas regioes existem vazias: um role="status" inserido junto com o
    // texto costuma nao ser anunciado pelo leitor de tela.
    expect(container?.querySelectorAll('[role="status"]')).toHaveLength(3);
    expect(avisosVivos()).toEqual([]);

    hookMocks.appearance.current = { ...hookMocks.appearance.current, interfaceContrast: 90 };
    render();
    expect(avisosVivos()).toEqual([
      "Abaixo de 100%, bordas e superfícies ficam menos separadas.",
    ]);

    hookMocks.appearance.current = {
      ...hookMocks.appearance.current,
      interfaceContrast: 150,
      textContrast: 95,
    };
    render();
    expect(avisosVivos()).toEqual([
      "Abaixo de 100%, os textos da interface ficam menos legíveis.",
    ]);
  });

  it("mostra a linha de horarios somente com a agenda habilitada", () => {
    render();
    expect(temLinha("Horário da luz noturna")).toBe(false);

    hookMocks.appearance.current = {
      ...hookMocks.appearance.current,
      nightLight: { ...hookMocks.appearance.current.nightLight, enabled: true },
    };
    render();
    expect(temLinha("Horário da luz noturna")).toBe(false);

    hookMocks.appearance.current = {
      ...hookMocks.appearance.current,
      nightLight: {
        ...hookMocks.appearance.current.nightLight,
        enabled: true,
        scheduleEnabled: true,
      },
    };
    render();
    expect(temLinha("Horário da luz noturna")).toBe(true);
  });
});
