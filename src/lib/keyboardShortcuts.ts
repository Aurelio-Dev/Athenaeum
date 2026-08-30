// Catalogo canonico dos atalhos. Alem de alimentar a tela de Ajustes, ele e a
// origem dos bindings remapeaveis: quem tem `defaultBinding` e resolvido em
// runtime pelo registro de atalhos, e o handler correspondente NAO pode
// comparar a tecla literalmente (ver keyboardShortcuts.test.ts).

export type ShortcutBinding = {
  // `event.key` ja normalizado: letras em minusculo, teclas nomeadas com a
  // grafia do DOM ("F11", "Escape").
  key: string;
  // Ctrl no Windows; o matcher tambem aceita Cmd, porque os handlers atuais
  // testam ctrlKey || metaKey.
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
};

export type KeyboardShortcut = {
  id: string;
  action: string;
  description: string;
  keys: readonly string[];
  // Ausente = fixo. So acordes de tecla unica sao remapeaveis. Ficam de fora:
  //   - Esc, Tab, Enter, setas e `/`, que carregam semantica de dialogo, de
  //     ARIA ou do editor e quebrariam a navegacao se mudassem;
  //   - acoes que hoje aceitam MAIS DE UMA tecla para o mesmo efeito (zoom com
  //     `+`/`=`/numerico, menu de contexto com Shift+F10/Menu, remover com
  //     Delete/Backspace). Um acorde unico as tornaria menos tolerantes do que
  //     sao hoje, entao permanecem fixas nesta versao.
  defaultBinding?: ShortcutBinding;
};

export type KeyboardShortcutGroup = {
  category: "Leitor" | "Caderno" | "Quadros";
  shortcuts: readonly KeyboardShortcut[];
};

function acorde(key: string, modificadores: Partial<Omit<ShortcutBinding, "key">> = {}): ShortcutBinding {
  return {
    key,
    ctrl: modificadores.ctrl ?? false,
    shift: modificadores.shift ?? false,
    alt: modificadores.alt ?? false,
  };
}

export const keyboardShortcutGroups: readonly KeyboardShortcutGroup[] = [
  {
    category: "Leitor",
    shortcuts: [
      {
        id: "reader.search",
        action: "Buscar no documento",
        description: "Abre o painel esquerdo e coloca o cursor no campo de busca.",
        keys: ["Ctrl", "F"],
        defaultBinding: acorde("f", { ctrl: true }),
      },
      {
        id: "reader.fullscreen",
        action: "Alternar tela cheia",
        description: "Entra e sai da tela cheia nativa da janela do leitor.",
        keys: ["F11"],
        defaultBinding: acorde("F11"),
      },
      {
        id: "reader.zoom-in",
        action: "Aumentar zoom",
        description: "Também aceita a tecla + do teclado numérico.",
        keys: ["Ctrl", "+"],
      },
      {
        id: "reader.zoom-out",
        action: "Reduzir zoom",
        description: "Também aceita a tecla − do teclado numérico.",
        keys: ["Ctrl", "−"],
      },
      {
        id: "reader.zoom-reset",
        action: "Voltar ao zoom padrão",
        description: "Restaura o zoom original do documento.",
        keys: ["Ctrl", "0"],
      },
      {
        id: "reader.context-menu",
        action: "Abrir o menu de contexto",
        description: "Abre pelo teclado o mesmo menu do clique com o botão direito.",
        keys: ["Shift", "F10", "ou", "Menu"],
      },
      {
        id: "reader.sidebar-tabs",
        action: "Navegar entre as abas do painel",
        description: "Home e End vão para a primeira e a última aba.",
        keys: ["←", "→", "ou", "Home", "End"],
      },
      {
        id: "reader.escape",
        action: "Fechar seleção, modo leitura, tela cheia ou leitor",
        description:
          "O Escape desfaz uma camada por vez, nesta ordem, e só fecha o leitor quando não há nenhuma acima dele.",
        keys: ["Esc"],
      },
    ],
  },
  {
    category: "Caderno",
    shortcuts: [
      {
        id: "notebook.save",
        action: "Salvar agora",
        description: "Grava na hora e cancela o salvamento automático agendado.",
        keys: ["Ctrl", "S"],
        defaultBinding: acorde("s", { ctrl: true }),
      },
      {
        id: "notebook.block-menu",
        action: "Abrir o menu de blocos",
        description: "Digite / no início de uma linha vazia para inserir tabela, callout, diagrama e mais.",
        keys: ["/"],
      },
      {
        id: "notebook.block-menu-navigation",
        action: "Navegar o menu de blocos",
        description: "As setas escolhem, Enter insere e Escape fecha sem inserir.",
        keys: ["↑", "↓", "Enter", "Esc"],
      },
      {
        id: "notebook.escape",
        action: "Fechar impressão, detalhes, modo foco ou caderno",
        description:
          "O Escape desfaz uma camada por vez, nesta ordem, e só fecha o caderno quando não há nenhuma acima dele.",
        keys: ["Esc"],
      },
      {
        id: "notebook.table-next-cell",
        action: "Avançar entre células da tabela",
        description: "Na última célula, cria uma nova linha automaticamente.",
        keys: ["Tab"],
      },
      {
        id: "notebook.table-previous-cell",
        action: "Voltar entre células da tabela",
        description: "Move o cursor para a célula anterior.",
        keys: ["Shift", "Tab"],
      },
      {
        id: "notebook.open-link",
        action: "Abrir link externo",
        description: "Abre o link sob o ponteiro pelo sistema operacional.",
        keys: ["Ctrl", "Clique"],
      },
      {
        id: "notebook.diagram-finish",
        action: "Finalizar a edição da fonte do diagrama",
        description: "Sai do bloco de diagrama e cria um novo bloco editável abaixo.",
        keys: ["Enter"],
      },
      {
        id: "notebook.diagram-newline",
        action: "Inserir linha na fonte do diagrama",
        description: "Mantém o cursor dentro do bloco de fonte.",
        keys: ["Shift", "Enter"],
      },
      {
        id: "notebook.resize",
        action: "Redimensionar imagem ou diagrama pelo teclado",
        description: "Com uma alça de redimensionamento focada, as setas ajustam o tamanho.",
        keys: ["Setas"],
      },
      {
        id: "notebook.resize-large-step",
        action: "Redimensionar em passos maiores",
        description: "Aumenta o passo aplicado pelas setas em imagens e diagramas.",
        keys: ["Shift", "Setas"],
      },
    ],
  },
  {
    category: "Quadros",
    shortcuts: [
      {
        id: "canvas.tool-select",
        action: "Selecionar",
        description: "Ativa a ferramenta de seleção.",
        keys: ["V"],
        defaultBinding: acorde("v"),
      },
      {
        id: "canvas.tool-rectangle",
        action: "Retângulo",
        description: "Ativa a ferramenta de retângulo.",
        keys: ["R"],
        defaultBinding: acorde("r"),
      },
      {
        id: "canvas.tool-freedraw",
        action: "Lápis",
        description: "Ativa o desenho livre.",
        keys: ["P"],
        defaultBinding: acorde("p"),
      },
      {
        id: "canvas.tool-eraser",
        action: "Borracha",
        description: "Ativa a ferramenta de apagar.",
        keys: ["E"],
        defaultBinding: acorde("e"),
      },
      {
        id: "canvas.tool-text",
        action: "Texto",
        description: "Ativa a criação de texto.",
        keys: ["T"],
        defaultBinding: acorde("t"),
      },
      {
        id: "canvas.tool-image",
        action: "Imagem",
        description: "Ativa a inserção de imagem.",
        keys: ["I"],
        defaultBinding: acorde("i"),
      },
      {
        id: "canvas.tool-frame",
        action: "Frame",
        description: "Ativa a criação de frame.",
        keys: ["F"],
        defaultBinding: acorde("f"),
      },
      {
        id: "canvas.undo",
        action: "Desfazer",
        description: "Volta um passo no histórico do quadro.",
        keys: ["Ctrl", "Z"],
        defaultBinding: acorde("z", { ctrl: true }),
      },
      {
        id: "canvas.redo",
        action: "Refazer",
        description: "Avança um passo no histórico do quadro.",
        keys: ["Ctrl", "Y"],
        defaultBinding: acorde("y", { ctrl: true }),
      },
      {
        id: "canvas.delete",
        action: "Remover elemento selecionado",
        description: "Exclui a forma atualmente selecionada.",
        keys: ["Delete", "ou", "Backspace"],
      },
      {
        id: "canvas.lock-aspect",
        action: "Travar a proporção ao redimensionar",
        description: "Segure Shift enquanto arrasta uma alça para manter a proporção original.",
        keys: ["Shift", "Arrastar"],
      },
      {
        id: "canvas.pan",
        action: "Mover pelo quadro",
        description: "Segure Espaço e arraste com o botão principal do mouse.",
        keys: ["Espaço", "Arrastar"],
      },
      {
        id: "canvas.exit-pan",
        action: "Sair da ferramenta Mover",
        description: "Retorna à ferramenta usada anteriormente.",
        keys: ["Esc"],
      },
    ],
  },
];

export const keyboardShortcuts: readonly KeyboardShortcut[] = keyboardShortcutGroups
  .flatMap((group) => group.shortcuts);

export const rebindableShortcuts: readonly KeyboardShortcut[] = keyboardShortcuts
  .filter((shortcut) => shortcut.defaultBinding !== undefined);

export function findShortcut(id: string): KeyboardShortcut | undefined {
  return keyboardShortcuts.find((shortcut) => shortcut.id === id);
}

// ---------------------------------------------------------------------------
// Bindings efetivos
//
// O catalogo acima e o padrao; o usuario pode sobrescrever os remapeaveis em
// Ajustes. Tudo aqui e puro: o provider cuida de persistencia e sincronizacao.
// ---------------------------------------------------------------------------

export type ShortcutOverrides = Readonly<Record<string, ShortcutBinding>>;

export type ShortcutBindings = Readonly<Record<string, ShortcutBinding>>;

export type BindingRejection =
  | { reason: "invalid" }
  | { reason: "reserved" }
  | { reason: "needs-modifier" }
  | { reason: "conflict"; conflictId: string };

const TECLA_DE_FUNCAO = /^F([1-9]|1[0-2])$/;

// Combinacoes que o Windows ou o proprio WebView2 consomem antes da pagina.
// Aceitar uma delas gravaria um atalho que nunca dispara.
const RESERVADOS: readonly ShortcutBinding[] = [
  { key: "F5", ctrl: false, shift: false, alt: false },
  { key: "F4", ctrl: false, shift: false, alt: true },
  { key: "w", ctrl: true, shift: false, alt: false },
  { key: "r", ctrl: true, shift: false, alt: false },
  { key: "n", ctrl: true, shift: false, alt: false },
  { key: "t", ctrl: true, shift: false, alt: false },
  { key: "p", ctrl: true, shift: false, alt: false },
];

type TecladoLike = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
};

export function normalizeBindingKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key;
}

export function bindingsEqual(first: ShortcutBinding, second: ShortcutBinding): boolean {
  return (
    first.key === second.key
    && first.ctrl === second.ctrl
    && first.shift === second.shift
    && first.alt === second.alt
  );
}

export function isValidBinding(value: unknown): value is ShortcutBinding {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidato = value as Record<string, unknown>;
  if (
    typeof candidato.key !== "string"
    || typeof candidato.ctrl !== "boolean"
    || typeof candidato.shift !== "boolean"
    || typeof candidato.alt !== "boolean"
  ) {
    return false;
  }

  const key = candidato.key;
  return key === normalizeBindingKey(key) && (key.length === 1 || TECLA_DE_FUNCAO.test(key));
}

// Ctrl e Cmd sao equivalentes aqui: os handlers historicos testam
// `ctrlKey || metaKey` e nenhum atalho do app distingue os dois.
export function matchesBinding(event: TecladoLike, binding: ShortcutBinding): boolean {
  return (
    normalizeBindingKey(event.key) === binding.key
    && (event.ctrlKey || event.metaKey) === binding.ctrl
    && event.shiftKey === binding.shift
    && event.altKey === binding.alt
  );
}

// Devolve null quando o evento ainda nao forma um atalho: so um modificador
// pressionado, ou uma tecla que nao e caractere nem tecla de funcao.
export function captureBinding(event: TecladoLike): ShortcutBinding | null {
  if (["Control", "Shift", "Alt", "Meta", "OS", "Dead"].includes(event.key)) {
    return null;
  }

  const key = normalizeBindingKey(event.key);
  if (key.length !== 1 && !TECLA_DE_FUNCAO.test(key)) {
    return null;
  }

  return {
    key,
    ctrl: event.ctrlKey || event.metaKey,
    shift: event.shiftKey,
    alt: event.altKey,
  };
}

export function formatBindingKeys(binding: ShortcutBinding): string[] {
  const partes: string[] = [];
  if (binding.ctrl) partes.push("Ctrl");
  if (binding.alt) partes.push("Alt");
  if (binding.shift) partes.push("Shift");
  partes.push(binding.key === " " ? "Espaço" : binding.key.toUpperCase());
  return partes;
}

function categoriaDe(id: string): string | null {
  return keyboardShortcutGroups.find((grupo) =>
    grupo.shortcuts.some((atalho) => atalho.id === id),
  )?.category ?? null;
}

export function validateBinding(
  id: string,
  binding: ShortcutBinding,
  bindings: ShortcutBindings,
): BindingRejection | null {
  const padrao = findShortcut(id)?.defaultBinding;
  if (!padrao || !isValidBinding(binding)) {
    return { reason: "invalid" };
  }

  if (RESERVADOS.some((reservado) => bindingsEqual(reservado, binding))) {
    return { reason: "reserved" };
  }

  // Um atalho que hoje exige Ctrl nao pode virar tecla solta: ele dispararia
  // no meio da digitacao do Caderno ou do campo de busca.
  if (padrao.ctrl && !binding.ctrl && !binding.alt) {
    return { reason: "needs-modifier" };
  }

  const categoria = categoriaDe(id);
  const conflito = rebindableShortcuts.find((atalho) =>
    atalho.id !== id
    && categoriaDe(atalho.id) === categoria
    && bindingsEqual(bindings[atalho.id] ?? atalho.defaultBinding!, binding),
  );
  return conflito ? { reason: "conflict", conflictId: conflito.id } : null;
}

export function normalizeShortcutOverrides(value: unknown): ShortcutOverrides {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      return {};
    }
  }

  if (typeof parsed !== "object" || parsed === null) {
    return {};
  }

  const candidato = parsed as Record<string, unknown>;
  if (candidato.version !== 1 || typeof candidato.bindings !== "object" || candidato.bindings === null) {
    return {};
  }

  const bruto = candidato.bindings as Record<string, unknown>;
  const resultado: Record<string, ShortcutBinding> = {};
  for (const atalho of rebindableShortcuts) {
    const binding = bruto[atalho.id];
    // Um override identico ao padrao nao e guardado: assim "Restaurar padrao"
    // e a ausencia da chave descrevem o mesmo estado.
    if (isValidBinding(binding) && !bindingsEqual(binding, atalho.defaultBinding!)) {
      resultado[atalho.id] = binding;
    }
  }

  return resultado;
}

export function serializeShortcutOverrides(value: unknown): string {
  return JSON.stringify({ version: 1, bindings: normalizeShortcutOverrides(value) });
}

export function resolveShortcutBindings(overrides: ShortcutOverrides): ShortcutBindings {
  const resultado: Record<string, ShortcutBinding> = {};
  for (const atalho of rebindableShortcuts) {
    resultado[atalho.id] = overrides[atalho.id] ?? atalho.defaultBinding!;
  }
  return resultado;
}
