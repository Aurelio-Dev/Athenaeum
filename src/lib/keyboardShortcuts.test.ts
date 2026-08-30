// @ts-expect-error - sem @types/node no projeto; resolvido em runtime pelo Node.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  captureBinding,
  findShortcut,
  formatBindingKeys,
  keyboardShortcutGroups,
  keyboardShortcuts,
  matchesBinding,
  normalizeShortcutOverrides,
  rebindableShortcuts,
  resolveShortcutBindings,
  validateBinding,
} from "./keyboardShortcuts";

function ler(caminho: string): string {
  return readFileSync(new URL(`../../${caminho}`, import.meta.url), "utf8");
}

// Inventario fechado por categoria. Um atalho novo no app so passa depois de
// entrar aqui — foi assim que Ctrl+S, Ctrl+F, F11, Ctrl+Z/Y e o menu "/"
// ficaram anos fora da tela de Ajustes sem nenhum teste reclamar.
const INVENTARIO: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["Leitor", [
    "reader.search",
    "reader.fullscreen",
    "reader.zoom-in",
    "reader.zoom-out",
    "reader.zoom-reset",
    "reader.context-menu",
    "reader.sidebar-tabs",
    "reader.escape",
  ]],
  ["Caderno", [
    "notebook.save",
    "notebook.block-menu",
    "notebook.block-menu-navigation",
    "notebook.escape",
    "notebook.table-next-cell",
    "notebook.table-previous-cell",
    "notebook.open-link",
    "notebook.diagram-finish",
    "notebook.diagram-newline",
    "notebook.resize",
    "notebook.resize-large-step",
  ]],
  ["Quadros", [
    "canvas.tool-select",
    "canvas.tool-rectangle",
    "canvas.tool-freedraw",
    "canvas.tool-eraser",
    "canvas.tool-text",
    "canvas.tool-image",
    "canvas.tool-frame",
    "canvas.undo",
    "canvas.redo",
    "canvas.delete",
    "canvas.lock-aspect",
    "canvas.pan",
    "canvas.exit-pan",
  ]],
];

const REMAPEAVEIS: readonly string[] = [
  "reader.search",
  "reader.fullscreen",
  "notebook.save",
  "canvas.tool-select",
  "canvas.tool-rectangle",
  "canvas.tool-freedraw",
  "canvas.tool-eraser",
  "canvas.tool-text",
  "canvas.tool-image",
  "canvas.tool-frame",
  "canvas.undo",
  "canvas.redo",
];

describe("catalogo de atalhos", () => {
  it("mantem fechado o inventario por categoria", () => {
    expect(keyboardShortcutGroups.map((grupo) => grupo.category)).toEqual(
      INVENTARIO.map(([categoria]) => categoria),
    );

    for (const [categoria, ids] of INVENTARIO) {
      const grupo = keyboardShortcutGroups.find((candidato) => candidato.category === categoria);
      expect(grupo?.shortcuts.map((atalho) => atalho.id), categoria).toEqual(ids);
    }
  });

  it("usa ids unicos e nunca publica uma linha vazia na tela de Ajustes", () => {
    const ids = keyboardShortcuts.map((atalho) => atalho.id);
    expect(new Set(ids).size, "id duplicado no catalogo").toBe(ids.length);

    for (const atalho of keyboardShortcuts) {
      expect(atalho.action.length, `${atalho.id}: acao vazia`).toBeGreaterThan(0);
      expect(atalho.description.length, `${atalho.id}: descricao vazia`).toBeGreaterThan(10);
      expect(atalho.keys.length, `${atalho.id}: sem teclas`).toBeGreaterThan(0);
    }
  });

  it("expoe como remapeavel exatamente o conjunto de acordes de tecla unica", () => {
    expect(rebindableShortcuts.map((atalho) => atalho.id).sort()).toEqual([...REMAPEAVEIS].sort());

    for (const id of REMAPEAVEIS) {
      const binding = findShortcut(id)?.defaultBinding;
      expect(binding, `${id}: remapeavel sem binding padrao`).toBeDefined();
      // Caracteres unicos precisam chegar em minusculo: o matcher compara com
      // `event.key.toLowerCase()` e um "V" maiusculo nunca casaria. Teclas
      // nomeadas ("F11") mantem a grafia do DOM, que nao e minuscula.
      if (binding && binding.key.length === 1) {
        expect(binding.key, `${id}: binding de caractere nao normalizado`)
          .toBe(binding.key.toLowerCase());
      }
    }

    // Esc, Tab, Enter, setas e `/` continuam fixos, assim como as acoes que
    // aceitam mais de uma tecla para o mesmo efeito.
    for (const id of [
      "reader.escape",
      "reader.zoom-in",
      "reader.context-menu",
      "reader.sidebar-tabs",
      "notebook.escape",
      "notebook.block-menu",
      "notebook.table-next-cell",
      "canvas.delete",
      "canvas.pan",
    ]) {
      expect(findShortcut(id)?.defaultBinding, `${id}: nao deveria ser remapeavel`).toBeUndefined();
    }
  });
});

// Literais de tecla que os handlers usam mas que NAO sao atalhos publicaveis:
// modificadores lidos como estado, teclas alternativas da mesma acao e o
// Escape, que cada tela trata como cascata propria.
const LITERAIS_SEM_LINHA: Readonly<Record<string, readonly string[]>> = {
  "src/features/reader/ReaderContent.tsx": [
    "Escape",
    "=", "_", "NumpadAdd", "NumpadSubtract", "Numpad0",
    "F10", "ContextMenu",
    // A linha "Reduzir zoom" exibe o sinal tipografico U+2212 ("−"), nao o
    // hifen ASCII que o handler compara.
    "-",
  ],
  "src/features/notebooks/NotebookContent.tsx": ["Escape"],
  "src/features/canvases/CanvasPanel.tsx": [
    "Escape",
    "Shift",
    "Space",
    "Delete", "Backspace",
  ],
};

// Cada arquivo e a lista de teclas que ele realmente compara. O teste falha
// quando um literal novo aparece sem entrar no catalogo nem na lista acima.
const LITERAIS_ESPERADOS: Readonly<Record<string, readonly string[]>> = {
  "src/features/reader/ReaderContent.tsx": [
    "+", "-", "0", "=", "ContextMenu", "Escape", "F10",
    "Numpad0", "NumpadAdd", "NumpadSubtract", "_",
  ],
  "src/features/notebooks/NotebookContent.tsx": ["Escape"],
  "src/features/canvases/CanvasPanel.tsx": [
    "Backspace", "Delete", "Escape", "Shift", "Space",
  ],
};

function literaisDe(caminho: string): string[] {
  const fonte = ler(caminho);
  const encontrados = [...fonte.matchAll(
    /(?:event|e)\.(?:key|code)(?:\.toLowerCase\(\))? [!=]== "([^"]+)"/g,
  )].map((achado: RegExpMatchArray) => achado[1]);
  return [...new Set(encontrados)].sort();
}

describe("atalhos declarados x handlers reais", () => {
  it("trava os literais de tecla de cada handler dono de atalho", () => {
    for (const [caminho, esperados] of Object.entries(LITERAIS_ESPERADOS)) {
      expect(literaisDe(caminho), `${caminho}: literal de tecla novo ou removido`)
        .toEqual([...esperados].sort());
    }
  });

  // A prova de que o remapeamento realmente chegou aos handlers: se algum
  // deles voltar a comparar a tecla literalmente, o atalho para de obedecer ao
  // que o usuario configurou em Ajustes, e este teste falha.
  it("nao deixa literal de tecla para nenhum atalho remapeavel", () => {
    const literais = Object.keys(LITERAIS_ESPERADOS)
      .flatMap(literaisDe)
      .map((literal) => literal.toLowerCase());

    for (const atalho of rebindableShortcuts) {
      const chave = atalho.defaultBinding!.key.toLowerCase();
      expect(
        literais.includes(chave),
        `${atalho.id}: handler compara "${chave}" literalmente em vez de usar o registro`,
      ).toBe(false);
    }
  });

  it("cobre no catalogo todo literal que nao esta explicitamente dispensado", () => {
    for (const [caminho, esperados] of Object.entries(LITERAIS_ESPERADOS)) {
      const dispensados = new Set(LITERAIS_SEM_LINHA[caminho] ?? []);
      const cobertosPeloCatalogo = new Set(
        keyboardShortcuts.flatMap((atalho) => [
          ...(atalho.defaultBinding ? [atalho.defaultBinding.key] : []),
          ...atalho.keys.map((tecla) => tecla.toLowerCase()),
        ]),
      );

      const orfaos = esperados.filter((literal) =>
        !dispensados.has(literal) && !cobertosPeloCatalogo.has(literal.toLowerCase()),
      );
      expect(orfaos, `${caminho}: tecla usada no handler e ausente do catalogo`).toEqual([]);
    }
  });
});

describe("bindings remapeaveis", () => {
  const tecla = (key: string, mods: Partial<{ ctrl: boolean; shift: boolean; alt: boolean }> = {}) => ({
    key,
    ctrlKey: mods.ctrl ?? false,
    metaKey: false,
    shiftKey: mods.shift ?? false,
    altKey: mods.alt ?? false,
  });

  it("exige os modificadores exatos e trata Cmd como Ctrl", () => {
    const ctrlS = { key: "s", ctrl: true, shift: false, alt: false };

    expect(matchesBinding(tecla("s", { ctrl: true }), ctrlS)).toBe(true);
    expect(matchesBinding({ ...tecla("S"), metaKey: true }, ctrlS)).toBe(true);
    expect(matchesBinding(tecla("s"), ctrlS)).toBe(false);
    expect(matchesBinding(tecla("s", { ctrl: true, shift: true }), ctrlS)).toBe(false);
    expect(matchesBinding(tecla("s", { ctrl: true, alt: true }), ctrlS)).toBe(false);
  });

  it("nao casa uma tecla solta quando o acorde tem modificador, e vice-versa", () => {
    const v = { key: "v", ctrl: false, shift: false, alt: false };
    // Regressao direta: antes do registro, Ctrl+V e Shift+V trocavam a
    // ferramenta do Quadro porque a comparacao ignorava modificadores.
    expect(matchesBinding(tecla("v"), v)).toBe(true);
    expect(matchesBinding(tecla("V"), v)).toBe(true);
    expect(matchesBinding(tecla("v", { ctrl: true }), v)).toBe(false);
    expect(matchesBinding(tecla("v", { shift: true }), v)).toBe(false);
  });

  it("captura apenas caracteres e teclas de funcao, ignorando modificador sozinho", () => {
    expect(captureBinding(tecla("Control", { ctrl: true }))).toBeNull();
    expect(captureBinding(tecla("Shift", { shift: true }))).toBeNull();
    expect(captureBinding(tecla("Escape"))).toBeNull();
    expect(captureBinding(tecla("Enter"))).toBeNull();
    expect(captureBinding(tecla("ArrowUp"))).toBeNull();
    expect(captureBinding(tecla("K", { ctrl: true, shift: true }))).toEqual({
      key: "k", ctrl: true, shift: true, alt: false,
    });
    // Teclas nomeadas mantem a grafia do DOM; so caracteres unicos viram minusculo.
    expect(captureBinding(tecla("F7"))).toEqual({ key: "F7", ctrl: false, shift: false, alt: false });
  });

  it("recusa combinacao reservada, perda de modificador e conflito na mesma categoria", () => {
    const bindings = resolveShortcutBindings({});

    expect(validateBinding("notebook.save", { key: "w", ctrl: true, shift: false, alt: false }, bindings))
      .toEqual({ reason: "reserved" });
    expect(validateBinding("notebook.save", { key: "j", ctrl: false, shift: false, alt: false }, bindings))
      .toEqual({ reason: "needs-modifier" });
    expect(validateBinding("canvas.tool-select", { key: "r", ctrl: false, shift: false, alt: false }, bindings))
      .toEqual({ reason: "conflict", conflictId: "canvas.tool-rectangle" });
    // Categorias diferentes tem escopos diferentes e podem repetir o acorde.
    expect(validateBinding("reader.search", { key: "s", ctrl: true, shift: false, alt: false }, bindings))
      .toBeNull();
    expect(validateBinding("canvas.tool-select", { key: "j", ctrl: false, shift: false, alt: false }, bindings))
      .toBeNull();
  });

  it("normaliza overrides descartando id desconhecido, atalho fixo e valor igual ao padrao", () => {
    const overrides = normalizeShortcutOverrides({
      version: 1,
      bindings: {
        "canvas.tool-select": { key: "j", ctrl: false, shift: false, alt: false },
        "canvas.tool-rectangle": { key: "r", ctrl: false, shift: false, alt: false },
        "reader.escape": { key: "k", ctrl: false, shift: false, alt: false },
        "nao.existe": { key: "k", ctrl: false, shift: false, alt: false },
        "notebook.save": { key: "ArrowUp", ctrl: true, shift: false, alt: false },
      },
    });

    expect(overrides).toEqual({
      "canvas.tool-select": { key: "j", ctrl: false, shift: false, alt: false },
    });
    expect(normalizeShortcutOverrides({ version: 2, bindings: {} })).toEqual({});
    expect(normalizeShortcutOverrides("nao e json")).toEqual({});
  });

  it("resolve o efetivo somando padrao e override e formata para exibicao", () => {
    const bindings = resolveShortcutBindings({
      "canvas.tool-select": { key: "j", ctrl: true, shift: true, alt: false },
    });

    expect(bindings["canvas.tool-select"]).toEqual({ key: "j", ctrl: true, shift: true, alt: false });
    expect(bindings["canvas.tool-rectangle"]).toEqual({ key: "r", ctrl: false, shift: false, alt: false });
    expect(formatBindingKeys(bindings["canvas.tool-select"])).toEqual(["Ctrl", "Shift", "J"]);
    expect(formatBindingKeys(bindings["reader.fullscreen"])).toEqual(["F11"]);
  });
});
