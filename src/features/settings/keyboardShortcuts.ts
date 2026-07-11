export type KeyboardShortcut = {
  action: string;
  description: string;
  keys: readonly string[];
};

export type KeyboardShortcutGroup = {
  category: "Leitor" | "Caderno" | "Quadros";
  shortcuts: readonly KeyboardShortcut[];
};

export const keyboardShortcutGroups: readonly KeyboardShortcutGroup[] = [
  {
    category: "Leitor",
    shortcuts: [
      {
        action: "Fechar seleção, janela auxiliar ou leitor",
        description: "O Escape fecha primeiro o elemento ativo e, depois, o painel do leitor.",
        keys: ["Esc"],
      },
    ],
  },
  {
    category: "Caderno",
    shortcuts: [
      {
        action: "Sair do modo foco ou fechar o caderno",
        description: "Sai primeiro do modo foco; fora dele, fecha o painel que estiver no topo.",
        keys: ["Esc"],
      },
      {
        action: "Avançar entre células da tabela",
        description: "Na última célula, cria uma nova linha automaticamente.",
        keys: ["Tab"],
      },
      {
        action: "Voltar entre células da tabela",
        description: "Move o cursor para a célula anterior.",
        keys: ["Shift", "Tab"],
      },
      {
        action: "Abrir link externo",
        description: "Abre o link sob o ponteiro pelo sistema operacional.",
        keys: ["Ctrl", "Clique"],
      },
      {
        action: "Finalizar a edição da fonte do diagrama",
        description: "Sai do bloco de diagrama e cria um novo bloco editável abaixo.",
        keys: ["Enter"],
      },
      {
        action: "Inserir linha na fonte do diagrama",
        description: "Mantém o cursor dentro do bloco de fonte.",
        keys: ["Shift", "Enter"],
      },
      {
        action: "Redimensionar imagem ou diagrama pelo teclado",
        description: "Com uma alça de redimensionamento focada, as setas ajustam o tamanho.",
        keys: ["Setas"],
      },
      {
        action: "Redimensionar em passos maiores",
        description: "Aumenta o passo aplicado pelas setas em imagens e diagramas.",
        keys: ["Shift", "Setas"],
      },
    ],
  },
  {
    category: "Quadros",
    shortcuts: [
      { action: "Selecionar", description: "Ativa a ferramenta de seleção.", keys: ["V"] },
      { action: "Retângulo", description: "Ativa a ferramenta de retângulo.", keys: ["R"] },
      { action: "Lápis", description: "Ativa o desenho livre.", keys: ["P"] },
      { action: "Borracha", description: "Ativa a ferramenta de apagar.", keys: ["E"] },
      { action: "Texto", description: "Ativa a criação de texto.", keys: ["T"] },
      { action: "Imagem", description: "Ativa a inserção de imagem.", keys: ["I"] },
      { action: "Frame", description: "Ativa a criação de frame.", keys: ["F"] },
      {
        action: "Remover elemento selecionado",
        description: "Exclui a forma atualmente selecionada.",
        keys: ["Delete", "ou", "Backspace"],
      },
      {
        action: "Mover pelo quadro",
        description: "Segure Espaço e arraste com o botão principal do mouse.",
        keys: ["Espaço", "Arrastar"],
      },
      {
        action: "Sair da ferramenta Mover",
        description: "Retorna à ferramenta usada anteriormente.",
        keys: ["Esc"],
      },
    ],
  },
];
