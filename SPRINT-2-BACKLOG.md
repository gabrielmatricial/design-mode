# Backlog desenvolvido — Sprint 2 (specs, sem implementação)

Este backlog consolida nove demandas para o `design-mode` (arquivo único `C:/Users/User/Music/design-mode/design-mode.js`), todas orientadas a um único norte: **reduzir a perda de intenção visual no caminho humano→agente**. Hoje o que o humano enxerga e quer (cor certa, espaçamento, "isso devia combinar com aquilo", "mexe nesse card e não no irmão", "era fluido, não chumba em px") chega ao agente programador como geometria crua + texto solto, ou simplesmente não chega. Cada demanda abre ou endurece um canal de comunicação — proveniência de unidade, tokens do próprio design system, vizinhança estrutural, vocabulário estável de referência, intenção relacional A→B e, no fim, a prova determinística de que o agente entregou (round-trip). O backlog está ordenado para entregar valor cedo (quick wins de export puro), construir a fundação headless de tokens no meio e fechar o ciclo com o capstone de verificação, mantendo as invariantes do projeto: arquivo único IIFE, `node --check`, `file://`, e **modo SELECT nunca muta o DOM da página** (só overlays `dm-` e leitura).

---

## Roadmap

### Ondas (ordem de entrega)

| Onda | Tema | Itens | Por quê nesta posição |
|---|---|---|---|
| **1** | Quick wins isolados (export-only, prontos) | `unit-warn`, `context-bundle` | Ambos com verdict **ready**, 100% pura-leitura, sem overlay novo, sem dependência cruzada, tocando só o pipeline de export (`markBaseline`/`buildSpec`/`specMarkdown`/`copyNotes`). Entregam valor imediato e estabilizam o pipeline de export ANTES das ondas pesadas. `unit-warn` deve gatear o probe só no gesto de **RESIZE** (não no drag) e tratar `calc()`/`clamp()` como relativo honesto; `context-bundle` deve montar `openTag` por `el.attributes` com whitelist (não `outerHTML` cru) pra não vazar `value`/`data-*`. |
| **2** | Fundação de tokens (infra headless) | `token-table` | Pré-requisito **bloqueante** do eyedropper e do manifesto. Centraliza o harvest de custom properties (try/catch por stylesheet p/ cross-origin/CSP), os resolvers `resolveColor`/`resolveLen` e UM único probe offscreen `dm-`. Sem UI nesta onda. |
| **3** | Canal de estilo (consome tokens) | `eyedropper`, `token-manifest` | O eyedropper consome `resolveColor`/`resolveLen`/`ensureTokens` do token-table (NÃO re-varre stylesheets, NÃO cria probe próprio). A proveniência EXATO/APROXIMADO/FORA-DA-ESCALA do `token-manifest` entra **fundida** aqui: vira tolerância (delta) nos resolvers e chip de proveniência nas linhas do popover — não um segundo popover de paste nem "auto :root". |
| **4** | Vocabulário de referência & robustez de identidade | `pins`, `stability-badge` | Ambos respondem "como humano e agente apontam o MESMO nó": `pins` dá número estável de sessão (1,2,3) reusando o overlay `noteBadges`; `stability-badge` expõe a confiança do seletor (verde/amarelo/vermelho + matches) e prova `anchorOf` via `flashCollisions` + carimbo `data-dm-ref`. Preparam o terreno do round-trip. |
| **5** | Intenção relacional A→B | `relational` | Novo canal declarativo de consistência cross-element, ortogonal ao snap-constraint (geométrico). Deixado depois da estabilização dos overlays porque introduz o **primeiro overlay CLICÁVEL** (`pointer-events:auto`), obrigando tocar `onDown`, `onKey` e `onStaticBlock`. |
| **6** | Fechamento do loop (capstone) | `round-trip` | Maior valor e maior esforço (L). Depende de `anchorOf` provado (Onda 4) e do `buildSpec`; fecha humano→agente→humano com veredito determinístico via snapshot por URL + `findByAnchor` + diff de computed styles. |

### Ordem de dependência

```
unit-warn → context-bundle → token-table → eyedropper → token-manifest
→ pins → stability-badge → relational → round-trip
```

### Resoluções de conflito

- **`pins` × notes (badge 📌):** Pins **absorve** o overlay de notas — não cria Map paralelo. Reusa o mesmo `noteBadges` (L35) e `refreshBadge` (L1075): o badge renderiza o número quando `pins.has(el)` e cai pro 📌 quando só nota. `textContent` + `classList.toggle('dm-has-note', notes.has(el))` DEVEM ser setados a CADA `refreshBadge` (hoje `textContent` só é setado na criação, L1081). Renomear o Map interno (ex.: `pinNums`) pra não dar shadow com `API.pins()`.
- **`relational` × snap-constraint:** Canais ortogonais — NÃO fundir. `snapToConstraint` descreve geometria/posição derivada de um drag; `relational` declara consistência semântica cross-element sem mover nada. Resolver pelo VOCABULÁRIO: `RELTYPES` exclui qualquer tipo posicional (sem `align.with`) e foca `match.style/color/size/spacing/same.component/mirror`. Overlays distintos, ambos `dm-` com teardown no quit.
- **`context-bundle` × anchorOf:** Bundle é COMPLEMENTO aditivo, anexado ao lado de `anchor` (`entry.context`), nunca substitui nem repete o alvo. `ancestors[]`/`siblings[]` carregam SÓ vizinhos. Opt-in via toggle `#dm-ctx` (default OFF). `openTag` reusa a MESMA whitelist de `anchor.attrs` (`data-testid`/`name`/`href`/`alt`), não despeja todos os atributos.
- **`token-table` × `eyedropper` × `token-manifest`:** Um único dono por responsabilidade. `token-table` é dono do HARVEST + `resolveColor`/`resolveLen` + o ÚNICO probe offscreen. `eyedropper` é dono do Map `samples` + UI (popover/tecla T) + `readChannels` (que CHAMA os resolvers, nunca re-varre). `token-manifest` NÃO declara `samples` nem re-varre nem cria "auto :root"; só estende os resolvers com tolerância (delta) e injeta o chip de proveniência. **Ordem de merge fixa:** token-table → eyedropper → (provenance).
- **`notePop` × `tokenPop` × `relPop` (slot único de popover):** Regra de UM popover por vez, simétrica nos dois sentidos e nos TRÊS handlers: abrir qualquer popover fecha os outros; cada popover precisa do MESMO trio de guards que a nota já tem — early-return em `onKey` L276, branch de clique-fora em `onDown` (~L713), e exceção no `onStaticBlock` L226 (`inTokenPop`/`inRelOverlay` junto de `inBar`/`inNotePop`).

### Drop / Merge

| Item | Ação | Motivo |
|---|---|---|
| `token-manifest` | **merge** (fundir no stack token-table + eyedropper) | ~80% de sobreposição. O único valor net-new é a classificação exact/near/off com tolerância — entra como extensão dos resolvers e chip no popover. A feature-âncora "auto :root" via `getComputedStyle` NÃO funciona em browser nenhum (`getComputedStyle` não enumera custom properties). |
| `eyedropper`: `collectCustomProps`/`dmProbe` próprios | **merge** (absorvidos pelo token-table) | Mesmo scan + probe do token-table. Centralizar evita dois nós `dm-` no body e dois caminhos de canonização divergentes (que quebrariam o round-trip de cor). |
| `stability-badge`: integração com `undoStack` (`kind:'attr'`/`pushUndo`) | **drop** (só a parte de histórico) | `undo()` (L404) só trata `kind:'dom'`/`'style'`; empurrar `kind:'attr'` cai no ramo style e crasha (`entry.snaps` undefined). O próprio toggle JÁ é a reversão. Manter o carimbo `data-dm-ref`. |
| `round-trip`: fallback in-memory em `file://` | **drop** (trocar por persistente) | In-memory NÃO sobrevive ao reload — entrega zero valor exatamente onde promete brilhar. Trocar por `window.name`/`sessionStorage`. |

### Quick wins

- **`unit-warn`** — verdict ready, M de baixo risco, zero UI nova, self-contained. Impede o agente de congelar layout fluido em px.
- **`context-bundle`** — verdict ready, M de baixo risco, pura-leitura, opt-in (default OFF). Triangulação de vizinhança que desambigua cards/linhas repetidos.
- **`pins`** — M risco baixo, reusa o overlay `noteBadges` existente, vocabulário 1/2/3 estável casa a prosa do PR/Slack com o export. Resolver os 4 gaps de sync de badge antes.

### Big bets

- **`round-trip`** (L, med) — fecha o ciclo com veredito determinístico e prova o motor de identidade via `findByAnchor`. Maior payoff, mas o de maior integração e risco: persistência cross-reload em `file://`, `getItem` no hot path do `updateCur`, e semântica before-vs-target.
- **Stack de tokens** (token-table → eyedropper → provenance, M+M) — abre o canal MUDO de estilo. Risco real: FALSO-NEGATIVO silencioso na normalização (triplet colors `rgb(var(--x))` do Tailwind/shadcn e unidades `rem`/`em`).
- **`relational`** (M, med) — único canal que captura intenção RELACIONAL. Risco de integração concentrado por ser o primeiro overlay CLICÁVEL: exige guards novos e coordenados em `onDown`, `onKey` e `onStaticBlock`.

---

## Specs por demanda

*(na ordem do roadmap; cada spec já incorpora os fixes da revisão)*

---

### 1. `unit-warn` — Delta na unidade original: AVISO auto/content-sized (versão honesta)

> Sem inventar conversão %: emite flag "era auto/content-sized, fixar px remove o auto" e a unidade-base como proveniência.

**Problema.** Ao redimensionar, o `resize:both` grava `width`/`height` em px inline e `markBaseline` (L1112) só guarda `offsetWidth`/`offsetHeight` (já px). O spec emite "tamanho 200×100 → 320×100" como se a dimensão original sempre fosse px fixo. Se a largura era `auto`/content-sized ou relativa (`%`, `rem`), o agente hardcoda `width:320px` e destrói silenciosamente a regra fluida. Falta registrar a proveniência da unidade-base ANTES da 1ª mutação.

**Ganho de comunicação.** Com o flag honesto ("era auto/content-sized; fixar 320px remove o auto" + unidade-base como proveniência) o agente sabe que o original era fluido e decide manter responsivo (`max-width`, `%`, `clamp`) em vez de chumbar px. Sem inventar conversão: a ferramenta NÃO calcula "320px = 47% do pai"; só reporta o que mediu (`auto`, ou raw `50%`).

**UX.** Sem botão novo. Captura automática no início do gesto (`markBaseline`), antes da mutação. No "🧾 copiar spec", abaixo da linha "tamanho A×B → C×D", um aviso por eixo alterado: "⚠ largura era auto/content-sized — fixar 320px remove o auto (proveniência: width:auto)" ou "⚠ largura era 50% (relativa ao pai) — fixar 320px congela o valor; sem conversão de %". Nada renderiza se a dimensão não mudou ou já era px fixo (zero ruído). JSON carrega o campo estruturado paralelo.

**Modelo de dados.** Reusar a Map `baselines` (já é o snapshot "before", limpa em `quit` L264 e `resetAll` L1000 — nenhum store novo). Estender o objeto baseline com `sizing:{ w:SizingInfo, h:SizingInfo }`, onde `SizingInfo = { source:'inline'|'css', unit:'px'|'%'|'rem'|'em'|'vw'|'auto'|null, raw:string|null, auto:bool, relative:bool }`.

**Plano de código (pontos de inserção).**
- Novo helper `sizingOf(el, prop)` perto de `markBaseline` (~L1110), pure-read, SEM tocar `document.styleSheets`. Lê inline `el.style[prop]`; se vazio, probe reversível (`setProperty(prop,'auto','important')` → mede `rect[prop]` → `removeProperty(prop)` restaura cascata).
- Em `markBaseline` (L1112-1123) acrescentar `sizing:{ w:sizingOf(el,'width'), h:sizingOf(el,'height') }`. **Fix:** gatear o probe ao gesto de RESIZE (branch `inCorner` L731-740), NÃO no caminho de DRAG (L748), onde w/h nunca mudam — elimina reflows inúteis no multi-select.
- Em `buildSpec` (L1136-1145), quando `before` existe e `delta.dw!==0` e `before.sizing.w.auto||relative` → montar `entry.provenance.w`. Se `unit==='px'` → não emitir.
- Em `specMarkdown` (após a linha de tamanho ~L1175, ANTES da linha "dica de layout" L1184) push das linhas de aviso, uma por eixo.
- JSON do spec já serializa o entry (`copySpec` L1196). Sem novo teardown: `baselines.clear()` em quit/resetAll já zera o sizing.
- **Fix:** tratar unidade inline não-simples (`calc()`/`min()`/`clamp()`/`var()`) como `{relative:true, unit:'?', raw:<valor>}` e ainda emitir o aviso com o raw — não jogar no silêncio de "desconhecida" um caso que claramente tem `%`.

**API.** Nenhuma (sem mudança de assinatura).

**Critérios de aceite.**
- Resize de `width:auto` (sem inline) → px → markdown mostra ⚠ auto e JSON `provenance.w.wasAuto=true`, `baseUnit 'auto'`.
- Resize de inline `width:50%` → aviso "era 50% (relativa)" e JSON `baseUnit '%'`, `baseRaw '50%'`; nenhuma conversão px-de-% em lugar nenhum.
- Resize de inline `width:200px` já fixo → NENHUM aviso.
- Elemento só arrastado (sem mudar dimensão) → sem linhas de proveniência mesmo que fosse auto.
- `node --check` passa; select continua sem mutar DOM (probe só no edit, no start do gesto); inline vazio permanece vazio após o probe.
- `quit()` e `resetAll()` limpam a proveniência junto com baselines.

**Dependências.** `markBaseline` L1112 + Map `baselines`; `buildSpec` L1127 + `specMarkdown` L1160 + `copySpec` L1192; `writeClipboard` L472 (inalterado). Helper NÃO pode ler `styleSheets[].cssRules`.

**Conflitos.** `copyLayout` (L966-985) escreve `width:Npx` incondicional sem o aviso (out-of-scope, só spec). Qualquer demanda que estenda o schema de `baselines` precisa coordenar o shape de `sizing`. Ordem das linhas no markdown: aviso de unidade ANTES da "dica de layout" do snap.

**Esforço / risco.** M / **low**.

**Veredito da revisão.** ✅ **ready.** A premissa central (`markBaseline` grava só px, perdendo a proveniência) é REAL e confirmada em L1117-1118. Os fixes são refinamentos, não bloqueios: (1) não rodar o probe no DRAG; (2) tratar `calc()`/`clamp()` como relativo honesto. Incorporar os 5 fixes antes de codar.

**Questões em aberto.** Ver checklist final (itens U1–U5).

---

### 2. `context-bundle` — Bundle de contexto (ancestrais + irmãos com snippets) em JSON

> Versão estendida do `anchorOf` com vizinhança redundante — enriquecimento opcional quando a âncora simples não basta pra desambiguar.

**Problema.** `anchorOf(el)` (L944) entrega seletor+texto+papel+near+atributos, mas em listas/cards repetidos o agente não sabe QUAL irmão é o alvo nem onde ele vive na árvore. Seletores `nth-of-type` (`cssPath` L911) ou que envelhecem deixam o alvo ambíguo sem vizinhança estrutural redundante.

**Ganho de comunicação.** O agente recebe vizinhança redundante: breadcrumb de ancestrais + irmãos anterior/posterior com micro-snippets + posição index/total entre irmãos do mesmo tipo + tag de abertura do alvo. Re-localiza o nó por triangulação mesmo se o seletor quebrar, e distingue o card certo entre N idênticos.

**UX.** Toggle na barra `#dm-ctx` "contexto rico: OFF" perto de copiar spec/notas (L124-125), default OFF. Quando ON, copiar spec/notas anexa o campo `context` por entrada e o Markdown ganha uma linha condensada. Opcional: botão `#dm-copyctx` (habilitado só com 1 selecionado) que copia o bundle isolado. Sem novo overlay.

**Modelo de dados.** Sem novo Map. Booleano module-level `let richContext = false;` (junto de `staticOn` ~L220). Bundle computado on-demand no export, nunca persistido. Tetos: `CTX_ANCESTORS=5`, `CTX_SIBLINGS=2`/lado, `CTX_SNIP=60`, `CTX_TAGCAP=200`. DEVE resetar em `quit()` (gotcha `__installed`).

**Plano de código (pontos de inserção).**
- `contextBundleOf(el)` logo após `anchorOf` (~L960): pura-leitura, retorna `{ancestors[], index, prevSiblings[], nextSiblings[], openTag}`; try/catch. Reusa `selectorOf`, `isStableClass`, `cssEsc`; helper `snip(n)` (slice `CTX_SNIP`).
- `ancestors`: sobe `parentElement` até body, máx `CTX_ANCESTORS`, nearest-first.
- `index` + siblings em `parent.children`. **Fix:** cortar a contagem cedo pra não iterar listas gigantes.
- **`openTag` — fix de exposição:** montar iterando `el.attributes` com a MESMA whitelist de `anchor.attrs` (ou pulando `value`/inputs sensíveis), NÃO `el.outerHTML.slice` (que serializa a subárvore inteira e vaza `value`/`data-*`). Aplicar `CTX_TAGCAP`.
- `buildSpec` (após L1154, ANTES do `out.push` L1155): `if (richContext) entry.context = contextBundleOf(el);`. `copyNotes` (L1205): mesmo append.
- `specMarkdown` (após L1184): se `it.context`, 1 linha "contexto:" compacta.
- Barra: `#dm-ctx` em L125 SEM classe `dm-edit-only` (igual `#dm-copyspec`/`#dm-copynotes`, pra aparecer no select). Wiring em `boot()` (~L154). Opcional `#dm-copyctx` + `updateCur` L361 (`size===1`).
- `quit()` (~L269): `richContext=false` e restaurar label.
- **Fix:** irmãos carregam SÓ estrutura (`tag/selector/text/role`), NÃO puxam nota/intenção do Map `notes` do irmão.

**API.** Opcional: `API.setRichContext(v)` e `API.contextBundle(el)`. Aditivo, nenhuma assinatura muda.

**Critérios de aceite.**
- `node --check` passa.
- Toggle ON: copiar spec/notas inclui `context` com `ancestors`/`prevSiblings`/`nextSiblings`/`index`/`openTag`; OFF: JSON idêntico ao atual.
- Select NÃO muta o DOM: nenhum nó novo dentro do alvo.
- Tetos respeitados (≤5 ancestrais, ≤2 irmãos/lado, texto ≤60, openTag ≤200).
- Cross-origin seguro: zero acesso a `document.styleSheets`; funciona em `file://`.
- `quit()` zera `richContext` e restaura label; reinstalar não dupla-bind.

**Dependências.** `selectorOf` L875 / `cssPath` L900; `anchorOf` L944 (complemento, não substituto); `isStableClass` L850 / `cssEsc` L962; `nearLabel` L924 (modelo do `snip`); `buildSpec`/`specMarkdown`/`copySpec` L1127-1198 + `copyNotes` L1200; `writeClipboard` L472.

**Conflitos.** Duplicação com `anchor.near`/`anchor.selector` — bundle referencia, não repete o alvo. `openTag` mais amplo que `anchor.attrs` (whitelist) → resolver com whitelist/skip + teto. Ortogonal a snap/relational. Não cria overlay.

**Esforço / risco.** M / **low**.

**Veredito da revisão.** ✅ **ready.** Hooks/linhas conferem; é pura-leitura, só enriquecimento de export, sem overlay nem listener per-frame. O único ajuste com peso de privacidade é o `openTag` (whitelist + iterar `el.attributes`). Demais são refinamentos.

**Questões em aberto.** Ver checklist (itens C1–C5).

---

### 3. `token-table` — Harvest de custom properties + `resolveLen`/`resolveColor`

> Pré-requisito do eyedropper: varre `styleSheets` (try/catch p/ cross-origin/CSP) e monta o mapa `--token→valor`; cacheia, invalida no `quit()`.

**Problema.** Exports atuais entregam só geometria + intenção em texto; valores visuais (cor, espaçamento) não viram nada acionável. Sem um mapa `--token→valor`, o futuro eyedropper só reportaria valores crus (`#3b82f6`, `16px`). Falta uma primitiva pura-leitura que varra os stylesheets (inclusive cross-origin, que lança `SecurityError`), monte o mapa, cacheie e ofereça `resolveColor`/`resolveLen`.

**Ganho de comunicação.** O agente passa a receber o NOME semântico (`var(--color-primary)`, `var(--space-4)`) em vez do valor cru. "Essa cor está errada" vira "trocar para `var(--brand-600)`". Traduz pixels/cores observados pro vocabulário real do projeto.

**UX.** Infraestrutura: SEM botão novo nesta rodada. Harvest headless e lazy — roda na 1ª `ensureTokens()` e cacheia. Único reflexo visível: se algum stylesheet for ilegível, `tokensPartial=true` e quem consome mostra aviso discreto via `uiNotifySafe`. O probe de cor é um div `dm-` offscreen invisível.

**Modelo de dados.** `tokenTable Map<string,{value,source}>`; índices reversos `colorIndex Map<rgbCanônico,token>` e `lenIndex Map<pxString,token>`; `tokensReady` bool; `tokensPartial` bool; `colorProbe` (div `dm-` offscreen lazy). Tudo module-level (~L52), espelhando `changes`/`notes`.

**Plano de código (pontos de inserção).**
- Estado ~L52 (após `notePop`).
- Nova seção pura-leitura entre `anchorOf` (L944-964) e `copyLayout` (L966): `harvestTokens()`, `ensureTokens()`, `resolveColor()`, `resolveLen()`, `normalizeColor()`.
- `harvestTokens()`: limpa os 3 Maps + `tokensPartial=false`; itera `document.styleSheets`, `try{sheet.cssRules}catch{tokensPartial=true;continue}`; recursa `CSSMediaRule`/`CSSSupportsRule`/`CSSImportRule`; coleta props `--*`.
- **Fix de simplificação forte:** depois de DESCOBRIR os nomes via `styleSheets`, ler o valor RESOLVIDO com `getComputedStyle(documentElement).getPropertyValue(nome)`. O browser resolve cadeias `var()`+fallback nativamente — elimina o `resolveVar()` hand-rolled. `styleSheets` vira só "lista de nomes". (Limitação: escopa v1 a tokens `:root` — resposta à open question 3.)
- **Fix crítico — canonização SIMÉTRICA:** ao popular `colorIndex`, passar o valor do token pela MESMA `normalizeColor` usada em `resolveColor` (probe + `getComputedStyle`). Idem `lenIndex`: converter `rem`/`em`→px no harvest com a MESMA regra do `resolveLen`. **Sem isso o acceptance `resolveColor('#3b82f6').token==='--x'` falha** (harvest indexaria a string crua, query canonizaria pra `rgb(...)`).
- **Fix — indexar SÓ valores atômicos:** se normalizou pra exatamente uma cor → `colorIndex`; se pra uma length → `lenIndex`; senão guarda em `tokenTable` mas NÃO no índice reverso (evita falso-positivo com `--shadow:0 1px 2px rgba(...)`).
- **Fix — colorProbe lazy de verdade:** criar só na 1ª `normalizeColor` (quando um resolve ocorre), nunca no harvest puro. `aria-hidden`, `pointer-events:none`, `position:fixed;top:-9999px`.
- **Fix — triplet & rem:** tratar tokens canal-triplet (`--primary: 59 130 246` consumido via `rgb(var(--primary))`) também probando `rgb(<raw>)`; resolver `rem`/`em`→px.
- `quit()` (~L264, junto de `baselines.clear()`): `.clear()` nos 3 Maps; `tokensReady=tokensPartial=false`; remover `colorProbe` e zerar pra null.
- API (~L1248): `refreshTokens()` (invalida + re-varre, p/ SPA) e `tokens()` (snapshot plano). `resolveColor`/`resolveLen`/`ensureTokens` ficam internos.

**API.** `DesignMode.tokens()`, `DesignMode.refreshTokens()`. Resolvers internos (consumidos pelo eyedropper no mesmo IIFE).

**Critérios de aceite.**
- `node --check` passa.
- `:root{--x:#3b82f6}` → `resolveColor('#3b82f6').token === '--x'`.
- Stylesheet cross-origin não derruba harvest: `cssRules` try/catch'd e `tokensPartial=true`.
- `file://`: harvest e resolves funcionam (não dependem de clipboard).
- `quit()` limpa os 3 Maps, zera flags, remove `colorProbe`; reinjetar não duplica nó.
- Select não muta alvos: só leitura de `styleSheets` + probe `dm-` offscreen transitório.
- Segunda chamada após `ensureTokens()` não re-varre (cacheado até `refreshTokens`/`quit`).

**Dependências.** Reusa `uiNotifySafe` (aviso `tokensPartial`) e o padrão de probe offscreen do `writeClipboard`. `getComputedStyle` + `document.styleSheets`. **BLOQUEIA/alimenta o eyedropper.**

**Conflitos.** Contradiz o gotcha "mantenha identidade/export FORA de `styleSheets`" — a leitura é deliberada e DEVE ficar isolada e try/catch'd nesta primitiva. O eyedropper NÃO deve varrer stylesheets por conta própria. `colorProbe` entra no teardown do `quit()`.

**Esforço / risco.** M / **med**.

**Veredito da revisão.** ⚠️ **needs-work** (vira ready com os 2 fixes obrigatórios). Spec bem ancorado, sem colisão de símbolos. Obrigatórios antes de ready: (1) **canonização simétrica** cor/length entre harvest e resolve; (2) trocar `resolveVar` hand-rolled por `getComputedStyle(documentElement).getPropertyValue(nome)` (escopa v1 a `:root`). Além disso: indexar só valores atômicos, `colorProbe` lazy, fixar regra de desempate de alias.

**Questões em aberto.** Ver checklist (itens TT1–TT5).

---

### 4. `eyedropper` — Eyedropper de tokens (cor/tipo/raio para `var()`) no modo SELECT

> Apontar e copiar cor/tipografia/border-radius lendo computed style e resolvendo contra as custom properties da página — abre o canal mudo de estilo sem mutar nada.

**Problema.** Quando o humano aponta uma cor/fonte/raio, o agente só recebe um valor computado cru (`#3b82f6`) ou nada, e hardcoda um magic number em vez do token do design system. O canal de estilo está mudo nos exports atuais.

**Ganho de comunicação.** O agente recebe a custom property da PRÓPRIA página: `color rgb(59,130,246)` → `var(--color-primary-500)`, `border-radius 8px` → `var(--radius-md)`. A correção sai como referência a token consistente. Dá o valor concreto por trás dos chips `color.wrong`/`type.small`/`radius`.

**UX.** Reusa o fluxo de nota. Com EXATAMENTE 1 selecionado, clicar botão `tokens` (ao lado de `#dm-note`) ou tecla **T** abre popover `dm-token-pop` (clone de `dm-note-pop`, posicionado por `positionPop`) listando canais: swatch + valor cru + `var()` casado (ou "sem token — hardcoded"). Cada linha com ícone copiar + **chip de proveniência** (verde exato / amarelo near+delta / vermelho off — fundido do token-manifest). Rodapé "copiar tudo". Esc / clicar fora fecha. Só 1 popover por vez.

**Modelo de dados.** `Map styleReads el→{ts, channels:[{prop,raw,hex?,token,prov}]}`. Overlay único `tokenPop`. **NÃO** declara probe/harvest próprios — consome `resolveColor`/`resolveLen`/`ensureTokens` do token-table (Onda 2).

**Plano de código (pontos de inserção).**
- STATE: add Map `styleReads` + var `tokenPop` (resetados em quit). (`dmProbe`/harvest **absorvidos pelo token-table**.)
- STYLE L80-93: `.dm-token-pop`/`.dm-swatch` clonando `.dm-note-pop`.
- Barra L122/125: botão `#dm-eyedrop` ao lado de `#dm-note` e `#dm-copytokens` ao lado de `#dm-copynotes`. **Fix:** dropar "gated por dm-has-sel" — `#dm-eyedrop` sempre-visível como `#dm-note`, só `disabled=n!==1` em `updateCur`.
- Wiring L152-154: `openTokens([...selected][0])`; `copyTokens()`.
- `onKey`: **fix** — adicionar o early-return sibling `tokenPop` em **L276** (popover dono das próprias teclas), além do atalho T near L282 com os mesmos guards de N. Single-popover: `openTokens` chama `closeNote(false)`; `openNote` chama `closeTokens()`.
- **Fix faltante — `onDown` (~L713):** branch simétrico ao `notePop` — se `tokenPop` aberto e clique fora, `closeTokens()` e return (não selecionar/arrastar).
- **Fix faltante — `onStaticBlock` (L226):** adicionar `inTokenPop(target)` à exceção (junto de `inBar`/`inNotePop`), senão os botões de copiar ficam mortos no MODO ESTÁTICO.
- `openTokens`/`closeTokens` perto de `openNote` L1015, reusando `positionPop`. `readChannels(el)` mapeia `color`/`background-color`/`border-color`/`font-family`/`font-size`/`font-weight`/`line-height`/`letter-spacing`/`border-radius` e CHAMA os resolvers do token-table.
- **Fix — longhands:** ler `border-top-color`/`border-top-width` (não shorthand, que retorna string vazia quando lados diferem).
- `buildSpec` L1127 (já usa Set — dedupe automático ao unir `styleReads.keys()`); `entry.style`; `specMarkdown` L1184 renderiza "estilo: color rgb→var(--x); radius 8px→var(--radius-md)".
- `updateCur` L355-362: `#dm-eyedrop.disabled=n!==1`; `#dm-copytokens.disabled=styleReads.size===0`.
- Teardown: `clearTokens()` em `quit` L263 e no off de `setMode` L202, junto de `clearNotes`.

**API.** `DesignMode.readTokens(el)`, `DesignMode.eyedrop(el?)`, `DesignMode.copyTokens()`. Sem breaking change.

**Critérios de aceite.**
- Select, 1 el, T/botão abre popover com linhas color/bg/border/font-size/font-family/weight/line-height/radius (cru + `var()` quando casa).
- `rgb(59,130,246)`, `#3b82f6` e `var(--x)` resolvem ao mesmo token.
- Página com stylesheet cross-origin: não lança `SecurityError`; tokens ausentes, resto funciona.
- Zero mutação do DOM alvo; só overlays `dm-` + probe (do token-table); `quit()` remove tudo; `node --check` passa.
- `file://`: copiar funciona via fallback do `writeClipboard`.
- `copySpec` e copiar tokens emitem "prop: cru → var(--token)" + bloco JSON.

**Dependências.** `anchorOf`/`selectorOf`; `writeClipboard` L472; padrão de popover de nota (`positionPop`/`openNote`/`closeNote`); `updateCur`; `buildSpec`/`specMarkdown`; teardown; **token-table (resolvers + probe + harvest).**

**Conflitos.** Regra de 1 popover (`tokenPop` ↔ `notePop`). Sem badge próprio (evita colisão com 📌). `buildSpec` já dedupe via Set. Cross-origin `.cssRules` (gotcha do token-table). Probe é overlay `dm-` `pointer-events:none` offscreen (não pego por `closest('*')` nem por `buildSnapTargets`).

**Esforço / risco.** M / **med**.

**Veredito da revisão.** ⚠️ **needs-work.** Dois pontos de integração ausentes do codePlan causam bugs funcionais (`onDown` close-on-outside-click; `onStaticBlock` exemption). E a promessa central (resolver valor computado → `var()`) falha silenciosamente nas encodings mais comuns (triplet colors, `rem`) — endereçado pela normalização do token-table. Resolver open question rumo a **selection-based** (não live-hover) pra manter select puro, e emitir valor cru rotulado "hardcoded — sem token" quando não casa.

**Questões em aberto.** Ver checklist (itens EY1–EY6).

---

### 5. `token-manifest` — Proveniência EXATO/OFF-SYSTEM (fundido no stack de tokens)

> Camada de proveniência: marca match exato vs aproximado e valores fora da escala — **mergeado** no token-table + eyedropper, NÃO é demanda/UI separada.

**Problema.** O export entrega valores crus (cor `#3a83f3`, radius `7px`) sem dizer se batem com a escala de design tokens. O agente, que não vê a tela, hardcoda valores one-off e a página descola do design system silenciosamente.

**Ganho de comunicação.** Cada valor amostrado carrega proveniência: **EXATO** (use `var(--blue-500)`), **APROXIMADO** (OFF-SYSTEM, token mais próximo `--blue-500` com delta pequeno; decida snap ou novo token) ou **FORA-DA-ESCALA** (OFF-SYSTEM sem token). O agente para de hardcodar e sabe quando reusar token vs registrar desvio intencional.

**UX (versão fundida).** **NÃO** cria popover de paste próprio, **NÃO** re-varre stylesheets, **NÃO** cria "auto :root". A proveniência vira: (1) **tolerância (delta)** nos resolvers do token-table — `TOK_COLOR_TOL` (~12 dist RGB) e `TOK_LEN_TOL` (max 2px, 8%); e (2) **chip de proveniência** (verde exato / amarelo near `--blue-500` +delta / vermelho sem token) nas linhas do popover do eyedropper. Sem manifesto/com degrade limpo. (A ideia original de "auto :root" via `getComputedStyle` é **descartada** — `getComputedStyle` NÃO enumera custom properties em browser nenhum.)

**Modelo de dados.** Reusa o Map `samples` do eyedropper; proveniência só anexa `prov={match:'exact'|'near'|'off', token, tokenValue, delta}`. Consts de tolerância. **Não** declara `samples` (evita redeclare → SyntaxError).

**Plano de código (pontos de inserção).**
- Estenter `resolveColor`/`resolveLen` do token-table com `matchToken(prop, raw)→prov` (distância RGB euclidiana + tolerância de length).
- `buildSpec` L1147: `provenance: provenanceOf(el)` na entry (só popula se houver match no que o eyedropper amostrou). **Fix:** expandir o set de els com `samples.keys()` filtrando `isConnected`, senão elementos só-amostrados não exportam proveniência.
- `specMarkdown` ~L1184: linha de proveniência por valor (exato → `var(--x)`; OFF-SYSTEM → nearest `--x` delta / sem token).
- **Guards herdados (críticos):** `tokenPop` precisa do early-return em `onKey` L276 e do clique-fora em `onDown` L713 (do eyedropper) — senão digitar dispara atalhos destrutivos (`Delete` apaga elemento, `[`/`]` mudam camada).
- `quit()`/`clearNotes()`: zerar `tokens`/`tokensRaw` coordenado com o eyedropper (uma limpeza só).

**API.** Opcional `DesignMode.setTokens(srcOrObj)` (injeta manifesto programaticamente, se mantido o paste como fonte canônica) e `tokens()`.

**Critérios de aceite.**
- `node --check` passa.
- Valor de cor igual a um token → `exact` + nome no MD e JSON.
- Cor próxima → OFF-SYSTEM + token mais próximo + delta; fora da tolerância → OFF-SYSTEM sem token.
- `file://` e http; clipboard via `writeClipboard`.
- Select DOM-puro; popover/overlay `dm-`, só leitura de computed style.
- `quit()` zera tudo; reinjeção não duplica binds.
- Sem manifesto: proveniência ausente, valores crus, nenhum erro.

**Dependências.** **Eyedropper (BLOQUEANTE)** — compartilha o Map `samples`. `writeClipboard` L472; `anchorOf`/`selectorOf`; `buildSpec`/`specMarkdown`; `uiNotifySafe`.

**Conflitos.** Co-propriedade do Map `samples` (eyedropper DECLARA, este REUSA — risco de dupla-declaração). Slot único de popover (`tokenPop`). "auto :root" quebrado (descartado). CIE Lab deltaE descartado (distância RGB euclidiana basta).

**Esforço / risco.** M (se o eyedropper entrar antes; L se tivesse que prover a própria amostragem) / **med**.

**Veredito da revisão.** ⚠️ **needs-work** → fundir é a resolução. Não-ready isolado por três motivos: (1) depende de `samples`/eyedropper que ainda não existem; (2) "auto :root" via `getComputedStyle` não funciona; (3) faltam guards de `tokenPop` em `onKey`/`onDown`. Como **merge** no stack de tokens (delta nos resolvers + chip no popover), o valor net-new é preservado sem código morto.

**Questões em aberto.** Ver checklist (itens TM1–TM6).

---

### 6. `pins` — Pins numerados com referência estável + legenda exportável

> Vocabulário "1,2,3" estável na sessão pra falar em prosa; deduplicar com o badge de notas (mesmo container de overlays).

**Problema.** Humano e agente não compartilham um vocabulário curto. A prosa re-descreve o alvo ("aquele card do topo") e o spec/notes numera entradas sequencialmente (`i++`) a cada export — número volátil que não casa com o PR/Slack. O badge 📌 não carrega identificador.

**Ganho de comunicação.** Cada elemento fixado ganha número estável na sessão (1,2,3…) no overlay E como HEADING das entradas no spec/notes/legenda. "Aumenta o pin 3, alinha 1 com 2" → o agente acha exatamente esses números, com âncora redundante por baixo.

**UX.** Botão `#dm-pin` "📍 fixar" (habilita com 1 selecionado; classe `.on` quando fixado) + tecla **P**. Fixar atribui o próximo número e mostra badge numerado REAPROVEITANDO o overlay das notas (mesmo Map `noteBadges`): o badge vira token circular com o número; com nota também ganha `dm-has-note` (cor âmbar). Export `#dm-copylegend` "🔢 copiar legenda".

**Modelo de dados.** `const pins = new Map()` (el → number) e `let pinSeq = 0` (~L34-36). **Fix:** renomear o Map interno (ex.: `pinNums`) pra evitar shadow com `API.pins()`. Reaproveita `noteBadges` e `notes`.

**Plano de código (pontos de inserção).**
- STATE ~L34-36: `pinNums` Map + `pinSeq`.
- Helpers perto de `openNote` ~L1013: `pinOf(el)` (atribui `++pinSeq` se ausente), `togglePin(el)`. Reusa `selectorOf`/`anchorOf`.
- **Fix `refreshBadge` (L1075):** condição `(notes.has(el)||pins.has(el)) && el.isConnected`; setar `textContent` + `classList.toggle('dm-has-note', notes.has(el))` **FORA do bloco de criação** (`if(!badge)`), a CADA refresh (hoje `textContent` só é setado na criação L1081 → um el que ganha nota antes do pin nunca atualiza pro número).
- **Fix auto-pin:** mover `pinOf` para o **SAVE** em `closeNote` (dentro de `if(types.size||text)` L1060), NÃO no início de `openNote` — senão cancelar (Esc) cria pin fantasma sem badge/sem sync.
- Barra L122-125: `#dm-pin` (após `#dm-note`) + `#dm-copylegend` (após `#dm-copynotes`); wiring L152-154; tecla P em `onKey` espelhando N (L282-286, guard `isEditableTarget`/`inBar`).
- `updateCur` L355-362: habilitar `#dm-pin` quando `n===1`, toggle `.on`; habilitar `#dm-copylegend` quando `pins.size>0`.
- **Fix heading sem colisão:** entradas com pin usam `it.pin`; entradas sem pin usam contador que começa em `maxPin+1` (ou rótulo distinto), NUNCA `it.pin||i` com `i` global (gera dois "## 3." com buracos {1,3}).
- **Fix `deleteElements` (L547):** guarda `if (notes.has(el)||pins.has(el)) { ...; refreshBadge(el); }` pra remover badge numerado órfão.
- `copyLegend()`: por `[el,n]` com `isConnected`, montar `{pin:n, anchor:anchorOf(el)}`; Markdown + JSON via `writeClipboard`.
- Teardown: decisão de lifecycle (abaixo) determina se `pins.clear()`/`pinSeq=0` vai em `clearNotes` (L1103, roda em `setMode('off')` L202) ou só em `quit()` L263.

**API.** `pin(el)`, `pins()` (legenda como objeto), `copyLegend()`. Opcionais.

**Critérios de aceite.**
- Fixar (P/botão) com 1 selecionado cria badge numerado; número não muda ao desfixar/fixar outros nem ao reordenar.
- Abrir nota num el sem pin auto-atribui número (no SAVE); badge mostra número + cor de nota.
- Spec/notes usam o número do pin como heading; entradas sem pin caem no fim com índice sequencial sem colisão.
- Copiar legenda gera Markdown+JSON (número→selector/âncora) via `writeClipboard` (`file://` e http).
- Select não muta o DOM; badge/legenda são overlays `dm-`.
- `quit()` remove badges e zera `pins`+`pinSeq`; re-inject não duplica número.

**Dependências.** `anchorOf`/`selectorOf`; Map `noteBadges` + `refreshBadge`/`positionBadge`/`repositionNotes` (overlay único); `notes` Map + `openNote`; `writeClipboard`; `buildSpec`/`specMarkdown`/`copyNotes`; `updateCur`.

**Conflitos.** Pins × badge de notas COMPARTILHAM o overlay (não criar paralelo). Heading numérico (manter fallback). Lifecycle (notas somem no `setMode('off')`). **Nota factual:** a "colisão token×resize ↘" do spec original é FALSA — `positionBadge` ancora no canto SUPERIOR-direito (`r.right`/`r.top`), o resize nativo é no INFERIOR-direito; o offset a revisar é o badge meio pra fora no topo-direito.

**Esforço / risco.** M / **low**.

**Veredito da revisão.** ⚠️ **needs-work.** Pontos de inserção precisos e primitivas certas. Quatro gaps produzem estado inconsistente: (1) heading `it.pin||i` colide com buracos; (2) auto-pin no open + cancel cria pin sem badge; (3) `deleteElements` não limpa badge de el só-pin; (4) `refreshBadge` precisa setar `textContent` fora do bloco de criação. Mais a decisão de lifecycle (pins morrem no "off"?). Com os fixes vira ready.

**Questões em aberto.** Ver checklist (itens PN1–PN5).

---

### 7. `stability-badge` — Badge de estabilidade do seletor + desambiguação de colisão

> Mostra verde/amarelo/vermelho conforme a robustez do seletor e pisca os N nós quando casa com >1; carimbar âncora (`data-dm-ref`) só no modo edit, removível.

**Problema.** `selectorOf` (L875) sempre devolve um seletor mas esconde a confiança: um `:nth-of-type` frágil, ou um seletor que casa com vários nós, vão direto pra `anchor.selector` (`buildSpec` L1148, `copyNotes` L1205) sem aviso. O agente edita o nó errado, e o humano não tem sinal nem como corrigir.

**Ganho de comunicação.** Cada export carrega confiança explícita: `anchor.stability` (forte/médio/frágil) + `anchor.matches` (quantos nós casam). O agente sabe quando confiar no seletor vs cair no texto/role/near. O humano, vendo o badge vermelho, carimba `data-dm-ref` (modo edit) ANTES de exportar — hook garantidamente único e estável entre builds.

**UX.** Pílula `#dm-stab` na barra ao lado de `#dm-cur`, só com 1 selecionado: bolinha verde/amarela/vermelha + texto ("forte (1)", "frágil: nth-of-type", "ambíguo: 3 nós") + title com o seletor. Quando `matches>1`, a barra ganha `.dm-ambig` e surge botão "piscar": desenha N caixas-overlay `dm-collide` pulsando sobre cada match (auto-removem ~1.2s, zero classe/atributo no alvo). Só no edit aparece "fixar ref": carimba `data-dm-ref`, badge fica verde; clicar de novo remove (toggle).

**Modelo de dados.** `let stampSeq=0` (ids `r1,r2…`) e `const collideOverlays=[]` (transitórias). Stamps rastreados pelo próprio `data-dm-ref` no DOM (varredura `querySelectorAll` no quit). `selectorGrade(el)` é função pura.

**Plano de código (pontos de inserção).**
- `selectorOf` L882: incluir `data-dm-ref` como primeiro attr do loop de candidatos fortes (ressalva: `#id` L881 ainda vem ANTES).
- `selectorGrade(el, selOpcional)` perto de `anchorOf` (~L940): `count=document.querySelectorAll(sel).length`; weak se `count!==1` ou contém `:nth-of-type`; strong se único e casa `#id`/`[data-dm-ref|data-testid|name|aria-label|href]`; senão medium. **Fix:** assinatura recebe `sel` opcional pra `anchorOf`/`updateCur` reaproveitarem o `selectorOf` já calculado. **Fix:** alinhar a lista strong com a do `selectorOf` (incluir `data-test`/`data-cy`/`data-qa`/`data-id`).
- `anchorOf` L944: `out.stability` + `out.matches` via `selectorGrade(el, out.selector)`.
- STYLE ~L92: `.dm-stab` (3 cores) + `.dm-collide` (overlay fixed, outline rosa, `@keyframes dm-pulse`). **Fix:** `.dm-collide` DEVE ter `pointer-events:none` + `position:fixed` + `z 2147483646`.
- Barra ~L121: `<span id='dm-stab'>`, `<button id='dm-flash'>`, `<button id='dm-stamp' class='dm-edit-only'>`.
- Wiring ~L152: `#dm-flash`→`flashCollisions(sel)`; `#dm-stamp`→`toggleStampRef([...selected])`.
- `updateCur` L361-372 (`n===1`): `selectorGrade`, texto/cor de `#dm-stab` + title; `bar.classList.toggle('dm-ambig', matches>1)`.
- `flashCollisions`/`toggleStampRef` ~L1095. **Fix:** capar flash a ~50 overlays; guardar timeouts + `clearTimeout` + checar `parentNode` no teardown.
- **Fix crítico — undo do carimbo:** `toggleStampRef` **NÃO** integra ao `undoStack` (não existe ramo `kind:'attr'`; cairia no ramo style e crasharia com `snaps=undefined`). O próprio toggle (clicar de novo remove) JÁ é a reversão.
- `stripDmState` L494-499: remover `data-dm-ref` do clone e descendentes (par do `data-dm-group`).
- `quit` L260: `querySelectorAll('[data-dm-ref]')` → `removeAttribute`; remover `collideOverlays`.

**API.** Opcional `DesignMode.grade()`, `stamp()`/`unstamp()`. `anchor` JSON ganha `stability`+`matches` (aditivo).

**Critérios de aceite.**
- Nó com id/data-testid: badge verde "forte (1)".
- Nó com `:nth-of-type`: badge frágil (amarelo/vermelho) + motivo.
- Nó cujo seletor casa >1: badge "ambíguo: N", botão piscar; clicar desenha N overlays que somem sozinhos; DOM do alvo inalterado em select.
- Em edit, "fixar ref" adiciona `data-dm-ref`, badge verde, `anchor.selector` passa a usar `[data-dm-ref]`, `matches===1`; toggle remove.
- Colar elemento carimbado não duplica `data-dm-ref` (clone stripado).
- `buildSpec`/`copyNotes` JSON incluem `stability` + `matches`.
- `quit()` remove todo `data-dm-ref` e overlays `dm-collide`; `node --check` passa.

**Dependências.** Motor de identidade L850-919 (`selectorOf`/`cssPath`/`isStableClass`/`uniqueGlobally`); `anchorOf` L944; padrão de overlay das notas; `updateCur` L345; `stripDmState` L494 + `quit` L254.

**Conflitos.** `#dm-stab` disputa espaço com `#dm-cur` (cosmético). Verde "forte" vs outline verde de seleção — pílula na barra, não no alvo. `data-dm-ref` × paste (stripado). `data-dm-ref` como candidato em `selectorOf` muda saída se o site já usar esse attr (improvável).

**Esforço / risco.** M / **med**.

**Veredito da revisão.** ⚠️ **needs-work.** Plano sólido e bem ancorado. Único bloqueador real: o undo do carimbo (`kind:'attr'`/`pushUndo` NÃO existem em `undo()` L404 — crasha ou não desfaz). Adotar **toggle-como-reversão** (sem undoStack) resolve sem código novo. Somado a `pointer-events:none` nos overlays, guard de timeout no teardown e alinhamento da lista strong-attr, fica pronto.

**Questões em aberto.** Ver checklist (itens SB1–SB6).

---

### 8. `relational` — Anotação relacional A→B (par entre 2 elementos)

> Modo de pareamento + linha overlay ligando A→B com tipo de relação; ortogonal ao snap-constraint.

**Problema.** Hoje a intenção é capturada por-elemento (notes/intents) ou como efeito geométrico de um drag (snap-constraint). Não existe canal para o humano DECLARAR, sem mover nada, que DOIS elementos devem ser consistentes ("esse botão devia combinar com aquele", "mesmo espaçamento", "mesmo tamanho"). Essa intenção relacional se perde.

**Ganho de comunicação.** O agente recebe um par explícito A→B com TIPO de relação e ÂNCORA REDUNDANTE dos dois lados (`anchorOf(a)`+`anchorOf(b)`), re-achando ambos mesmo se um seletor envelhecer. Expressa consistência cross-element (estilo/cor/tamanho/espaçamento/mesmo-componente) que geometria pura e notas por-elemento não conseguem.

**UX.** Botão `#dm-relate` "link relacionar" na barra ao lado de "nota", habilitado com 1 selecionado; vale em inspecionar e editar (puro overlay). Clique arma o pareamento: o selecionado vira A, `#dm-cur` mostra "escolha o 2º elemento (B)... Esc cancela" e a barra ganha `dm-pairing`. Próximo clique define B e abre popover-picker (padrão `openNote`) com chips de TIPO + textarea opcional. Ao salvar, desenha conector A→B (linha SVG full-viewport + seta) e badge-rótulo no ponto médio. **Clicar o badge remove a relação.** Esc ou clicar A de novo cancela. Overlays seguem scroll/resize/drag. Botão `#dm-copyrel`.

**Modelo de dados.** `relations Map` (relId→`{a,b,type,text}`); `relBadges Map`; `relLayer` (svg `dm-rel-layer` sob demanda); `pairing` (`{a:el}`); `relPop` (1 por vez); `relSeq=0`. `RELTYPES` junto de `INTENTS` L46: `match.style`, `match.color`, `match.size`, `match.spacing`, `same.component`, `mirror` — **exclui qualquer tipo posicional** pra não duplicar `snapToConstraint`. Export materializa `anchorOf` só na hora de salvar/copiar.

**Plano de código (pontos de inserção).**
- STATE L34-36: `relations`/`relBadges`/`relLayer`/`pairing`/`relPop`/`relSeq`; `RELTYPES` perto de `INTENTS` L46.
- Barra L122/125: `#dm-relate` após `#dm-note`, `#dm-copyrel` após `#dm-copynotes`.
- Wiring L152-154: `startPairing()`; `copyRelations()`.
- `updateCur` L361: `relate.disabled=n!==1`; `copyrel.disabled=relations.size===0`; `bar.classList.toggle('dm-pairing', !!pairing)`; prompt no `#dm-cur` (short-circuit antes do branch `n===1`).
- `onKey` L279: `if(pairing){cancelPairing();return;}` antes de `clearSel`; opcional tecla **R** arma. **Fix:** espelhar guard `if (relPop && relPop.pop.contains(e.target)) return;` ANTES do Escape.
- **`onDown` L711:** após o guard de `notePop` (~L717), `if(pairing){...finishPairing(b)/cancelPairing(); return;}` (ANTES de `selectOnly`/drag). **Fix:** helper `inRelOverlay(node)` + guard no TOPO de `onDown` (junto de `inBar` L712): clicou badge → `removeRelation(id)`; clicou fora do `relPop` → salva/fecha sem selecionar. Excluir `inBar`/`inRelOverlay` do alvo `b`.
- **`onStaticBlock` L226:** adicionar `inRelOverlay(e.target)` às exceções (junto de `inBar`/`inNotePop`).
- Bloco ~L1108: `startPairing`/`cancelPairing`/`finishPairing(b)`→`openRelPicker(a,b)`; `saveRelation`; `ensureRelLayer` (`createElementNS` p/ svg/line/marker; `pointer-events:none` no layer, `pointer-events:auto` só no badge); `drawRelation`/`positionRelation`; `removeRelation`; `repositionRelations` (culla `!isConnected`); `clearRelations` (remove `relLayer`+null, fecha `relPop`, remove badges, `.clear()`, `cancelPairing`, reset `relSeq`).
- `repositionNotes` L1096: chamar `repositionRelations()` no mesmo loop. **NUNCA** chamar `selectorOf` no loop (só no save/export).
- `setMode` off L202 e `quit` L263: `clearRelations()`+`cancelPairing()`.
- EXPORT: `buildRelations()` → `[{type,text,a:anchorOf(a),b:anchorOf(b)}]` filtrando `isConnected`; `copyRelations()` espelha `copyNotes`; `specMarkdown` L1160 anexa "## Relações".
- CSS L93: `.dm-rel-layer`, `.dm-rel-line`, marker de seta, `.dm-rel-badge` (`pointer-events:auto`).

**API.** Nenhuma obrigatória. Opcional `copyRelations()`/`clearRelations()`.

**Critérios de aceite.**
- Inspecionar: armar com 1 selecionado, clicar 2º elemento, escolher tipo → conector A→B com badge-rótulo, sem alterar o DOM da página.
- Overlays seguem scroll/resize/drag; removidos em `setMode('off')` e `quit()`.
- Relação com endpoint `!isConnected` some do overlay e do export.
- `copyRelations()` escreve Markdown+JSON com `anchorOf(a)`/`anchorOf(b)`; `file://` (fallback).
- Esc cancela; clicar A de novo cancela; barra volta ao normal.
- `node --check` passa; re-injetar não duplica binds.
- `copySpec` inclui "## Relações" quando há relações.

**Dependências.** `anchorOf` L944 / `selectorOf` L875; `writeClipboard` L472; padrão de overlay/badge L1075-1101; padrão de popover `openNote`/`positionPop` L1015-1074; `updateCur` L345; guard de select sem mutação em `onDown`; `copyNotes`/`specMarkdown`.

**Conflitos.** `align.with` duplicaria `snapToConstraint` L813 → `RELTYPES` evita posicional. Badge-rótulo × 📌 (mesmo z 2147483646) → offset, compartilhar `repositionNotes`. Intercept de pairing ANTES de `selectOnly`/drag. **`copySpec` JSON:** schema atual é array plano (L1196); incluir relações muda pra `{elements,relations}` — **decidir antes** (acceptance "## Relações" exige consistência).

**Esforço / risco.** M / **med**.

**Veredito da revisão.** ⚠️ **needs-work.** Conceito sólido, referências de linha corretas. O bloqueador não é arquitetura: ao contrário do 📌 (`pointer-events:none`), o badge de relação precisa ser **CLICÁVEL** (`pointer-events:auto`), o que obriga tocar `onDown` (guard de overlay + clique-fora), `onKey` (guard `relPop`) e `onStaticBlock` (exempt) — nenhum dos três está no codePlan. Com esses guards + `createElementNS` + teardown explícito, fica pronto.

**Questões em aberto.** Ver checklist (itens RL1–RL6).

---

### 9. `round-trip` — Verificar round-trip (snapshot + diff pós-reload)

> Fecha o loop humano→agente→humano via localStorage por URL + `findByAnchor` (reusa `anchorOf`, agora provado) + diff de computed styles; marca se o agente entregou.

**Problema.** Hoje o loop é mão-única: o humano exporta spec/notas e nunca sabe, de forma checável, se o agente entregou. Não há prova de que o build novo aplicou a intenção, nem de que a âncora ainda re-localiza o alvo. Tudo é olho-no-olho e some no reload.

**Ganho de comunicação.** O agente ganha um veredito determinístico: lista de elementos re-encontrados pela MESMA âncora que recebeu, com before→after de computed styles + geometria, marcando cada intenção como **entregue/pendente/regrediu/sumiu**. Prova que `selectorOf`/`anchorOf` re-localiza (valida o motor de identidade via `findByAnchor`, o reverso de `anchorOf`) e devolve relatório Markdown acionável ("3/5 entregues, faltam estes 2").

**UX.** Dois botões ao lado de "copiar spec" (visíveis em select e edit, pura-leitura): **"snapshot"** (captura âncora+intenção+styles dos rastreados → localStorage por URL; toast "snapshot de N el.") e **"verificar"** (relê o snapshot, re-localiza e diffa contra o DOM vivo). Verificar abre painel `dm-verify-panel` listando cada item com status + props que mudaram, mais badges `dm-verify-badge` ancorados ao alvo (deslocados pra não cobrir o 📌). Botão "copiar relatório". `updateCur` habilita "verificar" só quando há snapshot pra esta URL.

**Modelo de dados.** Chave `RT_KEY="dm-rt:"+location.href`. Valor JSON `{v:1,url,ts,entries:[{anchor,intents:[],note,geom:{w,h},styles:{prop:val}}]}`. Estado: `snapshot=null` (lazy); `verifyBadges=new Map()` (separado de `noteBadges`); `verifyPanel=null`; `WATCH_BASE=["font-size","color","background-color","padding","margin","border-radius","width","height","display"]`; `INTENT_WATCH={"spacing.increase":["padding","margin","gap"],"color.wrong":["color","background-color"],...}`. **Fix:** chaves pontilhadas DEVEM ser strings quotadas (senão `node --check` falha). Memória limpa por `quit()`; localStorage só via `clearSnapshot()`.

**Plano de código (pontos de inserção).**
- STATE L30-52: `snapshot`/`verifyBadges`/`verifyPanel` + consts `WATCH_BASE`, `INTENT_WATCH`, helper `RT_KEY()`.
- STYLE (antes de L93): `.dm-verify-panel` (padrão `.dm-bar`) + `.dm-verify-badge` + classes de status (ok/pend/miss/regress).
- BAR L124: `<button id=dm-snapshot>` + `<button id=dm-verify>`; sem `dm-edit-only`.
- WIRING L153-154: `captureSnapshot`; `runVerify`.
- Nova seção após `copyNotes` (~L1225): `captureSnapshot()` reúne els de `buildSpec` (filtra `isConnected`), monta entries com `anchorOf(el)` + `styleFingerprint` + geom, grava em localStorage com try/catch.
- `findByAnchor(anchor)`: tenta `anchor.selector` via `querySelectorAll` (1 match=alta confiança); senão varre por tag pontuando text/role/near/attrs (`data-testid`/`name`/`href`/`alt`); retorna `{el,by,confidence}` ou null. **É o reverso que PROVA `anchorOf`.** **Fix:** try/catch no `querySelectorAll` (mirror `uniqueGlobally` L859) antes do fallback.
- `styleFingerprint`/`watchedPropsFor(intents)`=`WATCH_BASE ∪ INTENT_WATCH[id]`; ler `getComputedStyle` ignorando o `transform` inline do design-mode (geom via `baselines` ou `offsetWidth`).
- `runVerify()`: `loadSnapshot()` → por entry `findByAnchor` + re-fingerprint + diff; classifica; `renderVerifyPanel` + cria `dm-verify-badge` via `positionBadge`. **Fix:** offset fixo em px pra nunca sentar sob o 📌.
- `repositionNotes` L1096: iterar `verifyBadges` com a mesma poda `isConnected`.
- `clearNotes` L1103 + `quit` L254: remover `verifyBadges`/`verifyPanel`; `clearSnapshot()` só esvazia localStorage sob demanda (só o `RT_KEY`).
- `copyVerifyReport()`: Markdown do veredito via `writeClipboard`.
- **Fix crítico — `updateCur` L345:** o `getItem(RT_KEY())` DEVE ser try/catch'd (`hasSnapshot()` helper). Em `file://`/incognito/storage bloqueado, `getItem` lança `SecurityError` e quebraria a barra inteira, não só o botão verificar.

**Fixes adicionais.**
- **Fallback `file://`:** trocar in-memory por `window.name`/`sessionStorage` (sobrevive ao reload); in-memory vira último recurso com toast honesto "snapshot não persiste neste contexto". Sem isso o acceptance `file://` é enganoso.
- **Chave RT:** default `origin+pathname` (dropar query/hash) pra re-achar em SPAs hash-routed; full href só se colisão.
- **Semântica de geometria (open question #5):** ou escopar verify a computed-style props no v1 (geometria out), ou guardar a geometria-alvo do humano (after-state) como goal — não shippar a ambiguidade.

**API.** `DesignMode.snapshot()`, `verify()`, `clearSnapshot()`; `findByAnchor(anchor)` (reverso publicável de `anchorOf`).

**Critérios de aceite.**
- `node --check` passa.
- Select: snapshot e verificar NÃO mutam o DOM; só overlays `dm-` removíveis por `quit()`.
- Round-trip real: snapshot, alterar CSS do fixture, reload, verificar mostra entregue com before→after da prop alterada.
- `findByAnchor` re-localiza quando o seletor casa E quando uma classe muda (fallback por texto/attrs).
- `file://`: localStorage indisponível/origin-null não quebra (try/catch, toast, fallback persistente).
- `quit()` remove painel, badges e listeners; reinjeção não duplica.
- Relatório Markdown lista status por elemento com props before→after.

**Dependências.** `anchorOf` L944 (`findByAnchor` é o reverso); motor de identidade L850-919; `buildSpec` L1127 + `baselines`/`markBaseline`; `writeClipboard` L472; padrão de overlay das notas; `INTENTS` L38; `uiNotifySafe` + `updateCur`.

**Conflitos.** Badge de verificação × 📌 (Map separado + offset). localStorage em `file://` (origin null compartilhado → chavear por href/pathname). Snapshot stale (mesma URL, página diferente — sem campo build/hash). Painel disputa espaço com a barra/popover. Edições via `transform` poluem geometria/styles se não ignoradas no fingerprint.

**Esforço / risco.** L / **med**.

**Veredito da revisão.** ⚠️ **needs-work.** Bem-ancorado; `findByAnchor` é a peça net-new genuinamente valiosa e factível. Não-ready por três motivos: (1) ler localStorage no hot path do `updateCur` pode lançar e quebrar a barra inteira — **must guard**; (2) o fallback `file://` in-memory não sobrevive ao reload, esvaziando justamente o caso-vitrine — precisa `window.name`/`sessionStorage`; (3) semântica geometria-vs-target deixada como open question determina se o round-trip geométrico do acceptance funciona. Com esses três + try/catch no `findByAnchor` e quoting das chaves, fica ready.

**Questões em aberto.** Ver checklist (itens RT1–RT6).

---

## Decisões pendentes pro humano

Checklist consolidado de todas as questões em aberto, agrupadas por demanda.

### `unit-warn`
- [ ] **U1.** Superfície "base CSS desconhecida" (não classificável) como nota suave, ou silêncio p/ evitar falso alarme? *(default proposto: silêncio)*
- [ ] **U2.** Filhos de flex/grid: o probe `auto` pode ler item esticado como "auto" falso — aceitar heurística ou pular proveniência quando o pai é flex/grid?
- [ ] **U3.** `height:auto` é o default da maioria dos blocks — restringir aviso de altura a quando ela mudou E era auto? *(adotar)*
- [ ] **U4.** Tolerância do match de `auto` (±1px) — fixa ou configurável? *(default: fixa ±1px)*
- [ ] **U5.** Levar o mesmo AVISO pro `copyLayout` (comentário CSS) e `copyNotes`, ou manter spec-only?

### `context-bundle`
- [ ] **C1.** Toggle-para-todos no spec vs botão copiar-contexto por elemento — ou ambos? *(recomendação da review: ambos)*
- [ ] **C2.** Valores dos tetos (5 ancestrais / 2 irmãos / 60 / 200) estão bons?
- [ ] **C3.** Incluir só `openTag` do alvo, ou também 1 nível de innerHTML truncado?
- [ ] **C4.** Irmãos devem carregar a própria nota/intenção se existir no Map `notes`, ou só estrutura? *(review recomenda só estrutura)*
- [ ] **C5.** `richContext` persiste entre quit/reinstall ou sempre volta OFF? *(spec: sempre OFF)*

### `token-table`
- [ ] **TT1.** Resolver unidades relativas (rem/em/%) exige elemento de contexto — best-effort com root font-size ou deixar cru?
- [ ] **TT2.** Vários tokens com o mesmo valor (alias) — qual ganha no índice reverso: nome mais curto, primeiro, ou listar todos? *(fixar 1 pra determinismo)*
- [ ] **TT3.** Coletar custom properties só de `:root` ou também de seletores/elementos com escopo? *(review: escopar v1 a `:root`)*
- [ ] **TT4.** Re-harvest automático via MutationObserver em `<style>`/`<link>` ou só `refreshTokens()` manual?
- [ ] **TT5.** Tolerância de match de cor exata vs near (arredondar rgb) pra absorver antialiasing/alpha?

### `eyedropper`
- [ ] **EY1.** Eyedropper ao vivo no hover vs baseado em seleção? *(review: selection-based, pra manter select puro)*
- [ ] **EY2.** Quais canais exatamente — incluir `box-shadow`/gradiente/`border-width`?
- [ ] **EY3.** Sem token casado: emitir valor cru ou marcar "hardcoded, precisa de token"? *(review: emitir cru rotulado "hardcoded — sem token")*
- [ ] **EY4.** Persistir o eyedrop no spec (vira estado) ou só copiar?
- [ ] **EY5.** Múltiplos tokens com o mesmo valor: escolher o mais curto / mais semântico / no escopo do elemento?
- [ ] **EY6.** Badge 💧 próprio ou nenhum? *(review: nenhum, evita colisão com 📌)*

### `token-manifest` (fundido)
- [ ] **TM1.** Fonte do manifesto: paste JSON, auto-derivar de `:root`, ou ambos? *(review: paste-first; "auto :root" via getComputedStyle não funciona)*
- [ ] **TM2.** Métrica/threshold de cor: euclidiana RGB simples vs CIE Lab deltaE? *(review: RGB euclidiana)*
- [ ] **TM3.** Quais props amostrar por padrão (color, background-color, border-color, border-radius, font-size, gap, padding)?
- [ ] **TM4.** Proveniência anexa só a amostras do eyedropper, ou auto-scan de todo elemento alterado? *(review: só o que o eyedropper amostrou)*
- [ ] **TM5.** Categorias além de cor/length (shadow, font-family, font-weight)?
- [ ] **TM6.** Tolerância de length: px absoluto, percentual, ou ambos? *(review: `max(2px, 8%)`)*

### `pins`
- [ ] **PN1.** Pins persistem ao alternar para "off" ou só dentro da sessão ativa? *(decisão de lifecycle — bloqueia o teardown; review pede resolver ANTES de codar)*
- [ ] **PN2.** Toda nota deve auto-fixar (todo noted vira numerado) ou pin e nota são independentes? *(review: auto-pin no SAVE, não no open)*
- [ ] **PN3.** Desfixar deve reaproveitar/compactar números ou manter buracos (1,3,5) pra estabilidade absoluta?
- [ ] **PN4.** Legenda é export separado e/ou também embutida como cabeçalho no spec/notes?
- [ ] **PN5.** Badge mostra número puro, número+📌, ou número com cor quando há nota?

### `stability-badge`
- [ ] **SB1.** Piscar automático ao selecionar nó ambíguo, ou só no clique do botão?
- [ ] **SB2.** Esquema do `data-dm-ref`: sequencial `r1`/`r2` ou slug do texto/role?
- [ ] **SB3.** `copyElements` (outerHTML) deve persistir o `data-dm-ref` no markup exportado ou stripar? *(review: stripar — hook só em-sessão)*
- [ ] **SB4.** Limiar de cor: "único por classe semântica" é verde-aceitável ou sempre amarelo?
- [ ] **SB5.** "Fixar ref" atua em multi-seleção (carimba todos) ou só em 1?
- [ ] **SB6.** Mostrar a confiança também no Markdown do spec (linha legível) além do JSON?

### `relational`
- [ ] **RL1.** Vocabulário: incluir relações geométricas ("alinhar com"/"mesmo tamanho") ou manter só semânticas? *(review: só semânticas, p/ não sobrepor snap-constraint)*
- [ ] **RL2.** A relação é DIRECIONADA (B segue A) ou simétrica? *(define seta vs linha e a fraseologia)*
- [ ] **RL3.** Export: só `copyRelations` dedicado, ou também dobrar no JSON do `copySpec` (mudaria schema p/ `{elements,relations}`)? *(precisa resolver — acceptance "## Relações" depende disso)*
- [ ] **RL4.** Permitir várias relações por elemento / muitos-para-um? Há cap?
- [ ] **RL5.** Editar/remover relação: clicar o badge só apaga, ou também reabre o picker de tipo?
- [ ] **RL6.** Dedicar a tecla **R** pra armar o pareamento (espelhando o N da nota)?

### `round-trip`
- [ ] **RT1.** Auto-snapshot ao rodar `copySpec` (zero-friction) ou só botão manual?
- [ ] **RT2.** "Entregue" = qualquer mudança em prop observada, ou exigir mudança na prop específica da intenção? *(classificação subespecificada — risco de "regrediu" falso)*
- [ ] **RT3.** Auto-rodar verify no boot quando existe snapshot, ou só manual após reload?
- [ ] **RT4.** Chave por `location.href` vs `origin+pathname` (ignorar query/hash)? *(review: `origin+pathname`)*
- [ ] **RT5.** Snapshot guarda os edits transform do humano como ALVO, ou só o estado original como before? *(determina se o round-trip geométrico funciona — resolver antes de codar)*
- [ ] **RT6.** Reter snapshot após verify (re-verificar) ou limpar; e como tratar `file://` sem localStorage? *(review: `window.name`/`sessionStorage`)*