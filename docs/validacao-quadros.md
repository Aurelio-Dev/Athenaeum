# Validacao manual dos Quadros

> **Update 10/07/2026 — revisão de documentação pós-migração Konva:** o
> Quadro deixou de usar `@excalidraw/excalidraw` e passou a usar
> [Konva.js](https://konvajs.org/) + `react-konva`, com toolbar flutuante em
> pílula, painel de propriedades próprio e handles de resize/rotate próprios
> (`Konva.Transformer` para a maioria das formas; handles customizados de
> início/fim para Seta e Linha, que são direcionais). Esta atualização troca
> o checklist abaixo para refletir as ferramentas atuais — é uma revisão de
> **documentação**, não uma nova rodada de QA executada: a coluna "OK?" foi
> reiniciada como "Pendente" e precisa ser preenchida na próxima validação
> manual real.

## Ferramentas atuais do Quadro

Seta e Linha possuem handles customizados de início/fim e um handle de dobra
intermediário; o handle de dobra faz parte da edição dessas duas ferramentas.

Selecionar, Mover, Retângulo, Losango, Elipse, Seta, Linha, Lápis
(`freedraw`), Borracha por segmento, Texto, Imagem e Frame — acessíveis pela
toolbar em pílula (Retângulo/Losango/Elipse/Seta agrupados no popup
"Formas▾") e pelos atalhos de teclado V/R/P/E/T/I/F.

| #   | Passo                                                                                              | Resultado esperado                                                                                                                        | OK?     |
| --- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 1   | Abrir o app                                                                                          | Boot normal, sem erro de migration                                                                                                             | Pendente |
| 2   | Abrir um Quadro criado antes da migração para Konva (formato antigo do Excalidraw)                  | Abre com cena vazia editável, sem erro no console                                                                                              | Pendente |
| 3   | Criar um retângulo, um losango, uma elipse, uma seta e uma linha; fechar no x; reabrir               | Todas as formas e a posição/zoom do stage são preservados                                                                                      | Pendente |
| 4   | Desenhar um traço curvo com o Lápis; fechar e reabrir                                                | Traço persiste com a mesma curvatura (sem serrilhado)                                                                                          | Pendente |
| 5   | Usar a Borracha cortando o meio de um traço de Lápis                                                | O traço se divide em dois traços independentes e móveis separadamente                                                                          | Pendente |
| 6   | Usar a Borracha passando rápido sobre uma forma rígida pequena (retângulo/losango/elipse/seta/linha) | A forma é removida inteira mesmo com o cursor se movendo rápido entre eventos de mousemove                                                     | Pendente |
| 7   | Criar um texto com a ferramenta Texto, digitar conteúdo e clicar fora para confirmar                 | Texto aparece renderizado no canvas e persiste após fechar/reabrir                                                                             | Pendente |
| 8   | Inserir uma imagem com a ferramenta Imagem (arquivo menor que o limite atual)                        | Imagem aparece no Quadro; arquivo é salvo em disco (mesmo mecanismo `canvas_files`/Rust já usado) e reaparece após reabrir                     | Pendente |
| 9   | Tentar inserir uma imagem acima do limite de tamanho aceito pela ferramenta Imagem                   | Inserção é rejeitada com mensagem de erro; app não quebra e não fica arquivo parcial em disco                                                  | Pendente |
| 10  | Criar um Frame                                                                                       | Retângulo tracejado com rótulo aparece e pode ser redimensionado                                                                                | Pendente |
| 11  | Selecionar uma forma com resize/rotate suportado (retângulo, losango, elipse, imagem, frame, lápis ou texto) e usar as alças do Transformer | Alças de redimensionar e girar aparecem e funcionam; dimensões e rotação persistem após reabrir                                                | Pendente |
| 12  | Selecionar uma Seta ou Linha e arrastar as alças customizadas de início/fim                          | Os dois pontos se movem independentemente (não é uma caixa delimitadora); persiste após reabrir                                                | Pendente |
| 13  | Selecionar formas de tipos diferentes e abrir o painel de propriedades (Cor/Traço/Preenchimento)     | As seções exibidas variam conforme o tipo da forma selecionada; alterações de cor/traço/preenchimento persistem                                | Pendente |
| 14  | Pressionar Esc durante o modo Mover                                                                  | Volta para a ferramenta ativa anterior; painel do Quadro não fecha                                                                              | Pendente |
| 15  | Selecionar uma forma e apertar Delete/Backspace                                                      | Forma é removida                                                                                                                                 | Pendente |
| 16  | Trocar de ferramenta pelos atalhos de teclado (V/R/P/E/T/I/F) com o cursor sobre o Quadro             | A ferramenta correspondente ativa e destaca na toolbar                                                                                          | Pendente |
| 17  | Abrir Quadro + Caderno + Leitor juntos e editar um Quadro                                            | Painéis coexistem na pilha; ao salvar, o card do Quadro atualiza "Editado há X"                                                                | Pendente |
| 18  | Selecionar uma Seta ou Linha e arrastar o handle de dobra intermediário                                  | A forma passa a usar três pontos, a curva passa pelos pontos com tension 0.5 e a ponta da Seta acompanha a tangente real da curva                         | Pendente |
| 19  | Criar qualquer forma (incluindo Imagem e texto não vazio) e concluir o gesto/edição                      | A ferramenta volta para Selecionar, a forma recém-criada fica selecionada e Transformer/handles/painel de propriedades aparecem imediatamente             | Pendente |
| 20  | Executar criação, mover, resize/rotate, handles, Delete, propriedades, texto e Borracha; usar Ctrl+Z/Ctrl+Y | Undo/Redo restaura os snapshots na ordem correta, limita o histórico a 50 níveis, limpa Redo após nova ação, ignora confirmações sem mudança e não persiste entre sessões | Pendente |

## Observações anteriores (pré-migração Konva, não reverificadas)

As notas abaixo foram registradas manualmente antes da migração para Konva.
Não sabemos se ainda se aplicam ao Quadro atual — ficam registradas por não
serem específicas do Excalidraw (parecem tratar de comportamento geral de
painel flutuante) e merecem reverificação na próxima rodada de QA real:

1. Ao abrir um Quadro colado do lado direito, ele precisa abrir no centro.
2. Dentro do Quadro, elementos inseridos (ex.: uma imagem colada no centro)
   podem não aparecer onde o usuário está vendo a tela — vale checagem de
   coordenadas de viewport vs. stage.
3. Clicar em outra janela pode mudar o foco do sistema operacional para essa
   janela, exigindo reorganizar as janelas para conseguir clicar nos botões
   do app quando painéis se sobrepõem.
