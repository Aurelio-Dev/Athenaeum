# Ajuste de blur do LiquidGlass

## Status

Implementado em 29/08/2026 como parte das preferências globais de Aparência.
Este arquivo preserva as decisões do plano original e registra o contrato que
novos componentes devem seguir.

## Comportamento

- Nome na interface: **Desfoque do material Vidro**.
- Faixa: `0–100%`, passo de `1%`, padrão `100%`.
- O controle fica desabilitado no material Padrão, sem apagar o valor salvo.
- A aplicação visual acompanha o arraste; a persistência usa debounce de
  `250 ms` e descarrega o último valor ao desmontar.
- `100%` preserva o caminho visual e o custo gráfico históricos.
- `0%` remove o filtro de verdade, em vez de manter uma camada com `blur(0)`.

Conversão proporcional:

| Ajuste | Ações LiquidGlass | Superfícies ópticas |
| ---: | ---: | ---: |
| 0% | 0px | 0px |
| 50% | 6px | 8px |
| 100% | 12px | 16px |

A saturação continua independente. Reduzir o blur também reduz a retenção da
tinta das ações, de `100%` até `66,667%`, sem aplicar `opacity` ao elemento e
sem esmaecer texto, ícones ou foco.

## Persistência e sincronização

A chave `appearance_glass_blur` vive em `app_settings`; nenhuma migration foi
necessária. Ela faz parte do snapshot versionado de Aparência, junto de
destaque, contrastes e luz noturna.

`GlobalAppearancePreferencesProvider`, montado dentro de `ThemeProvider`, é a
fonte de estado para todas as WebViews. SQLite continua sendo a fonte de
verdade; `localStorage` é somente cache de bootstrap. Alterações confirmadas
são propagadas pelo evento discriminado
`app:appearance-preferences-changed`.

## Contrato extensível de backdrops

O CSS não mantém mais uma lista paralela de classes que podem filtrar. O
componente que realmente possui o backdrop declara um papel:

```tsx
data-glass-backdrop="optical"
data-glass-backdrop="action"
```

- `optical`: superfície que filtra o wallpaper quando ele está ativo e
  visível;
- `action`: ação LiquidGlass que pode filtrar mesmo sem wallpaper;
- superfícies aninhadas reutilizam o backdrop do ancestral e nunca empilham
  filtros;
- overlays `position: fixed` não contam como aninhados: eles são portaled para
  `document.body` e declaram o próprio papel, pois `backdrop-filter` transforma
  o ancestral em containing block;
- controles apenas pintados, inputs, previews e chrome imersivo não recebem o
  marcador;
- elementos condicionais só declaram o papel quando realmente geram a caixa.

Assim, uma superfície nova passa a responder ao slider ao declarar o papel no
próprio JSX. `glassBackdropMarkers.test.ts` mantém um inventário auditável e
reprova papéis desconhecidos, marcadores indevidos e novos donos não
revisados.

## Acoplamento com a visibilidade do wallpaper

O slider de visibilidade controla o scrim; o de blur controla o raio e, para
evitar uma superfície opaca sem difusão, também participa do alpha do scrim.
Para `v = visibilidade / 100` e `b = blur / 100`:

```text
alpha = 1 - v × (0,40 + 0,20 × (1 - b))
```

| Visibilidade | Blur 100% | Blur 50% | Blur 0% |
| ---: | ---: | ---: | ---: |
| 0% | 1,00 | 1,00 | 1,00 |
| 50% | 0,80 | 0,75 | 0,70 |
| 100% | 0,60 | 0,50 | 0,40 |

A imagem continua em alpha `1`; apenas a tinta protetora varia. O brilho do
wallpaper permanece outro eixo e continua aplicado somente à imagem.

## Estados CSS

- padrão `100%`: `data-glass-blur` e overrides neutros ausentes;
- `1–99%`: `data-glass-blur="adjusted"`;
- `0%`: `data-glass-blur="off"` e `backdrop-filter: none` nos donos;
- variáveis `--appearance-glass-*` são neutras no elemento raiz, mas só são
  consumidas sob `[data-material="glass"]`;
- os dois filtros mantêm paridade entre `-webkit-backdrop-filter` e
  `backdrop-filter`.

O material Padrão, conteúdo do Reader/Caderno/Quadro, previews, campos e
superfícies sem marcador permanecem fora do efeito.

## Cobertura

Os guards cobrem normalização, curvas `0/50/100`, persistência, cache,
sincronização entre janelas, debounce/flush, controle de Aparência, inventário
de donos, ausência de empilhamento, estado desligado e isolamento do material
Vidro. O guard estrutural foi exercitado por mutação negativa antes de ser
aceito.

Não houve alteração em Rust, schema ou dependências.
