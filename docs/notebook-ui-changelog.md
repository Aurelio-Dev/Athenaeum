# Changelog da UI do Caderno

## 16/07/2026 — Enter sai de callout/código, scroll do menu "/" e placeholder

Três ajustes pontuais no editor, sem migrations.

Correção de Enter em blocos multi-linha (callout e "bloco de código"):

- Dentro do callout e do bloco de código, o Enter nunca saía do bloco: o
  callout sempre inseria uma quebra de linha, e o bloco de código (um
  `<code>` inline com `white-space:pre`, não um bloco estrutural) não tinha
  handler de Enter nenhum. Passaram a seguir a convenção de "Enter duplo sai"
  (Notion/Obsidian): Enter numa linha com texto quebra normalmente; Enter numa
  linha já vazia sai do bloco para uma nova linha depois dele. Shift+Enter
  sempre quebra a linha, nunca sai.
- A detecção de "linha vazia" precisou lidar com dois modelos de quebra que o
  Chromium usa dentro do contentEditable: elementos `<br>` (callout) e
  caracteres `\n` dentro de um nó de texto (o bloco de código, por causa do
  `white-space:pre`) — e com o fato de que, ao abrir uma linha em branco, o
  Chromium insere uma quebra duplicada (dois `<br>`, ou `"\n\n"`) com o caret
  posicionado *antes* da segunda, não depois — um detalhe que não é visível
  olhando o HTML, só via inspeção do `Range` da seleção.
- Clicar fora do bloco (numa área vazia abaixo dele) já funcionava nativamente
  para callout, código e equação, graças ao parágrafo em branco que a
  inserção sempre deixa depois do bloco — não precisou de código novo.

Menu "/":

- O item selecionado por seta (↑/↓) podia passar da área visível do menu sem
  o scroll acompanhar. Agora o item ativo usa `scrollIntoView({ block:
  "nearest" })`, que rola só o necessário.

Callout:

- "Escreva uma observação importante..." virou placeholder de CSS
  (`:empty::before`), que some sozinho ao começar a digitar. Callouts novos
  nascem com o corpo vazio; callouts antigos que gravaram a frase como
  conteúdo real continuam mostrando-a como texto comum (editável e apagável),
  sem migration.

Validação executada:

- `npm run typecheck`
- `npm test`
- `npm run build`
- Verificação manual via CDP: Enter duplo saindo do callout e do bloco de
  código (com o corpo limpo, sem linha em branco sobrando), clique fora
  confirmado nos dois, scroll do menu "/" acompanhando a seleção (screenshot),
  placeholder do callout sumindo ao digitar.

## 16/07/2026 — Modo foco recuado, autosave real e Ctrl+S

As barras do modo foco deixaram de sumir e passaram a recuar, e o salvamento
automático — que não existia — foi implementado. Sem migrations.

Modo foco:

- O trilho de páginas era **removido do DOM** no modo foco; agora permanece,
  como o header e o rodapé (que já ficavam e só trocavam de conteúdo).
- As três barras ganharam cor própria no foco, convergindo para a cor da
  página: header e rodapé em `#F6F0E8` (`#1D1712` no escuro) e trilho em
  `#F2EBE1` (`#18130E` no escuro), via os tokens `--notebook-focus-bar-bg` e
  `--notebook-focus-rail-bg`.
- O conteúdo das barras (texto, botões, ícones) fica em `opacity: 0.45` e volta
  ao normal ao passar o mouse — individualmente, uma barra por vez. Sair do
  modo foco restaura todas. A opacidade vai nos filhos da barra, não na barra:
  aplicada nela, o fundo apagaria junto. `:focus-within` acompanha o `:hover`
  para que a navegação por teclado não caia numa barra apagada.
- `enterFocusMode` passou a largar o foco de teclado: o botão "Foco" vive no
  rodapé, e sem isso o `:focus-within` mantinha aquela barra acesa logo ao
  entrar no modo.
- O status de salvamento saiu do rodapé; ele agora vive só no header.
- O botão `(i)` no modo foco abria mão do foco para mostrar o drawer. Agora ele
  abre o drawer **por cima** do modo foco: o drawer não apaga (não é uma barra
  recuada) e o resto continua no foco.
- A ordem do `Esc` passou a fechar o drawer antes de sair do modo foco — o
  drawer agora pode estar aberto por cima dele, e sair do foco primeiro o
  deixaria aberto para trás.
- O ícone do topo do trilho virou uma seta que aponta para onde o trilho vai:
  `>` expande, `<` recolhe. Reusa o `ChevronRightIcon` compartilhado.

Salvamento:

- **Não havia autosave.** O painel só gravava em blur de campo, troca de
  página, fechamento, export e lixeira — digitar sem sair do campo mantinha
  "Alterações não salvas" indefinidamente, e um fechamento anormal perdia tudo
  desde o último blur. Agora um autosave com debounce de 1,2 s grava depois de
  uma pausa na digitação.
- `Ctrl+S` / `Cmd+S` grava na hora e cancela o autosave agendado. Só responde
  quando o painel é o topo da pilha, como o `Esc`, e usa `preventDefault` para
  o WebView2 não abrir o "salvar página" do Chromium.
- Ambos reusam a fila serializada existente (`saveQueueTailRef`), então não
  concorrem com um save em andamento; os dois saves são guardados pelos refs de
  "sujo", então agendar sem nada sujo é um no-op.

Validação executada:

- `npm run typecheck`
- `npm test`
- `npm run build`
- Verificação manual via CDP (claro e escuro): cores e opacidades das três
  barras medidas na entrada do foco, no hover individual e na saída; autosave e
  `Ctrl+S` verificados por reload sem blur (o conteúdo sobrevive).

## 16/07/2026 — Superfície, tipografia serifada, callouts e modo limpo

Esta fase aproximou o corpo do Caderno da referência visual e corrigiu um bug
destrutivo de desfazer nas tabelas. Sem migrations e sem novos tokens de cor.

Principais alterações:

- Superfície de escrita passou a usar `--background` (`#F5EDE4` no claro) em vez
  do `--card` quase branco. Foi usado o token, não o hex literal, para o tema
  escuro continuar em `#1A1410`. Como callout e tabela ficam em `--card`, eles
  passaram a se destacar sobre a página.
- O corpo do editor passou a ser serifado (Lora). O cartão de anexo continua na
  sans por ser cromo de UI; fonte de diagrama/equação e código já tinham fonte
  própria.
- `--font-body` passou a existir: era referenciado em duas regras de placeholder
  e nunca havia sido definido.
- Placeholder do editor virou `Escreva, ou tecle "/" para inserir um bloco...`.
- Callout redesenhado: superfície `--card` única (o fundo não é mais tingido por
  tipo), borda fina com faixa de 3px à esquerda, ícone em círculo contornado e
  rótulo do tipo em caixa-alta. O accent virou o único sinal do tipo, com `info`
  em `--primary`. Os quatro tipos foram mantidos. O rótulo é desenhado por
  `::before` de propósito: dentro do contentEditable um nó real seria editável,
  apagável e viraria HTML persistido. Rótulo em `--font-body` peso 700; corpo
  herda a serifa.
- Tabelas ganharam modo limpo por bloco (sem grade nem fundo de célula, só a
  régua do cabeçalho), seguindo o padrão da equação: classe de runtime, nunca
  persistida.
- O CSS de callout do exportador foi espelhado, senão o HTML exportado
  divergiria do editor.

Correção de desfazer (Ctrl+Z) nas tabelas:

- As operações de linha/coluna mutavam o DOM direto, o que é invisível para o
  histórico do contentEditable. O Ctrl+Z seguinte revertia a entrada anterior —
  a inserção da tabela — e destruía o bloco inteiro (medido: 2 linhas → `+
  linha` → 3 → Ctrl+Z → **0**).
- Agora a mutação roda num clone e a tabela é reinserida via `execCommand`, o
  que grava a operação como um passo desfazível.
- Ctrl+Z/Ctrl+Y de digitação e de formatação já funcionavam e não foram
  alterados.
- Fora do escopo desta fase: redimensionar imagem e outras operações que ainda
  alteram o DOM direto continuam fora da pilha nativa.

Validação executada:

- `npm run typecheck`
- `npm test`
- `npm run build`
- Verificação manual via CDP (claro e escuro), incluindo o round-trip de
  persistência do modo limpo (salva com o modo ligado, reabre com as bordas) e
  os cenários de Ctrl+Z/Ctrl+Y das operações de tabela.

Observação sobre tokens:

Não houve alteração nos tokens de cor, na paleta de tags, nos temas claro/escuro
ou na tipografia global desta fase além da fonte do corpo do editor.

## 16/07/2026 — Rodapé, header e toolbar flutuante

Esta fase aproximou o editor da referência visual, sem migrations e sem novos
tokens de cor.

Principais alterações:

- Rodapé reescrito: contador passou a mostrar `N palavras · N páginas`; `Foco`
  virou pílula; o dropdown de espaçamento virou um segmentado inline
  (`Compacto`/`Normal`/`Confortável`/`Amplo`); o dropdown de zoom virou botões
  `−`/`+` com o percentual entre eles.
- Header simplificado: status de salvamento (`• Salvo`/`• Alterações não
  salvas`/`• Erro`) com ponto colorido à esquerda; breadcrumb saiu do header e
  passou a aparecer acima do título da página, no conteúdo.
- A toolbar fixa de formatação foi removida. Ao selecionar texto, uma barra
  flutuante ancorada acima da seleção aparece com `Texto`, `Negrito`,
  `Itálico`, `Listas` e `Mais opções` (compacto, com citação em bloco, código,
  citar, link, anexo, PDF, inserir blocos, alinhamento e manutenção).
- `H1`/`H2`/`H3` foram removidos do menu `/`: `execCommand("formatBlock")` não
  consegue escopar corretamente em um bloco deixado vazio após o gatilho ser
  apagado, mesclando o título com o parágrafo anterior mesmo com conteúdo
  bem-formado. Títulos continuam disponíveis via seleção de texto, no chip
  `Texto` da barra flutuante, onde o comportamento foi verificado correto.

Validação executada:

- `npm run typecheck`
- `npm test`
- Verificação manual via CDP (claro e escuro): menu `/` sem títulos, barra
  flutuante dentro da viewport, popover de link mantendo a barra visível,
  título via seleção aplicado corretamente.

Observação sobre tokens:

Não houve alteração nos tokens de cor, na paleta de tags, nos temas claro/escuro
ou na tipografia global nesta fase.

## 07/07/2026 — Refinos da toolbar compacta

Esta fase ajustou detalhes visuais da toolbar compacta do editor.

Principais alterações:

- O botão `...` passou a ficar encostado no canto direito da toolbar.
- `Vincular PDF` passou a usar botão com ícone e texto `PDF`, seguindo a
  referência visual.
- Os ícones e glifos da toolbar voltaram a usar os tokens temáticos já
  existentes de texto suave/forte para modo claro e escuro.

Validação executada:

- `npm run typecheck`
- `npm run test -- src/features/notebooks/notebookDiagramParser.test.ts`
- `npm run build`
- `git diff --check`

Observação sobre tokens:

Não houve alteração nos tokens de cor, na paleta de tags, nos temas claro/escuro
ou na tipografia global nesta fase.

## 07/07/2026 — Toolbar compacta por ícones

Esta fase ajustou a toolbar do editor para ficar mais próxima da referência
visual enviada, priorizando botões compactos por ícone e removendo os menus
textuais permanentes da barra.

Principais alterações:

- `H1`, `H2` e `H3` voltaram para a toolbar como glifos diretos.
- `Negrito`, `Itálico`, listas, citação em bloco e código ficaram como botões
  diretos por ícone.
- `Cite`, link, anexo e PDF também voltaram para a toolbar como ações diretas
  por ícone.
- O botão `...` voltou a existir permanentemente no fim da toolbar, como na
  referência, concentrando inserção de blocos, layout, espaçamento e manutenção.
- As opções de alinhamento dentro do menu `...` passaram a usar ícones em vez
  de rótulos textuais.

Validação executada:

- `npm run typecheck`
- `npm run test -- src/features/notebooks/notebookDiagramParser.test.ts`
- `npm run build`
- `git diff --check`

Observação sobre tokens:

Não houve alteração nos tokens de cor, na paleta de tags, nos temas claro/escuro
ou na tipografia global nesta fase.

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
