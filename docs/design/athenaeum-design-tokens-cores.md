# Athenaeum — Tokens de Cor (Tags, Badges, Texto Secundário)

> **Changelog 17/08/2026 (noite) — Borda de componente interativo e divisória
> deixam de compartilhar token.**
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
> preservam hue/saturação.** `color-mix(in srgb, var(--foreground) 72%,
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

> ⚠️ **REGRA: não usar `color-mix` para derivar este token.** A primeira
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

**Modo claro** — `--muted-foreground`, hex fixo, derivado em HSL a partir de
`#7A6558` (hue 22.9°, sat 0.162), preservando hue/saturação e variando só a
luminosidade:

```css
--muted-foreground: #665449;
```

Era o literal `#7A6558` (que por sua vez corrigiu um `#8B7263` ainda pior,
em 30/06), depois brevemente um `color-mix` dessaturado (ver regra acima).
`#665449` fecha AA nas seis superfícies preservando o tom. **Não usar tom
mais claro que este.**

| Superfície | Valor | `#665449` (hoje) | `#7A6558` (original) |
| --- | --- | --- | --- |
| `--background` / `surface-app` | `#F5EDE4` | 6.18:1 ✅ | 4.73:1 ✅ |
| `--card` / `surface-card`, `surface-panel` | `#FAF5EF` | 6.61:1 ✅ | 5.06:1 ✅ |
| `--sidebar` | `#EDE5DA` | 5.74:1 ✅ | **4.39:1** ❌ |
| `--muted` / `surface-muted` | `#EDE5DA` | 5.74:1 ✅ | **4.39:1** ❌ |
| `--input` / `surface-subtle` | `#EDE5DA` | 5.74:1 ✅ | **4.39:1** ❌ |
| `--color-sidebar-raised` | `#D8CCBD` | 4.54:1 ✅ | **3.47:1** ❌ |
| `--notebook-focus-bar-bg` | `#F6F0E8` | 6.33:1 ✅ | 4.83:1 ✅ |

As três superfícies que falhavam não eram casos de borda: a pílula "+N" de
tags extras vive sempre sobre `--muted`, o hover da list row troca o fundo
para `--muted`, e o hover dos itens da sidebar usa `--color-sidebar-raised`
— que também é o pior caso do tom corrigido (4.54:1, a margem mais estreita
das sete).

**Modo escuro** — sobre `--card` `#231C16`:

- Cor: `#9E8878` _(sem alteração — já passava nas seis; hue 25.3°, sat
  0.164, mesma família de origem que o claro)_
- Contraste: 5.00:1 sobre `--card`; pior superfície 4.68:1 (`--muted`
  `#2E2018`)
- **Não usar tom mais claro que este.**

**`--color-sidebar-muted`** é um token separado, com o mesmo histórico e a
mesma correção: era `#7A6558` e falhava nas duas superfícies da sidebar. Hoje
no claro é o hex fixo `#665449` — **o mesmo valor** de `--muted-foreground`,
não por acaso: os dois nascem do mesmo hue/sat de origem, e o par de
superfícies mais restritivo em ambos os casos é o mesmo
(`--color-sidebar-raised`). Fecha 5.74:1 sobre `--sidebar` e 4.54:1 sobre
`--color-sidebar-raised`. No escuro segue `#9E8878` (5.00:1 / 5.66:1).

`src/styles/mutedForegroundContrast.test.ts` lê o `index.css` e recalcula
contraste **e** hue/saturação a cada `npm test` — o segundo é o que trava a
regressão de identidade que o teste de contraste sozinho deixou passar.

### Níveis de "Contraste da interface"

O stepper de Ajustes › Aparência redefine `--muted-foreground` e
`--color-sidebar-muted` por hex fixo (derivado em HSL, ver regra acima) e
`--border` por `color-mix` (inalterado — não é texto). **100 é o piso, não o
meio.** Havia um nível 90 que levava as seis superfícies a 2.95:1–3.74:1 — um
controle de contraste cujo mínimo reduzia contraste abaixo do legível.
Removido em 17/08/2026.

Como hex fixo não se adapta a `--foreground`/`--background` como o mix
fazia, cada nível tem blocos **separados por tema**:
`html[data-ui-contrast="N"]` para o claro e
`.dark[data-ui-contrast="N"]` para o escuro (vence por especificidade, mesmo
padrão do eixo de material). Travado por teste: todo nível claro tem de ter
o par escuro correspondente.

| Nível | `--muted-foreground` claro | Pior claro | `--muted-foreground` escuro | Pior escuro |
| --- | --- | --- | --- | --- |
| 100 (default) | `#665449` | 4.54:1 | `#9E8878` (inalterado) | 4.68:1 |
| 110 | `#4B3E36` | 6.51:1 | `#B5A497` | 6.53:1 |
| 120 | `#362D27` | 8.51:1 | `#C9BDB4` | 8.55:1 |

`--color-sidebar-muted` sobre as suas duas superfícies (`--sidebar` e
`--color-sidebar-raised`):

| Nível | Claro | Pior claro | Escuro | Pior escuro |
| --- | --- | --- | --- | --- |
| 100 (default) | `#665449` | 4.54:1 | `#9E8878` (inalterado) | 5.00:1 |
| 110 | `#4B3E36` | 6.51:1 | `#B09E90` | 6.52:1 |
| 120 | `#362D27` | 8.51:1 | `#C4B6AC` | 8.51:1 |

No escuro os dois tokens **divergem** a partir do 110 — `--color-sidebar-muted`
só precisa satisfazer duas superfícies mais escuras que o pior caso de
`--muted-foreground` (`--muted`/`--input`, mais claro que `--sidebar`/
`--card`), então a mesma meta de contraste é alcançada com menos
luminosidade. No claro os dois convergem para os mesmos três hexes porque a
superfície mais restritiva (`--color-sidebar-raised`) é compartilhada.

Um nível novo tem de ficar **acima** do anterior, passar AA nas superfícies
do seu tema, **e** manter hue/saturação a até 4° e 0.02 da cor de origem. Os
três requisitos são travados por teste.

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
| `sidebar-muted`              | claro `#665449` (hex fixo, derivado em HSL); escuro `#9E8878`     | Itens não selecionados da sidebar, ações secundárias e metadados leves da navegação. Vive sobre `--sidebar` **e** `--color-sidebar-raised` (hover) — era `#7A6558` e falhava AA nas duas até 17/08/2026.                          |
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
- Modo claro: #665449
- Modo escuro: #9E8878
Não usar tom mais claro que esses — são o limite mínimo aceitável.
Esse tom aparece sobre SEIS superfícies diferentes, não só sobre o card.
A mais escura delas é #D8CCBD (hover da sidebar): valide contra ela, que
é o pior caso, não contra o fundo do card.

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
- Light mode: #665449
- Dark mode: #9E8878
Do not lighten these tones even if it looks "nicer" — this breaks the
calculated WCAG AA contrast. This tone sits on SIX different surfaces, not
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
