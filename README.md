# Athenaeum

> Aplicativo desktop, offline-first e open source para organizar, ler,
> anotar e estudar PDFs e materiais acadêmicos. Roda 100% localmente —
> sem nuvem, sem conta, sem servidor remoto.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Status](https://img.shields.io/badge/status-em%20desenvolvimento-orange)

## Sobre

Athenaeum reúne, num único app de desktop, uma biblioteca pessoal de
PDFs, um leitor com anotações, cadernos de estudo com editor rico,
quadros visuais com canvas próprio baseado em Konva e configurações de aparência e
comportamento. Tudo é organizado por coleções, tags e busca local, e
persistido num banco SQLite no próprio computador — sem conta, nuvem ou
servidor remoto.

O projeto nasceu como estudo pessoal de Rust e Tauri, e está em
desenvolvimento ativo. APIs internas, schema do banco e UI ainda podem
mudar sem aviso.

## Principais funcionalidades

### Biblioteca

- Importação de um ou vários PDFs, com extração de metadados via pdf.js
- Coleções e tags de assunto (paleta fixa de cores, validada em WCAG AA)
- Estados de leitura, favoritos e lixeira com soft delete
- Visualização em grade ou lista
- Busca full-text (SQLite FTS5) em título, autores, fonte, coleção, tags e notas
- Painel de detalhes do documento

### Leitor

- Renderização de PDF embutida (pdf.js)
- Seleção de texto com destaques e comentários
- Notas livres associadas ao documento
- Navegação e painéis laterais (Anotações, Notas e IA)
- Visualização em uma ou duas páginas, rolagem contínua e exibição de capa
- Zoom por menu, slider, atalhos `Ctrl` + `+`/`-` e pinça no touchpad
- Ajustes de zoom por página, largura, altura e conteúdo visível
- Modo de leitura sem ilhas da interface e tela cheia nativa da janela
- A aba de IA é só um placeholder visual por enquanto — nenhuma integração real ainda

### Cadernos

- Múltiplas páginas por caderno, com editor rico baseado em `contenteditable`
- Títulos, listas, citações, links, blocos de código e tabelas
- Callouts, imagens persistidas localmente e anexos de arquivos
- Equações renderizadas com KaTeX
- Diagramas, grafos, grafos cíclicos e fluxogramas, com redimensionamento
  de figuras, equações e diagramas
- Tags, metadados e vinculação de PDFs ao caderno
- Modo foco, zoom e opções de espaçamento
- Exportação da página atual ou do caderno completo para HTML autocontido

A exportação HTML roda pelo lado Rust com escrita segura (arquivo
temporário + rename atômico, com backup em caso de falha) e pode
incorporar fontes e o CSS do KaTeX no próprio arquivo, para abrir offline
sem depender do app.

### Quadros

Quadros usam [Konva](https://konvajs.org/) com uma interface própria do
Athenaeum. Os arquivos permanecem armazenados localmente junto ao restante
dos dados do app.

### Ajustes

Preferências persistidas incluem tema claro e escuro, linhas divisórias
e variante do ícone do app.

## Status do projeto e limitações importantes

- Em desenvolvimento ativo; não é recomendado para uso em produção.
- A aba de IA no leitor é apenas visual, sem integração real.
- Schema do banco, formatos internos e UI podem mudar sem aviso entre versões.

## Stack

| Camada | Tecnologia |
| --- | --- |
| Shell desktop | Tauri 2 (Rust) |
| Frontend | React 18 + TypeScript + Tailwind CSS |
| Renderização de PDF | pdf.js |
| Banco de dados | SQLite (FTS5) via `tauri-plugin-sql` |
| Quadros | Konva + react-konva |
| Equações | KaTeX |
| Testes | Vitest |
| Build | Vite |

A stack é uma decisão fechada do projeto — sem troca de Tauri por Electron,
React por outro framework, ou SQLite por outro banco, sem necessidade
comprovada.

## Arquitetura

A maior parte das escritas no banco acontece direto do TypeScript, via
`tauri-plugin-sql`: cada ação do usuário vira um statement atômico, o que
o SQLite já garante sozinho. O lado Rust entra onde isso não basta —
transações reais com múltiplas tabelas, acesso a filesystem, diálogos
nativos e integração com o sistema operacional — porque confiabilidade e
consistência entre arquivo e banco têm prioridade sobre rapidez de
implementação. Exemplos:

- **Importação de documentos** (`import_document`) — grava coleção, tags,
  documento, autores e os vínculos entre eles numa única transação, e
  copia o PDF para o storage do app fora da transação, com a ordem das
  etapas pensada para nunca deixar arquivo órfão se algo falhar no meio
  do caminho.
- **Arquivos de Quadros** (`save_canvas_file` / `load_canvas_files`) —
  leitura e escrita dos arquivos binários dos Quadros no storage do app.
- **Imagens e anexos de Cadernos** (`save_notebook_asset`,
  `save_notebook_file_attachment`, `open_notebook_file_attachment`,
  `delete_notebook_file_attachment`) — imagens e anexos ficam no disco,
  referenciados por ID no HTML persistido.
- **Exportação HTML** (`write_notebook_export`) — grava o HTML exportado
  no destino escolhido pelo usuário.
- **Acesso ao sistema de arquivos do SO** (`select_pdf_file`,
  `read_pdf_file`, `open_file_location`, `open_external_url`) — diálogos
  nativos, leitura de bytes de PDF e abrir arquivos/URLs no SO.

O padrão de escrita segura usado pelos comandos que gravam arquivo e
registro de banco juntos é: escrever num arquivo temporário, finalizar
com flush, renomear para o destino final e só então gravar no banco —
limpando o temporário (ou o arquivo final) se qualquer etapa falhar
depois. Isso evita que uma interrupção deixe um arquivo parcialmente
escrito parecendo válido.

## Banco de dados e migrations

O registro das migrations fica em `src-tauri/src/lib.rs`, através de
`database_migrations()`. As primeiras migrations são literais SQL
embutidos no Rust; a partir da v9, o SQL vive em arquivos próprios sob
`src-tauri/migrations/` e é incluído via `include_str!`. O índice
`documents_fts` usa SQLite FTS5 e é mantido em sincronia por triggers.

Principais áreas do schema:

- documentos, autores, tags e coleções
- anotações
- cadernos e páginas
- assets e anexos de cadernos
- tags e PDFs vinculados aos cadernos
- quadros e seus arquivos
- configurações do aplicativo

## Pré-requisitos

- [Node.js](https://nodejs.org/) (LTS) + npm
- [Rust](https://www.rust-lang.org/tools/install) via `rustup` — versão mínima `1.77.2`
- Dependências de sistema do Tauri para o seu SO — veja o
  [guia oficial de pré-requisitos](https://v2.tauri.app/start/prerequisites/)
  (no Linux isso inclui `webkit2gtk-4.1`; no Windows, WebView2 e as
  Build Tools da Microsoft; no macOS, Xcode Command Line Tools)

## Como rodar

```bash
git clone https://github.com/Aurelio-Dev/Athenaeum.git
cd Athenaeum
npm install
npm run tauri dev
```

A primeira execução compila as dependências Rust — pode demorar alguns
minutos. As próximas são bem mais rápidas.

### Fontes

A UI usa Segoe UI. É uma fonte proprietária da Microsoft (licenciada só
para uso no Windows, sem redistribuição), então os arquivos `.ttf` **não**
ficam no repositório — `src/assets/fonts/*.ttf` está no `.gitignore`.

Em uma máquina Windows, copie os seguintes arquivos de `C:\Windows\Fonts`
para `src/assets/fonts/`, renomeando conforme a tabela:

| Origem (`C:\Windows\Fonts`) | Destino (`src/assets/fonts/`) |
| --- | --- |
| `segoeui.ttf` | `segoeui.ttf` |
| `segoeuii.ttf` | `segoeui-italic.ttf` |
| `seguisb.ttf` | `segoeui-semibold.ttf` |
| `segoeuib.ttf` | `segoeui-bold.ttf` |
| `segoeuiz.ttf` | `segoeui-bold-italic.ttf` |
| `seguibl.ttf` | `segoeui-black.ttf` |

Sem esses arquivos, o app roda normalmente e cai no fallback do CSS
(Inter, IBM Plex Sans, `system-ui`) — a UI funciona, só visualmente
diferente do Figma. Em Linux/macOS, onde a Segoe UI não existe, o
fallback é o comportamento esperado. Não adicione arquivos `.ttf` ao
repositório, com a exceção descrita abaixo.

A serifa é a Lora, usada nos títulos e no corpo do editor do Caderno. Ela
é OFL (licença em `src/assets/fonts/OFL.txt`), então **pode** ser
redistribuída e é a única fonte versionada — o `.gitignore` a libera por
exceção nominal:

| Arquivo (`src/assets/fonts/`) | O que cobre |
| --- | --- |
| `Lora-Variable.ttf` | Eixo `wght` 400–700, estilo normal |
| `Lora-Italic-Variable.ttf` | Eixo `wght` 400–700, itálico |

São fontes variáveis: dois arquivos cobrem Regular, Medium e Bold, além
do itálico real que o corpo serifado do editor exige. Ao trocá-las,
regenere `src/features/notebooks/notebookExportLoraFontCss.generated.ts`,
que embute a Lora em base64 para a exportação autocontida, e atualize as
exceções do `.gitignore`.

## Scripts e validações

| Comando | O que faz |
| --- | --- |
| `npm run tauri dev` | Sobe o app completo (frontend + shell Tauri) em modo desenvolvimento |
| `npm run tauri build` | Gera o binário/instalador de produção |
| `npm run dev` | Sobe só o frontend (Vite), sem a janela do Tauri |
| `npm run build` | Type-check (`tsc --noEmit`) + build do frontend |
| `npm run typecheck` | Roda só o type-check do TypeScript |
| `npm test` | Roda os testes com Vitest |
| `npm run preview` | Serve o build de produção do frontend localmente |

`npm run dev` sobe só o frontend (Vite) — sem os comandos nativos,
SQLite e acesso a filesystem que dependem do ambiente Tauri. Para
funcionalidade completa, use `npm run tauri dev`.

Os testes com Vitest cobrem, entre outras áreas, o parser de diagramas,
análise de grafos, escalas e dimensões de figuras, geração de SVG
estático e a exportação HTML (incluindo fontes, KaTeX e nomes de
arquivo exportados).

### Validação do lado Rust

```bash
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

## Estrutura do projeto

```text
src/
├── app/                  # Composição raiz do app
├── components/           # Componentes compartilhados (badges, painéis flutuantes, etc.)
├── features/
│   ├── library/          # Biblioteca: cards, importação, toolbar, detalhes
│   ├── reader/           # Leitor de PDF, anotações, painéis laterais
│   ├── notebooks/        # Cadernos: editor rico, páginas, exportação HTML
│   ├── canvases/         # Quadros com canvas Konva e interface própria
│   └── settings/         # Interface de configurações
├── lib/                  # Acesso ao SQLite e utilitários
├── styles/               # Design tokens e CSS global
└── types/                # Tipos compartilhados

src-tauri/
├── src/                  # Comandos Tauri e registro das migrations
├── migrations/           # Migrations SQL (a partir da v9)
├── capabilities/         # Permissões declaradas (fs, sql)
└── tauri.conf.json       # Configuração do app

docs/                     # Documentação de design e tokens
```

## Design e acessibilidade

A paleta de tags e badges de status foi desenhada para passar em WCAG AA
(contraste mínimo 4.5:1) mesmo em texto pequeno — veja
[`docs/design/athenaeum-design-tokens-cores.md`](docs/design/athenaeum-design-tokens-cores.md).
Cada palavra-chave de tag usa sempre a mesma cor em todas as telas;
Green, Slate e Red são reservados para badges de estado e nunca usados
como tag de assunto.

## Contribuindo

O projeto está em estágio inicial. Convenções que valem para qualquer
contribuição:

- Componentes React funcionais; sem `any` em TypeScript
- Composição em vez de herança; evitar abstrações prematuras
- Código legível por quem chega de fora, não só por quem já conhece o projeto
- Comentários em português quando o arquivo seguir esse padrão
- No lado Rust, comando novo só quando `tauri-plugin-sql` não for
  suficiente (ex.: precisar de uma transação multi-statement de verdade,
  acesso a filesystem ou coerência entre arquivo e banco)
- Operações simples de banco não devem gerar comandos Rust desnecessários

Issues e PRs são bem-vindos. Para mudanças maiores, abra uma issue
primeiro para alinhar a abordagem antes de implementar.

## Licença

[MIT](LICENSE) © 2026 Aurelio Ruotolo
