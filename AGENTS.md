# AGENTS.md — Athenaeum

## Projeto

Athenaeum é um aplicativo desktop open source para organização,
leitura e anotação de PDFs e materiais acadêmicos.

## Stack fixa

- Tauri
- Rust
- React
- TypeScript
- Tailwind CSS
- SQLite com FTS5
- pdf.js

Não substituir a stack nem sugerir Electron, Next.js, outro ORM ou
framework equivalente, salvo solicitação explícita.

## Prioridades de engenharia

Nesta ordem:

1. Confiabilidade
2. Performance
3. Baixo consumo de recursos
4. Velocidade de desenvolvimento

## Responsabilidades arquiteturais

### TypeScript

Usar preferencialmente para:

- interface;
- estado;
- editor;
- transformação de conteúdo;
- consultas e escritas simples;
- lógica que já possui implementação no frontend.

### Rust

Usar para:

- filesystem;
- validação e canonização de caminhos;
- leitura e escrita de arquivos binários;
- operações nativas;
- transações atômicas;
- coerência entre arquivo e banco;
- operações que exigem temp + rename.

Não duplicar em Rust parsers ou renderizadores que já possuem uma
fonte de verdade em TypeScript sem justificativa arquitetural.

## TypeScript e React

- Usar componentes funcionais.
- Não introduzir `any`.
- Preferir composição a herança.
- Usar nomes explícitos.
- Evitar abstrações prematuras.
- Preservar tipos discriminados e validações existentes.
- Não modificar comportamento fora do escopo solicitado.

## Rust

- Validar IDs e caminhos antes de acessar o filesystem.
- Não confiar em caminhos enviados pelo frontend.
- Preferir escrita em temporário e finalização segura.
- Limpar temporários em caso de erro.
- Preservar ordenação segura em operações de banco + filesystem.
- Explicar código Rust menos óbvio com comentários objetivos.

## Banco e migrations

- Não editar migrations já aplicadas.
- Criar migration nova somente quando houver mudança real de schema.
- Não criar migration para recursos somente de leitura.
- Verificar especialmente que migrations históricas permaneçam intactas.

## Cadernos

Ao trabalhar no editor de Cadernos, preservar salvo instrução explícita:

- autosave;
- seleção e range;
- HTML persistido;
- atributos `data-*`;
- compatibilidade com conteúdo legado;
- hidratação runtime;
- imagens e anexos em disco;
- equações;
- diagramas;
- callouts;
- tabelas;
- toolbars contextuais.

Não persistir no HTML:

- SVG gerado em runtime;
- base64 de assets;
- caminhos absolutos;
- controles temporários do editor.

## Assets e anexos

- Validar associação com Caderno e página.
- Não confiar somente no ID recebido pelo frontend.
- Não expor caminhos absolutos.
- Preservar nome e MIME type quando aplicável.
- Tratar arquivos ausentes explicitamente.
- Evitar carregar vários arquivos grandes simultaneamente em memória.

## Segurança

- Rejeitar path traversal.
- Sanitizar conteúdo exportado.
- Não inserir scripts ou handlers inline.
- Não ampliar allowlists sem justificativa.
- Não reduzir configurações de segurança para facilitar implementação.

## Fluxo de trabalho

Antes de alterar código:

1. Ler os arquivos relacionados.
2. Identificar a fonte de verdade existente.
3. Verificar alterações locais com `git status`.
4. Mapear arquivos que serão modificados.
5. Evitar mudanças fora do escopo.

Depois de alterar:

1. Revisar o diff.
2. Executar as validações adequadas.
3. Informar arquivos alterados.
4. Informar testes executados.
5. Declarar limitações e riscos restantes.

Nunca usar comandos destrutivos para descartar mudanças locais sem
autorização explícita.

## Comandos de validação

Frontend:

```bash
npm run typecheck
npm test
npm run build
```
