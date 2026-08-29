# Plano de implementação — ajuste de blur do Liquid Glass

## Status

Planejamento concluído e implementação adiada.

## Objetivo

Adicionar um ajuste percentual de intensidade do blur limitado estritamente
aos filtros que já pertencem ao Liquid Glass. O material Padrão, conteúdos
imersivos, campos, previews e superfícies sem marcador devem permanecer
inalterados.

## Decisão inicial recomendada

Usar uma faixa de `0%` a `100%`, em que `100%` preserva exatamente o visual
atual. O ajuste permite reduzir o blur, mas não ultrapassa o custo gráfico já
validado.

Se o produto decidir permitir um blur mais forte que o atual, a faixa e os
limites de desempenho deverão ser redefinidos antes da implementação.

## Comportamento proposto

- Nome: **Intensidade do desfoque**.
- Descrição: **Ajuste o desfoque das superfícies do material Vidro.**
- Faixa: `0–100%`.
- Padrão: `100%`.
- Passo: `1%`.
- Controle desabilitado enquanto o material Padrão estiver selecionado.
- Aplicação visual imediata durante o arraste.
- Persistência com debounce de aproximadamente `250 ms`.

Conversão proposta:

| Ajuste | Ações Liquid Glass | Superfícies sobre wallpaper |
| ---: | ---: | ---: |
| 0% | 0px | 0px |
| 50% | 6px | 8px |
| 100% | 12px | 16px |

A saturação continua independente. Portanto, `0%` remove somente o desfoque
espacial, sem transformar o material Vidro em material Padrão.

## Plano de implementação

### 1. Criar o contrato persistido

Em `src/lib/database.ts`:

- adicionar a chave `glass_blur_intensity` em `app_settings`;
- definir mínimo `0`, máximo `100` e padrão `100`;
- criar normalização com arredondamento e limitação da faixa;
- criar `getGlassBlurIntensity` e `setGlassBlurIntensity`;
- persistir antes de emitir o evento entre janelas;
- validar valores inválidos ou produzidos por versões futuras.

Não é necessária migration, pois `app_settings` já é uma tabela chave-valor.

### 2. Sincronizar entre janelas

Criar um hook específico, sugerido como
`src/hooks/useGlassBlurPreference.ts`, e integrá-lo ao `ThemeProvider`.

O hook deverá:

- usar SQLite como fonte de verdade;
- manter um espelho em `localStorage` para evitar o primeiro frame com blur
  incorreto;
- escutar um novo evento global, por exemplo `app:glass-blur-changed`;
- proteger a leitura inicial contra eventos ou alterações locais mais recentes;
- atualizar imediatamente a janela de origem;
- aplicar debounce às gravações causadas pelo slider;
- concluir uma gravação pendente ao desmontar;
- expor `glassBlurIntensity` e `setGlassBlurIntensity` pelo `useTheme`.

Isso também cobre Reader, Caderno e painéis nativos porque todos passam pelo
`ThemeProvider`, embora atualmente essas janelas quase não tenham superfícies
filtráveis.

### 3. Aplicar os valores nos tokens existentes

Não criar novos seletores de `backdrop-filter`. O ajuste deverá substituir
somente os tokens existentes:

- `--glass-action-blur`, atualmente `12px`;
- `--glass-optical-blur`, atualmente `16px`.

O hook calculará os dois valores proporcionais e os aplicará como propriedades
CSS no elemento raiz somente quando `data-material="glass"` estiver ativo. Ao
entrar no material Padrão, removerá as propriedades inline.

Devem ser preservados sem ampliação de escopo:

- o filtro das ações primárias Liquid Glass;
- o filtro das superfícies translúcidas sobre o wallpaper;
- a restauração específica da ação no layout de ilhas;
- os resets `backdrop-filter: none` das superfícies aninhadas.

Os resets impedem que o wallpaper seja filtrado repetidamente e não devem ser
alterados para implementar a preferência.

### 4. Adicionar o controle em Aparência

Em `src/features/settings/AppearanceSettings.tsx`:

- criar um slider próprio para intensidade do desfoque;
- posicioná-lo próximo às opções de material, wallpaper e visibilidade;
- exibir o percentual atual;
- usar `aria-label` e `aria-valuetext`;
- desabilitar o slider no material Padrão, preservando o valor escolhido;
- restaurar para `100%` em **Restaurar padrões**;
- não condicionar o controle à existência de wallpaper, pois ações Liquid
  Glass já possuem blur mesmo sem imagem.

### 5. Preservar as interações existentes

Documentar e testar estes casos:

- material Padrão: nenhuma alteração visual, independentemente do valor salvo;
- Vidro sem wallpaper: o ajuste afeta somente alvos Liquid Glass que já possuem
  filtro, principalmente ações;
- Vidro com wallpaper visível: afeta sidebars, detalhes, cards, overlays e
  barra superior filtráveis;
- visibilidade do wallpaper em `0%`: o blur óptico das superfícies continua
  desativado, pois nenhum pixel do wallpaper atravessa o scrim; o blur das
  ações permanece independente;
- inputs, textareas, formulários, previews, frames imersivos e conteúdo de
  Reader, Caderno e Quadro permanecem fora.

### 6. Cobertura automatizada

Criar ou ampliar testes para verificar:

- normalização, persistência e emissão do novo evento;
- padrão `100%` na ausência da chave;
- restauração pelo cache antes da resposta do SQLite;
- reconciliação entre SQLite e cache;
- propagação entre janelas;
- debounce durante o arraste;
- conclusão do valor pendente;
- conversões `0/50/100% → 0/6/12px` e `0/8/16px`;
- remoção das propriedades CSS no material Padrão;
- slider desabilitado em Padrão e habilitado em Vidro;
- **Restaurar padrões** retornando a `100%`;
- ausência de seletores com blur fora de `[data-material="glass"]`;
- preservação dos resets para superfícies aninhadas.

O novo teste de isolamento deverá ser provado por mutação: remover
temporariamente o escopo `[data-material="glass"]` de um seletor filtrável,
confirmar que o teste falha com mensagem clara e restaurar o seletor.

### 7. Documentação e validação

Atualizar `docs/design/athenaeum-design-tokens-cores.md` com:

- chave persistida;
- faixa e curva;
- dois valores-base;
- relação com saturação e visibilidade do wallpaper;
- limites de aplicação;
- motivo de `100%` ser o máximo atual.

Validações previstas:

- `npm run typecheck`;
- testes específicos de banco, provider, Aparência e estilos;
- `npm test`;
- verificação manual exclusivamente com `npm run tauri:dev`;
- matriz claro/escuro × docado/ilhas × blur 0/50/100;
- confirmação visual de que o material Padrão não muda;
- teste de reinicialização e sincronização entre janelas;
- revisão do diff e do `git status`.

Não são previstos alteração Rust, migration ou instalação de dependências.
