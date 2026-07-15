# Changelog da UI do Leitor

## 15/07/2026 — Reader 1C: visualização, zoom e foco de leitura

Esta fase consolida o Reader no layout 1C e amplia os controles de leitura
sem alterar o formato persistido de documentos, anotações ou localização de
leitura.

Principais alterações:

- Novo menu de visualização na ilha superior, com ícone de páginas, para
  alternar uma página/duas páginas, capa e rolagem contínua.
- Controles de zoom por slider, `Ctrl` + `+`/`-`, pinça no touchpad e ajustes
  por tamanho real, página, largura, altura e conteúdo visível.
- `Ajustar conteúdo visível` mede o conteúdo renderizado em baixa resolução;
  quando a página não oferece margem confiável, mantém a página integral.
- O modo de leitura esconde as ilhas com animação suave, preserva a posição da
  página e disponibiliza uma ação explícita para sair.
- Tela cheia passou a usar a janela nativa do Tauri, com sincronização segura
  durante troca de documento, `F11` e `Escape`.
- O menu `Mais` foi removido da ilha superior; as ações do documento seguem
  disponíveis pelo menu de contexto do leitor.
- Spreads passaram a manter o progresso, a página ativa e a ordem das
  anotações corretamente.

Depuração e confiabilidade:

- Ajustes de zoom, animações, restauração de leitura e callbacks de render são
  cancelados quando o usuário interage para não sobrescrever sua posição.
- A análise de conteúdo visível é limitada em tamanho, evita alocações por
  pixel e invalida resultados de PDFs que já foram trocados.
- Ações de tela cheia são serializadas entre instâncias consecutivas do Reader.

Validação executada:

- `npm run typecheck`
- `npm test` — 23 arquivos e 311 testes aprovados
- `npm run build`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `git diff --check`
- Smoke test com `npm run tauri dev`

Observações:

- Não houve migration, dependência nova ou alteração no formato persistido.
- O build mantém o aviso preexistente sobre chunks maiores que 500 kB.
