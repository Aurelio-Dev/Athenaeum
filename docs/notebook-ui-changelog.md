# Changelog da UI do Caderno

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
- Toolbar do editor reorganizada em menus menores:
  - `Inserir`: Tabela, Callout, Imagem, Equação, Separador e Diagramas.
  - `Layout`: Alinhamento e Espaçamento.
  - `...`: apenas manutenção de formatação, com `Limpar formatação` e
    `Remover link`.
- `Link`, `Anexar` e `PDF` ficaram como botões diretos na toolbar.
- O menu `...` deixou de misturar inserção de blocos, alinhamento e
  espaçamento.

Validação executada:

- `npm run typecheck`
- `npm run test -- src/features/notebooks/notebookDiagramParser.test.ts`
- `npm run build`
- `git diff --check`

Observação sobre tokens:

Não houve alteração nos tokens de cor, na paleta de tags, nos temas claro/escuro
ou na tipografia global nesta fase.
