// Decisao pura de teclado para o Enter dentro de um bloco de diagrama.
//
// Fica isolada num modulo sem dependencia de DOM/React para poder ser testada
// diretamente (o ambiente de teste do projeto e Node puro, sem jsdom). O editor
// executa a acao resultante contra o DOM real:
//   - "insert-line-break": Shift+Enter com o caret no campo fonte -> uma unica
//     quebra de linha (o editor aplica via document.execCommand insertLineBreak);
//   - "exit-block": Enter simples -> sai do diagrama para um bloco editavel;
//   - "ignore": nao interceptar (mantem o comportamento padrao do editor).
// Modificadores (Ctrl/Meta/Alt) nunca sao interceptados.

export type DiagramSourceEnterAction = "insert-line-break" | "exit-block" | "ignore";

export type DiagramSourceEnterInput = {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  // O caret esta dentro de um bloco de diagrama.
  hasDiagram: boolean;
  // O caret esta dentro do campo fonte (data-diagram-source) do diagrama.
  hasSourceCaret: boolean;
};

export function resolveDiagramSourceEnterAction(input: DiagramSourceEnterInput): DiagramSourceEnterAction {
  if (input.key !== "Enter") {
    return "ignore";
  }

  if (!input.hasDiagram || input.ctrlKey || input.metaKey || input.altKey) {
    return "ignore";
  }

  if (input.shiftKey) {
    return input.hasSourceCaret ? "insert-line-break" : "ignore";
  }

  return "exit-block";
}
