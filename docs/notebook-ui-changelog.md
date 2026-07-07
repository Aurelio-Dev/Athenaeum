# Changelog da UI do Caderno

## 07/07/2026 — Reorganização estrutural da toolbar do editor

Esta fase refez a organização da toolbar para reduzir a quantidade de controles
visíveis sem alterar comandos, HTML persistido, autosave, seleção/range,
atalhos ou tokens de cor.

Principais alterações:

- `H1`, `H2` e `H3` foram agrupados no menu `Texto`, junto de `Parágrafo`,
  `Citação em bloco`, `Bloco de código` e `Limpar formatação`.
- `Negrito` e `Itálico` permaneceram como botões diretos.
- As listas foram agrupadas no menu `Listas`.
- `Cite`, inserção/remoção de link, anexo e PDF foram agrupados em
  `Referências`.
- `Inserir` ficou restrito a blocos e elementos de conteúdo: Tabela, Callout,
  Imagem, Equação, Separador e Diagramas.
- `Layout` concentra Alinhamento e Espaçamento, preservando os presets
  existentes e destacando o estado ativo.
- O menu `...` permanente foi removido; ele aparece apenas como overflow
  responsivo quando `Layout` e/ou `Referências` precisam ser recolhidos.
- O overflow é calculado pela largura real da toolbar, para respeitar variações
  causadas por sidebars e modo foco.

Validação executada:

- `npm run typecheck`
- `npm run test -- src/features/notebooks/notebookDiagramParser.test.ts`
- `npm run build`
- `git diff --check`

Observação sobre tokens:

Não houve alteração nos tokens de cor, na paleta de tags, nos temas claro/escuro
ou na tipografia global nesta fase.

## 07/07/2026 — Sidebar Detalhes e toolbar do editor

Esta fase reorganizou a experiência do Caderno sem alterar o HTML persistido
das páginas, o autosave, a seleção/range do editor ou os tokens de cor.

Principais alterações:

- Sidebar `Detalhes` mais próxima da referência visual, com `Reading Status`,
  descrição, autor/disciplina abaixo da descrição, tags compactas e botão
  `+ Tag` no padrão do painel `Detalhes` dos documentos.
- Menu `Mais opções` do Caderno fixo no rodapé do painel, com botão adicional
  no cabeçalho. Ações com lógica existente foram habilitadas; placeholders
  permanecem desabilitados.
- `Salvo agora` passou a refletir estados reais de salvamento: salvo, sujo,
  salvando e erro.
- Novos Cadernos criados pela biblioteca abrem maximizados na primeira vez.
- Toolbar do editor começou a ser separada em menus menores, depois consolidada
  pela reorganização estrutural registrada acima.

Validação executada:

- `npm run typecheck`
- `npm run test -- src/features/notebooks/notebookDiagramParser.test.ts`
- `npm run build`
- `git diff --check`

Observação sobre tokens:

Não houve alteração nos tokens de cor, na paleta de tags, nos temas claro/escuro
ou na tipografia global nesta fase.
