# Athenaeum

> Gerenciador de biblioteca pessoal de PDFs e artigos acadêmicos. Offline-first, open source, roda 100% localmente — sem nuvem, sem conta, sem servidor.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Status](https://img.shields.io/badge/status-em%20desenvolvimento-orange)

## Sobre

Athenaeum organiza PDFs e artigos acadêmicos: importação com extração de
metadados, leitura com anotações, tags de assunto com contraste validado
em WCAG AA, busca full-text e coleções — tudo num banco SQLite local.

O projeto nasceu como estudo pessoal de Rust e Tauri, e está em
desenvolvimento ativo. APIs internas, schema do banco e UI ainda podem
mudar sem aviso.

## Funcionalidades

**Biblioteca**
- Importação de PDF com extração de metadados via pdf.js
- Coleções e tags de assunto (paleta fixa de cores, validada em WCAG AA)
- Estados de leitura: não iniciado, em progresso, concluído
- Favoritos, notas por documento e lixeira (soft delete)
- Busca full-text (SQLite FTS5) em título, autores, fonte, coleção, tags e notas

**Leitor**
- Visualização de PDF embutida (pdf.js)
- Anotações: destacar trecho selecionado, com comentário opcional
- Painel lateral com abas de Anotações, Notas e IA
- Aba de IA é só um placeholder visual por enquanto — nenhuma integração real ainda

## Stack

| Camada | Tecnologia |
| --- | --- |
| Shell desktop | Tauri 2 (Rust) |
| Frontend | React 18 + TypeScript + Tailwind CSS |
| Renderização de PDF | pdf.js |
| Banco de dados | SQLite (FTS5) via `tauri-plugin-sql` |
| Build | Vite |

A stack é uma decisão fechada do projeto — sem troca de Tauri por Electron,
React por outro framework, ou SQLite por outro banco, sem necessidade
comprovada.

## Arquitetura

A maior parte das escritas no banco acontece direto do TypeScript, via
`tauri-plugin-sql`: cada ação do usuário vira um statement atômico, o que
o SQLite já garante sozinho. O lado Rust só entra onde isso não basta:

- **`import_document`** — grava coleção, tags, documento, autores e os
  vínculos entre eles numa única transação (`BEGIN...COMMIT`) na mesma
  conexão. Também copia o PDF para o storage do app fora da transação,
  com a ordem das etapas pensada para nunca deixar arquivo órfão (PDF
  copiado sem linha correspondente no banco) se algo falhar no meio do
  caminho.
- **`select_pdf_file` / `read_pdf_file` / `open_file_location`** —
  acesso ao sistema de arquivos do SO: diálogo nativo de escolha de
  arquivo, leitura de bytes do PDF e abrir a localização do arquivo no
  explorador do sistema.

O schema é versionado em migrations (`src-tauri/src/lib.rs`):
`collections`, `documents`, `document_authors`, `tags`, `document_tags`,
`documents_fts` (índice FTS5, mantido em sincronia por triggers) e
`annotations`.

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

### Scripts disponíveis

| Comando | O que faz |
| --- | --- |
| `npm run tauri dev` | Sobe o app completo (frontend + shell Tauri) em modo desenvolvimento |
| `npm run tauri build` | Gera o binário/instalador de produção |
| `npm run dev` | Sobe só o frontend (Vite), sem a janela do Tauri |
| `npm run build` | Type-check (`tsc --noEmit`) + build do frontend |
| `npm run typecheck` | Roda só o type-check do TypeScript |

## Estrutura do projeto

```
src/                      # Frontend React
├── app/                  # Composição raiz do app
├── components/           # Componentes compartilhados (badges, sidebar, etc.)
├── features/
│   ├── library/           # Biblioteca: cards, modal de importação, toolbar
│   └── reader/             # Leitor de PDF, anotações, painéis laterais
├── lib/database.ts         # Camada de acesso ao SQLite (via plugin-sql)
├── styles/                 # Design tokens e CSS global
└── types/                   # Tipos compartilhados (biblioteca, anotações)

src-tauri/                # Backend Rust / shell Tauri
├── src/lib.rs               # Comandos Tauri + migrations do banco
├── capabilities/             # Permissões declaradas (fs, sql)
└── tauri.conf.json           # Configuração do app

docs/design/               # Tokens de design extraídos do protótipo
```

## Design e acessibilidade

A paleta de tags e badges de status foi desenhada para passar em WCAG AA
(contraste mínimo 4.5:1) mesmo em texto pequeno de 12-13px — veja
[`docs/design/design-tokens.md`](docs/design/design-tokens.md). Cada
palavra-chave de tag usa sempre a mesma cor em todas as telas; Green,
Slate e Red são reservados para badges de estado e nunca usados como tag
de assunto.

## Contribuindo

O projeto está em estágio inicial. Convenções que valem para qualquer
contribuição:

- Componentes React funcionais; sem `any` em TypeScript
- Composição em vez de herança
- Evitar abstrações prematuras — o código deve ser legível por quem chega
  de fora, não só por quem já conhece o projeto
- No lado Rust, comando novo só quando `tauri-plugin-sql` não for
  suficiente (ex.: precisar de uma transação multi-statement de verdade)

Issues e PRs são bem-vindos. Para mudanças maiores, abra uma issue
primeiro para alinhar a abordagem antes de implementar.

## Licença

[MIT](LICENSE) © 2026 Aurelio Ruotolo
