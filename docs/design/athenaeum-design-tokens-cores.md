# Athenaeum — Tokens de Cor (Tags, Badges, Texto Secundário)

> **Changelog 25/08/2026 — Gramática óptica do Liquid Glass refinada na
> Library. Flat e glass sem wallpaper permanecem idênticos aos baselines
> `c01c1e9` e `869952d`.**
>
> A referência visual foi traduzida em quatro sinais que o WebView2 consegue
> compor de forma previsível: tinta translúcida, blur com saturação, aresta
> especular direcional e profundidade por sombras inset/externa. O azul ou
> qualquer outra dominante vem exclusivamente do wallpaper; não há token de
> cor que pinte o vidro de azul. Refração óptica real não foi simulada porque
> exigiria shader ou cópias deslocadas do backdrop, com custo e artefatos
> desproporcionais para a Library.
>
> A referência é um card único sobre uma foto desfocada de campo simples — o
> cenário mais favorável possível para vidro. A Library distribui sidebar,
> grade, painel Detalhes e menus sobre o mesmo fundo; por isso o efeito final é
> deliberadamente mais discreto. Essa diferença pertence ao layout, não à
> implementação: não se aumenta blur nem se reduz o scrim para perseguir o
> mock.
>
> A gramática óptica separa tinta (`--glass-optical-tint*`), reflexo da aresta
> no topo/esquerda (`--glass-optical-edge-specular*`), sombra da aresta no
> fundo/direita (`--glass-optical-edge-shadow`), glow interno
> (`--glass-optical-inner-glow*`), sombra externa
> (`--glass-optical-outer-shadow*`), blur (`--glass-optical-blur`) e saturação
> (`--glass-optical-saturation`). Os nomes descrevem o papel óptico; cards,
> overlays e faixas apenas compõem esses papéis em intensidades adequadas à
> elevação.
>
> As arestas usam dois backgrounds (`padding-box` para a tinta e `border-box`
> para o gradiente especular). Assim os cantos arredondados recebem luz no
> topo/esquerda e sombra no fundo/direita sem pseudo-elemento e sem uma camada
> de composição adicional. Raios, posição e espaçamento continuam sendo
> definidos pelos componentes: material altera somente pintura.
>
> A cobertura passa a incluir a faixa superior da Library, cards de Caderno e
> Quadro, o `ContextMenu` compartilhado, o menu de coleção da sidebar e os
> dropdowns de tags. Controles dentro de uma superfície já filtrada recebem
> tinta, borda e reflexo, mas nunca outro `backdrop-filter`. Overlays aninhados
> também reutilizam o backdrop já composto pelo ancestral. Inputs, textarea,
> preview de PDF, capas, conteúdo de Caderno/Quadro/Reader e os frames
> imersivos continuam opacos e fora desta leva.
>
> O filtro é `blur(16px) saturate(1.18)` no claro e
> `blur(16px) saturate(1.16)` no escuro. Blur e saturação são tokens
> independentes; não há ajuste de brilho fundido ao filtro. Ele só casa com
> `data-wallpaper-translucent="true"`: no slider 0 o scrim está em alpha 1 e
> o filtro é removido, evitando composição sem pixel visível. O piso do scrim
> permanece 0,60 e a dívida de contraste registrada abaixo não foi ampliada
> por uma nova curva.
>
> ### Medição de composição no perfil `.dev`
>
> Percurso contínuo de 8 segundos (topo → fundo → topo, 815 px), com janelas
> móveis de 1 segundo, em uma coleção com 12 documentos, 4 cadernos e 4
> quadros. O mesmo percurso foi executado com slider 0 e slider 50:
>
> | Execução | Slider 0 — sem filtro | Slider 50 — filtro ativo |
> | --- | --- | --- |
> | primeira passagem | mínimo sustentado **48 FPS**; **3** frames >20 ms; máximo 183,4 ms | mínimo sustentado **56 FPS**; **2** frames >20 ms; máximo 83,0 ms |
> | passagem aquecida | mínimo sustentado **56 FPS**; **2** frames >20 ms; máximo 66,4 ms | mínimo sustentado **59 FPS**; **1** frame >20 ms; máximo 33,3 ms |
>
> O caminho com filtro permaneceu acima do piso de 55 FPS nas duas passagens
> e não aumentou a contagem de frames longos. Portanto, nesta medição, não há
> evidência para acionar a alternativa de blur compartilhado da grade nem o
> pré-blur estático da imagem.
>
> A validação visual percorreu claro/escuro × flat/glass × wallpaper
> claro/escuro. Hover foi produzido por `Input.dispatchMouseEvent`, foco por
> Tab e seleção por Enter. Cards de Documento, Caderno e Quadro, faixa docada,
> busca/segmentado, `ContextMenu`, menu de ordenação, menu da Sidebar e tags
> foram verificados em repouso, hover, foco e estado ativo/selecionado quando o
> componente oferece esse estado. O ring selecionado permaneceu visível também
> durante hover; preview e textarea ficaram opacos; menus aninhados ficaram sem
> segundo filtro. Em flat, as capturas com wallpaper claro e escuro foram
> byte-idênticas dentro de cada tema.
>
> Marcadores `material-liquid-*` não possuem regra fora da conjunção
> `[data-material="glass"][data-wallpaper="active"]`. Eles existem para
> ampliar a cobertura sem mudar o glass sem imagem já aprovado. A família
> histórica `material-surface-*` continua sendo a fonte dos papéis que já
> existiam antes do wallpaper.

> **Changelog 20/08/2026 — Wallpaper visível atrás das superfícies glass. O
> material flat e o glass sem imagem permanecem idênticos.**
>
> A imagem persistida em `wallpaper_file` é resolvida exclusivamente pelo
> comando Rust `resolve_wallpaper_path`, convertida para o protocolo `asset://`
> e pintada uma única vez no fundo da janela com `background-size: cover`.
> Nenhum caminho absoluto é persistido ou transportado por evento entre
> janelas. A camada só é consumida sob a conjunção
> `[data-material="glass"][data-wallpaper="active"]`; em flat ela não pinta
> nenhum pixel.
>
> ### Curva do slider: alpha do scrim, não da imagem
>
> `wallpaper_opacity` continua exposto como visibilidade da imagem (0–100), mas
> o valor aplicado é o alpha da tinta de `--glass-surface` e
> `--glass-surface-elevated`. A imagem permanece sempre em alpha 1. A curva é
> linear:
>
> `alpha do scrim = 1 − (slider / 100 × 0,40)`
>
> | Slider | Alpha do scrim | Resultado |
> | --- | --- | --- |
> | 0 | **1,00** | superfície totalmente opaca; imagem invisível |
> | 50 (padrão) | **0,80** | equilíbrio inicial |
> | 100 | **0,60** | maior visibilidade permitida |
>
> O piso de 0,60 evita remover toda a proteção do texto. As superfícies usam
> `backdrop-filter: blur(12px)` somente quando o wallpaper está ativo. O trio
> `--glass-immersive-*` não recebe alpha nem blur: continua sendo chrome opaco
> sobre conteúdo do usuário.
>
> ### ⚠️ Dívida de contraste deliberada e aceita
>
> Por decisão de produto, o slider é livre e não mostra aviso, não bloqueia
> combinações e não mede a imagem. Portanto, certos pares podem ficar abaixo de
> WCAG AA. Medições registradas para as piores combinações:
>
> | Cenário | Scrim necessário para AA |
> | --- | --- |
> | tema claro, texto `#756154`, scrim `#F7F0E8`, imagem escura | passa só a partir de **95%** |
> | tema escuro, texto `#9E8878`, scrim `#292521`, imagem clara | passa só a **100%** |
> | tema claro com imagem clara | passa desde **60%** (**5,43:1**) |
> | tema escuro com imagem escura | passa desde **60%** (**5,35:1**) |
>
> Esses percentuais são alpha do scrim, não posição do slider — os eixos são
> inversos. A liberdade do controle, inclusive nos estados não conformes, é
> intencional e não deve ganhar aviso ou trava sem nova decisão de produto.

> **Changelog 18/08/2026 — REGRESSÃO CORRIGIDA: o material engolia o estado
> de seleção do card. Regra nova: o material governa o REPOUSO, o estado
> governa o resto.**
>
> `[data-material="glass"] .material-surface-card` declarava `border-color` e
> `box-shadow` **inteiros**, em especificidade (0,2,0). As classes de estado
> do Tailwind (`border-primary ring-2 ring-primary-soft`) são (0,1,0). Sob
> glass, um card selecionado ficava com a **borda pálida do material e sem
> anel** — indistinguível de um não selecionado, com `aria-pressed="true"` e
> as classes corretas presentes no DOM o tempo todo.
>
> ### Por que passou
>
> O teste manual da leva que introduziu isso cobria quatro combinações de
> modo × material — **todas com o card em repouso**. O estado selecionado não
> estava na lista. Uma matriz de materiais não encontra um bug de estado.
>
> ### A correção é de ALCANCE, não de especificidade
>
> ```css
> /* material puro: vale nos dois estados */
> [data-material="glass"] .material-surface-card { background: … }
>
> /* repouso: NAO casa com o selecionado */
> [data-material="glass"] .material-surface-card:not([aria-pressed="true"]) { … }
>
> /* selecionado: sem border-color, para o accent do JSX valer */
> [data-material="glass"] .material-surface-card[aria-pressed="true"] { … }
> ```
>
> A regra de repouso simplesmente **não casa** com o card selecionado, então
> a borda de accent volta a valer sozinha. Sem `!important` e sem escalar
> especificidade — travado por teste, inclusive a ausência de `!important`
> em qualquer regra de material.
>
> ⚠️ **Acoplamento registrado:** a regra do selecionado **repete** o anel
> (`0 0 0 2px var(--color-primary-soft)`) porque `box-shadow` é uma
> propriedade só — não dá para o material contribuir a sombra e o Tailwind o
> anel na mesma declaração. Se o JSX trocar `ring-2` por outra largura, o
> glass fica para trás em silêncio. Há um teste que lê o JSX e acusa.
>
> ### Os outros estados, medidos no DOM
>
> | Estado | Afetado pelo material? | Medição |
> | --- | --- | --- |
> | repouso | sim, por projeto | é o que o material pinta |
> | **selecionado** | **sim — era a regressão** | corrigido |
> | hover (real, `Input.dispatchMouseEvent`) | **não** | só `transform: translateY(-4px)`; nenhuma regra de material toca isso |
> | foco por teclado | **não** | `outline: auto` do navegador, idêntico em flat e glass — `outline` é propriedade separada de `box-shadow` |
> | arrastar | **não existe** | o card não tem `draggable` nem handler de drag (só `AddDocumentModal` e `DocumentPreview` têm) |
>
> Verificado nas quatro combinações modo × material: os quatro estados se
> comportam de forma **idêntica** em flat e glass. Flat conferido por
> SHA-256 do PNG — os quatro estados de grade/lista × claro/escuro seguem
> byte-idênticos.
>
> **Nota de projeto, não corrigida aqui:** o anel de seleção
> (`--color-primary-soft` = `var(--muted)`) é intrinsecamente fraco nos dois
> materiais — ΔL\* ~1.1 contra o fundo no glass claro e ~2.6 no flat. Quem
> sinaliza a seleção é a **borda de accent**; o anel é halo. Restaurei a
> paridade com o flat, sem redesenhar o anel.

> **Changelog 18/08/2026 — `--glass-border` passa a ler como aresta, não
> como vão. Consequência de a Leva 4 ter recuado o fundo sem reavaliar a
> borda.**
>
> ### A métrica é o SINAL do ΔL\*, não o módulo
>
> Uma borda separa duas superfícies: a de **fora** (o fundo da página) e a
> de **dentro** (a capa, nos ~2/3 de cima do card; o próprio card, no terço
> de baixo). Para ler como **aresta** no tema claro, ela tem de ser mais
> **escura** que as duas. Se ficar mais clara, lê como **fresta** — e é
> exatamente a mesma distância em módulo. Por isso o ΔL\* aqui é usado
> **com sinal**; a versão sem sinal (usada para separação de camadas) não
> responde a esta pergunta.
>
> A borda nasceu certa e só ficou errada quando a Leva 4 recuou
> `--glass-surface-app` para `#EDE2D4` sem reavaliar a borda.
>
> ### Claro: 0.08 → 0.20
>
> | | Composto sobre o card | vs fundo `#EDE2D4` | vs capa (pior hue) |
> | --- | --- | --- | --- |
> | antes `rgb(44 26 16 / 0.08)` | `#EEEBE7` | **+2.8** (mais clara) ❌ | **+4.3** (mais clara) ❌ |
> | depois `rgb(44 26 16 / 0.20)` | `#D5D0CB` | **−6.8** (mais escura) ✅ | **−2.6** (mais escura) ✅ |
>
> Verificado que fica mais escura que a capa em **todos os 360 hues**, não
> só no pior caso — o hue é determinístico por documento.
>
> ### Escuro: preto não resolve, então a borda é de LUZ
>
> O fundo escuro (`#120E0C`) já está perto do preto: `rgb(0 0 0 / 0.35)`
> composto sobre o card dá `#1B1815`, que **ainda é +4.2 mais claro que o
> fundo**. Não há para onde descer. Por isso o escuro inverte a estratégia:
>
> `--glass-border` escuro passa a **`rgb(255 255 255 / 0.10)`** = `#3E3B37`
> — **+20.8** do fundo e **+10.0** do card. A aresta é lida pelo lado claro,
> que é o idioma normal de vidro em tema escuro.
>
> ### Efeito de canto — medido, não corrigido
>
> A capa tem `border-radius: 0` dentro de um card de raio 12px, então o
> fundo do card aparece na curva. Medido por amostragem de pixel na
> diagonal do canto: a transição é de **1px**, e a borda nova a **alivia** —
> o pixel de transição sai de `#EDE9E6` (mais claro que o fundo, somando-se
> à fresta) para `#E1DCD9` (praticamente colado na capa, `#E0DBD7`). Sem
> correção nesta leva, como pedido.
>
> ### Divergências do brief, reportadas
>
> Os números que decidem a mudança conferem exatos (+2.8 / −6.8 / +4.2, e
> `#EEEBE7` / `#D5D0CB`). Dois números de **contexto** não reproduzem:
>
> - o brief cita **+5.5** para a borda antiga vs capa; o **pior hue** dá
>   +4.3 e a **média de hue** dá +5.6 — a diferença é a estatística usada,
>   não o cálculo;
> - o brief afirma que em flat a borda `#D9CBBF` está a "−7.9 e −5.2, mais
>   escura que ambas". Medido: **−11.6** contra o fundo `#F5EDE4`, e
>   **+5.8 em média** (pior hue **+0.1**) contra a capa flat
>   `hsl(hue 28% 74%)` — ou seja, no flat a borda é **mais clara** que a
>   capa, não mais escura. O flat não foi tocado; o registro fica para que
>   a premissa não seja reaproveitada como fato.

> **Changelog 18/08/2026 — Capas de documento clareadas no glass CLARO
> (follow-up de 7631155). Só o claro; o escuro não muda.**
>
> Julgamento visual, não métrica: mesmo com a saturação já em 12%
> (entrada abaixo), a capa continuava dominando a tela no glass claro. A
> causa não era cor — era **área**: a capa ocupa ~2/3 do card. Correção:
> clarear, mantendo hue e saturação intocados.
>
> **1. `--document-cover-swatch`** sobe de 74% para **86%** de luminosidade
> sob glass claro. Os três hexes do brief conferem exatos, confirmados por
> varredura completa de hue (não por um palpite pontual):
>
> | Hue | Hex |
> | --- | --- |
> | verde (~90°) | `#DBE0D7` ✅ |
> | roxo (~275°) | `#DCD7E0` ✅ |
> | terracota (~28°) | `#E0DBD7` ✅ |
>
> **2. As linhas internas** (que imitam texto na miniatura) quase somem com
> o alpha antigo de 0.24 contra a capa mais clara. Medido no **pior caso ao
> longo de todo o hue** (0–359°, já que `--document-cover-hue` é por
> documento — um número pontual não garante a regra para todo documento):
>
> | | Alpha | Contraste (pior hue) |
> | --- | --- | --- |
> | `--document-cover-line` | 0.24 → **0.40** | 1.36:1 → **1.70:1** |
> | `--document-cover-line-strong` | 0.34 → **0.57** | 1.63:1 → **2.39:1** |
>
> ⚠️ Os números medidos divergem levemente dos citados no brief (1.34/~1.65):
> o pior caso medido sobre a capa nova é 1.36–1.70, não 1.34/1.65. A
> diferença é pequena (≤0.05) e não muda a decisão — reportado por
> disciplina de verificação, não porque algo estivesse errado.
>
> `0.57` preserva a razão original entre as duas linhas (0.34/0.24 = 1.4167)
> a 0.008 de distância — a proporção de 2 casas decimais que o resto do
> arquivo usa.
>
> **3. Distinção capa × card**, verificada contra `#F7F0E8` (parada mais
> escura de `--glass-surface-elevated` claro), também no pior caso de hue:
> **1.18:1** — acima do mínimo de 1.15:1 pedido, com margem de 0.03.
>
> **Isolamento.** As três mudanças vivem só em
> `[data-material="glass"] .document-cover-*` (sem `.dark`). O par
> `.dark[data-material="glass"] .document-cover-*` **não foi tocado** —
> confirmado por teste e por captura de tela. `glassPalette.test.ts` ganhou
> um describe dedicado com os três itens, mais um guard de escopo para os
> valores novos (86%, alpha 0.40/0.57) e um guard explícito de que o glass
> escuro continua nos três valores herdados. Sete mutações confirmadas.
>
> Verificado por captura: os quatro estados de flat (grade/lista × claro/
> escuro) têm o **mesmo SHA-256** de antes desta leva.
> O glass estava aplicado (entrada abaixo) mas **não lia como vidro**: com o
> fundo do flat, a distância entre o fundo e a parada escura de
> `--glass-surface` era de **ΔL\* 0.3** no claro — indistinguível. Vidro sem
> camada separada é só uma superfície clara.
>
> ### ΔL\* é a métrica de camada; contraste WCAG é a de texto
>
> **São perguntas diferentes, e a segunda não responde a primeira.** WCAG
> responde "dá para LER este texto sobre este fundo" e é uma razão entre
> luminâncias relativas. Entre dois cremes vizinhos essa razão fica ~1.0 e
> não diz nada sobre se as duas camadas se distinguem — 1.0 é o valor tanto
> para "iguais" quanto para "quase iguais". Separação de camada é percepção
> de **luminosidade**, e a escala perceptualmente uniforme para isso é o L\*
> do CIELAB. Por isso os alvos desta leva são ΔL\*, não razões de contraste.
>
> Usar contraste WCAG para julgar camadas foi o que deixou o problema passar
> na leva anterior: os quatro números de legibilidade estavam certos e
> validados, e mesmo assim o vidro não aparecia.
>
> ### 1. Fundo estratificado
>
> Token novo `--glass-surface-app`: `#EDE2D4` no claro, `#120E0C` no escuro.
> `--background` **não muda** — o que muda, e só dentro do seletor de
> material, é o alias `--color-surface-app`, que `body`, as 14 utilitárias
> `bg-surface-app` e a borda do polegar da barra de rolagem já liam. Trocar
> só o `body` abriria costura visível contra as áreas pintadas pela
> utilitária.
>
> | ΔL\* do fundo até… | Claro | Escuro |
> | --- | --- | --- |
> | `--glass-surface`, parada clara | 8.0 | 9.4 |
> | `--glass-surface`, parada escura | 3.4 | 4.4 |
> | `--glass-surface-elevated`, parada clara | 9.0 | 10.7 |
> | `--glass-surface-elevated`, parada escura | 4.7 | 6.4 |
>
> As duas superfícies de vidro **não foram tocadas**: já estavam validadas.
>
> ### 2. Texto secundário próprio do glass claro
>
> Com o fundo em `#EDE2D4`, o `#7A6558` do flat cai a **4.29:1**. Token novo
> `--glass-text-secondary`, derivado em HSL do próprio `#7A6558` escurecendo
> só a luminosidade — **não** por `color-mix`, que dessatura (regra
> estabelecida).
>
> ⚠️ **CORRIGIDO no mesmo dia (follow-up):** a primeira versão fechava em
> `#766255` — **4.500:1** sobre `#EDE2D4`, margem de **0.003**. Era o menor
> escurecimento que fechava 4.5:1, literal à regra de derivação, mas
> qualquer clareada futura quebraria AA. Trocado para **`#756154`**, com
> folga real:
>
> | Sobre | Contraste |
> | --- | --- |
> | `#EDE2D4` (fundo) | **4.57:1** ✅ |
> | `#F4ECE3` (surface, parada escura) | 5.00:1 ✅ |
> | `#F7F0E8` (elevated, parada escura) | 5.17:1 ✅ |
>
> Hue 23.6° (origem 22.9°, Δ 0.70°) e saturação 0.164 (origem 0.162, Δ
> 0.002): dentro das tolerâncias de 4° e 0.02. `glassPalette.test.ts` lê o
> hex do CSS (não repete o valor), então a exigência de margem passou a
> estar travada nos números exatos, não só no limiar ≥4.5:1.
>
> O **escuro não recebe token próprio**: `#9E8878` dá **5.71:1** sobre
> `#120E0C`. Um token escuro aqui seria cópia do valor de flat esperando
> divergir. Por isso o bloco usa `[data-material="glass"]:not(.dark)` em vez
> do par `[data-material="glass"]` / `.dark[data-material="glass"]` do resto
> do arquivo — assim o escuro simplesmente não é tocado.
>
> `--color-sidebar-muted` **não** entra: vive sobre `--glass-surface`
> (4.69:1 com o tom do flat, passa) e sobre `--color-sidebar-raised`, que não
> está entre as superfícies para as quais este tom foi derivado.
>
> ### 3. Capas — papel tingido
>
> Sob glass, a saturação das capas cai de 28%/30% para **12%**; hue e
> luminosidade ficam. O hue continua determinístico por documento
> (`deriveCoverHue`), então a distinção entre documentos é **exatamente a
> mesma** — muda a intensidade, não a identidade. Medido na tela: saturação
> 0.121 nos dois temas.
>
> Armadilha registrada: `[data-material="glass"] .document-cover-*` empata em
> especificidade com `.dark .document-cover-*` (0,2,0) e vem depois, então
> venceria também no escuro e aplicaria luminosidade de tema claro ali. O par
> `.dark[data-material="glass"]` (0,3,0) é **obrigatório**, e as duas regras
> de linha que ele repete não são duplicação a limpar.
>
> ### Isolamento — a invariante principal
>
> O tema padrão está fechado e aprovado depois de uma reversão inteira.
> `glassPalette.test.ts` trava o inventário **completo** dos 207 tokens de
> `:root` e `.dark` por impressão digital, além de checar que nenhum token
> `--glass-*` é declarado fora do escopo de material. Sete mutações
> confirmadas, nas duas direções.
>
> Verificado também por captura: os seis estados de flat (grade, lista e
> modal × dois temas) têm o **mesmo SHA-256** de antes desta leva. Os dois
> modais só bateram depois de desfocar o campo de nome — o anel de autofoco
> pinta de forma assíncrona e a captura pegava a corrida, não uma diferença
> de estilo.

> **Changelog 18/08/2026 — Os 7 tokens `--glass-*` deixam de ser órfãos: a
> Library é o primeiro consumidor amplo.**
>
> Órfãos desde a reversão de 16/08 (entrada mais abaixo), com destino já
> previsto. O destino se cumpriu: as superfícies da Library passam a
> consumir os sete sob `[data-material="glass"]`.
>
> **Arquitetura — quatro classes marcadoras, por PAPEL e não por
> componente.** Mesmo padrão do chrome flutuante do Reader: as classes não
> têm estilo próprio em lugar nenhum do CSS, então o material flat continua
> byte-idêntico. Verificado por captura de tela: o PNG do flat depois desta
> leva tem o **mesmo SHA-256** do PNG do mesmo estado antes dela.
>
> | Classe | Superfície | Borda topo | Sombra | Onde |
> | --- | --- | --- | --- | --- |
> | `.material-surface` | `--glass-surface` | `--glass-border-top` | — | sidebar |
> | `.material-surface-elevated` | `--glass-surface-elevated` | `--glass-border-top-elevated` | — | container da lista, painel Detalhes docado, controles da toolbar |
> | `.material-surface-card` | `--glass-surface-elevated` | `--glass-border-top-elevated` | `--glass-shadow` | card da grade |
> | `.material-surface-overlay` | `--glass-surface-elevated` | `--glass-border-top-elevated` | `--glass-shadow-elevated` | modais, menu de ordenação |
>
> Todas usam `--glass-border` como `border-color`. `surface-app` (a raiz)
> **não participa**: é fundo, não superfície de vidro — se virasse
> gradiente, as superfícies acima perderiam o plano contra o qual se
> destacam.
>
> **REGRA: a sombra glass entra só onde já existe sombra no flat.** Glass é
> acabamento de superfície, não licença para flutuar (changelog 15/07): a
> Library é workspace docado e continua docada. Adicionar sombra a um painel
> hoje docado é exatamente o que o faria ler como flutuante, então sidebar,
> container da lista, painel Detalhes docado e controles da toolbar recebem
> superfície e borda e seguem **sem sombra**. As duas sombras ficam
> distribuídas por peso: `--glass-shadow` (0 8px 24px) no card, que já
> flutuava pouco via `shadow-card`, e `--glass-shadow-elevated` (0 16px
> 40px) no que realmente paira. Nenhum seletor desta leva toca margem, raio
> de canto ou posição.
>
> **Contraste — confirmado, não recalculado** (pior parada de cada
> gradiente: a mais escura no claro, a mais clara no escuro):
>
> | Superfície | Pior parada | `--muted-foreground` |
> | --- | --- | --- |
> | `--glass-surface` claro | `#F4ECE3` | 4.69:1 ✅ |
> | `--glass-surface-elevated` claro | `#F7F0E8` | 4.85:1 ✅ |
> | `--glass-surface` escuro | `#262220` | 4.69:1 ✅ |
> | `--glass-surface-elevated` escuro | `#292521` | 4.52:1 ✅ |
>
> ⚠️ **Uma dívida aceita muda de número sob glass — reportado, não
> ajustado.** O texto secundário da sidebar fica em **4.39:1** no flat
> (abaixo de AA, dívida registrada na entrada da reversão) e em
> **4.69–5.27:1** no glass, porque a superfície de vidro é mais clara que
> `#EDE5DA`. O glass não corrige a dívida: ela continua inteira no material
> padrão, e nada foi mexido para produzir isso. O chip de hover
> (`--color-sidebar-raised`, 3.47:1) é opaco e **não** muda nos dois
> materiais — medido nos dois. As demais dívidas (`--muted`/`--input` em
> 4.39:1, borda de input em 1.27:1) também não mudam: essas superfícies não
> estão mapeadas e seguem chapadas por cima do vidro.
>
> Travado por `materialGlassSurfaces.test.ts`, que verifica os dois lados do
> contrato — nenhuma regra `.material-surface*` fora do escopo glass, e cada
> papel com o seu token. Confirmado por mutação nas duas frentes.

> **Changelog 18/08/2026 — REVERSÃO: o tema padrão volta aos valores
> aprovados. As quatro entradas de correção de contraste abaixo saem do
> código e ficam como registro histórico.**
>
> Decisão do dono do projeto. As correções de contraste de 17/08 foram
> **escopo excedente**: nasceram como desdobramento do trabalho de material
> glass, mas **o glass nunca dependeu delas** — `#7A6558` sobre `#F4ECE3`
> (a superfície glass mais escura do tema claro) dá **4.69:1** e passa AA
> por conta própria. Verificado nesta leva. O tema padrão volta ao estado
> aprovado visualmente.
>
> **Revertidos:** `2e7c4fd`, `117fd79`, `d552111`, `eac4ef6`, `4f24534` —
> os cinco reverteram sem conflito. A auditoria doc↔código (`840478b`)
> **não** foi revertida: continua valendo integralmente, incluindo as
> correções de `accent-icon-amber`, `icon_variant`, `surface-header`, o
> duplo sistema de mapeamento palavra-chave→cor, e a estrutura de tabela
> completa por superfície desta página — que é a lição durável da leva e
> sobreviveu à reversão do código que a originou.
>
> **Estado restaurado:** `--muted-foreground` volta a `#7A6558`;
> `--color-sidebar-muted` volta ao `color-mix` de `--color-sidebar-text`
> nos níveis 90/110; a escada volta a **90/100/110**;
> `--color-border-strong` volta a alias de `--border`;
> `--color-border-muted` volta a existir; os 190 usos voltam às classes
> originais.
>
> ### ⚠️ Dívida conhecida e ACEITA
>
> As violações abaixo voltam ao produto **por decisão de produto**, não por
> descuido. Todas remedidas e conferidas nesta leva (a implementação de
> `color-mix` foi validada contra o motor do WebView2 do próprio app):
>
> | Token × superfície | Medido | Mínimo | Regra |
> | --- | --- | --- | --- |
> | `#7A6558` sobre `--sidebar`/`--muted`/`--input` (`#EDE5DA`) | **4.39:1** | 4.5:1 | 1.4.3 AA |
> | `#7A6558` sobre `--color-sidebar-raised` (`#D8CCBD`) | **3.47:1** | 4.5:1 | 1.4.3 AA |
> | nível 90 da escada, tema claro | **2.18–3.18:1** | 4.5:1 | 1.4.3 AA |
> | nível 90 da escada, tema escuro | **3.50–4.24:1** | 4.5:1 | 1.4.3 AA |
> | nível 110 sobre `--color-sidebar-raised` | **4.35:1** | 4.5:1 | 1.4.3 AA |
> | `--color-sidebar-muted` nível 90 sobre `--sidebar` | **2.65:1** (claro) / **3.80:1** (escuro) | 4.5:1 | 1.4.3 AA |
> | `--border` sobre `--input`/`--muted` | **1.27:1** (claro) / **1.21:1** (escuro) | 3:1 | 1.4.11 |
> | `--border` sobre `--card` e `--background` | **1.29–1.46:1** | 3:1 | 1.4.11 |
>
> Nenhuma combinação de borda alcança 3:1 — a melhor fica em 1.46:1. O
> nível 90 continua sendo um controle de contraste cujo mínimo reduz
> contraste abaixo do legível; isso é conhecido e aceito.
>
> **Correção de um número desta própria página:** a entrada de 17/08
> (manhã) afirmava que o nível 90 derrubava as superfícies para
> "2.95:1–3.74:1". O intervalo medido é **2.18:1–4.24:1** (pior caso
> `--color-sidebar-raised` no claro, melhor caso `--sidebar` no escuro).
> Nenhuma combinação de superfícies reproduz 2.95 como piso. O número
> antigo não confere e não deve ser reaproveitado em briefs.
>
> ### Caminho de correção, já mapeado
>
> Quem retomar isto **não precisa refazer o cálculo**: os hexes que fecham
> AA e 1.4.11 preservando hue/saturação estão nas quatro entradas
> históricas logo abaixo — `#665449` / `#4B3E36` / `#362D27` para o texto
> (com o par escuro de cada nível), e `#987F6F` claro / `#7D695A` escuro
> para a borda de componente. Junto com eles ficam as duas armadilhas já
> pagas: **não derivar texto com `color-mix`** (dessatura o tom: hue 23°→30°,
> sat 0.162→0.074) e **não derivar a borda de componente a partir de
> `--border`** (produz saturação ~0.257, perto demais do accent `#9C5A2E`).
>
> **Os testes não foram apagados.** `mutedForegroundContrast.test.ts` e
> `borderTokenContrast.test.ts` deixaram de exigir AA e passaram a travar o
> **inventário medido**: cada par token × superfície com o seu valor atual
> e um `passaAA`/`passa1411` explícito. Quebram se qualquer valor mudar,
> para cima ou para baixo — o registro tem de continuar descrevendo o
> produto. Confirmado por mutação nas duas direções.
>
> `useAppearancePreferences.contrast.test.tsx` **foi removido**: cada uma
> das suas asserções (`o nivel 90 nao e mais oferecido`, `aceita o nivel
> novo 120`) trava exatamente o que a reversão desfez. Não havia o que
> converter.

> **Changelog 17/08/2026 (follow-up da entrada abaixo) —
> `--color-border-strong` derivava da origem errada; corrigido para a mesma
> saturação dos tokens de texto.**
>
> 🔻 **REVERTIDA em 18/08/2026** (commit `4f24534` revertido). O conteúdo
> abaixo descreve código que **não está mais no produto** e fica como
> registro do caminho de correção: o hex e o raciocínio de saturação
> continuam válidos para quem retomar. Ver a entrada do topo.
>
> A entrada logo abaixo derivou `--color-border-strong` em HSL a partir do
> próprio `--border` (`#D9CBBF` claro, sat 0.255 / `#3D2E22` escuro, sat
> 0.284). Isso passava nos três critérios verificados na hora — 3:1, hue/sat
> preservados, `strong` ≠ `subtle` — mas a origem escolhida estava errada: a
> saturação resultante (0.257 claro) ficou **quase o dobro** da sat ~0.166 de
> todo o resto do sistema (texto secundário, `sidebar-muted`), e próxima
> demais do accent `#9C5A2E` (sat 0.545) — só **1.33:1** de contraste entre
> os dois no claro. Como a seleção do `DocumentCard` usa `border-primary` (o
> próprio accent), um card selecionado e um não selecionado ficavam
> visualmente próximos — o oposto do que a borda deveria sinalizar.
>
> **A saturação, não a luminância, é o canal que separa a borda de
> componente do accent.** Os dois ocupam faixas parecidas de luminosidade
> (`L=0.48` vs `L=0.396` no claro); é a saturação que os distingue. Por isso
> a origem certa é a mesma dos tokens de **texto** cromático — não a de
> `--border`, que é (e continua sendo) um tom mais saturado, pensado para
> `--color-border-subtle`, que não precisa se distinguir do accent.
>
> | Token | Claro | Escuro |
> | --- | --- | --- |
> | `--color-border-strong` (corrigido) | `#987F6F` | `#7D695A` |
>
> | Contraste do `strong` corrigido | Claro | Escuro |
> | --- | --- | --- |
> | sobre `--card` | 3.46:1 ✅ | 3.23:1 ✅ |
> | sobre `--background` | 3.24:1 ✅ | 3.51:1 ✅ |
> | sobre `--input` / `--muted` | 3.00:1 ✅ | 3.02:1 ✅ |
>
> Derivado em HSL a partir de `#7A6558` (claro) e `#9E8878` (escuro) — a
> mesma origem de `--muted-foreground` — preservando hue/saturação: claro
> hue 23.4° / sat 0.166 contra hue 22.9° / sat 0.162 da origem; escuro hue
> 25.7° / sat 0.163 contra hue 25.3° / sat 0.164.
>
> `borderTokenContrast.test.ts` agora trava a saturação contra a origem de
> **texto**, não contra `--border`. Confirmado por mutação: o `#9A785B`
> anterior reprova — delta de saturação de 0,095 contra a tolerância de
> 0,02 (quase 5× o limite; a checagem de hue já barra primeiro, em 4.68°
> contra a tolerância de 4°).
>
> **`--color-sidebar-raised` continua a única superfície fora do requisito**
> — `2.37:1` com o valor corrigido, mesma pendência já registrada, sem
> nenhuma borda `strong` cuja adjacência primária seja essa superfície.
> Fora de escopo desta correção, como da anterior.
>
> Confirmado de novo: a família `--reader-header-*` (11 tokens) e
> `--floating-header-divider` seguem sem nenhum consumidor — ver a entrada
> abaixo, que já registrava isso.

> **Changelog 17/08/2026 (noite) — Borda de componente interativo e divisória
> deixam de compartilhar token.**
>
> 🔻 **REVERTIDA em 18/08/2026** (commit `eac4ef6` revertido). Os três nomes
> (`subtle`, `muted`, `strong`) voltaram a apontar para `var(--border)`, e
> `--color-border-muted` voltou a existir. A **classificação dos 190 usos**
> registrada abaixo continua sendo trabalho de análise válido para quem
> retomar — o que saiu foi o código, não o levantamento. Ver a entrada do
> topo.
>
> ⚠️ **Valores de `--color-border-strong` desta entrada foram SUPERADOS
> pela entrada de cima**, escrita depois como follow-up desta. A regra, a
> classificação dos 190 usos e a remoção de `--color-border-muted`
> continuam válidas sem alteração; só os dois hexes de `strong` e os
> contrastes derivados deles mudaram.
>
> **REGRA NOVA: os dois papéis têm requisitos de contraste diferentes e não
> podem viver no mesmo token.** A WCAG 1.4.11 exige **3:1** para o limite de
> um componente de interface; para uma régua decorativa não exige nada. Um
> token só não serve aos dois: subir tudo para 3:1 deixaria cada divisória
> com traço quase de texto, e manter tudo baixo deixa todo campo sem limite
> perceptível — que era o estado até aqui (1.21:1–1.46:1 em **todos** os 190
> usos).
>
> **Por que 1.4.11 se aplica aqui sem exceção.** O critério dispensa o
> contraste quando o componente é identificável por outra indicação visual.
> No Athenaeum **essa outra indicação não existe**: as superfícies não se
> distinguem entre si — `--card` sobre `--background` dá **1.07:1**, `--muted`
> sobre `--card` dá **1.15:1**. Um campo com fundo `--card` sobre um painel
> `--background` é literalmente invisível sem a borda. Ela é a única
> portadora de limite, então carrega o requisito inteiro.
>
> | Token | Papel | Claro | Escuro |
> | --- | --- | --- | --- |
> | `--color-border-subtle` | divisória decorativa | `var(--border)` = `#D9CBBF` | `var(--border)` = `#3D2E22` |
> | `--color-border-strong` | limite de componente | `#9A785B` | `#8B694E` |
>
> | Contraste do `strong` | Claro | Escuro |
> | --- | --- | --- |
> | sobre `--card` | 3.72:1 ✅ | 3.39:1 ✅ |
> | sobre `--input` / `--muted` | 3.23:1 ✅ | 3.17:1 ✅ |
>
> Derivado em HSL a partir do próprio `--border`, preservando hue e saturação
> (claro 27.6° / 0.257 contra 27.7° / 0.255 da origem; escuro 26.6° / 0.281
> contra 26.7° / 0.284) — mesma regra dos tokens de texto cromático, pelo
> mesmo motivo: `color-mix` rumo a um foreground quase acromático dessatura.
>
> **`--color-border-muted` foi removido.** Os três `--color-border-*` eram
> aliases **idênticos** de `--border` — nomes sem semântica, em que escrever
> `strong` dava exatamente o mesmo traço que escrever `subtle`. Os 22 usos do
> `muted` se dividiram limpo entre os dois papéis reais (14 eram campo, botão
> ou wrapper de campo; 8 eram painel de menu ou caixa informativa); nenhum
> pedia um terceiro nível.
>
> **Classificação aplicada** (190 usos, inventariados na Etapa 1):
>
> | Vai para | Quantos | O quê |
> | --- | --- | --- |
> | `strong` | 83 | campos, botões, wrappers de campo, controles agrupados, cards clicáveis, zona de drop |
> | `subtle` | 99 | réguas de uma aresta, painéis de menu, chrome flutuante, caixas informativas, decorativos |
> | condicional | 1 | `ReaderLeftSidebar` — item de marcador: `subtle` em repouso, `strong` em edição |
> | **não tocados** | 8 | blocos do editor de Caderno — ver abaixo |
>
> **Categoria à parte, pendente de token próprio: os blocos do editor de
> Caderno.** Tabela, callout, figura, anexo e equação (`index.css` 745, 786,
> 880, 892, 1555, 1569, 1644, 1807) desenham contorno de **conteúdo do
> documento**, não de chrome do app. Nem "limite de componente" nem
> "divisória decorativa" descreve o que eles são: pertencem ao documento que
> o usuário escreveu, e um dia serão exportados junto com ele. Ficaram
> intocados de propósito, aguardando um token de conteúdo editorial próprio.
>
> **Órfãos confirmados nesta leva.** A família `--reader-header-*` inteira —
> os **11 tokens** — tem zero consumidores; a suspeita da auditoria de 17/08
> se confirma e vai além do `--reader-header-muted` já registrado.
> `--floating-header-divider` também está sem consumidor. Registrados, sem
> destino inventado.
>
> Travado por `src/styles/borderTokenContrast.test.ts`, que reprova um
> `strong` abaixo de 3:1, um `strong` que volte a igualar o `subtle`, e um
> `strong` dessaturado — as três mutações foram verificadas.

> **Changelog 17/08/2026 (tarde) — A correção de contraste da entrada
> abaixo dessaturava o texto secundário; revertida para hexes fixos que
> preservam hue/saturação.**
>
> 🔻 **REVERTIDA em 18/08/2026** (commit `d552111` revertido). A constatação
> de que `color-mix` dessatura um tom cromático é **medida e continua
> verdadeira** — e agora aparece no produto de novo, porque os níveis 90 e
> 110 da escada voltaram a ser `color-mix`. É dívida aceita, não fato
> revogado. Ver a entrada do topo.
> `color-mix(in srgb, var(--foreground) 72%,
> var(--background))` fechava AA (era esse o único critério verificado) mas
> misturar um tom cromático (`#7A6558`, hue 23°, sat 0.162) com um neutro
> quase acromático desloca o resultado: o `#57514B` produzido tinha hue 30°
> e sat 0.074 — **54% menos saturado**. Contra a premissa "warm minimalism,
> nunca cinza frio" do design system, isso era regressão de identidade, só
> que invisível a qualquer teste de contraste numérico.
>
> **A regra nova, e por que ela existe:** tokens de **texto cromático**
> (que carregam um matiz de marca, não apenas neutralidade) não usam
> `color-mix` rumo a um foreground/background quase acromático para gerar
> escala de contraste. Usam hexes derivados em **HSL**, preservando hue e
> saturação da cor de origem e variando só luminosidade — como uma escala
> tonal desenhada à mão. `--border` é a exceção deliberada: é traço/divisor,
> não texto, e a identidade cromática dele é secundária à presença; segue
> em `color-mix`.
>
> **Valores finais** (tabela completa, com contraste em cada superfície e
> prova de hue/saturação preservados, na seção "Texto secundário" abaixo):
>
> | Token | Nível | Claro | Escuro |
> | --- | --- | --- | --- |
> | `--muted-foreground` | 100 | `#665449` | `#9E8878` (inalterado) |
> | `--muted-foreground` | 110 | `#4B3E36` | `#B5A497` |
> | `--muted-foreground` | 120 | `#362D27` | `#C9BDB4` |
> | `--color-sidebar-muted` | 100 | `#665449` | `#9E8878` (inalterado) |
> | `--color-sidebar-muted` | 110 | `#4B3E36` | `#B09E90` |
> | `--color-sidebar-muted` | 120 | `#362D27` | `#C4B6AC` |
>
> Todos passam AA com margem nas superfícies do próprio tema; nenhum se
> desvia da cor de origem em mais de 4° de hue ou 0.02 de saturação —
> ambos travados por teste (`mutedForegroundContrast.test.ts`).
>
> Verificado num efeito colateral: `--reader-header-muted` também está sem
> consumidor (acréscimo à lista de órfãos, ver a entrada de 16/08 sobre o
> eixo de material, abaixo).
>
> ⚠️ A entrada logo abaixo (mesmo dia, de manhã) está **parcialmente
> superada**: a causa raiz que ela identifica (token validado só contra
> `--card`) continua correta e é o motivo desta leva inteira existir; os
> **valores** `#57514B`/`#463F3A`/`#342E29`/`#625149` que ela registra
> foram substituídos pelos da tabela acima.

> **Changelog 17/08/2026 (manhã) — Texto secundário sobe para AA em todas as
> superfícies, e o documento passa por uma auditoria contra o código.**
>
> 🔻 **PARCIALMENTE REVERTIDA em 18/08/2026** (commits `2e7c4fd` e `117fd79`
> revertidos). Esta entrada mistura duas coisas de destinos diferentes:
>
> - **A correção de contraste e a remoção do nível 90 saíram.** O nível 90
>   voltou; os níveis são 90/100/110 de novo, não 100/110/120.
> - **A auditoria doc↔código (`840478b`) FICA**, inteira. As cinco
>   divergências corrigidas continuam corrigidas.
>
> O intervalo "2.95:1–3.74:1" citado abaixo para o nível 90 **não confere**;
> o medido é 2.18:1–4.24:1. Ver a correção na entrada do topo.
>
> **A correção.** `--muted-foreground` no tema claro era o literal
> `#7A6558`, validado nesta página **apenas contra `--card`** (5.06:1). O
> token é usado sobre **seis** superfícies, e falhava AA em quatro:
> `--sidebar`/`--muted`/`--input` (`#EDE5DA`, 4.39:1) e
> `--color-sidebar-raised` (`#D8CCBD`, 3.47:1). Não eram casos de borda —
> a pílula "+N" de tags vive sempre sobre `--muted`, o hover da list row
> troca o fundo para `--muted`, e o hover da sidebar usa
> `--color-sidebar-raised`. Hoje o token é derivado
> (`color-mix(--foreground 72%, --background)` = `#57514B`) e fecha a pior
> superfície em 4.95:1. `--color-sidebar-muted` recebeu o mesmo tratamento.
> O tema escuro não mudou: já passava nas seis.
>
> **A causa raiz é documental**, e por isso está registrada aqui: validar
> um token contra uma única superfície, quando ele é usado em seis, foi o
> que deixou o bug passar meses. A seção "Texto secundário" agora traz a
> tabela completa, e um teste (`mutedForegroundContrast.test.ts`) lê o
> `index.css` e recalcula a cada `npm test`.
>
> **O nível 90 de "Contraste da interface" foi removido.** Ele derrubava
> as seis superfícies para 2.95:1–3.74:1 — o valor mínimo de um controle
> de contraste reduzindo contraste abaixo do legível, contra a regra desta
> própria página ("não usar tom mais claro que este"). Os níveis passam a
> ser 100 / 110 / 120, com 100 como piso.
>
> **Correções de auditoria nesta mesma leva** (o documento é usado para
> escrever briefs, então afirmação não verificada aqui propaga erro):
>
> | Item | O que estava escrito | O que o código faz |
> | --- | --- | --- |
> | `accent-icon-amber` | ícone "Marcar" da `SelectionToolbar` | borda do aviso de export do Caderno; a toolbar **nunca** usou o token |
> | `icon_variant` | feature entregue, persistida e propagada | **nunca existiu** — entrada retratada |
> | `surface-header` | fundo do header/top bar | só o toast de carregamento do Quadro |
> | nota do Excalidraw | limitação ativa | resolvida pela migração para Konva |
> | mapeamento palavra-chave→cor | um sistema, 23 palavras | **dois** sistemas; as pílulas da Library usam 6 palavras + substring + hash |
>
> Registrados também: os 7 tokens `--glass-*` que ficaram órfãos após a
> reversão de 16/08 (com destino conhecido — não remover), e o hash de cor
> de tag ser sensível à caixa, o que contradiz a regra 2 desta página e
> fica como limitação conhecida.
>
> **Fora do escopo desta leva, para levas próprias:** os hex hardcoded da
> Library (`#2C1810`/`#F0E8DF` em 9 lugares ignorando
> `--color-sidebar-text`, `#EF4444`, `bg-white`, os 4 hex do botão "+ Tag"),
> a correção do hash sensível à caixa, e o consumo dos tokens glass.

> **Changelog 16/08/2026 — O chrome flutuante do Reader permanece escuro
> no material glass. Revisão da entrada anterior.** A decisão registrada
> logo abaixo — a ilha da `SelectionToolbar` seguir a variante de
> material — está **revertida**. Ela foi tomada olhando o contraste do
> *texto sobre a ilha*, que fechava (4.85:1). O que não foi medido na
> hora foi a ilha contra **o que está atrás dela**.
>
> **A medição que derruba a decisão.** A `SelectionToolbar` flutua sobre
> a página do PDF, que é papel branco — a única superfície branca pura do
> leitor. Seguindo a variante, no Glass claro a ilha ficava:
>
> | Parada da ilha (Glass claro) | Contra papel `#FFFFFF` | Mínimo 1.4.11 (3:1) |
> | --- | --- | --- |
> | `#FFFDFA` (topo do elevated) | **1.02:1** | ❌ |
> | `#F7F0E8` (base do elevated) | **1.13:1** | ❌ |
>
> A WCAG 2.1 **1.4.11 (Non-text Contrast)** exige 3:1 para o limite de um
> componente de interface contra o que o cerca. A 1.02:1 a ilha não tem
> limite visível nenhum: ela desaparece no papel, e o que sobra é texto
> marrom flutuando sobre o PDF. O problema nunca foi o texto — era a
> própria ilha. Com o par `--glass-immersive-*` ela vai a **15.2:1**
> contra o papel.
>
> **REGRA NOVA: chrome flutuante sobre superfície imersiva não segue a
> variante de material.** O material descreve o acabamento das
> superfícies *do app*; ele não tem jurisdição sobre um controle que
> flutua sobre conteúdo do usuário — ali quem manda é o contraste contra
> esse conteúdo, e conteúdo não muda de cor com o tema. Isso não
> contradiz a regra de 15/07/2026, e sim a completa: aquela decide *quem*
> pode ser chrome flutuante; esta decide que, uma vez flutuante sobre
> superfície imersiva, o componente sai do eixo de material.
>
> Os tokens são um par dedicado, com valores **idênticos** nos blocos
> claro e escuro de `[data-material="glass"]` — a repetição é proposital
> e não deve ser "limpada" movendo para `:root`, porque é ela que torna
> visível, lendo qualquer um dos blocos, que este grupo não varia:
>
> | Token | Claro e escuro (mesmo valor) |
> | --- | --- |
> | `--glass-immersive-surface` | `linear-gradient(180deg, #292521 0%, #201C19 100%)` |
> | `--glass-immersive-border-top` | `rgb(255 255 255 / 0.16)` |
> | `--glass-immersive-shadow` | `0 16px 40px -12px rgb(0 0 0 / 0.70)` |
>
> O nome diz o contrato: `immersive`, não `elevated`. Reaproveitar
> `--glass-surface-elevated` aqui reintroduziria o problema no dia em que
> a variante clara mudasse.
>
> ✅ **RESOLVIDO em 18/08/2026:** os sete deixaram de ser órfãos — a Library
> é o consumidor, exatamente o destino previsto abaixo. Ver a entrada do
> topo. O parágrafo seguinte fica como registro do período órfão.
>
> **Efeito colateral desta reversão: 7 dos 12 tokens `--glass-*` ficaram
> sem consumidor.** Como a ilha passou a usar só o trio `--glass-immersive-*`,
> estes continuam definidos nos dois blocos de tema, com valor e regra de
> luminância documentados, sem que nenhuma regra CSS ou componente os
> referencie:
>
> `--glass-surface` · `--glass-surface-elevated` · `--glass-border-top` ·
> `--glass-border-top-elevated` · `--glass-border` · `--glass-shadow` ·
> `--glass-shadow-elevated`
>
> **Órfãos com destino conhecido, não lixo.** O consumo previsto é a
> Library — superfícies do app, não chrome sobre conteúdo do usuário, que é
> exatamente o caso em que a variante de material *deve* ser seguida. Ficam
> como estão até lá; **não remover**.
>
> **Um oitavo órfão, sem relação com o eixo de material:**
> `--reader-header-muted` tem zero consumidores em `.tsx` — achado da
> auditoria de 17/08/2026, registrado aqui e não corrigido. Diferente dos
> sete acima, não há destino conhecido para ele.
>
> ⚠️ Verificação rápida ao registrar este item encontrou algo maior, fora
> do escopo desta correção: `ReaderChrome.tsx` não usa **nenhum** token
> `--reader-header-*` — consome `--reader-chrome-divider` e
> `--reader-floating-shadow`, de uma família de nomes diferente. Não
> investiguei se é a família inteira (11 tokens) que ficou órfã ou só
> parte dela. Fica para uma auditoria própria, não expandida aqui.
>
> ✅ **Confirmado em 17/08/2026 (noite):** é a família inteira. Os 11
> tokens `--reader-header-*` têm zero consumidores, e
> `--floating-header-divider` também. Ver a entrada de bordas no topo.
>
> **Consequência: a conversão de ícones e rótulos foi revertida.** Como a
> ilha volta a ser escura sempre, os brancos e o `#9E8878` do componente
> voltam a ser corretos e ficam em 15.2:1 e 4.52:1 sobre
> `#292521`. O bloco glass agora toca **apenas superfície, borda e
> sombra** — nenhum valor de texto, divisor ou anel segue a variante.
>
> **`accent-icon-amber` e `tag-amber-text` seguem sem se substituir.** A
> emenda que se cogitou para essa regra (ver "Cores de interface" abaixo)
> **não é mais necessária**: ela só faria sentido se a ilha pudesse ficar
> clara, quando a distinção entre ícone vívido e texto sobre fundo claro
> ficaria ambígua. Com a ilha sempre escura, `#F59E0B` fica em 7.08:1
> sobre `#292521` e a regra original vale sem ressalva.
>
> Em `flat` nada mudou, de novo — a ilha continua `#1E2130` nos dois
> modos, byte-idêntica.

> ⚠️ **Entrada parcialmente SUPERADA pela de cima.** A parte sobre a ilha
> seguir a variante foi revertida por 1.4.11 — ela permanece escura no
> glass. O restante (controle em Ajustes, invariante do flat, mecânica
> das classes marcadoras) continua valendo. Mantida como registro de
> como a decisão foi tomada e por que caiu.
>
> **Changelog 16/08/2026 — Primeiro consumo dos tokens `--glass-*`, e
> mudança de regra no chrome flutuante do Reader.** Os tokens de material
> saíram da infraestrutura e passaram a pintar uma superfície real: a
> `SelectionToolbar` do Reader (a ilha que aparece sobre o texto
> selecionado) e sua paleta de seis cores. **Só ela** — nenhuma outra
> superfície do Reader, da Library, do Caderno ou do Quadro consome os
> tokens ainda. O controle de material vive em Ajustes › Aparência, numa
> linha própria (`Padrão` | `Vidro`), separada do controle de tema:
> continuam sendo dois eixos ortogonais, não uma lista de três temas.
>
> **A mudança de regra.** Até aqui, o chrome flutuante do Reader era
> **escuro por definição**: a ilha usava `--surface-elevated` (`#1E2130`)
> nos dois modos, e era exatamente por isso que seus ícones e rótulos
> podiam ser brancos fixos — o fundo nunca mudava. No material `glass`
> isso deixa de valer: **a ilha passa a seguir a variante**, e no Glass
> claro ela fica creme, onde texto branco seria ilegível. A consequência
> é obrigatória, não opcional: em `glass`, ícones e texto do chrome usam
> os tokens de texto do tema (`--color-text-primary` e
> `--color-text-secondary`), nunca branco fixo.
>
> | Texto sobre a ilha em glass | Contraste | AA (4.5:1) |
> | --- | --- | --- |
> | `#7A6558` sobre `#F7F0E8` (claro, parada mais escura do elevated) | 4.85:1 | ✅ |
> | `#9E8878` sobre `#292521` (escuro, parada mais clara do elevated) | 4.52:1 | ✅ |
>
> **Em `flat` nada mudou** — e isso é invariante, não coincidência. As
> classes `.reader-selection-*` do componente são marcadores sem estilo
> próprio; toda regra que as usa vive sob `[data-material="glass"]`. No
> material padrão a ilha continua pintada apenas pelas utilitárias do
> componente, byte-idêntica ao que era antes do eixo existir. Há teste
> travando as duas pontas desse contrato.
>
> **Esta decisão está sob avaliação visual, não fechada.** O que está em
> aberto é se um chrome flutuante *claro* continua lendo como chrome —
> a regra de 15/07/2026 ("chrome flutuante é reservado para superfícies
> imersivas de objeto único") foi escrita quando ilha flutuante e fundo
> escuro eram a mesma coisa na prática, e nunca precisou distinguir as
> duas. Se o Glass claro se provar frágil sobre a página do PDF, a saída
> não é voltar a branco fixo: é a ilha manter a variante *escura* do
> glass nos dois modos, o que preservaria a legibilidade sem reintroduzir
> uma superfície fora do eixo. Não estender o padrão a outras superfícies
> antes desse veredito.

> **Changelog 16/08/2026 — Eixo de material (`flat` | `glass`),
> ortogonal ao tema claro/escuro:** o app passa a ter uma segunda
> dimensão de aparência, independente do modo. O modo continua sendo a
> classe `.dark` no `<html>` e continua definindo *qual* é a paleta; o
> material entra como `data-material` no mesmo elemento e define *como*
> a superfície é pintada. As duas dimensões se combinam livremente
> (claro/flat, claro/glass, escuro/flat, escuro/glass) sem duplicar a
> paleta. O mecanismo `.dark` não foi alterado.
>
> `flat` é o default e **não tem bloco CSS**: é a ausência dos tokens
> `--glass-*`, ou seja, exatamente a aparência que o app já tinha. Só
> `glass` adiciona tokens, em duas variantes — `[data-material="glass"]`
> (claro) e `.dark[data-material="glass"]` (escuro, que vence por
> especificidade 0,2,0 contra 0,1,0, não por ordem de origem):
>
> | Token | Claro | Escuro |
> | --- | --- | --- |
> | `--glass-surface` | `linear-gradient(180deg, #FDFAF7 0%, #F4ECE3 100%)` | `linear-gradient(180deg, #262220 0%, #1C1815 100%)` |
> | `--glass-surface-elevated` | `linear-gradient(180deg, #FFFDFA 0%, #F7F0E8 100%)` | `linear-gradient(180deg, #292521 0%, #201C19 100%)` |
> | `--glass-border-top` | `rgb(255 255 255 / 0.65)` | `rgb(255 255 255 / 0.10)` |
> | `--glass-border-top-elevated` | `rgb(255 255 255 / 0.85)` | `rgb(255 255 255 / 0.16)` |
> | `--glass-border` | `rgb(44 26 16 / 0.08)` | `rgb(0 0 0 / 0.35)` |
> | `--glass-shadow` | `0 8px 24px -8px rgb(44 26 16 / 0.18)` | `0 8px 24px -8px rgb(0 0 0 / 0.55)` |
> | `--glass-shadow-elevated` | `0 16px 40px -12px rgb(44 26 16 / 0.24)` | `0 16px 40px -12px rgb(0 0 0 / 0.70)` |
>
> **REGRA (limite de luminância das superfícies glass):** nenhuma
> superfície glass pode ser **mais escura que `#F2EAE0` no tema claro nem
> mais clara que `#292521` no tema escuro**. O vínculo é o **ponto mais
> claro da superfície mais clara** — não a base do gradiente, e não a
> média: quem decide o contraste é a parada de maior luminância que o
> texto atravessa, e ela costuma estar na superfície *elevada*, não na
> comum. O propósito do teto é manter `--muted-foreground` em AA **sem
> introduzir nenhum token de texto novo**: são `#7A6558` (claro) e
> `#9E8878` (escuro) que teriam de ganhar uma variante paralela se a
> superfície escorregasse. Qualquer superfície glass futura que estoure o
> limite quebra os dois tons secundários de uma vez, em todas as telas.
> Ao propor uma nova superfície glass, verifique o limite antes de
> verificar o gosto.
>
> **Medição (pior caso de cada tema, medido e não estimado):**
>
> | Texto sobre superfície | Contraste | AA (4.5:1) |
> | --- | --- | --- |
> | `#7A6558` sobre `#F4ECE3` (parada mais escura do claro) | 4.69:1 | ✅ |
> | `#9E8878` sobre `#292521` (parada mais clara do escuro, no próprio teto) | 4.52:1 | ✅ |
>
> **No escuro a elevação não é luminância — é borda e sombra.** Comprimir
> a família inteira abaixo de `#292521` não deixa faixa de luminância
> suficiente para hierarquia: `--glass-surface-elevated` fica praticamente
> colada em `--glass-surface`. Por isso o escuro ganhou
> `--glass-border-top-elevated` e `--glass-shadow-elevated`, que passam a
> ser os portadores da elevação. Os dois existem também no claro, por
> simetria de API — lá a luminância ainda ajudaria, mas um consumidor não
> deve precisar saber em qual tema está para escolher o token. **Clarear
> o fundo para "elevar" no escuro é justamente o que a regra proíbe:**
> escureça e use borda/sombra.
>
> **Glass altera apenas superfícies, bordas e sombras.** `--primary` /
> `--accent` (`#9C5A2E`), a paleta de 9 tags, os tokens de status e toda
> a tipografia ficam intactos nos dois materiais — nenhum token
> existente foi removido, renomeado ou alterado nesta entrada. Um token
> `--glass-*` só descreve pintura de superfície; não existe variante
> glass de cor de marca ou de tag.
>
> A preferência persiste em `app_settings` na chave `material_variant`
> (valores `'flat' | 'glass'`, default `'flat'`), como
> `show_divider_lines` e `icon_variant`, e é propagada às janelas
> nativas separadas (Reader, Anotações, Caderno) pelo evento
> `app:material-variant-changed`. O SQLite é a fonte de verdade; há um
> espelho write-through em `localStorage` (`athenaeum-material`) usado só
> para o bootstrap aplicar `data-material` antes do primeiro paint, sem
> o qual as 4 janelas piscavam em `flat` até o IPC responder. Quando os
> dois divergem, o SQLite vence e o cache é corrigido.
>
> Esta entrada cobre só a infraestrutura: nenhuma tela consome os tokens
> ainda, e não há controle na tela de Ajustes.

> **Changelog 16/08/2026 — Corolário do chrome flutuante e novo valor
> escuro de `--color-empty-state-detail`:** um bug no Reader mostrou que
> a regra de chrome flutuante do changelog de 15/07/2026 ("sem competir
> pelo espaço do documento") tem um corolário de hit-testing que ainda
> não estava explícito: a área *clicável* de uma ilha flutuante não pode
> exceder a pílula visível, mesmo quando o wrapper é transparente. O
> header do Reader (`ReaderChrome.tsx`) cobria os 84px superiores da
> janela inteira — incluindo a faixa da barra de rolagem vertical na
> borda direita — porque o wrapper `absolute inset-x-0 top-0` não tinha
> `pointer-events-none`. Corrigido com `pointer-events-none` no wrapper
> e `pointer-events-auto` nos contêineres interativos (a pílula de
> título e a pílula de controles), preservando o estado oculto do modo
> de leitura via seletor de especificidade composta
> (`.reader-reading-island.reader-reading-island--hidden *`), que não
> depende de ordem de origem no CSS gerado.
>
> Nesta mesma correção, `--color-empty-state-detail` (linhas internas
> secundárias dos ícones de estado vazio) ganhou valor no tema escuro:
> `#463A31`. O token só existia em `:root` (`#D9C5B4`, claro) e, sem
> redefinição em `.dark`, herdava o valor claro. O novo valor foi
> derivado por interpolação proporcional entre `--card` escuro
> (`#231C16`) e o token de texto secundário escuro (`#9E8878`),
> preservando a mesma razão de contraste (~1.55:1) que o par claro já
> tinha (`#D9C5B4` sobre `--card` claro `#FAF5EF`). Ver a tabela "Cores
> de interface" abaixo para os dois valores lado a lado.
>
> Nenhuma alteração na paleta de tags, tipografia ou demais tokens
> nesta entrada.

> **Changelog 13/08/2026 — Realce e cor de fonte no Caderno:** os dois
> recursos reaproveitam os 9 tokens existentes de tag (`Violet`, `Indigo`,
> `Blue`, `Teal`, `Rose`, `Amber`, `Green`, `Red` e `Slate`), sem introduzir
> nenhum hex novo. O realce usa o tom pastel e a cor de fonte usa o tom
> saturado/texto das tabelas documentadas abaixo.
>
> Este uso é uma exceção explícita à regra de que `Green`, `Red` e `Slate`
> nunca devem representar tags de assunto: no Caderno eles não são tags, mas
> destaques pontuais aplicados ao texto. A restrição continua integralmente
> válida para tags de assunto.

> **Changelog 15/07/2026 — Regra de chrome: docado vs. flutuante:**
> o redesign do Caderno (trilho colapsável, drawer de Detalhes,
> menu "/") tornou explícita uma distinção que já existia
> implicitamente entre as telas do app, e que precisa ser seguida
> por qualquer tela nova: **chrome flutuante (ilhas com margem
> própria, cantos arredondados nos 4 lados, sobreposição sem reflow)
> é reservado para superfícies imersivas de objeto único** — telas
> onde existe um conteúdo central dominante e tudo mais é controle
> temporário sobre ele. O Reader é o caso de referência: o PDF ocupa
> a tela inteira, e sidebar de miniaturas, painel de anotações e as
> ilhas de zoom/edição são chrome que aparece por cima, sem competir
> pelo espaço do documento.
>
> **Chrome docado (painéis flush, sem margem própria, reflow real ao
> abrir/fechar) é o padrão para telas de workspace com múltiplas
> regiões coexistindo por definição** — não existe um "objeto
> central" a respeitar, existe uma composição de painéis que o
> usuário lê como um único layout. Library (sidebar + grid) e Caderno
> (trilho + editor, com o drawer de Detalhes como única exceção
> intencional — ver abaixo) seguem esse padrão.
>
> **Nuance:** o drawer de Detalhes do Caderno é overlay (sobrepõe sem
> reflow), mesmo o Caderno sendo majoritariamente docado. Isso é
> proposital — o drawer é conteúdo consultado ocasionalmente, não uma
> região permanente do layout, então se comporta como as ilhas do
> Reader nesse ponto específico. O trilho de páginas, por outro lado,
> reflui de verdade ao expandir, porque ele é parte estrutural do
> workspace.
>
> **Ao decidir uma tela nova (ex: Quadro/Canvas):** pergunte primeiro
> se existe um objeto central único sendo manipulado (→ flutuante) ou
> se são múltiplas regiões permanentes coexistindo (→ docado, com
> overlays pontuais permitidos para conteúdo consultivo/ocasional,
> como o drawer). Não decidir por precedente visual solto — decidir
> por essa pergunta.
>
> Nenhuma alteração de tokens de cor, tipografia ou paleta de tags
> nesta entrada — é só uma regra de comportamento estrutural.

> **Changelog técnico 10/07/2026 — Migração do Quadro de Excalidraw para
> Konva.js:** o Quadro (`src/features/canvases/`) deixou de depender de
> `@excalidraw/excalidraw` e passou a usar [Konva.js](https://konvajs.org/) +
> `react-konva` (MIT), com UI 100% própria: toolbar flutuante em pílula,
> painel de propriedades customizado (`CanvasPropertiesPanel`) e handles de
> resize/rotate próprios (`Konva.Transformer` para a maioria das formas;
> handles customizados de início/fim para Seta e Linha, que são
> direcionais). A migração cobriu 9 ferramentas de forma (Retângulo,
> Losango, Elipse, Seta, Linha, Lápis, Texto, Imagem, Frame) além de
> Selecionar, Mover e Borracha por segmento. Não houve alteração nos tokens
> de cor em si — a paleta de 9 cores de tag (`TAG_COLOR_TOKENS`) continua a
> mesma e passou a ser reaproveitada também como paleta de preenchimento das
> formas do Quadro no painel de propriedades, sem criar uma paleta paralela.
> Não houve alteração de tipografia, tema claro/escuro ou schema de
> persistência de outras features.
>
> **Changelog técnico 07/07/2026 — QA final dos diagramas do Notebook:**
> a Fase 7.2 encerrou funcionalmente `Diagram`, `Graph`, `Cycle Graph` e
> `Flowchart` para o escopo atual. A revisão corrigiu o estado ativo dos
> handles de resize ao sair por foco/perda de janela, preservou copy/paste
> interno de diagramas com `data-diagram-kind`, `data-diagram-source` e
> `data-diagram-scale` sanitizados, e rejeitou separadores malformados em
> `graph` como `A --- B`/`A --> B`. Não houve alteração de tokens de cor,
> paleta de tags, backend, migrations, dependências ou formato persistido além
> da preservação já prevista de `data-diagram-scale`.
>
> **Changelog 07/07/2026 — Refinos da toolbar compacta do Caderno:**
> o botão `...` foi alinhado ao canto direito da toolbar, `Vincular PDF` passou
> a aparecer como botão com ícone e texto `PDF`, e os ícones/glifos da toolbar
> voltaram a usar os tokens existentes de texto suave/forte para respeitar
> modo claro e escuro. Não houve alteração de tokens de cor, paleta de tags,
> tipografia, comandos do editor ou formato HTML persistido.
>
> **Changelog 07/07/2026 — Toolbar compacta por ícones no Caderno:**
> a toolbar do editor foi ajustada para seguir a referência visual com botões
> diretos e compactos por ícone. `H1/H2/H3`, `Negrito`, `Itálico`, listas,
> citação em bloco, código, Cite, link, anexo e PDF voltaram para a barra; o
> `...` permanente concentra inserção, layout, espaçamento e manutenção. As
> opções de alinhamento dentro do menu `...` agora são representadas por ícones
> em vez de rótulos textuais. Não houve alteração de tokens de cor, paleta de
> tags, tipografia, tema claro/escuro, comandos do editor ou formato HTML
> persistido.
>
> **Changelog 07/07/2026 — Reorganização estrutural da toolbar do Caderno:**
> a toolbar do editor foi compactada por grupos funcionais: `Texto`,
> `Negrito`, `Itálico`, `Listas`, `Referências`, `Inserir` e `Layout`.
> `H1/H2/H3`, listas, Cite, links, anexos e PDF deixaram de ocupar botões
> permanentes separados e foram movidos para menus dedicados. `Limpar
formatação` foi movido para `Texto` e `Remover link` para `Referências`,
> removendo o menu `...` permanente. O `...` agora aparece apenas como
> overflow responsivo quando `Layout` e/ou `Referências` precisam ser
> recolhidos pela largura disponível da própria toolbar. Não houve alteração
> de tokens de cor, paleta de tags, tipografia, tema claro/escuro, comandos do
> editor ou formato HTML persistido.
>
> **Changelog 07/07/2026 — Caderno, painel Detalhes e toolbar do editor:**
> a rodada de UI do Caderno deixou a sidebar `Detalhes` mais robusta, com
> status de leitura visual, descrição, campo de autor/disciplina reposicionado,
> `+ Tag` no mesmo padrão do painel de documentos, menu `Mais opções` fixo no
> rodapé e botão de opções também no cabeçalho. O menu ganhou ações reais para
> renomear, mover para coleção, fixar nos favoritos, contagem detalhada e mover
> para a lixeira, mantendo placeholders desabilitados onde ainda não há lógica.
> O editor também iniciou a separação da toolbar em menus menores, depois
> consolidada pela reorganização estrutural registrada acima. Não houve
> alteração de tokens de cor, paleta de tags, tipografia, tema claro/escuro ou
> formato HTML persistido.
>
> **Changelog 06/07/2026 — Tela inicial e painel Detalhes:** a rodada de UI
> da Home ajustou tokens de texto e previews sem mudar o accent principal nem
> a paleta de tags. `sidebar-text` passou a usar `#2C1810` no modo claro e
> `#F0E8DF` no modo escuro, cobrindo o título `Athenaeum`, o nome da coleção
> ativa, o título da coleção aberta e itens selecionados da sidebar. O token
> `sidebar-muted` foi fechado em `#7A6558` no claro e `#9E8878` no escuro para
> itens não selecionados. No tema escuro, `foreground` e `card-foreground`
> também foram alinhados para `#F0E8DF` para manter consistência com os títulos
> fortes da biblioteca e do painel `Detalhes`. As miniaturas de documento
> deixaram de usar uma cor fixa pronta por documento e passaram a usar um hue
> determinístico com luminância por tema: capa clara em
> `hsl(hue 28% 74%)`, capa escura em `hsl(hue 30% 18%)`, com linhas internas
> derivadas do mesmo hue. Não houve mudança em `accent-interactive`, nos tokens
> de tag ou no mapeamento palavra-chave → cor.
>
> **Changelog técnico 06/07/2026 — Diagramas no Notebook:** as Fases
> 6A, 6B, 6C, 6D, 6E, 6E.1 e 6E.2 consolidaram a auditoria e o refinamento visual dos previews
> SVG runtime de `data-athenaeum-block="diagram"`. A Fase 6A criou
> `docs/diagram-visual-audit.md` com arquitetura, riscos, hardcoded visual,
> matriz trabalho x resultado e ressalvas. A Fase 6B adicionou tokens CSS
> específicos para diagramas em `src/styles/index.css`, cobrindo card,
> preview, nós, linhas, setas, textos, fonte e estados discretos sem criar
> paleta paralela. A Fase 6C ajustou escala e legibilidade dos previews:
> `diagram` passou a adaptar limite de label/largura máxima pela quantidade
> de nós, enquanto `flowchart` ganhou nós mais largos e altura runtime
> proporcional com teto seguro. A Fase 6D adicionou preview visual runtime
> para `data-diagram-kind="graph"` em `NotebookGraphPreview.tsx`, usando
> `parseDiagramSource` com relações `A -> B`, layout em grade determinística
> e os mesmos tokens visuais; fontes inválidas ou legadas continuam no
> fallback textual. A Fase 6E suavizou bordas, fonte, títulos internos,
> labels SVG e espaçamentos, além de adicionar `Modo limpo` runtime na toolbar
> contextual de diagrama para ocultar visualmente `Fonte` sem salvar estado no
> bloco. A Fase 6E.1 corrigiu o botão, que havia entrado na toolbar de Callout,
> e passou a aceitar cadeias em linha única como `A -> B -> C`, mantendo
> `A -- B` no fallback textual/inválido. A Fase 6E.2 refinou o Modo limpo para
> um visual mais editorial: o título interno do preview e a moldura principal
> somem visualmente, a área `Fonte` continua oculta e nós, setas e conexões
> permanecem legíveis. O SVG continua apenas runtime; o HTML salvo permanece
> leve e sem SVG persistido. Não foram alterados autosave, paste,
> seleção/range, backend, migrations ou dependências.
>
> **Update técnico 06/07/2026:** refatoração incremental do
> `NotebookPageEditor.tsx` sem mudança de comportamento. A Fase 1 extraiu
> ícones e metadata estática da toolbar/menu para
> `notebookEditorToolbar.tsx`; a Fase 2 extraiu constants, allowlists,
> type guards e formatadores puros para `notebookEditorUtils.ts`. Foram
> preservados handlers, seleção/range, autosave, paste, HTML persistido,
> atributos `data-*`, toolbars contextuais, imagens/assets, anexos, tabelas,
> callouts, equações e diagramas.
>
> **Update Fase 3A:** helpers DOM específicos de anexos foram isolados em
> `notebookEditorAttachmentDom.ts`, mantendo no editor os handlers e a ação
> assíncrona de remoção. A normalização do card, os controles `Abrir`,
> `Mostrar no sistema`/`Remover`, a limpeza dos controles antes da serialização
> e a localização segura do bloco de anexo seguem com o mesmo HTML persistido
> e os mesmos atributos `data-*`.
>
> **Update Fase 3B:** helpers DOM de `Diagrama/Grafo/Fluxograma` foram
> isolados em `notebookEditorDiagramDom.ts`. A normalização de blocos legados,
> a detecção de `data-athenaeum-block="diagram"`, a atualização de
> `data-diagram-kind`, a fonte editável e o preview textual continuam com o
> mesmo HTML persistido e sem renderizador visual novo. Inserção, seleção,
> autosave, paste, remoção e toolbar contextual permanecem no editor.
>
> **Update Fase 3C:** helpers DOM de `Callout` foram isolados em
> `notebookEditorCalloutDom.ts`. A detecção de
> `data-athenaeum-block="callout"`, a leitura/atualização de
> `data-callout-type`, a atualização do ícone e a normalização da estrutura
> interna (`data-callout-icon` e `data-callout-content`) seguem com os mesmos
> atributos e HTML persistido. Inserção, remoção, seleção, autosave, paste e
> toolbar contextual permanecem no editor.
>
> **Update Fase 3D:** helpers DOM de `Equação` foram isolados em
> `notebookEditorEquationDom.ts`. A detecção de
> `data-athenaeum-block="equation"`, a fonte `data-equation-source`, o preview
> `data-equation-preview`, a normalização de blocos incompletos e a limpeza do
> HTML renderizado antes da serialização seguem com os mesmos atributos e HTML
> persistido. A renderização KaTeX mantém `displayMode: true`,
> `throwOnError: false` e `trust: false`; inserção, remoção, seleção, autosave,
> paste e toolbar contextual permanecem no editor.
>
> **Update Fase 3E:** helpers DOM de `Figura/Imagem` foram isolados em
> `notebookEditorFigureDom.ts`. A hidratação runtime de
> `img[data-notebook-asset-id]` e a remoção do `src` antes da serialização
> seguem preservando o HTML salvo sem `data:image`, mantendo no editor os fluxos
> de clipboard, seletor de arquivo, `saveNotebookAsset`, `loadNotebookAssets`,
> seleção, autosave, paste e toolbars.
>
> **Update Diagrama SVG:** `data-diagram-kind="diagram"` ganhou preview visual
> runtime em SVG, sem dependência externa e sem alterar o HTML persistido. A
> fonte textual continua em `data-diagram-source`; relações `origem -> destino`
> são parseadas por `notebookDiagramParser.ts` e renderizadas por
> `NotebookDiagramPreview.tsx` como caixas conectadas por setas. Labels longos
> têm truncamento visual seguro, o SVG fica contido no card existente e casos
> inválidos continuam caindo no fallback textual. `graph` e `flowchart` seguem
> com o preview textual anterior.
>
> **Update Diagrama SVG multiline:** fontes com múltiplas relações no mesmo
> bloco agora são consolidadas como uma única área `data-diagram-source`, com
> suporte a `Shift+Enter` para quebra de linha dentro da fonte. O preview passa
> a renderizar todas as relações válidas do texto completo, por exemplo
> `Entrada -> Processamento -> Saída -> Revisão` como 4 nós e 3 setas. A linha
> da aresta usa `stroke` com token válido e `marker-end` para manter seta
> visível. Limitação conhecida: ciclos são aceitos pelo parser, mas ainda não
> são representados como curva/retorno visual.
>
> **Update Diagrama SVG estados:** o preview de
> `data-diagram-kind="diagram"` agora diferencia fonte vazia e fonte sem
> relações válidas, exibindo mensagens curtas com exemplo de sintaxe
> (`Entrada -> Processamento` / `Processamento -> Saída`). Quando há ao menos
> uma relação válida, o SVG runtime continua inalterado; linhas inválidas
> misturadas com válidas seguem sendo ignoradas com segurança. O HTML persistido
> permanece leve e `graph`/`flowchart` continuam com preview textual.
>
> **Update Diagrama 3:** `data-diagram-kind="flowchart"` ganhou preview visual
> runtime em SVG com sintaxe simples `A -> B`, reutilizando o parser de relações
> e mantendo `graph` no preview textual. O layout do fluxograma é vertical e
> determinístico, com nós terminais arredondados para `Início`/`Fim`; o HTML
> persistido segue leve, sem SVG runtime.
>
> **Ressalvas futuras (não bloqueiam MVP):** o preview de `flowchart` está
> funcional, mas visualmente pequeno em fluxos com várias etapas. Labels longos
> são truncados corretamente, mas o truncamento ainda está agressivo.
>
> **Update Fase 5A:** o parser `parseDiagramSource` ganhou cobertura mínima
> com Vitest. Os testes cobrem texto vazio, linhas vazias, relação simples,
> múltiplas relações, ordem de nós únicos, linhas inválidas, mistura de linhas
> válidas/inválidas, labels com acentos/Unicode e relações malformadas sem nós
> vazios. O parser permanece sem mudança de comportamento.
>
> ### Segurança / Dependências
>
> - Investigado `npm audit`: 9 vulnerabilidades reportadas, sendo 8 moderate e
>   1 high.
> - A origem principal está em dependências transitivas de
>   `@excalidraw/excalidraw@0.18.1`, especialmente
>   `@excalidraw/mermaid-to-excalidraw`, `@mermaid-js/parser`, `langium`,
>   `chevrotain`, `lodash-es` e `nanoid`.
> - `npm audit --omit=dev` reporta o mesmo conjunto, então o problema não vem
>   do Vitest.
> - `npm audit fix --force` foi descartado porque faria downgrade para
>   `@excalidraw/excalidraw@0.17.6`, com breaking change.
> - Decisão: manter como risco conhecido e reavaliar quando houver nova versão
>   do Excalidraw ou de suas dependências transitivas.

> **Update técnico 05/07/2026:** revisão de regressões da categoria `Inserir`
> no editor de Cadernos. Blocos ricos vazios (`Tabela`, `Callout`, `Diagrama`,
> `Equação`, `Figura` e `Arquivo`) agora contam como conteúdo real para não
> exibir placeholder sobre blocos inseridos. A inserção de blocos passa a
> reposicionar o cursor na linha vazia criada após o elemento, evitando que o
> caret volte para o bloco anterior. No Windows, `Mostrar no sistema` para
> anexos usa o caminho canonizado e chama o Explorer com `/select,` separado
> do arquivo para evitar abrir uma pasta incorreta quando há espaços no path.
> O visual de `Diagrama/Grafo/Fluxograma` também foi refinado para parecer um
> card único, com preview e fonte no mesmo contêiner. Limitações mantidas:
> diagramas seguem como prévia textual, sem SVG/canvas/renderizador visual.

> **Changelog técnico 05/07/2026:** `Inserir > Figura > Diagrama`,
> `Diagrama de grafo` e `Fluxograma` no editor de Cadernos agora usam uma
> base única de bloco (`data-athenaeum-block="diagram"`) com
> `data-diagram-kind="diagram" | "graph" | "flowchart"`. Cada bloco persiste
> HTML leve com prévia textual, fonte editável em texto puro e toolbar
> contextual para trocar o tipo ou remover o bloco. A implementação também
> normaliza placeholders antigos de figura/diagrama para o novo formato.
> Limitação conhecida: esta fase ainda não renderiza SVG/canvas nem usa
> biblioteca externa de diagramas; a prévia é textual e serve como base
> confiável para um renderizador visual futuro.

> **Changelog técnico 05/07/2026:** `Inserir > Arquivo` no editor de
> Cadernos deixou de ser placeholder e ganhou persistência inicial de anexos.
> A migration `v18` cria `notebook_file_attachments`; os bytes ficam em
> `notebook-attachments/{notebookId}/{pageId}/{attachmentId}/`, enquanto o
> HTML da página salva apenas `data-notebook-attachment-id`, sem base64 nem
> caminho absoluto. O backend valida IDs/nome de arquivo, aplica limite de
> 4MB, usa escrita temp+rename e registra metadados no SQLite.
>
> **Update 05/07/2026:** cards de anexo agora exibem ações `Abrir`,
> `Mostrar no sistema` e `Remover`. Essas ações enviam somente `attachmentId`
> ao backend, que busca `file_path` no banco antes de abrir/revelar/remover;
> ao remover, o registro é excluído e o arquivo físico é apagado quando ainda
> existe. Limitações conhecidas: ainda não há preview de PDF/imagem/vídeo,
> busca em anexos, múltiplos uploads, drag and drop, deduplicação por hash,
> limpeza global de órfãos ou sincronização em nuvem.

> **Changelog 05/07/2026:** a tela de Caderno foi reestruturada para uma
> experiência de editor em três áreas: trilho/lista de páginas à esquerda,
> editor central responsivo e drawer de detalhes à direita. O header agora
> usa breadcrumb centralizado (`Minha Biblioteca > Coleção > Caderno`), o
> painel de detalhes passou a exibir `Caderno`, `Coleção`, `Status de leitura`,
> `PDFs vinculados`, `Tags`, `Autor / disciplina`, `Criado`, `Atualizado` e
> `Última abertura`, e o footer do editor ganhou contagem de palavras/caracteres,
> modo `Foco` e zoom com presets. O modo Foco esconde laterais, centraliza o
> texto, usa toolbar reduzida (`Texto`, `Inserir`, `Mais opções`) e permite
> espaçamento independente (`Compacto`, `Normal`, `Confortável`, `Amplo`) para
> leitura/escrita longa. A toolbar normal também ganhou `Espaçamento` no menu
> `...`.
>
> **Changelog técnico 05/07/2026:** Cadernos ganharam tags próprias,
> metadados adicionais, PDFs vinculados e assets persistentes em disco. As
> migrations `v15`, `v16` e `v17` criam `notebook_tags`,
> `notebook_linked_documents`, `reading_status`, `author_discipline` e
> `notebook_assets`. Imagens coladas ou inseridas por `Inserir > Figura >
Imagem` são salvas em `notebook-assets/{notebookId}/{pageId}/` via
> `save_notebook_asset`, com allowlist PNG/JPEG/WebP/GIF, limite de 4MB,
> escrita temp+rename e proteção contra path traversal; o HTML da página salva
> apenas `data-notebook-asset-id`, sem `src="data:image..."`. O editor também
> passou a suportar tabelas editáveis com navegação por Tab, callouts com tipos
> `Info`, `Dica`, `Atenção` e `Perigo`, links com Ctrl+clique, e equações com
> fonte LaTeX editável renderizada por **KaTeX** (`throwOnError: false`,
> `trust: false`). Limitações conhecidas: KaTeX cobre preview matemático de
> bloco, ainda sem equação inline, numeração automática, referência cruzada ou
> macros globais persistentes; assets SVG, múltiplos uploads, drag and drop,
> compressão e galeria de assets ficam para etapas futuras.

> **Changelog 05/07/2026:** o painel de Ajustes passou a organizar as
> preferências em navegação lateral (`Geral`, `Aparência`, `Biblioteca`,
> `Avançado`) e ganhou a opção `Linhas divisórias`, persistida em
> `app_settings` (`show_divider_lines`), que oculta visualmente bordas/
> separadores sem remover a estrutura dos componentes. A seção de tags
> da sidebar de detalhes também foi refinada: pílulas e botões usam o
> mesmo raio do `+ Tag`, o dropdown fica contido na largura do painel, o
> texto dos inputs mantém contraste no modo escuro, a lixeira interna do
> seletor foi removida e o `x` flutuante das tags aplicadas permanece.
> Cards e detalhes agora compartilham o mesmo resolvedor de cor, usando
> os tokens existentes (`violet`, `indigo`, `blue`, `teal`, `rose`,
> `amber`) sem criar novos hex. Clique simples em uma tag aplicada cicla
> entre esses tons e persiste em `tags.color_token`; duplo clique renomeia
> inline e preserva o tom quando o novo nome ainda não existe. Limitação:
> a troca de cor é global por tag, não por documento; renomear para uma
> tag já existente assume a cor já registrada dessa tag.

> ❌ **Changelog 04/07/2026 — RETRATADO em 17/08/2026: esta feature nunca
> existiu em código.** A entrada descrevia uma seleção funcional de
> variante do ícone do app (`Frontão` / `Coluna`), persistida em
> `app_settings` como `icon_variant` e propagada por um provider global.
> Uma auditoria doc↔código não encontrou **nada**: nenhum
> `getSetting`/`setSetting("icon_variant")`, nenhum provider, nenhuma
> string `Frontão` ou `Coluna` em `src/`. O texto original foi removido
> para não seguir circulando como precedente.
>
> Por que isto importa mais que uma entrada errada: dois commits de agosto
> (o eixo de material) citaram `icon_variant` em comentários de código como
> "padrão já seguido" para justificar a própria arquitetura de
> persistência. A ficção estava se propagando. Esses comentários foram
> corrigidos junto com esta retratação.
>
> Resta **uma** menção que não pode ser removida: o comentário de
> `src-tauri/migrations/0014_add_app_settings.sql`. O `sqlx` guarda
> checksum do conteúdo da migration, então editar até o comentário
> quebraria bancos já migrados. Fica como artefato histórico — ao ler
> aquele arquivo, saiba que a única chave realmente persistida em
> `app_settings` naquele momento era nenhuma; hoje são
> `show_divider_lines`, `material_variant`, `reader.maximized`,
> `reader.view-preferences` e as duas de espaçamento do Caderno.

> 🗄️ **HISTÓRICO — resolvido pela migração para Konva em 10/07/2026.** A
> nota abaixo pressupõe `@excalidraw/excalidraw` ativo; a dependência não
> existe mais em `package.json` nem em `src/`, então o popup descrito não
> existe. Mantida como registro da decisão. Marcada em 17/08/2026.
>
> **Nota conhecida (03/07/2026):** o popup "Mais ferramentas" do Quadro
> mostra 4 itens em inglês (Web Embed, Laser pointer, Generate, Mermaid
> to Excalidraw) — traduções ausentes no locale pt-BR da própria lib
> @excalidraw/excalidraw@0.18.1, mesmo com a cobertura geral do idioma
> em 91%. Aceito como limitação conhecida: baixa visibilidade (exige
> abrir o popup), e esconder via CSS adicionaria fragilidade
> desproporcional ao ganho. Reavaliar apenas se a lib atualizar a
> tradução, ou se decidirmos contribuir a tradução faltante ao projeto
> Excalidraw upstream.

> **Changelog 03/07/2026:** revisão de decisão — o header dos painéis
> flutuantes (Quadro/Caderno/Leitor) deixou de ser fixo em `#14161F`
> independente do tema. Agora acompanha o tema do app via os tokens
> `--floating-header-*` e `--reader-header-*` (claro: fundo `var(--card)`
> = `#FAF5EF`; escuro: `var(--card)` = `#231C16`). O token `--surface-header`
> (`#14161F`) continua existindo no código mas não é mais usado nesses
> headers — mantido apenas por compatibilidade até uma limpeza futura
> remover as referências órfãs, se houver.

> **Changelog 03/07/2026:** adicionado token `accent-tint-bg` (#EFE2D8) —
> fundo de destaque para ferramenta ativa na toolbar de Quadros, extraído
> por amostragem de pixel do protótipo Claude Design em 03/07/2026.

> Referência de design system. Validado em WCAG AA (contraste mínimo
> 4.5:1, critério de texto pequeno) via fórmula de luminância relativa
> do WCAG. Última atualização: 01/07/2026.
>
> **Changelog 01/07/2026:** (4) `accent-interactive` trocado de indigo
> (`#4F46E5`/`#6366F1`) para terracota/cobre (`#9C5A2E`) — hue do
> indigo estava a apenas ~20–25° do Violet das tags, causando colisão
> visual no dark mode onde ambos eram as únicas cores saturadas da
> tela. Terracota validado: contraste texto branco 5.36:1. Mesmo hex
> nos dois modos (sem variante dark separada). Aplicado em: ícone do
> logo, botão "+ Adicionar", barra de progresso de leitura, toggle de
> painel ativo, aba ativa no painel de anotações.
>
> **Changelog 30/06/2026:** (1) texto secundário estava com contraste
> abaixo do mínimo no modo claro real do app (~3.9–4.1:1, medido por
> amostragem de pixel no protótipo "Redesign Library View" do Figma
> Make) — corrigido. (2) O protótipo adotou pílulas de tag com
> **fill sólido** (bg saturado + texto branco) em vez do pastel
> original — este documento agora registra os dois estilos, com o
> fill sólido marcado como padrão atual de produção. (3) mapeamento
> palavra-chave→cor expandido: o rascunho de 20/06 só cobria um
> acervo de CS/IA; o protótipo real trouxe 21 palavras-chave
> diferentes (Philosophy of Mind, Urban Studies, Cognitive Science
> etc.), cada uma com hex individual hardcoded no código — consolidado
> de volta pros 9 tokens abaixo.

## Contexto

App desktop open source para organizar biblioteca pessoal de PDFs/
artigos acadêmicos. Stack: Tauri + React + TypeScript + Tailwind CSS +
SQLite (FTS5) + pdf.js. Esta paleta substitui as cores pastel geradas
inicialmente pelo Figma Make na tela "Library View", que falhavam
contraste em texto pequeno (tags de 12-13px).

**Direção visual do protótipo atual** ("Redesign Library View"): warm
minimalism — fundo creme quente (`#F5EDE4` claro / `#1A1410` escuro),
nunca branco puro ou cinza frio, com terracota/cobre `#9C5A2E` como
accent (único valor, claro e escuro). Os tokens de tag e texto
secundário abaixo já refletem essa paleta quente, não um fundo branco
genérico.

## Paleta de tags — pastel (bg claro + texto escuro)

Estilo original, ainda válido para qualquer lugar que precise de uma
pílula "leve" (ex: badge dentro de um card já colorido, hover state):

| Nome   | Background | Texto     | Contraste | Uso sugerido                               |
| ------ | ---------- | --------- | --------- | ------------------------------------------ |
| Violet | `#EDE9FE`  | `#5B21B6` | 7.56:1    | Tema/assunto principal                     |
| Indigo | `#E0E7FF`  | `#4338CA` | 6.42:1    | Tema/assunto principal                     |
| Blue   | `#DBEAFE`  | `#1D4ED8` | 5.49:1    | Subcategoria                               |
| Teal   | `#CCFBF1`  | `#0D5C54` | 6.97:1    | Subcategoria                               |
| Green  | `#D1FAE5`  | `#036B4D` | 5.75:1    | Estado positivo (ex: concluído)            |
| Amber  | `#FEF3C7`  | `#92400E` | 6.37:1    | Atenção / destaque                         |
| Rose   | `#FCE7F3`  | `#9D174D` | 6.71:1    | Subcategoria                               |
| Red    | `#FEE2E2`  | `#B91C1C` | 5.30:1    | Erro / exclusão (não usar como tag normal) |
| Slate  | `#E2E8F0`  | `#475569` | 6.15:1    | Estados neutros (ex: badge "Não iniciado") |

## Paleta de tags — fill sólido (padrão atual das pílulas de tag)

O protótipo atual usa pílula com fundo saturado + texto branco fixo.
Reaproveita a coluna "Texto" da tabela pastel acima como o novo
**Background**, então nenhum hex novo precisou ser inventado:

| Nome   | Background (= texto pastel) | Texto     | Contraste | Uso sugerido           |
| ------ | --------------------------- | --------- | --------- | ---------------------- |
| Violet | `#5B21B6`                   | `#FFFFFF` | 8.98:1    | Tema/assunto principal |
| Indigo | `#4338CA`                   | `#FFFFFF` | 7.90:1    | Tema/assunto principal |
| Blue   | `#1D4ED8`                   | `#FFFFFF` | 6.70:1    | Subcategoria           |
| Teal   | `#0D5C54`                   | `#FFFFFF` | 7.85:1    | Subcategoria           |
| Green  | `#036B4D`                   | `#FFFFFF` | 6.53:1    | Estado positivo        |
| Amber  | `#92400E`                   | `#FFFFFF` | 7.09:1    | Atenção / destaque     |
| Rose   | `#9D174D`                   | `#FFFFFF` | 7.88:1    | Subcategoria           |
| Red    | `#B91C1C`                   | `#FFFFFF` | 6.47:1    | Erro / exclusão        |
| Slate  | `#475569`                   | `#FFFFFF` | 7.58:1    | Estados neutros        |

Pior caso é Red a 6.47:1 — todos folgados acima do mínimo de 4.5:1.

## Texto secundário (metadados, datas, percentuais)

> A versão de 20/06 assumia fundo branco/`#FAFAFA` genérico. O app
> real não usa branco — usa a paleta creme quente abaixo.

> ⚠️ **Este token vive sobre SEIS superfícies, não uma.** Até 17/08/2026
> esta seção validava o tom apenas contra `--card`, e essa omissão foi a
> causa raiz de um bug de acessibilidade que durou meses: o valor passava
> em `--card` e falhava em quatro das outras cinco. Ao mexer neste token,
> verifique a tabela completa abaixo — não só `--card`.

> ⚠️ **REGRA (para quem for corrigir): não usar `color-mix` para derivar
> este token.** A constatação abaixo é medida e continua verdadeira; o que
> mudou é que ela hoje descreve o produto em vez de um erro já corrigido —
> os níveis 90 e 110 da escada voltaram a ser `color-mix` na reversão de
> 18/08, com a dessaturação que isso implica. A primeira
> correção do bug acima (17/08/2026, manhã) usou
> `color-mix(in srgb, var(--foreground) 72%, var(--background))`, que
> fechava AA mas **dessaturava o tom**: hue `23°` → `30°`, saturação
> `0.162` → `0.074` — perda de 54%. `color-mix(in srgb, ...)` interpola
> linear nos canais R/G/B gama-codificados, não em HSL; misturar um tom
> cromático com um neutro quase acromático sempre puxa para cinza. Numa
> paleta cuja premissa é "warm minimalism, nunca cinza frio" (ver
> Contexto, acima), isso é regressão de identidade — e um teste de
> contraste numérico **não pega isso sozinho**, porque o valor dessaturado
> ainda passava AA. Foi corrigido horas depois (mesmo dia) derivando os
> hexes em HSL a partir da cor de origem, preservando hue/saturação e
> variando só luminosidade. `--border` é a exceção deliberada: é traço
> fino/divisor, não texto, e continua em `color-mix` — a identidade
> cromática importa para o que se lê, não para o que separa.

**Modo claro** — `--muted-foreground`, hex fixo:

```css
--muted-foreground: #7A6558;
```

Corrigiu um `#8B7263` ainda pior em 30/06. Subiu para `#665449` em 17/08 e
**voltou para cá em 18/08**, na reversão — ver a entrada do topo.

| Superfície | Valor | `#7A6558` (hoje) | `#665449` (correção revertida) |
| --- | --- | --- | --- |
| `--background` / `surface-app` | `#F5EDE4` | 4.73:1 ✅ | 6.18:1 ✅ |
| `--card` / `surface-card`, `surface-panel` | `#FAF5EF` | 5.06:1 ✅ | 6.61:1 ✅ |
| `--sidebar` | `#EDE5DA` | **4.39:1** ❌ | 5.74:1 ✅ |
| `--muted` / `surface-muted` | `#EDE5DA` | **4.39:1** ❌ | 5.74:1 ✅ |
| `--input` / `surface-subtle` | `#EDE5DA` | **4.39:1** ❌ | 5.74:1 ✅ |
| `--color-sidebar-raised` | `#D8CCBD` | **3.47:1** ❌ | 4.54:1 ✅ |
| `--notebook-focus-bar-bg` | `#F6F0E8` | 4.83:1 ✅ | 6.33:1 ✅ |

**Quatro das sete superfícies estão abaixo de AA, e isso é dívida aceita**
(entrada do topo). Não são casos de borda: a pílula "+N" de tags extras vive
sempre sobre `--muted`, o hover da list row troca o fundo para `--muted`, e
o hover dos itens da sidebar usa `--color-sidebar-raised` — o pior caso, em
3.47:1.

O tom **passa** sobre a superfície glass mais escura do claro (`#F4ECE3`,
4.69:1). Foi o trabalho de glass que originou a investigação de contraste, e
é por isso que a correção pôde sair sem prejudicá-lo.

**Modo escuro** — sobre `--card` `#231C16`:

- Cor: `#9E8878` _(sem alteração — já passava nas seis; hue 25.3°, sat
  0.164, mesma família de origem que o claro)_
- Contraste: 5.00:1 sobre `--card`; pior superfície 4.68:1 (`--muted`
  `#2E2018`)
- **Não usar tom mais claro que este.**

**`--color-sidebar-muted`** é um token separado que segue o mesmo histórico:
no claro é `#7A6558` (o mesmo valor de `--muted-foreground`) e fica em
**4.39:1** sobre `--sidebar` — abaixo de AA, dívida aceita. No escuro é
`#9E8878` (5.66:1 sobre `--sidebar`, passa).

`src/styles/mutedForegroundContrast.test.ts` lê o `index.css` e recalcula o
contraste a cada `npm test`. ⚠️ Desde 18/08 ele **não valida conformidade**:
trava o inventário medido, com as violações marcadas `passaAA: false`. Ele
quebra se qualquer valor mudar — inclusive para melhor. Se você estiver
corrigindo um destes tons, atualizar o inventário faz parte da correção.

### Níveis de "Contraste da interface"

O stepper de Ajustes › Aparência redefine `--muted-foreground`,
`--color-sidebar-muted` e `--border` por `color-mix`. Os níveis são
**90 / 100 / 110**, e o 100 é o **meio**, não o piso.

⚠️ **O nível 90 reduz contraste abaixo do legível** — um controle de
contraste cujo mínimo derruba o texto secundário para 2.18:1 no pior caso do
claro. Isso é conhecido e **aceito** (ver a entrada do topo); foi removido em
17/08 e voltou na reversão de 18/08.

Como `color-mix` interpola contra `--foreground`/`--background`, um bloco
só serve aos dois temas: `html[data-ui-contrast="N"]` sem par escuro. É a
adaptação automática que os hexes fixos da correção revertida perdiam — e o
motivo de aquela versão precisar de blocos separados por tema.

`--muted-foreground`, com o pior caso de cada tema:

| Nível | Claro | Pior claro | Escuro | Pior escuro |
| --- | --- | --- | --- | --- |
| 90 | `#908982` | **2.18:1** ❌ | `#7C766F` | **3.50:1** ❌ |
| 100 (default) | `#7A6558` | **3.47:1** ❌ | `#9E8878` | 4.68:1 ✅ |
| 110 | `#605954` | **4.35:1** ❌ | `#ACA49D` | 6.40:1 ✅ |

O pior caso do claro é sempre `--color-sidebar-raised` (`#D8CCBD`); o do
escuro é sempre `--muted`/`--input` (`#2E2018`). **Nenhum nível do tema
claro fecha AA em todas as superfícies** — nem o 110.

`--color-sidebar-muted` sobre `--sidebar`:

| Nível | Claro | Contraste | Escuro | Contraste |
| --- | --- | --- | --- | --- |
| 90 | `#988B81` | **2.65:1** ❌ | `#756E68` | **3.80:1** ❌ |
| 100 (default) | `#7A6558` | **4.39:1** ❌ | `#9E8878` | 5.66:1 ✅ |
| 110 | `#66564D` | 5.60:1 ✅ | `#AEA79F` | 8.00:1 ✅ |

Todos esses valores estão travados como inventário em
`mutedForegroundContrast.test.ts` — que os afirma, não os exige.

## Texto principal e seleção na biblioteca

Esses valores cobrem títulos fortes e estados selecionados da Home, incluindo
sidebar esquerda, título `Athenaeum`, nome da coleção ativa e o título da
coleção aberta.

**Modo claro** — sobre `--sidebar` `#EDE5DA` e superfícies claras da biblioteca:

- Cor: `#2C1810`
- Uso: texto principal da sidebar e títulos/itens selecionados

**Modo escuro** — sobre `--sidebar` `#140F0B` e superfícies escuras da biblioteca:

- Cor: `#F0E8DF`
- Uso: texto principal da sidebar e títulos/itens selecionados

## Regras de uso

1. Cada par bg/texto já foi validado — não trocar o tom de texto por
   um mais claro mesmo que pareça "mais bonito". Isso quebra o
   contraste calculado.
2. A mesma palavra-chave de tag deve sempre usar o mesmo par de cor em
   todas as telas. Ver mapeamento fechado na seção "Mapeamento
   palavra-chave → cor" abaixo. **Nunca gerar um hex novo por tag** —
   se a palavra-chave não está no mapeamento, escolher o token
   existente cujo "papel" mais se aproxima, e adicionar a linha na
   tabela (não inventar tom vizinho).
3. Red é reservado para erro/exclusão, não para tags de assunto.
4. Estes tokens cobrem tags e badges de status. Cor do ícone por
   documento na lista (se representa coleção, tipo de arquivo, ou é
   decorativo) é uma decisão separada, ainda em aberto.
5. Entre pastel e fill sólido: fill sólido é o padrão atual de
   produção pra pílulas de tag. Pastel fica disponível pra outros usos
   (hover, badge dentro de área já colorida) — não misturar os dois
   estilos pra tags dentro da mesma tela.

## Mapeamento palavra-chave → cor (tags de assunto)

> **Status: expandido em 30/06/2026.** A versão de 20/06 cobria só um
> acervo de CS/IA com 2 exemplos confirmados. O protótipo real trouxe
> coleções de Filosofia, Design, Urbanismo e Ciência Cognitiva — as
> 21 palavras-chave que apareceram foram consolidadas nos 9 tokens
> existentes por papel semântico (tema principal / subcategoria /
> destaque / estado), não por área de conhecimento.

> ⚠️ **Existem DOIS sistemas de resolução em código, não um.** A tabela
> abaixo descreve fielmente `tagColors.ts`. Ela **não** descreve o que as
> pílulas de tag da Library exibem — essas passam por `designTokens.ts`,
> que tem outra lista e outra estratégia. Verificado em 17/08/2026.

| | `tagColors.ts` | `designTokens.ts` |
| --- | --- | --- |
| Função | `resolveTagColor` | `getSubjectTagTone` |
| Quem consome | Realce e cor de fonte no Caderno, color-picker de Coleção, preenchimento de forma no Quadro | **Pílulas de tag da Library** (`TagBadge`, `TagPill`) |
| Palavras-chave explícitas | 27 (a tabela abaixo) | **6** — uma por tom |
| Tokens alcançáveis | os 9 | **6** (sem green/slate/red) |
| Fallback | `'slate'`, fixo | casamento por substring, depois **hash da string** |

O sistema da Library resolve pelo tom registrado no banco
(`tags.color_token`), depois por igualdade exata numa lista de 6, depois
por **substring nos dois sentidos** — é isso que faz `Systems` → indigo
(contido em "systems / infra"), `Vision` → teal, `Math`/`Theory` → rose,
`Ethics` → amber e `Learning` → violet (contido em "machine learning") —
e só então por hash. Tag vazia ou nula → indigo.

**Das 23 palavras de assunto da tabela abaixo, a Library resolve 10 para o
tom documentado, e só 6 por projeto** — as outras 4 (`Deep Learning`,
`Transformers`, `Neuroscience`, `Seminal`) acertam por coincidência do
hash. As 13 restantes divergem: `Consciousness`→amber,
`Philosophy`→teal, `Urbanismo`→blue, `Cognition`→blue, `Design
Systems`→blue, `Typography`→amber, `Accessibility`→blue,
`Language`→violet, `Perception`→amber, `Epistemologia`→violet,
`Memory`→teal, `Sociologia`→indigo, `Reinf. Learning`→blue.

### Limitação conhecida: o hash é sensível à caixa

`getSubjectTagTone` soma `charCodeAt` da string **original**, não da
normalizada que ele próprio calcula duas linhas acima. Consequência:

| Tag | Tom |
| --- | --- |
| `Deep Learning` | violet |
| `deep learning` | rose |
| `Seminal` | amber |
| `seminal` | indigo |

**Isso contradiz a regra 2 desta página** ("a mesma palavra-chave de tag
deve sempre usar o mesmo par de cor em todas as telas"). Registrado como
limitação conhecida, **não corrigido** — fica para uma leva própria. O
alcance prático é limitado: uma tag já gravada no banco passa por
`registerSubjectTagTone` e fica estável; o hash só decide antes disso.

| Cor    | Papel                | Palavras-chave                                                                   |
| ------ | -------------------- | -------------------------------------------------------------------------------- |
| Violet | Tema principal       | Machine Learning, Consciousness, Philosophy, Deep Learning, Urbanismo, Cognition |
| Indigo | Tema principal       | Systems / Infra, Design Systems, Typography, Accessibility                       |
| Blue   | Subcategoria         | NLP, Transformers, Language                                                      |
| Teal   | Subcategoria         | Computer Vision, Neuroscience, Perception                                        |
| Rose   | Subcategoria         | Theory / Math, Epistemologia, Memory, Sociologia, Reinf. Learning                |
| Amber  | Destaque             | AI Safety / Ethics, Seminal                                                      |
| Green  | Estado (não-assunto) | Concluído                                                                        |
| Slate  | Estado (não-assunto) | Não iniciado, Review                                                             |
| Red    | Estado (não-assunto) | Erro / exclusão                                                                  |

Green, Slate e Red **nunca** devem ser usados para tags de assunto —
estão reservados para badges de estado.

⚠️ **Nota de produto, não só técnica:** ao consolidar assim, "Violet"
passa a aparecer em Philosophy of Mind, Machine Learning, Urban
Studies e Cognitive Science ao mesmo tempo — o token identifica o
_papel_ da tag (tema principal), não a área de conhecimento nem a
coleção. Se no futuro você quiser que cada coleção tenha uma
identidade de cor mais exclusiva, esse mapeamento precisa ser revisto
(provavelmente separando "cor por coleção" de "cor por tag", que hoje
são dois sistemas sobrepostos).

## Cores de interface (chrome / elementos interativos)

> Diferente da paleta de tags acima (conteúdo: assunto, status), estas
> cores são da casca do app — header, toolbars, estados ativos.

| Nome                         | Valor                                                             | Uso                                                                                                                                                                                                                              |
| ---------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `surface-header`             | `#14161F`                                                         | ⚠️ **Histórico.** Descrito como "fundo do header/top bar" até 17/08/2026, mas os headers migraram para `--card` em 03/07 (ver nota abaixo). Único consumidor real hoje: o toast de carregamento do painel de Quadro (`LibraryView.tsx:999`). |
| `surface-elevated`           | `#1E2130`                                                         | Fundo de elementos flutuantes escuros (toolbar de seleção, toolbar de formatação)                                                                                                                                                |
| `accent-interactive`         | `#9C5A2E`                                                         | Ícone do logo, botão "+ Adicionar", barra de progresso de leitura, toggle de painel ativo, aba ativa no painel de anotações. **Mesmo hex em claro e escuro — sem variante separada.**                                            |
| `accent-icon-amber`          | `#F59E0B`                                                         | Borda de destaque do aviso de exportação grande no Caderno (`NotebookContent.tsx:2405`). ⚠️ Descrito como "ícone Marcar ativo na toolbar de seleção" até 17/08/2026 — a `SelectionToolbar` **nunca** consumiu este token; seu estado ativo usa `text-white`. |
| `accent-tint-bg`             | `#EFE2D8`                                                         | Fundo de destaque em estado "ativo" de botões de ferramenta (ex: toolbar do Quadro) — tint sutil de terracota sobre o accent. Diferente do fill sólido das tags: aqui o texto/ícone continua na cor accent por cima, não branco. |
| `sidebar-text`               | claro `#2C1810`; escuro `#F0E8DF`                                 | Texto principal da sidebar, título `Athenaeum`, título da coleção aberta e itens selecionados da navegação/biblioteca.                                                                                                           |
| `sidebar-muted`              | claro `#7A6558`; escuro `#9E8878`                                 | Itens não selecionados da sidebar, ações secundárias e metadados leves da navegação. Vive sobre `--sidebar` **e** `--color-sidebar-raised` (hover). ⚠️ No claro **falha AA nas duas** (4.39:1 e 3.47:1) — dívida aceita na reversão de 18/08/2026.                          |
| `document-cover-hue`         | hue derivado do documento                                         | Base determinística das miniaturas de documento; o hue é estável por documento e a saturação/luminosidade mudam por tema.                                                                                                        |
| `document-cover-swatch`      | claro `hsl(hue 28% 74%)`; escuro `hsl(hue 30% 18%)`               | Fundo principal da área de preview dos cards de documento.                                                                                                                                                                       |
| `document-cover-line`        | claro `hsl(hue 28% 34% / 0.24)`; escuro `rgb(255 255 255 / 0.08)` | Linhas secundárias internas das miniaturas.                                                                                                                                                                                      |
| `document-cover-line-strong` | claro `hsl(hue 30% 30% / 0.34)`; escuro `rgb(255 255 255 / 0.15)` | Linhas internas mais fortes das miniaturas.                                                                                                                                                                                      |
| `empty-state-detail`         | claro `#D9C5B4`; escuro `#463A31`                                 | Linhas internas secundárias das ilustrações de ícone de estado vazio (busca sem resultados, coleção/painel de anotações vazios). Contraste baixo é intencional — é detalhe decorativo, não texto.                              |

Regra: `accent-icon-amber` não substitui o par `tag-amber-bg`/`tag-amber-text`
documentado acima — são usos diferentes (ícone vívido vs. texto sobre fundo
claro). Não usar um no lugar do outro.

> **Nota sobre a troca de accent (01/07/2026):** o indigo anterior
> (`#4F46E5` claro / `#6366F1` escuro) ficava a apenas ~20–25° de hue
> do Violet das tags (`#5B21B6`, hue 263°), causando colisão visual no
> dark mode. O terracota (`#9C5A2E`, hue 24°) fica a ~239° de distância
> do Violet — sem sobreposição possível com nenhum dos 9 tokens de tag.

## Prompt para colar no Figma Make

```
Aplique esses tokens de cor em todas as tags, badges de status e texto
secundário, substituindo as cores pastel/fill-sólido atuais:

TEXTO SECUNDÁRIO (metadados, datas, percentuais):
- Modo claro: #7A6558
- Modo escuro: #9E8878
Não usar tom mais claro que esses — são o limite mínimo aceitável.
Esse tom aparece sobre SEIS superfícies diferentes, não só sobre o card.
A mais escura delas é #D8CCBD (hover da sidebar): valide contra ela, que
é o pior caso, não contra o fundo do card.
Atenção: o tom claro NÃO fecha AA em quatro das sete superfícies (pior
caso 3.47:1). É dívida aceita por decisão de produto, não meta atingida —
não apresente esses valores como conformes.

TAGS (fill sólido — bg saturado + texto branco fixo #FFFFFF):
- Violet #5B21B6 — Consciousness, Philosophy, Deep Learning, Urbanismo, Cognition
- Indigo #4338CA — Design Systems, Typography, Accessibility
- Blue   #1D4ED8 — NLP, Transformers, Language
- Teal   #0D5C54 — Computer Vision, Neuroscience, Perception
- Rose   #9D174D — Epistemologia, Memory, Sociologia, Reinf. Learning
- Amber  #92400E — Ethics, Seminal
- Slate  #475569 — Review, Não iniciado
- Green  #036B4D — Concluído (estado, não usar como tag de assunto)
- Red    #B91C1C — Erro/exclusão (estado, não usar como tag de assunto)

Cada palavra-chave usa sempre o mesmo par de cor em todas as telas —
não gerar um hex novo por tag, mesmo que pareça "mais bonito" ou mais
distinto visualmente.
```

## Prompt para colar no Claude Design

```
An interactive prototype from these mocks. Apply the color tokens from
athenaeum-design-tokens-cores.md to all tags, status badges, and
secondary text.

Secondary text (metadata, dates, percentages):
- Light mode: #7A6558
- Dark mode: #9E8878
Note: the light tone does NOT meet WCAG AA on four of the seven surfaces
(worst case 3.47:1). This is accepted debt by product decision — do not
present these values as conformant.
Do not lighten these tones even if it looks "nicer". This tone sits on SIX
different surfaces, not
just the card. The darkest is #D8CCBD (sidebar hover) — validate against
that worst case, not against the card background.

Tags use solid-fill pills (saturated bg + fixed white #FFFFFF text).
Use this fixed keyword-to-color mapping, and do not invent new colors
for these keywords across screens:
- Violet #5B21B6 — Consciousness, Philosophy, Deep Learning, Urbanismo, Cognition
- Indigo #4338CA — Design Systems, Typography, Accessibility
- Blue   #1D4ED8 — NLP, Transformers, Language
- Teal   #0D5C54 — Computer Vision, Neuroscience, Perception
- Rose   #9D174D — Epistemologia, Memory, Sociologia, Reinf. Learning
- Amber  #92400E — Ethics, Seminal
- Slate  #475569 — Review, Não iniciado

Green (#036B4D) and Red (#B91C1C) are reserved for status badges only
(concluído / erro-exclusão respectively) — never use them for subject
tags.
```

## Próximos passos (quando for para código/Tailwind)

Ao implementar, estes pares devem virar variáveis de tema (ex:
`tag-violet-bg`, `tag-violet-text`, `accent-interactive`) em vez de
hex hardcoded em componentes — facilita manutenção e mantém o
contraste validado centralizado em um único lugar.

Telas finalizadas no protótipo (Figma Make) e prontas para spec de
implementação:

- Library View (grid + list, claro + escuro)
- Modal Adicionar Documento (4 estados: vazio, revisão 1 arquivo,
  revisão lote, importando/status)
- PDF Reader (header, área de leitura, painel de anotações com 3
  abas, toolbar de highlight, toolbar de formatação de texto)
- Modal Nova Coleção (nome + descrição + color picker)

Telas ainda sem design próprio (implementar como variação da
Library View, sem necessidade de spec separada):

- Recentes, Favoritos, Lixeira — mesma estrutura, filtro diferente
- List view — mesmo card em layout de linha, toggle já visível

Telas que precisam de design antes de codar:

- Settings/Ajustes — sem spec ainda
