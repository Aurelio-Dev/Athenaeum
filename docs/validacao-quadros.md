# Validacao manual dos Quadros

| #   | Passo                                                      | Resultado esperado                                                                           | OK?                         |
| --- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------- |
| 1   | Abrir o app                                                | Boot normal, sem erro de migration                                                           | OK                          |
| 2   | Abrir um Quadro criado antes da v12                        | Cena vazia, editavel, sem erro de load                                                       | OK                          |
| 3   | Desenhar algo, fechar no x, reabrir                        | Desenho e viewport preservados                                                               | Desenho não aparece na tela |
| 4   | Colar uma imagem pequena no Quadro e fechar/reabrir        | Imagem reaparece; arquivo existe em `canvas-assets/<canvasId>/` no diretorio de dados do app | OK                          |
| 5   | Tentar colar/salvar imagem maior que 10MB                  | Arquivo e rejeitado; app nao quebra e nao cria arquivo parcial em disco                      | Aceitou a imagem            |
| 6   | Pressionar Esc durante desenho/uso de ferramenta no Quadro | Esc fica com o Excalidraw; painel do Quadro nao fecha                                        | OK                          |
| 7   | Abrir Quadro + Caderno + Leitor juntos e editar um Quadro  | Paineis coexistem na pilha; ao salvar, o card do Quadro atualiza "Editado ha X"              | OK                          |

Outras observações que notei nos testes:
1 - Quando clico para abrir um Quadro ele bem colado do lado direito, ele precisa abrir no centro
2- Dentro do Quadro por algum motivo as coisas não ficam aonde estou "vendo", por exemplo, colei uma imagem no centro, eu tive que ficar
caçando aonde ela foi colada pelo programa, provavelmente acontece com os desenhos/texto. Vale uma checagem!
3 - Sei que estamos cuidando do Quadro, mas precisamos urgente tratar de quando clicar em uma outra janela o programa mudar o foco para essa
janela clicada, pois tive que ficar movendo as janelas da frente para conseguir clicar nos botões, pois fica uma janela em cima da outra.
