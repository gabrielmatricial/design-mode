/*!
 * design-mode.js — standalone, zero-dependency DOM design tool.
 *
 * Drop in via <script src="design-mode.js"></script> on ANY page/project.
 * Optional auto-start: <script src="design-mode.js" data-autostart></script>
 *
 * Features: floating toolbar, click/Shift+click (multi)select, drag to move
 * (transform translate), native corner resize (↘), align (⬅⬌➡/⬆⬍⬇),
 * undo (Ctrl+Z), copy/paste elements (Ctrl+C / Ctrl+V), delete (Del),
 * export CSS ("copiar layout"), quit (✕ — removes the tool from the page).
 *
 * Two active modes: SELECT (🔍 inspecionar) — with the default MOVE tool it never
 * moves/resizes/restructures the layout, safe for investigating; EDIT (✎ editar) is
 * the full editor (move/resize/align/group/copy/paste/delete). Pair with STATIC
 * (▣ estático) to freeze the page's own clicks/dropdowns/forms.
 *
 * Pointer TOOL (orthogonal to the mode — works in BOTH inspecionar and editar):
 * MOVE (✥) drags to move (move/resize only mutate in editar); MARQUEE (▦ seleção)
 * drags a rubber-band to multi-select everything it touches (read-only, both modes);
 * TEXT (T) clicks an element to edit its text in place (a deliberate content edit,
 * available in both modes). Shortcuts: V / M / T.
 *
 * Public API: window.DesignMode.select() / .edit() / .setMode("off"|"select"|"edit")
 *   / .setTool("move"|"marquee"|"text") / .tool() / .toggle() / .quit() / .isEditing() / .mode()
 *
 * MIT License.
 */
(function DM_INSTALL() {
  "use strict";

  if (window.DesignMode && window.DesignMode.__installed) return;

  const DM_VERSION = "1.8.0"; // versão da ferramenta — mostrada na barra pra confirmar que atualizou
  const PASTE_OFFSET = 12; // px de offset ao colar
  const SNAP = 6; // px de tolerância do alinhamento magnético no drag (Alt desliga)
  let groupSeq = 0; // contador de ids de grupo (data-dm-group)
  let guideV = null, guideH = null; // linhas-guia do snap (criadas sob demanda)
  let snapBoxV = null, snapBoxH = null; // realce da CAIXA do elemento-alvo do snap (eixo X/Y)
  const changes = new Map(); // el -> { w, h, tx, ty, z, el, snap? }
  const baselines = new Map(); // el -> { w, h, tx, ty, z } ANTES da 1ª mutação (before do spec)
  const notes = new Map(); // el -> { types:Set<string>, text:string } (intenção em linguagem natural)
  const noteBadges = new Map(); // el -> badge overlay 📌 (NUNCA filho do alvo)
  const detachOverlays = new Map(); // el -> overlay tracejado (solto do fluxo, FORA do alvo)
  const displayForced = new Set(); // els promovidos inline→inline-block p/ poder mover
  const boxSizingForced = new Set(); // els forçados a box-sizing:border-box p/ o resize bater 1:1
  let notePop = null; // popover de nota aberto (1 por vez)
  // Intenções tipadas (chips) — vocabulário curto e acionável pro agente programador.
  const INTENTS = [
    { id: "spacing.increase", label: "+ respiro" },
    { id: "color.wrong", label: "cor errada" },
    { id: "type.small", label: "fonte pequena" },
    { id: "semantics.dropdown", label: "vira dropdown" },
    { id: "role.primary", label: "CTA primário" },
    { id: "responsive.fluid", label: "responsivo" },
    { id: "radius", label: "arredondar" },
  ];
  const selected = new Set(); // seleção MÚLTIPLA (Shift+clique adiciona)
  const undoStack = []; // pilha de snapshots p/ desfazer (Ctrl+Z)
  const clipboard = []; // outerHTML dos elementos copiados (Ctrl+C)
  let mode = "off"; // "off" (dormente) | "select" (inspecionar) | "edit" (editor)
  let drag = null; // array de { el, btx, bty } (+ .sx/.sy) — move todos juntos
  let booted = false;
  let dmQuit = false; // marca que o usuário saiu (✕) — barra-moldura não reinjeta no iframe
  let frameObserver = null, frameSweep = null, frameKick = null, dmMsgHandler = null; // observação/sweep/escuta de iframes filhos
  const dmWatched = new Map(); // iframe -> handler de 'load' (guardado p/ remover no quit, sem vazar)
  let nudgeSession = null; // { els:Set, t:number } — coalesce de undo p/ rajadas de seta (mover/resize teclado)
  let alignKeep = true; // '@ manter': align vincula ao último selecionado (constraint mantida)
  // ── FERRAMENTA de ponteiro (eixo ORTOGONAL a inspecionar/editar) ──
  // "move" (padrão): arrastar move (editar) / só clica-seleciona (inspecionar); grip ↘ redimensiona.
  // "marquee": arrastar desenha um retângulo e seleciona tudo que ENCOSTAR (vale nos dois modos).
  // "text": clicar edita o texto do elemento no lugar (contenteditable).
  let tool = "move";
  let marquee = null; // { x0,y0,x1,y1, add, cands:[{el,r}], hi:Set, box } durante o retângulo
  let textEdit = null; // { el, before } enquanto edita o texto no lugar
  const textEdits = new Map(); // el -> { before, after } (innerHTML) p/ spec + contador
  let resize = null; // { sx,sy, anchor, anchorRect0, base:Map<el,{w,h}>, targetXs, targetYs, snapX, snapY }
  let rzHandle = null; // overlay do grip de resize (↘) — afeta TODOS os selecionados

  const style = document.createElement("style");
  style.setAttribute("data-dm-style", ""); // marcador p/ remover do HTML salvo
  style.textContent = `
    .dm-bar{position:fixed;z-index:2147483647;right:12px;bottom:12px;display:flex;gap:5px;
      align-items:center;font:12px ui-monospace,monospace;background:#11151b;color:#cfe;flex-wrap:wrap;max-width:96vw;
      border:1px solid #38414e;border-radius:8px;padding:6px 8px;box-shadow:0 4px 16px #0008}
    .dm-bar.dm-bar-frame{left:12px;right:auto;border-color:#e6a23c}
    .dm-bar.dm-dragged{right:auto;bottom:auto}
    .dm-bar #dm-grip{cursor:grab;user-select:none;padding:0 4px;color:#7f93a6;font-size:14px;line-height:1;touch-action:none}
    .dm-bar.dm-dragging #dm-grip{cursor:grabbing}
    .dm-bar button{font:12px ui-monospace,monospace;padding:6px 8px;background:#1b222c;color:#cfe;
      border:1px solid #38414e;border-radius:6px;cursor:pointer}
    .dm-bar button:hover{border-color:#5b8;background:#1f2a36}
    .dm-bar button.on{border-color:#1dc077;background:#13241b;color:#9f7}
    .dm-bar button:disabled{opacity:.4;cursor:default}
    .dm-bar .dm-sep{width:1px;align-self:stretch;background:#38414e;margin:0 2px}
    .dm-bar .dm-grp{display:none;gap:4px}
    .dm-bar.dm-multi .dm-grp{display:flex}
    .dm-bar .dm-grp1{display:none;gap:4px}
    .dm-bar.dm-has-sel .dm-grp1{display:flex}
    .dm-bar .dm-cur{max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#8aa}
    .dm-bar .dm-ver{color:#5f7287;font-size:10px;align-self:center;margin-left:2px;opacity:.8}
    .dm-bar.dm-collapsed{padding:4px 8px}
    .dm-bar.dm-collapsed > *:not(.dm-bar-toggle){display:none !important}
    .dm-bar .dm-bar-toggle{cursor:pointer;font-weight:bold;align-self:center;color:#9fc6ff;touch-action:none;user-select:none}
    .dm-bar.dm-bar-frame .dm-bar-toggle{color:#e6a23c}
    .dm-bar.dm-collapsed .dm-bar-toggle::after{content:" ▸";opacity:.7}
    .dm-bar:not(.dm-collapsed) .dm-bar-toggle::after{content:" ▾";opacity:.7}
    body.dm-active *:hover{outline:1px dashed #5b8a !important}
    .dm-sel{outline:2px solid #1dc077 !important;outline-offset:1px}
    .dm-grouped{outline:1px dashed #c9a227 !important;outline-offset:1px}
    .dm-rzh{position:fixed;z-index:2147483646;width:14px;height:14px;box-sizing:border-box;
      background:#1dc077;border:2px solid #0b3a26;border-radius:3px;cursor:nwse-resize;
      box-shadow:0 1px 4px #0008;touch-action:none;display:none}
    .dm-bar:not(.dm-editing) .dm-edit-only{display:none !important}
    .dm-bar #dm-mode-select.on{border-color:#4aa3ff;background:#0f1f2e;color:#9fd0ff}
    .dm-guide{position:fixed;z-index:2147483646;background:#ff3b8d;pointer-events:none;margin:0;padding:0}
    .dm-guide.dm-guide-v{top:0;width:1px;height:100vh}
    .dm-guide.dm-guide-h{left:0;height:1px;width:100vw}
    .dm-snapbox{position:fixed;z-index:2147483646;border:1px solid #ff3b8d;box-sizing:border-box;
      pointer-events:none;margin:0;padding:0;border-radius:2px;background:rgba(255,59,141,.06)}
    .dm-bar #dm-note.on{border-color:#e6a23c;background:#2a2113;color:#ffd27f}
    .dm-note-pop{position:fixed;z-index:2147483647;width:264px;max-width:96vw;box-sizing:border-box;
      font:12px ui-monospace,monospace;background:#11151b;color:#cfe;border:1px solid #38414e;
      border-radius:8px;padding:8px;box-shadow:0 6px 20px #000a}
    .dm-note-pop .dm-chips{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px}
    .dm-note-pop .dm-chip{padding:3px 8px;border:1px solid #38414e;border-radius:999px;background:#1b222c;
      color:#cfe;cursor:pointer;font:11px ui-monospace,monospace}
    .dm-note-pop .dm-chip:hover{border-color:#5b8}
    .dm-note-pop .dm-chip.on{border-color:#1dc077;background:#13241b;color:#9f7}
    .dm-note-pop textarea{width:100%;box-sizing:border-box;min-height:48px;background:#0d1116;color:#cfe;
      border:1px solid #38414e;border-radius:6px;padding:5px;font:12px ui-monospace,monospace;resize:vertical}
    .dm-note-pop .dm-note-hint{color:#8aa;margin-top:5px;font-size:11px}
    .dm-note-badge{position:fixed;z-index:2147483646;font-size:14px;line-height:1;pointer-events:none;
      transform:translate(-50%,-50%);filter:drop-shadow(0 1px 2px #000)}
    .dm-detach{position:fixed;z-index:2147483645;border:1px dashed #e6883c;pointer-events:none;
      box-sizing:border-box;margin:0;padding:0;border-radius:2px}
    .dm-bar #dm-keep.on{border-color:#e6a23c;background:#2a2113;color:#ffd27f}
    /* ── ferramentas: seleção (marquee) + texto ── */
    .dm-bar .dm-grp-tool{display:flex;gap:4px}
    .dm-bar:not(.dm-on) .dm-tool-only{display:none !important}
    .dm-bar #dm-tool-marquee.on{border-color:#4aa3ff;background:#0f1f2e;color:#9fd0ff}
    .dm-bar #dm-tool-text.on{border-color:#e6a23c;background:#2a2113;color:#ffd27f}
    .dm-marquee{position:fixed;z-index:2147483646;border:1px solid #4aa3ff;
      background:rgba(74,163,255,.12);box-sizing:border-box;pointer-events:none;margin:0;padding:0}
    .dm-marquee-hit{outline:2px solid #4aa3ff !important;outline-offset:1px}
    .dm-text-editing{outline:2px dashed #e6a23c !important;outline-offset:2px}
    body.dm-tool-marquee.dm-active *{cursor:crosshair !important;user-select:none !important}
    body.dm-tool-text.dm-active *{cursor:text !important}
    body.dm-active .dm-bar, body.dm-active .dm-bar *{cursor:auto !important;user-select:none !important}
    body.dm-active .dm-bar button{cursor:pointer !important}
    body.dm-active .dm-bar #dm-grip{cursor:grab !important}
    body.dm-active .dm-bar #dm-toggle{cursor:pointer !important}
    /* o popover de nota NÃO está dentro da barra: isenta do cursor de ferramenta */
    body.dm-active .dm-note-pop, body.dm-active .dm-note-pop *{cursor:auto !important;user-select:auto !important}
    body.dm-active .dm-note-pop textarea{cursor:text !important}
    /* o grip ↘ não deve receber o outline tracejado de hover da página */
    body.dm-active .dm-rzh, body.dm-active .dm-rzh:hover{outline:none !important;cursor:nwse-resize !important}
  `;

  const bar = document.createElement("div");
  bar.className = "dm-bar";
  bar.innerHTML =
    '<span id="dm-toggle" class="dm-bar-toggle" title="clique pra abrir/fechar · arraste pra mover">▣ design</span>' +
    '<span id="dm-grip" title="arraste pra mover esta barra">⠿</span>' +
    '<button id="dm-mode-select" title="modo seletor — só inspeciona/seleciona; NÃO move nem redimensiona (seguro pra investigar)">🔍 inspecionar</button>' +
    '<button id="dm-mode-edit" title="modo editor — mover, redimensionar, alinhar, agrupar, copiar/colar, apagar">✎ editar</button>' +
    '<span class="dm-sep dm-tool-only"></span>' +
    '<span class="dm-grp-tool dm-tool-only" id="dm-tools">' +
      '<button id="dm-tool-move" class="on" title="ferramenta MOVER (V) — arrastar move o(s) elemento(s); o grip ↘ redimensiona TODOS os selecionados (segure Shift pra alinhar)">✥ mover</button>' +
      '<button id="dm-tool-marquee" title="ferramenta SELEÇÃO (M) — arraste pra desenhar um retângulo; tudo que encostar entra na seleção. Vale em inspecionar E editar">▦ seleção</button>' +
      '<button id="dm-tool-text" title="ferramenta TEXTO (T) — clique num elemento pra editar o texto no lugar (Enter confirma · Esc cancela)">T texto</button>' +
    '</span>' +
    '<span class="dm-sep"></span>' +
    '<button id="dm-static" title="modo estático — congela a página: não responde a cliques, dropdowns nem filtros">▣ estático: OFF</button>' +
    '<button id="dm-parent" title="selecionar elemento pai (Alt+↑) — Alt+↓ filho, Alt+←/→ irmãos">⬆ pai</button>' +
    '<span class="dm-grp dm-edit-only" id="dm-align" title="alinhar (2+ selecionados)">' +
      '<button data-al="left" title="alinhar à esquerda">⬅</button>' +
      '<button data-al="hcenter" title="centralizar horizontal">⬌</button>' +
      '<button data-al="right" title="alinhar à direita">➡</button>' +
      '<button data-al="top" title="alinhar ao topo">⬆</button>' +
      '<button data-al="vcenter" title="centralizar vertical">⬍</button>' +
      '<button data-al="bottom" title="alinhar à base">⬇</button>' +
      '<button id="dm-keep" class="on" title="@ manter — alinha ao ÚLTIMO selecionado e MANTÉM a constraint: mover a referência reencosta os vinculados (ON por padrão)">@ manter</button>' +
    '</span>' +
    '<span class="dm-grp1 dm-edit-only" id="dm-layer-grp">' +
      '<button id="dm-front" title="trazer pro topo (z-index)">⤒ topo</button>' +
      '<button id="dm-up" title="subir uma camada (])">↑</button>' +
      '<button id="dm-down" title="descer uma camada ([)">↓</button>' +
      '<button id="dm-back" title="enviar pro fundo (z-index)">⤓ fundo</button>' +
      '<button id="dm-group" title="agrupar selecionados (Ctrl+G)">▣ agrupar</button>' +
      '<button id="dm-ungroup" title="desagrupar (Ctrl+Shift+G)">▢ desagrupar</button>' +
    '</span>' +
    '<span class="dm-sep dm-edit-only"></span>' +
    '<button id="dm-copyel" title="copiar HTML do(s) elemento(s) pro clipboard (Ctrl+C)" disabled>⧉ copiar el</button>' +
    '<button id="dm-copysel" title="copiar o seletor CSS do(s) elemento(s) pro clipboard" disabled>⛓ copiar seletor</button>' +
    '<button id="dm-note" title="anotar intenção (cor/tipo/espaço/semântica) ancorada ao elemento — vale em inspecionar e editar (tecla N)" disabled>✎ nota</button>' +
    '<button id="dm-copy" class="dm-edit-only" title="copiar CSS do layout (tamanhos/posição) pro clipboard">📋 copiar layout</button>' +
    '<button id="dm-copyspec" title="copiar SPEC (geometria + intenção) em Markdown + JSON pro agente programador">🧾 copiar spec</button>' +
    '<button id="dm-copynotes" title="copiar só as notas/intenções (Markdown + JSON)">🗒 copiar notas</button>' +
    '<button id="dm-copyall" title="copiar TUDO num pacote só: spec (intenção+geometria+notas) + layout CSS + seletores + HTML">📦 copiar tudo</button>' +
    '<span class="dm-sep"></span>' +
    '<button id="dm-save" title="salvar o HTML da página no arquivo (Ctrl+S) — sobrescreve em localhost/https, baixa cópia em file://">💾 salvar</button>' +
    '<button id="dm-saveas" title="salvar como… — escolher arquivo/destino (Ctrl+Shift+S)">💾 salvar como…</button>' +
    '<span class="dm-sep dm-edit-only"></span>' +
    '<button id="dm-paste" class="dm-edit-only" title="colar elemento(s) (Ctrl+V)" disabled>⊕ colar</button>' +
    '<button id="dm-del" class="dm-edit-only" title="apagar selecionado(s) (Del)" disabled>🗑 apagar</button>' +
    '<span class="dm-sep dm-edit-only"></span>' +
    '<button id="dm-undo" class="dm-edit-only" title="desfazer (Ctrl+Z)" disabled>↶ undo</button>' +
    '<button id="dm-reset" class="dm-edit-only" title="desfazer tudo">↺ reset</button>' +
    '<span class="dm-sep"></span>' +
    '<button id="dm-quit" title="sair — remove a ferramenta da página">✕ sair</button>' +
    '<span class="dm-cur" id="dm-cur">—</span>' +
    '<span class="dm-ver" id="dm-ver" title="versão da ferramenta — confira se mudou após recarregar (Alt+Shift+D)">v' + DM_VERSION + '</span>';

  function ready(fn) {
    if (document.body) fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }

  function makeDraggable(el, handle, onTap) {
    if (!handle) return;
    let dragging = false, moved = false, sx = 0, sy = 0, ox = 0, oy = 0;
    const onDown = (e) => {
      dragging = true; moved = false;
      const r = el.getBoundingClientRect();
      // fixa em left/top a partir da posição atual (independe de right/bottom)
      ox = r.left; oy = r.top;
      sx = e.clientX; sy = e.clientY;
      try { handle.setPointerCapture(e.pointerId); } catch (_) {}
      e.preventDefault();
    };
    const onMove = (e) => {
      if (!dragging) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 4) return; // ainda é clique, não arrasto
      if (!moved) { // primeiro movimento real: fixa em left/top
        moved = true;
        el.classList.add("dm-dragged", "dm-dragging");
        el.style.left = ox + "px";
        el.style.top = oy + "px";
      }
      let nx = ox + dx, ny = oy + dy;
      const r = el.getBoundingClientRect();
      nx = Math.min(Math.max(0, nx), Math.max(0, innerWidth - r.width));
      ny = Math.min(Math.max(0, ny), Math.max(0, innerHeight - r.height));
      el.style.left = nx + "px";
      el.style.top = ny + "px";
    };
    const onUp = (e) => {
      if (!dragging) return;
      dragging = false;
      el.classList.remove("dm-dragging");
      try { handle.releasePointerCapture(e.pointerId); } catch (_) {}
      if (!moved && typeof onTap === "function") onTap(e); // clique sem arrasto = toggle
    };
    handle.addEventListener("pointerdown", onDown);
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  }

  function boot() {
    if (booted) return;
    booted = true;
    ready(() => {
      document.head.appendChild(style);
      document.body.appendChild(bar);
      makeDraggable(bar, bar.querySelector("#dm-grip"));
      makeDraggable(bar, bar.querySelector("#dm-toggle"), () => bar.classList.toggle("dm-collapsed"));
      bar.classList.add("dm-collapsed"); // nasce recolhida — só a pílula; clica/arrasta
      bar.querySelector("#dm-mode-select").addEventListener("click", () => setMode(mode === "select" ? "off" : "select"));
      bar.querySelector("#dm-mode-edit").addEventListener("click", () => setMode(mode === "edit" ? "off" : "edit"));
      bar.querySelector("#dm-tool-move").addEventListener("click", () => setTool("move"));
      bar.querySelector("#dm-tool-marquee").addEventListener("click", () => setTool("marquee"));
      bar.querySelector("#dm-tool-text").addEventListener("click", () => setTool("text"));
      bar.querySelector("#dm-parent").addEventListener("click", selectParent);
      bar.querySelector("#dm-copy").addEventListener("click", copyLayout);
      bar.querySelector("#dm-copysel").addEventListener("click", copySelector);
      bar.querySelector("#dm-note").addEventListener("click", () => { if (selected.size === 1) openNote([...selected][0]); });
      bar.querySelector("#dm-copyspec").addEventListener("click", copySpec);
      bar.querySelector("#dm-copynotes").addEventListener("click", copyNotes);
      bar.querySelector("#dm-copyall").addEventListener("click", copyAll);
      bar.querySelector("#dm-save").addEventListener("click", () => saveFile(false));
      bar.querySelector("#dm-saveas").addEventListener("click", () => saveFile(true));
      bar.querySelector("#dm-reset").addEventListener("click", resetAll);
      bar.querySelector("#dm-undo").addEventListener("click", undo);
      bar.querySelector("#dm-copyel").addEventListener("click", copyElements);
      bar.querySelector("#dm-paste").addEventListener("click", pasteElements);
      bar.querySelector("#dm-del").addEventListener("click", deleteElements);
      bar.querySelector("#dm-static").addEventListener("click", toggleStatic);
      bar.querySelector("#dm-quit").addEventListener("click", quit);
      bar.querySelector("#dm-front").addEventListener("click", () => layer("front"));
      bar.querySelector("#dm-up").addEventListener("click", () => layer("up"));
      bar.querySelector("#dm-down").addEventListener("click", () => layer("down"));
      bar.querySelector("#dm-back").addEventListener("click", () => layer("back"));
      bar.querySelector("#dm-group").addEventListener("click", groupSelected);
      bar.querySelector("#dm-ungroup").addEventListener("click", ungroupSelected);
      bar.querySelectorAll("#dm-align button[data-al]").forEach((b) =>
        b.addEventListener("click", () => align(b.getAttribute("data-al"), { keep: alignKeep })));
      bar.querySelector("#dm-keep").addEventListener("click", toggleKeep);
      // âncoras dos overlays (badges de nota / popover) seguem o scroll e o resize
      window.addEventListener("scroll", repositionNotes, true);
      window.addEventListener("resize", repositionNotes, true);
    });
  }

  // MODOS: "off" (dormente) · "select" (inspecionar: só seleciona, não muta) ·
  // "edit" (editor completo). Selecionar e copiar seletor/HTML valem nos dois modos
  // ativos; mover/redimensionar e mutações (colar/apagar/agrupar/camadas) só no "edit".
  function setMode(next) {
    boot();
    next = (next === "select" || next === "edit") ? next : "off";
    if (next === mode) return;
    const wasActive = mode !== "off";
    mode = next;
    const active = mode !== "off";
    const editing = mode === "edit";
    document.body.classList.toggle("dm-active", active);
    document.body.classList.toggle("dm-edit", editing);
    bar.classList.toggle("dm-editing", editing);
    bar.classList.toggle("dm-on", active); // mostra a paleta de ferramentas (✥/▦/T) quando ativo
    const selBtn = bar.querySelector("#dm-mode-select");
    const editBtn = bar.querySelector("#dm-mode-edit");
    if (selBtn) selBtn.classList.toggle("on", mode === "select");
    if (editBtn) editBtn.classList.toggle("on", editing);
    if (active && !wasActive) {
      document.addEventListener("pointerdown", onDown, true);
      document.addEventListener("keydown", onKey, true);
    } else if (!active && wasActive) {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
      if (drag) onUp(); // segurança: encerra qualquer drag em curso
      if (marquee) cancelMarquee(); // encerra um retângulo em curso
      if (resize) onRzUp(); // encerra um resize em curso
      if (textEdit) endTextEdit(true); // confirma uma edição de texto em curso
      clearSel();
      clearNotes(); // setMode("off") limpa o Map de notas + overlays
    }
    updateCur();
  }

  function isEditing() { return mode === "edit"; }

  // toggle (ícone da extensão / API): liga em modo SELETOR (seguro p/ investigar)
  // ou desliga se já estiver ativo. Pra editar, clique "✎ editar" na barra.
  function toggle() { setMode(mode === "off" ? "select" : "off"); }

  // ── FERRAMENTA de ponteiro: "move" | "marquee" | "text" (ortogonal ao modo) ──
  // Vale tanto em inspecionar quanto em editar. Trocar de ferramenta encerra com
  // segurança qualquer interação em curso da ferramenta anterior.
  function setTool(next) {
    boot();
    next = (next === "marquee" || next === "text") ? next : "move";
    if (next === tool) return;
    if (resize) onRzUp(); // encerra um resize em curso (o grip some fora da ferramenta "move")
    if (tool === "text") endTextEdit(true); // sai do texto confirmando
    if (tool === "marquee" && marquee) cancelMarquee();
    tool = next;
    for (const [id, t] of [["dm-tool-move", "move"], ["dm-tool-marquee", "marquee"], ["dm-tool-text", "text"]]) {
      const b = bar.querySelector("#" + id);
      if (b) b.classList.toggle("on", tool === t);
    }
    document.body.classList.toggle("dm-tool-marquee", tool === "marquee");
    document.body.classList.toggle("dm-tool-text", tool === "text");
    updateCur(); // reposiciona o grip de resize (some fora da ferramenta "move")
  }

  // ── MODO ESTÁTICO ──────────────────────────────────────────────────────────
  // Toggle DEDICADO (independente do design ON/OFF): congela a página — não
  // responde a cliques, links, botões, dropdowns nem filtros. A barra é exceção.
  // Bloqueia em CAPTURA: a família click/change/submit sempre; e `mousedown` só em
  // controles interativos (assim o `<select>`, que abre no mousedown, não abre, e o
  // foco não vai pro campo) — `pointerdown` fica LIVRE pro design selecionar/arrastar
  // e o grip de resize (↘) segue funcionando (ele é um div, não um controle).
  let staticOn = false;
  const STATIC_BLOCK_EVENTS = ["click", "dblclick", "auxclick", "contextmenu", "submit", "change", "input", "beforeinput"];
  const STATIC_CTRL_SEL =
    'a,button,select,input,textarea,label,summary,details,option,[onclick],' +
    '[role="button"],[role="tab"],[role="option"],[role="menuitem"],[role="combobox"],[contenteditable]';
  function onStaticBlock(e) {
    if (inBar(e.target) || inNotePop(e.target)) return; // barra e popover de nota são exceção
    if (textEdit && textEdit.el && textEdit.el.contains(e.target)) return; // deixa digitar no texto em edição
    if (e.type === "mousedown") {
      const ctrl = e.target && e.target.closest ? e.target.closest(STATIC_CTRL_SEL) : null;
      if (!ctrl) return; // mousedown em layout puro passa (drag do design / grip de resize)
    }
    e.preventDefault();
    e.stopImmediatePropagation();
  }
  function setStatic(next) {
    boot();
    const want = !!next;
    if (want === staticOn) return;
    staticOn = want;
    document.body.classList.toggle("dm-static", staticOn);
    const btn = bar.querySelector("#dm-static");
    if (btn) {
      btn.textContent = staticOn ? "▣ estático: ON" : "▣ estático: OFF";
      btn.classList.toggle("on", staticOn);
    }
    const types = STATIC_BLOCK_EVENTS.concat(["mousedown"]);
    if (staticOn) types.forEach((t) => document.addEventListener(t, onStaticBlock, true));
    else types.forEach((t) => document.removeEventListener(t, onStaticBlock, true));
  }
  function toggleStatic() { setStatic(!staticOn); }

  // QUIT: remove a ferramenta de vez (barra + estilos + listeners + artefatos),
  // deixando a página como o usuário a editou. Permite reinstalar depois (ex.:
  // clicar o bookmarklet de novo) zerando o guard __installed.
  function quit() {
    setMode("off"); // remove listeners + classes de modo + limpa seleção
    setStatic(false); // remove o bloqueio de eventos do modo estático
    document.body.classList.remove("dm-active", "dm-edit", "dm-static", "dm-tool-marquee", "dm-tool-text");
    document.querySelectorAll(".dm-editable, .dm-sel, .dm-grouped, .dm-marquee-hit, .dm-text-editing")
      .forEach((n) => n.classList.remove("dm-editable", "dm-sel", "dm-grouped", "dm-marquee-hit", "dm-text-editing"));
    document.querySelectorAll("[data-dm-group]").forEach((n) => n.removeAttribute("data-dm-group"));
    [guideV, guideH, snapBoxV, snapBoxH].forEach((g) => { if (g && g.parentNode) g.parentNode.removeChild(g); });
    guideV = guideH = null; snapBoxV = snapBoxH = null;
    for (const [, ov] of detachOverlays) { if (ov.parentNode) ov.parentNode.removeChild(ov); }
    detachOverlays.clear();
    if (rzHandle && rzHandle.parentNode) rzHandle.parentNode.removeChild(rzHandle);
    rzHandle = null;
    if (marquee && marquee.box && marquee.box.parentNode) marquee.box.parentNode.removeChild(marquee.box);
    marquee = null;
    textEdits.clear();
    nudgeSession = null;
    clearNotes(); // remove badges 📌 + popover; zera o Map de notas
    baselines.clear();
    displayForced.clear();
    boxSizingForced.clear();
    fileHandle = null; // esquece o arquivo aberto (File System Access API)
    window.removeEventListener("scroll", repositionNotes, true);
    window.removeEventListener("resize", repositionNotes, true);
    if (bar.parentNode) bar.parentNode.removeChild(bar);
    if (style.parentNode) style.parentNode.removeChild(style);
    booted = false;
    dmQuit = true;
    if (frameObserver) { try { frameObserver.disconnect(); } catch (_) {} frameObserver = null; }
    if (frameSweep) { clearInterval(frameSweep); frameSweep = null; }
    if (frameKick) { clearTimeout(frameKick); frameKick = null; }
    if (dmMsgHandler) { try { window.removeEventListener("message", dmMsgHandler); } catch (_) {} dmMsgHandler = null; }
    for (const [frm, onLoad] of dmWatched) { try { frm.removeEventListener("load", onLoad); } catch (_) {} }
    dmWatched.clear();
    quitChildren(); // página-moldura: ✕ aqui também fecha o design-mode do(s) iframe(s)
    try { delete window.DesignMode; } catch (_) { window.DesignMode = undefined; }
  }

  function onKey(e) {
    if (mode === "off") return;
    // o popover de nota trata as próprias teclas (Enter/Esc/digitação) — não intercepta
    if (notePop && notePop.pop.contains(e.target)) return;
    const mod = e.ctrlKey || e.metaKey;
    // Salvar (Ctrl+S) / Salvar como (Ctrl+Shift+S) — vale ATÉ durante a edição de texto
    // (confirma a edição antes); bloqueia o diálogo nativo "salvar página" do navegador.
    if (mod && (e.key === "s" || e.key === "S")) { e.preventDefault(); if (textEdit) endTextEdit(true); saveFile(e.shiftKey); return; }
    // editando texto no lugar: o contenteditable + onTextKey cuidam do resto (Enter/Esc/digitação).
    // Sai aqui pra os atalhos globais (Del apaga elemento, setas movem) NÃO agirem enquanto digita.
    if (textEdit) return;
    // ── valem nos dois modos (não mutam o layout) ──
    if (e.key === "Escape") { clearSel(); return; }
    if (mod && (e.key === "c" || e.key === "C")) { e.preventDefault(); copyElements(); return; }
    // Trocar de FERRAMENTA por tecla: V mover · M seleção (marquee) · T texto. Vale nos dois modos.
    if (!mod && (e.key === "v" || e.key === "V")) { if (isEditableTarget(e.target)) return; e.preventDefault(); setTool("move"); return; }
    if (!mod && (e.key === "m" || e.key === "M")) { if (isEditableTarget(e.target)) return; e.preventDefault(); setTool("marquee"); return; }
    if (!mod && (e.key === "t" || e.key === "T")) { if (isEditableTarget(e.target)) return; e.preventDefault(); setTool("text"); return; }
    // Nota (intenção): 'N' com exatamente 1 selecionado — vale em select e edit.
    if (!mod && (e.key === "n" || e.key === "N")) {
      if (isEditableTarget(e.target)) return; // só barra campo de texto; foco na barra NÃO bloqueia
      if (selected.size === 1) { e.preventDefault(); openNote([...selected][0]); }
      return;
    }
    // Navegar o DOM (Alt+setas) — SÓ-leitura, vale em select E edit: pai / filho / irmãos.
    if (e.altKey && e.key.indexOf("Arrow") === 0) {
      if (isEditableTarget(e.target)) return; // só barra campo de texto; foco na barra NÃO bloqueia
      if (selected.size !== 1) return;
      e.preventDefault(); e.stopPropagation();
      if (e.key === "ArrowUp") selectParent();
      else if (e.key === "ArrowDown") selectChild();
      else if (e.key === "ArrowLeft") selectSibling(-1);
      else if (e.key === "ArrowRight") selectSibling(1);
      scrollSelIntoView();
      return;
    }
    // ── daqui pra baixo: só no modo editor ──
    if (mode !== "edit") return;
    // Mover / redimensionar pela seta (setas SEM Alt; Alt já tratado acima).
    if (!e.altKey && e.key.indexOf("Arrow") === 0) {
      if (isEditableTarget(e.target)) return; // só barra campo de texto; foco na barra NÃO bloqueia
      if (selected.size === 0) return; // no-op: deixa a página rolar
      e.preventDefault(); e.stopPropagation();
      const step = e.shiftKey ? 10 : 1;
      if (mod) {
        // Redimensionar (lote): →/↓ maior, ←/↑ menor. Âncora no top-left.
        if (e.key === "ArrowRight") resizeStep(step, 0);
        else if (e.key === "ArrowLeft") resizeStep(-step, 0);
        else if (e.key === "ArrowDown") resizeStep(0, step);
        else if (e.key === "ArrowUp") resizeStep(0, -step);
      } else {
        // Mover (lote): passo fino 1px / Shift 10px.
        if (e.key === "ArrowRight") nudge(step, 0);
        else if (e.key === "ArrowLeft") nudge(-step, 0);
        else if (e.key === "ArrowDown") nudge(0, step);
        else if (e.key === "ArrowUp") nudge(0, -step);
      }
      return;
    }
    // qualquer outro ramo de edição encerra a sessão de nudge/resize coalescida
    nudgeSession = null;
    // Soltar do fluxo (P) / devolver ao fluxo (Shift+P).
    if (!mod && (e.key === "p" || e.key === "P")) {
      if (isEditableTarget(e.target)) return; // só barra campo de texto; foco na barra NÃO bloqueia
      e.preventDefault(); e.stopPropagation();
      detachSelection(e.shiftKey);
    }
    else if (mod && (e.key === "g" || e.key === "G")) { e.preventDefault(); if (e.shiftKey) ungroupSelected(); else groupSelected(); }
    else if (mod && (e.key === "z" || e.key === "Z")) { e.preventDefault(); undo(); }
    else if (mod && (e.key === "v" || e.key === "V")) { e.preventDefault(); pasteElements(); }
    else if (e.key === "]") { e.preventDefault(); layer("up"); }
    else if (e.key === "[") { e.preventDefault(); layer("down"); }
    else if (e.key === "Delete" || e.key === "Backspace") {
      // Backspace só apaga quando não estamos num campo editável
      if (e.key === "Backspace" && isEditableTarget(e.target)) return;
      e.preventDefault();
      deleteElements();
    }
  }

  function isEditableTarget(node) {
    if (!node) return false;
    const tag = node.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || node.isContentEditable;
  }

  function inBar(node) {
    return node && bar.contains(node);
  }

  // Overlays/artefatos da PRÓPRIA ferramenta — NUNCA são alvos válidos de snap/marquee.
  // ATENÇÃO: não inclui dm-sel/dm-editable/dm-grouped — essas vivem em elementos REAIS da
  // página (e o dm-editable fica "grudado" depois de selecionar), então excluí-las quebraria
  // o snap/seleção contra elementos já tocados.
  const DM_OVERLAY_CLASSES = ["dm-guide", "dm-snapbox", "dm-marquee", "dm-rzh", "dm-note-badge", "dm-note-pop", "dm-detach"];
  function isDmOverlay(node) {
    return !!(node && node.classList && DM_OVERLAY_CLASSES.some((k) => node.classList.contains(k)));
  }

  // ── seleção múltipla (clique = só este; Shift+clique = alterna no conjunto) ──
  // Grupos: selecionar 1 membro seleciona o grupo inteiro (data-dm-group).
  function groupMembers(el) {
    const g = el.getAttribute && el.getAttribute("data-dm-group");
    if (!g) return [el];
    return [...document.querySelectorAll('[data-dm-group="' + g + '"]')];
  }
  function addSel(el) {
    for (const m of groupMembers(el)) { selected.add(m); m.classList.add("dm-sel", "dm-editable"); }
    updateCur();
  }
  function selectOnly(el) { nudgeSession = null; clearSel(); addSel(el); }
  function toggleSel(el) {
    nudgeSession = null;
    const mem = groupMembers(el);
    const has = selected.has(el);
    for (const m of mem) {
      if (has) { selected.delete(m); m.classList.remove("dm-sel"); }
      else { selected.add(m); m.classList.add("dm-sel", "dm-editable"); }
    }
    updateCur();
  }
  function clearSel() {
    nudgeSession = null; // Escape também fecha a sessão de nudge/resize coalescida
    selected.forEach((e) => e.classList.remove("dm-sel"));
    selected.clear();
    updateCur();
  }

  function selectParent() {
    if (selected.size !== 1) return;
    const el = [...selected][0];
    if (el.parentElement && el.parentElement !== document.body) selectOnly(el.parentElement);
  }

  // Filhos-elemento "navegáveis": pula a barra e os overlays da ferramenta, e os sem
  // caixa (display:none / 0×0). NÃO usa o prefixo "dm-" cru: dm-sel/dm-editable/dm-grouped
  // ficam em elementos REAIS da página (dm-editable é grudento) e precisam continuar
  // navegáveis. offsetParent==null cobre o caso normal; o rect cobre position:fixed e file://.
  function elementChildrenOf(el) {
    if (!el || !el.children) return [];
    return [...el.children].filter((c) => {
      if (c.nodeType !== 1) return false;
      if (inBar(c) || isDmOverlay(c)) return false;
      if (c.offsetParent != null) return true;
      const r = c.getBoundingClientRect();
      return r.width > 0 || r.height > 0;
    });
  }
  function selectChild() {
    if (selected.size !== 1) return;
    const kids = elementChildrenOf([...selected][0]);
    if (kids.length) selectOnly(kids[0]);
  }
  function selectSibling(dir) {
    if (selected.size !== 1) return;
    const el = [...selected][0];
    const parent = el.parentElement;
    if (!parent) return;
    const sibs = elementChildrenOf(parent);
    const i = sibs.indexOf(el);
    if (i === -1 || sibs.length < 2) return;
    selectOnly(sibs[(i + dir + sibs.length) % sibs.length]); // envolve nas pontas
  }
  // Traz a seleção (1 elemento) pra viewport se estiver fora — acompanha a navegação.
  function scrollSelIntoView() {
    if (selected.size !== 1) return;
    const el = [...selected][0];
    const r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth)
      try { el.scrollIntoView({ block: "nearest", inline: "nearest" }); } catch (_) { el.scrollIntoView(); }
  }

  function updateCur() {
    const n = selected.size;
    bar.classList.toggle("dm-multi", n >= 2);
    bar.classList.toggle("dm-has-sel", n >= 1);
    const undoBtn = bar.querySelector("#dm-undo");
    if (undoBtn) undoBtn.disabled = undoStack.length === 0;
    const copyEl = bar.querySelector("#dm-copyel");
    const copySelEl = bar.querySelector("#dm-copysel");
    const pasteEl = bar.querySelector("#dm-paste");
    const delEl = bar.querySelector("#dm-del");
    const noteEl = bar.querySelector("#dm-note");
    const copyNotesEl = bar.querySelector("#dm-copynotes");
    if (copyEl) copyEl.disabled = n === 0;
    if (copySelEl) copySelEl.disabled = n === 0;
    if (delEl) delEl.disabled = n === 0;
    if (pasteEl) pasteEl.disabled = clipboard.length === 0;
    if (noteEl) { noteEl.disabled = n !== 1; noteEl.classList.toggle("on", n === 1 && notes.has([...selected][0])); }
    if (copyNotesEl) copyNotesEl.disabled = notes.size === 0;
    syncDetachOverlays(); // overlays tracejados acompanham o estado de detach (e o undo)
    positionRzHandle(); // grip ↘ segue a seleção (some fora de editar/ferramenta move)
    const cur = bar.querySelector("#dm-cur");
    if (!cur) return;
    // contador combinado: edições geométricas + notas de intenção + textos editados.
    // textos conta só os ainda CONECTADOS (apagar o elemento zera o item; undo o restaura).
    const meta = [];
    let nTexto = 0; for (const el of textEdits.keys()) if (el.isConnected) nTexto++;
    if (changes.size) meta.push(changes.size + " edit" + (changes.size > 1 ? "s" : ""));
    if (nTexto) meta.push(nTexto + " texto" + (nTexto > 1 ? "s" : ""));
    if (notes.size) meta.push(notes.size + " nota" + (notes.size > 1 ? "s" : ""));
    const metaStr = meta.length ? "  (" + meta.join(" · ") + ")" : "";
    if (n === 0) cur.textContent = meta.length ? meta.join(" · ") : "—";
    else if (n === 1) cur.textContent = selectorOf([...selected][0]) + metaStr;
    else cur.textContent = n + " selecionados" + metaStr;
  }

  // ── undo: snapshots ──
  // Tipo "style": estado de transform/width/height/changes de elementos existentes.
  // Tipo "dom": criação/remoção de nós (colar/apagar), restaurável via parent+nextSibling.
  function snapOf(el) {
    return {
      el,
      transform: el.style.transform,
      width: el.style.width,
      height: el.style.height,
      zIndex: el.style.zIndex,
      position: el.style.position,
      top: el.style.top,
      left: el.style.left,
      change: changes.has(el) ? Object.assign({}, changes.get(el)) : null,
    };
  }
  function pushUndo(els) {
    if (!els.length) return;
    undoStack.push({ kind: "style", snaps: els.map(snapOf) });
    trimUndo();
    updateCur();
  }
  // ops: [{ action: "add"|"remove", el, parent, next }]
  function pushDomUndo(ops) {
    if (!ops.length) return;
    undoStack.push({ kind: "dom", ops });
    trimUndo();
    updateCur();
  }
  function trimUndo() { if (undoStack.length > 100) undoStack.shift(); }

  function undo() {
    const entry = undoStack.pop();
    if (!entry) { uiNotifySafe("Nada pra desfazer.", "warn"); return; }
    if (entry.kind === "text") {
      // desfaz a edição de texto: volta o innerHTML pro estado anterior
      if (entry.el && entry.el.isConnected) entry.el.innerHTML = entry.before;
      const te = textEdits.get(entry.el);
      if (te) { if (te.before === entry.before) textEdits.delete(entry.el); else te.after = entry.before; }
      else if (entry.restore) textEdits.set(entry.el, { before: entry.restore.before, after: entry.restore.after }); // undo de um reset re-rastreia
      updateCur();
      return;
    }
    if (entry.kind === "dom") {
      // desfaz de trás pra frente
      for (let i = entry.ops.length - 1; i >= 0; i--) {
        const op = entry.ops[i];
        if (op.action === "add") {
          // foi adicionado → remover
          selected.delete(op.el);
          changes.delete(op.el);
          if (op.el.parentNode) op.el.parentNode.removeChild(op.el);
        } else if (op.action === "remove") {
          // foi removido → reinserir na posição original
          if (op.parent) {
            if (op.next && op.next.parentNode === op.parent) op.parent.insertBefore(op.el, op.next);
            else op.parent.appendChild(op.el);
          }
          if (op.change) changes.set(op.el, op.change);
        }
      }
      updateCur();
      return;
    }
    for (const s of entry.snaps) {
      setImp(s.el, "transform", s.transform);
      setImp(s.el, "width", s.width);
      setImp(s.el, "height", s.height);
      if (s.zIndex !== undefined) setImp(s.el, "z-index", s.zIndex);
      if (s.position !== undefined) setImp(s.el, "position", s.position);
      if (s.top !== undefined) setImp(s.el, "top", s.top);
      if (s.left !== undefined) setImp(s.el, "left", s.left);
      if (s.change) changes.set(s.el, s.change);
      else changes.delete(s.el);
    }
    updateCur();
  }

  // ── copiar / colar / apagar elementos ──
  function copyElements() {
    if (!selected.size) { uiNotifySafe("Selecione 1+ elemento(s) pra copiar.", "warn"); return; }
    clipboard.length = 0;
    // preserva ordem de documento
    const els = [...selected].sort((a, b) =>
      (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1);
    for (const el of els) {
      const clone = el.cloneNode(true);
      // limpa classes/estado próprios da ferramenta no clone
      stripDmState(clone);
      clipboard.push(clone.outerHTML);
    }
    updateCur();
    // Além do clipboard interno (Ctrl+V cola na ferramenta), manda o HTML pro
    // clipboard do SO — pra colar o markup em qualquer editor.
    writeClipboard(clipboard.join("\n"), `${clipboard.length} elemento(s): HTML no clipboard · Ctrl+V cola aqui.`);
  }

  // Copia o seletor CSS do(s) selecionado(s) pro clipboard (lista separada por vírgula).
  function copySelector() {
    if (!selected.size) { uiNotifySafe("Selecione 1+ elemento(s) pra copiar o seletor.", "warn"); return; }
    const els = [...selected].sort((a, b) =>
      (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1);
    const sel = els.map(selectorOf).join(", ");
    writeClipboard(sel, `Seletor copiado (${els.length}).`);
  }

  // Escreve no clipboard do SO de forma robusta. navigator.clipboard só existe em
  // contexto seguro (https/localhost) e com foco — em página http vinha undefined e
  // o código só dava console.log (= "não mandou nada pro clipboard"). Fallback via
  // textarea + execCommand cobre http e falta de permissão.
  function writeClipboard(text, okMsg) {
    function fallback() {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.cssText = "position:fixed;top:-9999px;left:-9999px;opacity:0";
        document.body.appendChild(ta);
        ta.focus(); ta.select();
        const ok = document.execCommand("copy");
        ta.remove();
        return ok;
      } catch (e) { return false; }
    }
    const ok = () => uiNotifySafe(okMsg, "ok");
    const fail = () => { console.log("[design-mode] clipboard:\n" + text); uiNotifySafe("Não consegui escrever no clipboard (conteúdo no console).", "err"); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(ok, () => { fallback() ? ok() : fail(); });
    } else {
      fallback() ? ok() : fail();
    }
  }

  function stripDmState(node) {
    if (node.classList) node.classList.remove("dm-sel", "dm-editable", "dm-grouped");
    if (node.removeAttribute) node.removeAttribute("data-dm-group");
    const inner = node.querySelectorAll ? node.querySelectorAll(".dm-sel, .dm-editable, .dm-grouped, [data-dm-group]") : [];
    inner.forEach((n) => { n.classList.remove("dm-sel", "dm-editable", "dm-grouped"); n.removeAttribute("data-dm-group"); });
  }

  function pasteElements() {
    if (!clipboard.length) { uiNotifySafe("Clipboard vazio — copie algo com Ctrl+C primeiro.", "warn"); return; }
    // anexa como irmão do último selecionado (ou no body) com offset
    let anchor = selected.size ? [...selected][selected.size - 1] : null;
    if (selected.size) anchor = [...selected].pop();
    const parent = anchor && anchor.parentElement ? anchor.parentElement : document.body;
    const next = anchor ? anchor.nextSibling : null;
    const ops = [];
    const created = [];
    const tpl = document.createElement("template");
    for (const html of clipboard) {
      tpl.innerHTML = html;
      const node = tpl.content.firstElementChild;
      if (!node) continue;
      const clone = node.cloneNode(true);
      // offset acumulado via transform translate
      const existing = (clone.style.transform || "").match(/translate\(\s*(-?\d+(?:\.\d+)?)px\s*,\s*(-?\d+(?:\.\d+)?)px/);
      const ox = (existing ? parseFloat(existing[1]) : 0) + PASTE_OFFSET;
      const oy = (existing ? parseFloat(existing[2]) : 0) + PASTE_OFFSET;
      setImp(clone, "transform", `translate(${ox}px, ${oy}px)`);
      if (next) parent.insertBefore(clone, next);
      else parent.appendChild(clone);
      created.push(clone);
      ops.push({ action: "add", el: clone, parent, next: clone.nextSibling });
      record(clone);
    }
    pushDomUndo(ops);
    // seleciona os recém-colados
    clearSel();
    created.forEach((c) => { selected.add(c); c.classList.add("dm-sel", "dm-editable"); });
    updateCur();
    uiNotifySafe(`${created.length} elemento(s) colado(s).`, "ok");
  }

  function deleteElements() {
    if (!selected.size) { uiNotifySafe("Selecione 1+ elemento(s) pra apagar.", "warn"); return; }
    const els = [...selected];
    const ops = els.map((el) => ({
      action: "remove",
      el,
      parent: el.parentNode,
      next: el.nextSibling,
      change: changes.has(el) ? Object.assign({}, changes.get(el)) : null,
    }));
    for (const el of els) {
      changes.delete(el);
      if (notes.has(el)) { notes.delete(el); refreshBadge(el); }
      if (el.parentNode) el.parentNode.removeChild(el);
    }
    selected.clear();
    pushDomUndo(ops);
    updateCur();
    uiNotifySafe(`${els.length} elemento(s) apagado(s). Ctrl+Z pra desfazer.`, "ok");
  }

  // ── alinhamento (precisa de 2+ selecionados) ──
  function avg(a) { return a.reduce((s, n) => s + n, 0) / a.length; }
  // Aresta de um rect pra um dado 'kind' de alinhamento (px na viewport).
  function edgePos(r, kind) {
    if (kind === "left") return r.left;
    if (kind === "right") return r.right;
    if (kind === "top") return r.top;
    if (kind === "bottom") return r.bottom;
    if (kind === "hcenter") return r.left + r.width / 2;
    if (kind === "vcenter") return r.top + r.height / 2;
    return 0;
  }
  function isHAlign(kind) { return kind === "left" || kind === "right" || kind === "hcenter"; }
  // align(kind, {keep}): keep=false → one-shot clássico (min/max/avg, move todos).
  // keep=true → alinha ao ÚLTIMO selecionado (referência) e grava a regra em c.rule pra
  // reapplyRules() reencostar quando a referência se mexer depois.
  function align(kind, opts) {
    const keep = !!(opts && opts.keep);
    const els = [...selected];
    if (els.length < 2) { uiNotifySafe("Selecione 2+ elementos (Shift+clique) pra alinhar.", "warn"); return; }
    pushUndo(els);
    for (const el of els) markBaseline(el); // "before" do spec antes de alinhar
    const items = els.map((el) => ({ el, r: el.getBoundingClientRect() }));
    const refItem = items[items.length - 1]; // referência = último selecionado
    let target, movers;
    if (keep) {
      target = edgePos(refItem.r, kind);
      movers = items.filter((o) => o !== refItem); // a referência não se mexe
    } else {
      if (kind === "left") target = Math.min(...items.map((o) => o.r.left));
      else if (kind === "right") target = Math.max(...items.map((o) => o.r.right));
      else if (kind === "top") target = Math.min(...items.map((o) => o.r.top));
      else if (kind === "bottom") target = Math.max(...items.map((o) => o.r.bottom));
      else if (kind === "hcenter") target = avg(items.map((o) => o.r.left + o.r.width / 2));
      else if (kind === "vcenter") target = avg(items.map((o) => o.r.top + o.r.height / 2));
      movers = items;
    }
    const refSel = keep ? selectorOf(refItem.el) : null;
    for (const o of movers) {
      const c = changes.get(o.el) || {};
      let tx = c.tx || 0, ty = c.ty || 0;
      if (isHAlign(kind)) tx += target - edgePos(o.r, kind);
      else ty += target - edgePos(o.r, kind);
      setImp(o.el, "transform", `translate(${Math.round(tx)}px, ${Math.round(ty)}px)`);
      record(o.el);
      if (keep) {
        const cc = changes.get(o.el); // record() recria o objeto → anexar a regra DEPOIS
        if (cc) cc.rule = { kind: "align", edge: kind, axis: isHAlign(kind) ? "H" : "V", ref: { selector: refSel, edge: kind } };
      } else {
        const cc = changes.get(o.el); if (cc) delete cc.rule; // one-shot limpa constraint antiga
      }
    }
    if (keep) uiNotifySafe(`Alinhado e MANTIDO (${movers.length}) à referência ${refSel}.`, "ok");
  }
  function toggleKeep() {
    alignKeep = !alignKeep;
    const btn = bar.querySelector("#dm-keep");
    if (btn) btn.classList.toggle("on", alignKeep);
    uiNotifySafe(alignKeep ? "Manter alinhamento: ON (vincula ao último selecionado)." : "Manter alinhamento: OFF (align one-shot).", "ok");
  }
  // Reencosta os elementos com regra 'align' à sua referência (chamada no fim de
  // drag/nudge/resize). Sem pushUndo: faz parte da ação que disparou. record() dropa
  // c.rule → reanexa depois pra a constraint sobreviver.
  function reapplyRules() {
    for (const [el, c] of changes) {
      if (!c.rule || c.rule.kind !== "align" || !el.isConnected) continue;
      let ref = null;
      try { ref = document.querySelector(c.rule.ref.selector); } catch (_) { ref = null; }
      if (!ref || ref === el || !ref.isConnected) continue;
      markBaseline(el);
      const rr = ref.getBoundingClientRect();
      const er = el.getBoundingClientRect();
      const kind = c.rule.edge;
      let tx = c.tx || 0, ty = c.ty || 0;
      if (isHAlign(kind)) tx += edgePos(rr, kind) - edgePos(er, kind);
      else ty += edgePos(rr, kind) - edgePos(er, kind);
      setImp(el, "transform", `translate(${Math.round(tx)}px, ${Math.round(ty)}px)`);
      const rule = c.rule;
      record(el);
      const cc = changes.get(el);
      if (cc) cc.rule = rule;
    }
  }

  // ── mover / redimensionar pela seta (modo edit) ───────────────────────────────
  // Coalesce de undo: uma rajada na MESMA seleção dentro de ~600ms reusa o snapshot
  // (1 só Ctrl+Z desfaz tudo). markBaseline garante o "before" do spec; record() entra
  // em changes (exportável). Sem snap (delta numérico puro). reapplyRules mantém as
  // constraints '@ manter' encostadas.
  function ensureNudgeSession(els) {
    const now = Date.now();
    const same = nudgeSession && nudgeSession.els.size === els.length &&
      els.every((e) => nudgeSession.els.has(e));
    if (same && now - nudgeSession.t < 600) { nudgeSession.t = now; return; }
    pushUndo(els);
    nudgeSession = { els: new Set(els), t: now };
  }
  function nudge(dx, dy) {
    const els = [...selected];
    if (!els.length) return;
    ensureNudgeSession(els);
    for (const el of els) {
      markBaseline(el);
      const m = el.style.transform.match(/translate\(\s*(-?\d+(?:\.\d+)?)px\s*,\s*(-?\d+(?:\.\d+)?)px/);
      const tx = (m ? parseFloat(m[1]) : 0) + dx;
      const ty = (m ? parseFloat(m[2]) : 0) + dy;
      setImp(el, "transform", `translate(${tx}px, ${ty}px)`);
      record(el);
    }
    reapplyRules();
    repositionNotes();
  }
  function resizeStep(dw, dh) {
    const els = [...selected];
    if (!els.length) return;
    ensureNudgeSession(els);
    let last = null;
    for (const el of els) {
      markBaseline(el);
      const w0 = el.offsetWidth, h0 = el.offsetHeight; // mede ANTES de forçar border-box
      ensureBorderBox(el);
      if (dw) setImp(el, "width", Math.max(8, w0 + dw) + "px"); // clamp 8px
      if (dh) setImp(el, "height", Math.max(8, h0 + dh) + "px");
      record(el);
      last = el;
    }
    reapplyRules();
    repositionNotes();
    if (last) { const c = bar.querySelector("#dm-cur"); if (c) c.textContent = `${last.offsetWidth}×${last.offsetHeight}` + (els.length > 1 ? ` (+${els.length - 1})` : ""); }
  }

  // ── soltar do fluxo (P) / devolver (Shift+P) ──────────────────────────────────
  // P: position:absolute com top/left:auto — a posição estática segura o lugar visual;
  // os irmãos colapsam e o translate existente segue deslocando. Shift+P volta a static.
  // c.struct é metadado SÓ no Map (limpo no save); o overlay tracejado vive FORA do alvo.
  function detachSelection(back) {
    const els = [...selected];
    if (!els.length) { uiNotifySafe("Selecione 1+ elemento(s) pra soltar do fluxo.", "warn"); return; }
    pushUndo(els);
    for (const el of els) markBaseline(el);
    for (const el of els) {
      if (back) { setImp(el, "position", ""); setImp(el, "top", ""); setImp(el, "left", ""); }
      else { setImp(el, "position", "absolute"); setImp(el, "top", "auto"); setImp(el, "left", "auto"); }
      record(el);
      const c = changes.get(el); // record() recria o objeto → anexar struct DEPOIS
      if (c) {
        if (back) delete c.struct;
        else c.struct = { kind: "detach", position: "absolute", parent: selectorOf(el.parentElement) };
      }
    }
    reapplyRules();
    repositionNotes();
    uiNotifySafe(back ? `${els.length} devolvido(s) ao fluxo (static).` : `${els.length} solto(s) do fluxo (position:absolute).`, "ok");
  }
  // overlay tracejado laranja FORA do alvo enquanto detached (não muta o DOM da página).
  function positionDetach(ov, el) {
    const r = el.getBoundingClientRect();
    ov.style.left = r.left + "px"; ov.style.top = r.top + "px";
    ov.style.width = r.width + "px"; ov.style.height = r.height + "px";
  }
  function refreshDetach(el) {
    const c = changes.get(el);
    const on = !!(c && c.struct && c.struct.kind === "detach" && el.isConnected);
    let ov = detachOverlays.get(el);
    if (on) {
      if (!ov) {
        ov = document.createElement("div");
        ov.className = "dm-detach";
        (document.body || document.documentElement).appendChild(ov);
        detachOverlays.set(el, ov);
      }
      positionDetach(ov, el);
    } else if (ov) {
      if (ov.parentNode) ov.parentNode.removeChild(ov);
      detachOverlays.delete(el);
    }
  }
  // reconcilia os overlays de detach com o estado atual de changes (chamado em updateCur).
  function syncDetachOverlays() {
    const want = new Set();
    for (const [el, c] of changes) if (c.struct && c.struct.kind === "detach" && el.isConnected) want.add(el);
    for (const el of want) refreshDetach(el);
    for (const el of [...detachOverlays.keys()]) if (!want.has(el)) refreshDetach(el);
  }

  // ── ordem de camadas (z-index): subir/descer/topo/fundo ──
  function zOf(el) {
    const c = changes.get(el);
    if (c && c.z != null) return c.z;
    const z = parseInt(getComputedStyle(el).zIndex, 10);
    return Number.isFinite(z) ? z : 0;
  }
  function applyZ(el, z) {
    const posForced = getComputedStyle(el).position === "static";
    if (posForced) setImp(el, "position", "relative"); // z-index só vale em elemento posicionado
    setImp(el, "z-index", String(z));
    const m = el.style.transform.match(/translate\(\s*(-?\d+(?:\.\d+)?)px\s*,\s*(-?\d+(?:\.\d+)?)px/);
    const prev = changes.get(el) || {};
    changes.set(el, {
      w: Math.round(el.offsetWidth), h: Math.round(el.offsetHeight),
      tx: m ? Math.round(parseFloat(m[1])) : prev.tx || 0,
      ty: m ? Math.round(parseFloat(m[2])) : prev.ty || 0,
      z, posForced: prev.posForced || posForced, el,
    });
  }
  function layer(kind) {
    const els = [...selected];
    if (!els.length) { uiNotifySafe("Selecione 1+ elemento(s) pra mudar a camada.", "warn"); return; }
    pushUndo(els);
    for (const el of els) markBaseline(el); // "before" do spec (inclui z)
    const pool = [];
    for (const c of changes.values()) if (c.z != null) pool.push(c.z);
    for (const el of els) pool.push(zOf(el));
    const maxZ = pool.length ? Math.max(...pool) : 0;
    const minZ = pool.length ? Math.min(...pool) : 0;
    for (const el of els) {
      let z;
      if (kind === "front") z = maxZ + 1;
      else if (kind === "back") z = minZ - 1;
      else if (kind === "up") z = zOf(el) + 1;
      else z = zOf(el) - 1;
      applyZ(el, z);
    }
    updateCur();
  }

  // ── agrupar / desagrupar (metadado data-dm-group; selecionar 1 pega o grupo) ──
  function groupSelected() {
    const els = [...selected];
    if (els.length < 2) { uiNotifySafe("Selecione 2+ elementos (Shift+clique) pra agrupar.", "warn"); return; }
    const id = String(++groupSeq);
    for (const el of els) { el.setAttribute("data-dm-group", id); el.classList.add("dm-grouped"); }
    uiNotifySafe(els.length + " elementos agrupados — clicar 1 seleciona o grupo (Ctrl+Shift+G desagrupa).", "ok");
    updateCur();
  }
  function ungroupSelected() {
    const els = [...selected];
    if (!els.length) { uiNotifySafe("Selecione um grupo pra desagrupar.", "warn"); return; }
    let n = 0;
    for (const el of els) {
      if (el.hasAttribute("data-dm-group")) { el.removeAttribute("data-dm-group"); el.classList.remove("dm-grouped"); n++; }
    }
    uiNotifySafe(n ? n + " elemento(s) desagrupado(s)." : "Nada agrupado na seleção.", n ? "ok" : "warn");
    updateCur();
  }

  // ── snap (alinhamento magnético): coleta as linhas-alvo (bordas+centros) ──
  // Helper COMPARTILHADO por drag (mover) e resize. Empilha alvos {pos, el, edge} nos
  // arrays xs/ys passados; pula a própria seleção, a barra e os overlays da ferramenta.
  function edgeTargets(exclude, xs, ys) {
    let count = 0;
    for (const el of document.querySelectorAll("body *")) {
      if (count > 600) break;
      if (exclude.has(el) || inBar(el) || isDmOverlay(el)) continue;
      let skip = false;
      for (const x of exclude) { if (el.contains(x) || x.contains(el)) { skip = true; break; } }
      if (skip) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) continue;
      if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
      count++;
      // alvos como OBJETOS {pos, el, edge}: guardam a IDENTIDADE da linha (de quem é,
      // qual borda) sem materializar selector (caro) — isso só acontece no vencedor, no onUp.
      xs.push(
        { pos: r.left, el, edge: "left" },
        { pos: r.left + r.width / 2, el, edge: "centerX" },
        { pos: r.right, el, edge: "right" });
      ys.push(
        { pos: r.top, el, edge: "top" },
        { pos: r.top + r.height / 2, el, edge: "centerY" },
        { pos: r.bottom, el, edge: "bottom" });
    }
  }
  function buildSnapTargets(exclude) {
    drag.targetXs = [];
    drag.targetYs = [];
    edgeTargets(exclude, drag.targetXs, drag.targetYs);
    // Centro do elemento PAI do arrastado: permite centralizar o objeto DENTRO do pai
    // (eixo horizontal E vertical). O pai é ancestral, então o loop acima o pula
    // (x.contains(el)); por isso o centro dele só vira alvo de snap aqui, explicitamente.
    const anchorEl = drag.anchorEl;
    const parent = anchorEl && anchorEl.parentElement;
    if (parent && parent !== document.documentElement) {
      const pr = parent.getBoundingClientRect();
      if (pr.width >= 8 && pr.height >= 8) {
        drag.targetXs.push({ pos: pr.left + pr.width / 2, el: parent, edge: "centerX", kind: "parent" });
        drag.targetYs.push({ pos: pr.top + pr.height / 2, el: parent, edge: "centerY", kind: "parent" });
      }
    }
  }
  // Compara cada borda do arrastado (lines[]) com cada alvo {pos,...}; devolve o vencedor
  // (objeto-alvo + delta + qual borda do arrastado casou, via myIdx).
  function nearestSnap(lines, targets) {
    let best = null;
    for (let li = 0; li < lines.length; li++) {
      const l = lines[li];
      for (const t of targets) {
        const ad = Math.abs(t.pos - l);
        if (ad <= SNAP && (!best || ad < best.ad)) best = { delta: t.pos - l, pos: t.pos, ad, target: t, myIdx: li };
      }
    }
    return best;
  }
  function showGuide(axis, pos) {
    let g = axis === "v" ? guideV : guideH;
    if (pos == null) { if (g) g.style.display = "none"; return; }
    if (!g) {
      g = document.createElement("div");
      g.className = "dm-guide dm-guide-" + axis;
      (document.body || document.documentElement).appendChild(g);
      if (axis === "v") guideV = g; else guideH = g;
    }
    g.style.display = "block";
    if (axis === "v") g.style.left = pos + "px"; else g.style.top = pos + "px";
  }

  // Realça a CAIXA do elemento-alvo do snap, com a borda CASADA mais grossa — assim você vê
  // A QUEM está se alinhando (além da reta de viewport). slot "v"/"h" = alvo do eixo X/Y.
  function showTargetBox(slot, target) {
    let b = slot === "v" ? snapBoxV : snapBoxH;
    if (!target || !target.el || !target.el.isConnected) { if (b) b.style.display = "none"; return; }
    if (!b) {
      b = document.createElement("div");
      b.className = "dm-snapbox";
      (document.body || document.documentElement).appendChild(b);
      if (slot === "v") snapBoxV = b; else snapBoxH = b;
    }
    const r = target.el.getBoundingClientRect();
    b.style.display = "block";
    b.style.left = r.left + "px"; b.style.top = r.top + "px";
    b.style.width = r.width + "px"; b.style.height = r.height + "px";
    // engrossa SÓ a borda que está casando; centro (centerX/centerY) fica uniforme.
    b.style.borderWidth = "1px";
    const W = "3px";
    if (target.edge === "left") b.style.borderLeftWidth = W;
    else if (target.edge === "right") b.style.borderRightWidth = W;
    else if (target.edge === "top") b.style.borderTopWidth = W;
    else if (target.edge === "bottom") b.style.borderBottomWidth = W;
  }

  function onDown(e) {
    nudgeSession = null; // qualquer clique encerra a sessão de nudge/resize coalescida
    if (inBar(e.target)) return; // não captura cliques na própria barra
    if (notePop) {
      if (notePop.pop.contains(e.target)) return; // interagindo com o popover (chips/textarea)
      closeNote(true); // clicou fora: salva e fecha — não seleciona/arrasta nesse clique
      return;
    }
    if (rzHandle && e.target === rzHandle) return; // o grip de resize tem handler próprio (onRzDown)

    // FERRAMENTA TEXTO: clicar edita o texto do elemento no lugar (não seleciona nem arrasta).
    if (tool === "text") {
      if (e.button) return; // só botão principal; right/middle → menu nativo
      const t = e.target.closest("*");
      if (textEdit && textEdit.el && textEdit.el.contains(e.target)) return; // já editando este → deixa o cursor andar
      if (textEdit) endTextEdit(true); // clicou fora → confirma a edição anterior
      if (t && t !== document.body && t !== document.documentElement && !inBar(t)) {
        e.stopPropagation();
        startTextEdit(t);
      }
      return;
    }
    // FERRAMENTA SELEÇÃO (marquee): arrastar desenha o retângulo (vale em inspecionar E editar).
    if (tool === "marquee") {
      if (e.button) return; // só botão principal; right/middle → menu nativo
      e.preventDefault();
      e.stopPropagation();
      startMarquee(e);
      return;
    }

    const el = e.target.closest("*");
    if (!el || el === document.body || el === document.documentElement) return;

    // Shift+clique: alterna o elemento na seleção múltipla (não arrasta).
    if (e.shiftKey) { e.preventDefault(); e.stopPropagation(); toggleSel(el); return; }
    // Clique simples num elemento fora da seleção: seleciona só ele.
    if (!selected.has(el)) selectOnly(el);

    // Modo SELETOR (inspecionar): só seleciona — nunca move nem redimensiona.
    if (!isEditing()) { e.preventDefault(); e.stopPropagation(); return; }

    // resize agora é via grip ↘ próprio (.dm-rzh / onRzDown) — afeta TODOS os selecionados
    // e imanta no Shift. Arrastar o corpo do elemento move (abaixo).

    // drag: move TODOS os selecionados juntos (via transform translate)
    e.preventDefault();
    e.stopPropagation();
    const els = [...selected];
    pushUndo(els);
    for (const x of els) { markBaseline(x); ensureMovable(x); } // before + garante movível (inline→inline-block)
    drag = els.map((x) => { const c = changes.get(x) || {}; return { el: x, btx: c.tx || 0, bty: c.ty || 0 }; });
    drag.sx = e.clientX;
    drag.sy = e.clientY;
    drag.anchorRect0 = el.getBoundingClientRect(); // p/ o snap medir o elemento agarrado
    drag.anchorEl = el; // p/ o snap oferecer o centro do elemento PAI como alvo
    drag.lastSnapX = null; // vencedor de snap do ÚLTIMO frame (vira constraint no onUp)
    drag.lastSnapY = null;
    buildSnapTargets(new Set(els));
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onUp, true); // gesto cancelado (touch/pen) também encerra
  }

  function onMove(e) {
    if (!drag) return;
    let dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    // Alinhamento magnético: encosta nas bordas/centros dos outros (Alt desliga).
    const a = drag.anchorRect0;
    if (a && !e.altKey) {
      const xs = [a.left + dx, a.left + dx + a.width / 2, a.left + dx + a.width];
      const ys = [a.top + dy, a.top + dy + a.height / 2, a.top + dy + a.height];
      const sx = nearestSnap(xs, drag.targetXs);
      const sy = nearestSnap(ys, drag.targetYs);
      if (sx) { dx += sx.delta; showGuide("v", sx.pos); showTargetBox("v", sx.target); drag.lastSnapX = sx; } else { showGuide("v", null); showTargetBox("v", null); drag.lastSnapX = null; }
      if (sy) { dy += sy.delta; showGuide("h", sy.pos); showTargetBox("h", sy.target); drag.lastSnapY = sy; } else { showGuide("h", null); showTargetBox("h", null); drag.lastSnapY = null; }
    } else { showGuide("v", null); showGuide("h", null); showTargetBox("v", null); showTargetBox("h", null); drag.lastSnapX = null; drag.lastSnapY = null; }
    for (const d of drag) { setImp(d.el, "transform", `translate(${d.btx + dx}px, ${d.bty + dy}px)`); }
    repositionNotes(); // badges 📌 acompanham os elementos arrastados
  }

  function onUp() {
    if (drag) {
      const anchorEl = drag.anchorEl, sx = drag.lastSnapX, sy = drag.lastSnapY;
      for (const d of drag) record(d.el);
      // Constraint: grava a REGRA do encaixe (centro do pai / borda do irmão) ALÉM do px,
      // só pros eixos que casaram no ÚLTIMO frame. Sem snap (ou Alt) → nenhuma regra inventada.
      if (anchorEl && (sx || sy)) {
        const c = changes.get(anchorEl);
        if (c) {
          const snap = {};
          if (sx) snap.x = snapAxis(sx, ["left", "centerX", "right"]);
          if (sy) snap.y = snapAxis(sy, ["top", "centerY", "bottom"]);
          c.snap = snap;
        }
      }
      reapplyRules(); // mover a referência reencosta os vinculados ('@ manter')
    }
    drag = null;
    showGuide("v", null);
    showGuide("h", null);
    showTargetBox("v", null);
    showTargetBox("h", null);
    repositionNotes();
    window.removeEventListener("pointermove", onMove, true);
    window.removeEventListener("pointerup", onUp, true);
    window.removeEventListener("pointercancel", onUp, true);
  }

  // ── SELEÇÃO POR RETÂNGULO (marquee) — ferramenta "marquee" ────────────────────
  // Vale em inspecionar E editar. Arrastar desenha a caixa; "encostou já pega"
  // (intersecção). Pega só os elementos MAIS EXTERNOS (sem filhos de um já pego),
  // ignora os containers que ENGLOBAM o retângulo (fundo), o body/html e os artefatos
  // da ferramenta. Clique sem arrasto continua selecionando 1 (Shift alterna/soma).
  // Candidatos em coords de DOCUMENTO (+scroll) — assim rolar a página no meio do arrasto
  // não corrompe o que o retângulo pega, e dá pra marquear além da dobra rolando.
  function marqueeCandidates() {
    const out = [];
    let count = 0;
    const sx = window.scrollX, sy = window.scrollY;
    for (const el of document.querySelectorAll("body *")) {
      if (count > 4000) break;
      if (inBar(el) || isDmOverlay(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue; // só descarta área zero (finos/hairlines valem)
      out.push({ el, r: { left: r.left + sx, top: r.top + sy, right: r.right + sx, bottom: r.bottom + sy } });
      count++;
    }
    return out;
  }
  function normMarquee(m) {
    return {
      left: Math.min(m.x0, m.x1), top: Math.min(m.y0, m.y1),
      right: Math.max(m.x0, m.x1), bottom: Math.max(m.y0, m.y1),
    };
  }
  function rectsTouch(M, r) {
    return r.left <= M.right && r.right >= M.left && r.top <= M.bottom && r.bottom >= M.top;
  }
  function rectEncloses(r, M) {
    return r.left <= M.left && r.right >= M.right && r.top <= M.top && r.bottom >= M.bottom;
  }
  function marqueeHits(M) {
    if (!marquee) return [];
    // toca o retângulo E não o engloba (containers de fundo ficam de fora)
    const inter = marquee.cands.filter((c) => rectsTouch(M, c.r) && !rectEncloses(c.r, M));
    const set = new Set(inter.map((c) => c.el));
    // só os mais externos: descarta quem tem um ancestral também pego
    return inter.filter((c) => {
      let p = c.el.parentElement;
      while (p) { if (set.has(p)) return false; p = p.parentElement; }
      return true;
    }).map((c) => c.el);
  }
  function startMarquee(e) {
    if (marquee) cancelMarquee(); // robustez: nunca empilha dois retângulos
    marquee = {
      x0: e.clientX + window.scrollX, y0: e.clientY + window.scrollY, // âncora em coords de documento
      x1: e.clientX + window.scrollX, y1: e.clientY + window.scrollY,
      cx: e.clientX, cy: e.clientY, // último ponto em coords de viewport (p/ a caixa fixed + elementFromPoint)
      add: e.shiftKey, cands: marqueeCandidates(), hi: new Set(), box: null, moved: false,
    };
    window.addEventListener("pointermove", onMarqueeMove, true);
    window.addEventListener("pointerup", onMarqueeUp, true);
    window.addEventListener("pointercancel", onMarqueeUp, true);
    window.addEventListener("scroll", onMarqueeScroll, true); // rolar redesenha sem mexer o ponteiro
  }
  function onMarqueeMove(e) {
    if (!marquee) return;
    marquee.cx = e.clientX; marquee.cy = e.clientY;
    drawMarquee();
  }
  function onMarqueeScroll() { if (marquee) drawMarquee(); }
  function drawMarquee() {
    marquee.x1 = marquee.cx + window.scrollX; marquee.y1 = marquee.cy + window.scrollY;
    // só materializa a caixa/realce depois de passar o limiar de 4px (senão pisca no clique).
    if (!marquee.moved && Math.abs(marquee.x1 - marquee.x0) + Math.abs(marquee.y1 - marquee.y0) < 4) return;
    marquee.moved = true;
    const M = normMarquee(marquee); // coords de documento
    if (!marquee.box) {
      marquee.box = document.createElement("div");
      marquee.box.className = "dm-marquee";
      (document.body || document.documentElement).appendChild(marquee.box);
    }
    const b = marquee.box; // a caixa é position:fixed → desenha em viewport (documento − scroll)
    b.style.left = (M.left - window.scrollX) + "px"; b.style.top = (M.top - window.scrollY) + "px";
    b.style.width = (M.right - M.left) + "px"; b.style.height = (M.bottom - M.top) + "px";
    setMarqueeHighlight(marqueeHits(M)); // realce ao vivo do que vai entrar
  }
  function setMarqueeHighlight(hits) {
    const next = new Set(hits);
    const prev = marquee.hi || new Set();
    for (const el of prev) if (!next.has(el)) el.classList.remove("dm-marquee-hit");
    for (const el of next) if (!prev.has(el)) el.classList.add("dm-marquee-hit");
    marquee.hi = next;
  }
  function clearMarqueeHighlight() {
    if (marquee && marquee.hi) marquee.hi.forEach((el) => el.classList.remove("dm-marquee-hit"));
    document.querySelectorAll(".dm-marquee-hit").forEach((n) => n.classList.remove("dm-marquee-hit"));
  }
  function detachMarqueeListeners() {
    window.removeEventListener("pointermove", onMarqueeMove, true);
    window.removeEventListener("pointerup", onMarqueeUp, true);
    window.removeEventListener("pointercancel", onMarqueeUp, true);
    window.removeEventListener("scroll", onMarqueeScroll, true);
  }
  function onMarqueeUp() {
    detachMarqueeListeners();
    if (!marquee) return;
    const moved = marquee.moved;
    const M = normMarquee(marquee);
    clearMarqueeHighlight();
    if (!moved) {
      // clique sem arrasto: preserva o "clicar seleciona 1" (Shift alterna) — viewport coords
      const hit = document.elementFromPoint(marquee.cx, marquee.cy);
      const t = hit && hit.closest ? hit.closest("*") : null;
      if (t && t !== document.body && t !== document.documentElement && !inBar(t)) {
        if (marquee.add) toggleSel(t); else selectOnly(t);
      }
    } else {
      const hits = marqueeHits(M);
      if (!marquee.add) clearSel();
      for (const el of hits) addSel(el);
      uiNotifySafe(hits.length + " selecionado(s) pelo retângulo.", hits.length ? "ok" : "warn");
    }
    if (marquee.box && marquee.box.parentNode) marquee.box.parentNode.removeChild(marquee.box);
    marquee = null;
    updateCur();
  }
  function cancelMarquee() {
    detachMarqueeListeners();
    clearMarqueeHighlight();
    if (marquee && marquee.box && marquee.box.parentNode) marquee.box.parentNode.removeChild(marquee.box);
    marquee = null;
  }

  // ── EDIÇÃO DE TEXTO NO LUGAR — ferramenta "text" ──────────────────────────────
  // Clicar torna o elemento contenteditable; Enter confirma, Esc cancela (reverte),
  // clicar fora confirma. A mudança entra em textEdits (vai pro spec e é salva no HTML).
  function startTextEdit(el) {
    if (!el || el.nodeType !== 1) return;
    if (textEdit && textEdit.el === el) return;
    if (textEdit) endTextEdit(true);
    const before = el.innerHTML;
    el.setAttribute("contenteditable", "true");
    el.classList.add("dm-text-editing");
    textEdit = { el, before };
    el.addEventListener("keydown", onTextKey, true);
    el.addEventListener("blur", onTextBlur, true);
    // engole o click que fecha ESTA sequência de ponteiro — senão um <button>/<a>/[onclick]
    // da página dispararia/navegaria (perdendo edições não salvas). One-shot, auto-removível.
    const eatClick = (ev) => { ev.preventDefault(); ev.stopImmediatePropagation(); window.removeEventListener("click", eatClick, true); };
    window.addEventListener("click", eatClick, true);
    try { el.focus(); } catch (_) {}
    updateCur();
  }
  function onTextKey(e) {
    e.stopPropagation(); // isola a digitação dos atalhos globais (defesa extra; onKey já sai cedo)
    if (e.key === "Escape") { e.preventDefault(); endTextEdit(false); }
    else if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); endTextEdit(true); }
  }
  function onTextBlur() { if (textEdit) endTextEdit(true); }
  function endTextEdit(save) {
    if (!textEdit) return;
    const el = textEdit.el, before = textEdit.before;
    textEdit = null;
    el.removeEventListener("keydown", onTextKey, true);
    el.removeEventListener("blur", onTextBlur, true);
    el.removeAttribute("contenteditable");
    el.classList.remove("dm-text-editing");
    const after = el.innerHTML;
    if (!save) { el.innerHTML = before; } // cancelou → reverte
    else if (after !== before) { recordTextEdit(el, before, after); }
    updateCur();
  }
  function recordTextEdit(el, before, after) {
    undoStack.push({ kind: "text", el, before, after });
    trimUndo();
    const prev = textEdits.get(el);
    textEdits.set(el, { before: prev ? prev.before : before, after }); // before = o estado original
    repositionNotes();
  }

  // ── RESIZE pelo grip ↘ (overlay próprio) — afeta TODOS os selecionados ─────────
  // Substitui o resize:both nativo: aplica o MESMO delta (dw,dh) a cada selecionado
  // (igual ao resize por teclado). Segurando SHIFT, imanta a borda direita/baixo do
  // elemento-âncora às bordas/centros de outros elementos (mesma engine do snap do drag),
  // ajudando a manter o alinhamento. Só aparece em editar + ferramenta "move" + 1+ seleção.
  function ensureRzHandle() {
    if (rzHandle) return;
    rzHandle = document.createElement("div");
    rzHandle.className = "dm-rzh";
    rzHandle.title = "arraste pra redimensionar TODOS os selecionados · segure Shift pra alinhar";
    (document.body || document.documentElement).appendChild(rzHandle);
    rzHandle.addEventListener("pointerdown", onRzDown, true);
  }
  function positionRzHandle() {
    const show = mode === "edit" && tool === "move" && selected.size >= 1 && !drag && !marquee && !textEdit;
    if (!show) { if (rzHandle) rzHandle.style.display = "none"; return; }
    ensureRzHandle();
    const anchor = [...selected][selected.size - 1]; // último selecionado = âncora do grip
    if (!anchor || !anchor.isConnected) { rzHandle.style.display = "none"; return; }
    const r = anchor.getBoundingClientRect();
    rzHandle.__anchor = anchor;
    rzHandle.style.display = "block";
    rzHandle.style.left = (r.right - 7) + "px";
    rzHandle.style.top = (r.bottom - 7) + "px";
  }
  function onRzDown(e) {
    if (mode !== "edit" || !selected.size) return;
    e.preventDefault(); e.stopPropagation();
    const anchor = (rzHandle && rzHandle.__anchor) || [...selected][selected.size - 1];
    const els = [...selected];
    pushUndo(els);
    resize = { sx: e.clientX, sy: e.clientY, anchor, base: new Map(), targetXs: [], targetYs: [], snapX: null, snapY: null };
    for (const el of els) { markBaseline(el); ensureMovable(el); resize.base.set(el, { w: el.offsetWidth, h: el.offsetHeight }); }
    resize.anchorRect0 = anchor.getBoundingClientRect();
    edgeTargets(new Set(els), resize.targetXs, resize.targetYs); // alvos de snap (Shift)
    try { rzHandle.setPointerCapture(e.pointerId); } catch (_) {}
    window.addEventListener("pointermove", onRzMove, true);
    window.addEventListener("pointerup", onRzUp, true);
    window.addEventListener("pointercancel", onRzUp, true); // gesto cancelado também encerra
  }
  function onRzMove(e) {
    if (!resize) return;
    let dw = e.clientX - resize.sx, dh = e.clientY - resize.sy;
    resize.snapX = resize.snapY = null;
    if (e.shiftKey) { // SHIFT = alinhar: imanta a borda direita/baixo do âncora
      const a = resize.anchorRect0;
      const sx = nearestSnap([a.right + dw], resize.targetXs);
      const sy = nearestSnap([a.bottom + dh], resize.targetYs);
      if (sx) { dw += sx.delta; showGuide("v", sx.pos); showTargetBox("v", sx.target); resize.snapX = sx; } else { showGuide("v", null); showTargetBox("v", null); }
      if (sy) { dh += sy.delta; showGuide("h", sy.pos); showTargetBox("h", sy.target); resize.snapY = sy; } else { showGuide("h", null); showTargetBox("h", null); }
    } else { showGuide("v", null); showGuide("h", null); showTargetBox("v", null); showTargetBox("h", null); }
    for (const [el, b] of resize.base) {
      ensureBorderBox(el); // base = offsetWidth (border-box); força border-box p/ bater 1:1
      setImp(el, "width", Math.max(8, b.w + dw) + "px");
      setImp(el, "height", Math.max(8, b.h + dh) + "px");
    }
    positionRzHandle();
    repositionNotes();
    const c = bar.querySelector("#dm-cur");
    if (c) c.textContent = resize.anchor.offsetWidth + "×" + resize.anchor.offsetHeight + (resize.base.size > 1 ? " (+" + (resize.base.size - 1) + ")" : "");
  }
  function onRzUp() {
    if (resize) {
      for (const el of resize.base.keys()) record(el);
      // grava a constraint do encaixe (qual borda casou com quem) pra dica de layout do spec
      const c = changes.get(resize.anchor);
      if (c && (resize.snapX || resize.snapY)) {
        const snap = {};
        if (resize.snapX) snap.x = snapAxis(resize.snapX, ["right", "right", "right"]);
        if (resize.snapY) snap.y = snapAxis(resize.snapY, ["bottom", "bottom", "bottom"]);
        c.snap = Object.assign(c.snap || {}, snap);
      }
      reapplyRules();
    }
    resize = null;
    showGuide("v", null); showGuide("h", null); showTargetBox("v", null); showTargetBox("h", null);
    window.removeEventListener("pointermove", onRzMove, true);
    window.removeEventListener("pointerup", onRzUp, true);
    window.removeEventListener("pointercancel", onRzUp, true);
    positionRzHandle();
    repositionNotes();
  }

  // Materializa a identidade do alvo vencedor (selectorOf SÓ aqui — não nos 600 alvos).
  function snapAxis(s, myEdges) {
    const t = s.target;
    return {
      myEdge: myEdges[s.myIdx],
      targetSelector: selectorOf(t.el),
      targetEdge: t.edge,
      kind: t.kind || "sibling",
    };
  }
  // Traduz a regra de snap numa frase de constraint (dica de layout pro agente).
  function snapToConstraint(snap) {
    if (!snap) return null;
    const parts = [];
    if (snap.x) parts.push(constraintPhrase(snap.x, "H"));
    if (snap.y) parts.push(constraintPhrase(snap.y, "V"));
    return parts.length ? parts.join(" · ") : null;
  }
  // Frase da constraint mantida ('@ manter') — vai pro spec/layout pro agente entender
  // que NÃO é um translate cru, é um alinhamento vinculado.
  function ruleConstraint(c) {
    if (!c || !c.rule || c.rule.kind !== "align") return null;
    const name = { left: "left", right: "right", hcenter: "center-H", top: "top", bottom: "bottom", vcenter: "center-V" };
    const e = name[c.rule.edge] || c.rule.edge;
    return `${e} aligned to ${c.rule.ref.selector} [mantido]`;
  }
  function constraintPhrase(s, axis) {
    if (s.kind === "parent" && (s.targetEdge === "centerX" || s.targetEdge === "centerY")) {
      return `center-${axis} in parent (${s.targetSelector})`;
    }
    const name = { left: "left", right: "right", centerX: "center-H", top: "top", bottom: "bottom", centerY: "center-V" };
    return `${name[s.myEdge] || s.myEdge} aligned to ${s.targetSelector} (${name[s.targetEdge] || s.targetEdge})`;
  }

  // Aplica um estilo no elemento-alvo com prioridade !important — vence o CSS da página
  // mesmo quando ela usa !important (caso real: páginas com `transform: ... !important`
  // que anulavam o mover/arrastar). Valor "" remove a propriedade. Nomes em dash-case.
  function setImp(el, prop, val) {
    if (val === "" || val == null) el.style.removeProperty(prop);
    else el.style.setProperty(prop, String(val), "important");
  }

  // transform/width não têm efeito em elemento display:inline — promove a inline-block (o
  // mínimo pra mover/redimensionar). Marca em displayForced p/ exportar e limpar depois.
  function ensureMovable(el) {
    if (displayForced.has(el)) return;
    try {
      if (getComputedStyle(el).display === "inline") { setImp(el, "display", "inline-block"); displayForced.add(el); }
    } catch (_) {}
  }

  // O resize grava offsetWidth/Height (border-box) como width/height CSS. Em elementos
  // content-box (padrão do CSS) isso somaria padding+borda e o objeto "pularia"; forçar
  // border-box faz o que-você-vê-é-o-que-grava. Mede ANTES de chamar (forçar muda o offset).
  function ensureBorderBox(el) {
    if (boxSizingForced.has(el)) return;
    try {
      if (getComputedStyle(el).boxSizing !== "border-box") { setImp(el, "box-sizing", "border-box"); boxSizingForced.add(el); }
    } catch (_) {}
  }

  function record(el) {
    ensureMovable(el);
    const prev = changes.get(el) || {};
    const m = el.style.transform.match(/translate\(\s*(-?\d+(?:\.\d+)?)px\s*,\s*(-?\d+(?:\.\d+)?)px/);
    const c = {
      w: Math.round(el.offsetWidth),
      h: Math.round(el.offsetHeight),
      tx: m ? Math.round(parseFloat(m[1])) : prev.tx || 0,
      ty: m ? Math.round(parseFloat(m[2])) : prev.ty || 0,
      z: prev.z,
      el,
    };
    // metadados "grudentos" sobrevivem ao record: struct (solto do fluxo), rule (align
    // mantido) e posForced (position forçado p/ z-index). snap NÃO — tem ciclo próprio (onUp).
    if (prev.posForced) c.posForced = prev.posForced;
    if (prev.struct) c.struct = prev.struct;
    if (prev.rule) c.rule = prev.rule;
    changes.set(el, c);
    updateCur();
  }

  // ── MOTOR DE IDENTIDADE ──────────────────────────────────────────────────────
  // Primitiva compartilhada por TODO export (copiar seletor/layout/spec/notas).
  // Objetivo: dar pro agente programador um alvo SEM AMBIGUIDADE e estável entre builds.

  // Classe "estável o suficiente" pra ancorar um seletor. Rejeita:
  //  - hasheadas de CSS-in-JS (emotion `css-…`, styled-components `sc-…`)
  //  - sufixos hasheados gerados por bundler/CSS-modules (`foo_x1a2b3`, `Btn-3kf9d`)
  //  - utilitárias do Tailwind (mudam nada da semântica e repetem em mil nós)
  function isStableClass(c) {
    if (!c || c.startsWith("dm-")) return false;
    if (/^css-/.test(c) || /^sc-/.test(c)) return false;
    if (/[_-][a-z0-9]{5,}$/i.test(c)) return false;
    if (/^(p|m|px|py|mx|my|w|h|flex|grid|gap|text|bg|border|rounded|absolute|relative)(-|$)/.test(c)) return false;
    return true;
  }

  // Um seletor é confiável quando casa com EXATAMENTE o elemento alvo no documento.
  function uniqueGlobally(sel, el) {
    if (!sel) return false;
    try {
      const m = document.querySelectorAll(sel);
      return m.length === 1 && m[0] === el;
    } catch (_) { return false; }
  }

  // [attr="valor"] com escape de string (CSS.escape é p/ identificador, não p/ valor).
  function attrSel(tag, attr, val) {
    return tag + "[" + attr + '="' + String(val).replace(/[\\"]/g, "\\$&") + '"]';
  }

  // Seletor CSS ranqueado por ESTABILIDADE: tenta hooks fortes em ordem de confiança e
  // devolve o 1º globalmente único; só cai no caminho por classe semântica (e nth-of-type
  // como ÚLTIMO recurso) quando não há nenhum hook estável. Sobe só o necessário.
  function selectorOf(el) {
    if (!el || el.nodeType !== 1 || el === document.body || el === document.documentElement) {
      return el && el.tagName ? el.tagName.toLowerCase() : "";
    }
    const tag = el.tagName.toLowerCase();
    const cands = [];
    if (el.id) cands.push("#" + cssEsc(el.id));
    for (const a of ["data-testid", "data-test", "data-cy", "data-qa", "data-id"]) {
      const v = el.getAttribute && el.getAttribute(a);
      if (v) cands.push(attrSel(tag, a, v));
    }
    const name = el.getAttribute && el.getAttribute("name");
    if (name) cands.push(attrSel(tag, "name", name));
    const aria = el.getAttribute && el.getAttribute("aria-label");
    if (aria) cands.push(attrSel(tag, "aria-label", aria));
    if (tag === "a") {
      const href = el.getAttribute("href");
      if (href) cands.push(attrSel(tag, "href", href));
    }
    for (const c of cands) if (uniqueGlobally(c, el)) return c;
    return cssPath(el);
  }

  // Caminho por classe semântica, subindo só até ficar único. nth-of-type só quando o nó
  // não tem nenhuma classe estável que o distinga dos irmãos de mesma tag.
  function cssPath(el) {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.body) {
      if (node.id) { parts.unshift("#" + cssEsc(node.id)); break; }
      let part = node.tagName.toLowerCase();
      const cls = (node.getAttribute("class") || "").split(/\s+/).filter(isStableClass)[0];
      if (cls) part += "." + cssEsc(cls);
      const parent = node.parentElement;
      if (parent && !cls) {
        const sib = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
        if (sib.length > 1) part += `:nth-of-type(${sib.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      const sel = parts.join(" > ");
      if (uniqueGlobally(sel, el)) return sel;
      node = parent;
    }
    return parts.join(" > ");
  }

  // Rótulo humano mais próximo (ancestral/irmão-anterior h1-h6|label|[aria-label]|legend).
  function nearLabel(el) {
    const SEL = "h1,h2,h3,h4,h5,h6,label,[aria-label],legend";
    const txtOf = (n) => {
      const t = (n.getAttribute && n.getAttribute("aria-label")) || n.textContent || "";
      return t.trim().replace(/\s+/g, " ").slice(0, 40);
    };
    let node = el;
    while (node && node.nodeType === 1 && node !== document.body) {
      for (let sib = node.previousElementSibling; sib; sib = sib.previousElementSibling) {
        if (sib.matches && sib.matches(SEL)) { const t = txtOf(sib); if (t) return t; }
        const inner = sib.querySelector && sib.querySelector(SEL);
        if (inner) { const t = txtOf(inner); if (t) return t; }
      }
      if (node.matches && node.matches(SEL)) { const t = txtOf(node); if (t) return t; }
      node = node.parentElement;
    }
    return null;
  }

  // Âncora humana redundante (PURA LEITURA → seguro no modo select). Junta seletor +
  // texto + papel + rótulo vizinho + atributos distintivos: o agente acha o alvo nem que
  // o seletor envelheça. Nunca lança em elementos sem texto/role/atributos.
  function anchorOf(el) {
    const out = { selector: null, tag: null, id: null, text: "", role: null, near: null, attrs: {} };
    if (!el || el.nodeType !== 1) return out;
    try {
      out.tag = el.tagName.toLowerCase();
      out.id = el.id || null;
      out.selector = selectorOf(el);
      out.text = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 60);
      out.role = el.getAttribute("role") || el.getAttribute("aria-label") || null;
      out.near = nearLabel(el);
      for (const a of ["data-testid", "name", "href", "alt"]) {
        const v = el.getAttribute(a);
        if (v) out.attrs[a] = v;
      }
    } catch (_) {}
    return out;
  }

  function cssEsc(s) {
    return (window.CSS && CSS.escape) ? CSS.escape(s) : s.replace(/[^\w-]/g, "\\$&");
  }

  // Gera os blocos CSS das mudanças de geometria (reusado por copyLayout e copyAll).
  function layoutBlocks() {
    const blocks = [];
    for (const c of changes.values()) {
      if (!c.el.isConnected) continue; // ignora nós já removidos
      const decls = [`  width: ${c.w}px;`, `  height: ${c.h}px;`];
      if (boxSizingForced.has(c.el)) decls.push(`  box-sizing: border-box;`); // resize mediu/gravou em border-box
      if (c.tx || c.ty) decls.push(`  transform: translate(${c.tx}px, ${c.ty}px);`);
      if (displayForced.has(c.el)) decls.push(`  display: inline-block;`); // era inline → precisa disso pro transform pegar
      const detached = c.struct && c.struct.kind === "detach";
      if (detached) decls.push(`  position: ${c.struct.position};`);
      if (c.z != null) {
        if (c.posForced && !detached) decls.push(`  position: relative;`);
        decls.push(`  z-index: ${c.z};`);
      }
      // dica de layout (constraint do snap / align mantido) — NÃO substitui o px, só explica.
      const rc = ruleConstraint(c);
      if (rc) decls.push(`  /* layout hint: ${rc} */`);
      else if (c.snap) { const ph = snapToConstraint(c.snap); if (ph) decls.push(`  /* layout hint: ${ph} */`); }
      if (detached) decls.push(`  /* layout hint: solto do fluxo, ancorado em ${c.struct.parent} */`);
      blocks.push(`${selectorOf(c.el)} {\n${decls.join("\n")}\n}`);
    }
    return blocks;
  }

  function copyLayout() {
    const blocks = layoutBlocks();
    if (!blocks.length) {
      uiNotifySafe("Nenhuma alteração pra copiar — arraste/redimensione algo primeiro.", "warn");
      return;
    }
    const css = "/* design-mode export — colar no styles.css */\n" + blocks.join("\n\n") + "\n";
    writeClipboard(css, `Layout copiado (${blocks.length} bloco(s)).`);
  }

  // ── SALVAR / SALVAR COMO (HTML da página) ─────────────────────────────────────
  // Híbrido: em contexto seguro (http://localhost / https) usa a File System Access API
  // e SOBRESCREVE o arquivo no lugar (mantém o handle p/ os próximos "salvar" sem
  // diálogo). Em file:// (sem essa API) cai pra BAIXAR uma cópia.
  let fileHandle = null; // handle retido do arquivo aberto (File System Access API)

  function suggestedFileName() {
    try {
      const base = decodeURIComponent(location.pathname).split("/").pop();
      return base && /\.[a-z0-9]+$/i.test(base) ? base : "pagina.html";
    } catch (_) { return "pagina.html"; }
  }

  // Serializa o documento ATUAL limpo dos artefatos da ferramenta: remove a barra, o
  // <style> injetado, guias, badges e popover de nota; tira classes dm-* e atributos
  // data-dm* de todo nó. As edições (estilos inline de transform/width/...) permanecem.
  function serializeCleanHTML() {
    const root = document.documentElement.cloneNode(true);
    root.querySelectorAll(".dm-bar, .dm-guide, .dm-snapbox, .dm-marquee, .dm-rzh, .dm-note-pop, .dm-note-badge, .dm-detach, [data-dm-style]")
      .forEach((n) => n.remove());
    const all = [root, ...root.querySelectorAll("*")];
    for (const n of all) {
      if (n.classList && n.classList.length) {
        for (const c of [...n.classList]) if (c.indexOf("dm-") === 0) n.classList.remove(c);
        if (!n.classList.length) n.removeAttribute("class");
      }
      if (n.getAttributeNames) for (const a of n.getAttributeNames()) if (a.indexOf("data-dm") === 0) n.removeAttribute(a);
    }
    const dt = document.doctype ? "<!doctype " + document.doctype.name + ">\n" : "";
    return dt + root.outerHTML + "\n";
  }

  function downloadFile(text, name) {
    const blob = new Blob([text], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name;
    (document.body || document.documentElement).appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    uiNotifySafe(`Baixado "${name}" (cópia — salve por cima do original se quiser).`, "ok");
  }

  // asNew=true força escolher arquivo/destino (Salvar como). asNew=false reusa o handle.
  async function saveFile(asNew) {
    if (textEdit) endTextEdit(true); // confirma a edição de texto em curso (tira o contenteditable)
    const html = serializeCleanHTML();
    // Caminho 1 — File System Access API (sobrescreve no lugar). Só existe em contexto
    // seguro (localhost/https); em file:// window.showSaveFilePicker é undefined → fallback.
    if (window.showSaveFilePicker) {
      try {
        if (asNew || !fileHandle) {
          fileHandle = await window.showSaveFilePicker({
            suggestedName: suggestedFileName(),
            types: [{ description: "HTML", accept: { "text/html": [".html", ".htm"] } }],
          });
        }
        const w = await fileHandle.createWritable();
        await w.write(html);
        await w.close();
        uiNotifySafe(`Salvo em "${fileHandle.name || "arquivo"}".`, "ok");
        return;
      } catch (e) {
        if (e && e.name === "AbortError") return; // usuário cancelou o diálogo
        console.warn("[design-mode] showSaveFilePicker falhou, baixando cópia:", e);
      }
    }
    // Caminho 2 — download (file:// e fallback geral)
    downloadFile(html, suggestedFileName());
  }

  function resetAll() {
    if (textEdit) endTextEdit(true); // confirma edição de texto em curso antes de resetar
    if (changes.size) pushUndo([...changes.keys()]); // reset também é desfazível
    // reverte os textos editados (cada um vira um passo de undo: restaura o texto editado)
    for (const [el, te] of textEdits) {
      if (!el.isConnected) continue;
      // restore: re-rastreia o item em textEdits se o usuário desfizer o reset (Ctrl+Z)
      undoStack.push({ kind: "text", el, before: te.after, after: te.before, restore: { before: te.before, after: te.after } });
      el.innerHTML = te.before;
    }
    textEdits.clear();
    trimUndo();
    for (const c of changes.values()) {
      if (!c.el.isConnected) continue;
      setImp(c.el, "transform", "");
      setImp(c.el, "width", "");
      setImp(c.el, "height", "");
      setImp(c.el, "z-index", "");
      if (c.posForced) setImp(c.el, "position", "");
      if (c.struct) { setImp(c.el, "position", ""); setImp(c.el, "top", ""); setImp(c.el, "left", ""); }
      if (displayForced.has(c.el)) setImp(c.el, "display", "");
      if (boxSizingForced.has(c.el)) setImp(c.el, "box-sizing", "");
      c.el.classList.remove("dm-editable", "dm-sel");
    }
    changes.clear();
    baselines.clear(); // zera os "before" do spec junto com as edições
    displayForced.clear();
    boxSizingForced.clear();
    document.querySelectorAll("[data-dm-group]").forEach((n) => {
      n.removeAttribute("data-dm-group");
      n.classList.remove("dm-grouped");
    });
    clearSel();
    uiNotifySafe("Layout resetado.", "ok");
  }

  // ── NOTA + CHIPS DE INTENÇÃO (canal de linguagem natural, vale em SELECT) ──────
  // Abre o canal mudo de propósito (cor/tipo/espaço/semântica) SEM virar editor: nada é
  // appendado dentro do alvo (badge e popover vivem em overlays dm-, posicionados por
  // getBoundingClientRect) → zero reflow, zero mutação do DOM da página. Respeita o select.
  function inNotePop(node) { return !!(notePop && notePop.pop.contains(node)); }

  function openNote(el) {
    if (!el || el.nodeType !== 1) return;
    closeNote(false); // fecha qualquer popover anterior
    const existing = notes.get(el);
    const types = new Set(existing ? existing.types : []);
    const pop = document.createElement("div");
    pop.className = "dm-note-pop";
    const chips = document.createElement("div");
    chips.className = "dm-chips";
    for (const it of INTENTS) {
      const b = document.createElement("button");
      b.className = "dm-chip" + (types.has(it.id) ? " on" : "");
      b.textContent = it.label;
      b.setAttribute("data-intent", it.id);
      b.addEventListener("click", (ev) => {
        ev.preventDefault();
        if (types.has(it.id)) { types.delete(it.id); b.classList.remove("on"); }
        else { types.add(it.id); b.classList.add("on"); }
      });
      chips.appendChild(b);
    }
    const ta = document.createElement("textarea");
    ta.value = existing ? existing.text : "";
    ta.setAttribute("placeholder", "descreva a intenção pro agente…");
    const hint = document.createElement("div");
    hint.className = "dm-note-hint";
    hint.textContent = "Enter salva · Esc cancela · Shift+Enter quebra linha";
    pop.appendChild(chips); pop.appendChild(ta); pop.appendChild(hint);
    (document.body || document.documentElement).appendChild(pop);
    notePop = { pop, el, types, getText: () => ta.value };
    positionPop(pop, el);
    ta.addEventListener("keydown", (ev) => {
      ev.stopPropagation();
      if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); closeNote(true); }
      else if (ev.key === "Escape") { ev.preventDefault(); closeNote(false); }
    });
    ta.focus();
  }
  function closeNote(save) {
    if (!notePop) return;
    const { pop, el, types, getText } = notePop;
    const text = (getText() || "").trim();
    notePop = null;
    if (pop.parentNode) pop.parentNode.removeChild(pop);
    if (save) {
      if (types.size || text) notes.set(el, { types, text });
      else notes.delete(el);
      refreshBadge(el);
      updateCur();
    }
  }
  function positionPop(pop, el) {
    const r = el.getBoundingClientRect();
    const pw = pop.offsetWidth || 264, ph = pop.offsetHeight || 140;
    let left = r.left, top = r.bottom + 6;
    if (top + ph > innerHeight) top = Math.max(6, r.top - ph - 6);
    if (left + pw > innerWidth) left = Math.max(6, innerWidth - pw - 6);
    pop.style.left = Math.max(6, left) + "px";
    pop.style.top = Math.max(6, top) + "px";
  }
  function refreshBadge(el) {
    let badge = noteBadges.get(el);
    if (notes.has(el) && el.isConnected) {
      if (!badge) {
        badge = document.createElement("div");
        badge.className = "dm-note-badge";
        badge.textContent = "📌";
        (document.body || document.documentElement).appendChild(badge);
        noteBadges.set(el, badge);
      }
      positionBadge(badge, el);
    } else if (badge) {
      if (badge.parentNode) badge.parentNode.removeChild(badge);
      noteBadges.delete(el);
    }
  }
  function positionBadge(badge, el) {
    const r = el.getBoundingClientRect();
    badge.style.left = r.right + "px";
    badge.style.top = r.top + "px";
  }
  function repositionNotes() {
    for (const [el, badge] of noteBadges) {
      if (!el.isConnected) { if (badge.parentNode) badge.parentNode.removeChild(badge); noteBadges.delete(el); continue; }
      positionBadge(badge, el);
    }
    for (const [el, ov] of detachOverlays) {
      if (!el.isConnected) { if (ov.parentNode) ov.parentNode.removeChild(ov); detachOverlays.delete(el); continue; }
      positionDetach(ov, el);
    }
    if (notePop) positionPop(notePop.pop, notePop.el);
    positionRzHandle(); // grip ↘ acompanha scroll/resize/drag
  }
  function clearNotes() {
    closeNote(false);
    for (const [, badge] of noteBadges) { if (badge.parentNode) badge.parentNode.removeChild(badge); }
    noteBadges.clear();
    notes.clear();
  }

  // ── BASELINE + SPEC ───────────────────────────────────────────────────────────
  // Grava o estado ANTES da 1ª mutação (no-op se já existe) → "before" do spec.
  function markBaseline(el) {
    if (baselines.has(el)) return;
    const m = el.style.transform.match(/translate\(\s*(-?\d+(?:\.\d+)?)px\s*,\s*(-?\d+(?:\.\d+)?)px/);
    const z = parseInt(getComputedStyle(el).zIndex, 10);
    baselines.set(el, {
      w: Math.round(el.offsetWidth),
      h: Math.round(el.offsetHeight),
      tx: m ? Math.round(parseFloat(m[1])) : 0,
      ty: m ? Math.round(parseFloat(m[2])) : 0,
      z: Number.isFinite(z) ? z : null,
    });
  }

  // change-set determinístico: UNIÃO de geometria (changes) + intenção (notes). Elementos
  // SÓ com nota entram como entradas de intenção pura. Cada item carrega âncora redundante.
  // texto legível (sem tags) de um trecho de innerHTML — p/ mostrar a mudança no spec.
  function htmlToText(s) {
    const d = document.createElement("div");
    d.innerHTML = s;
    return (d.textContent || "").trim().replace(/\s+/g, " ").slice(0, 160);
  }
  function buildSpec() {
    const els = new Set();
    for (const c of changes.values()) if (c.el && c.el.isConnected) els.add(c.el);
    for (const el of notes.keys()) if (el.isConnected) els.add(el);
    for (const el of textEdits.keys()) if (el.isConnected) els.add(el);
    const out = [];
    for (const el of els) {
      const c = changes.get(el);
      const before = baselines.get(el) || null;
      let after = null, delta = null;
      if (c) {
        after = { w: c.w, h: c.h, tx: c.tx || 0, ty: c.ty || 0, z: c.z != null ? c.z : null };
        if (before) {
          delta = {
            dw: after.w - before.w, dh: after.h - before.h,
            dx: after.tx - before.tx, dy: after.ty - before.ty,
            dz: (after.z != null && before.z != null) ? after.z - before.z : null,
          };
        }
      }
      const n = notes.get(el);
      const entry = {
        anchor: anchorOf(el),
        before, after, delta,
        note: n ? (n.text || "") : "",
        intents: n ? [...n.types] : [],
      };
      const te = textEdits.get(el);
      if (te) entry.text = { before: htmlToText(te.before), after: htmlToText(te.after) };
      const constraint = (c && ruleConstraint(c)) || (c && c.snap ? snapToConstraint(c.snap) : null);
      if (constraint) entry.constraint = constraint;
      if (displayForced.has(el)) entry.displayForced = true;
      if (c && c.struct && c.struct.kind === "detach") {
        entry.struct = { kind: "detach", position: c.struct.position, parent: c.struct.parent };
      }
      out.push(entry);
    }
    return out;
  }

  function specMarkdown(spec) {
    const lines = ["# design-mode spec", "",
      `${spec.length} elemento(s) — intenção visual do humano pro agente programador aplicar.`, ""];
    let i = 0;
    for (const it of spec) {
      i++;
      const a = it.anchor;
      lines.push(`## ${i}. \`${a.selector || a.tag}\``);
      const id = [];
      if (a.text) id.push(`texto: "${a.text}"`);
      if (a.role) id.push(`papel: ${a.role}`);
      if (a.near) id.push(`perto de: "${a.near}"`);
      if (id.length) lines.push("- âncora: " + id.join(" · "));
      if (it.before && it.after) {
        const b = it.before, af = it.after, segs = [];
        if (b.w !== af.w || b.h !== af.h) segs.push(`tamanho ${b.w}×${b.h} → ${af.w}×${af.h}`);
        if ((b.tx || 0) !== (af.tx || 0) || (b.ty || 0) !== (af.ty || 0))
          segs.push(`posição translate(${b.tx},${b.ty}) → translate(${af.tx},${af.ty})`);
        if (b.z !== af.z && af.z != null) segs.push(`z-index ${b.z == null ? "auto" : b.z} → ${af.z}`);
        if (segs.length) lines.push("- [ ] " + segs.join("; "));
      } else if (it.after) {
        lines.push(`- [ ] tamanho ${it.after.w}×${it.after.h}, translate(${it.after.tx},${it.after.ty})` +
          (it.after.z != null ? `, z-index ${it.after.z}` : ""));
      }
      if (it.text) lines.push(`- [ ] texto: "${it.text.before}" → "${it.text.after}"`);
      if (it.constraint) lines.push("- dica de layout: " + it.constraint);
      if (it.struct && it.struct.kind === "detach")
        lines.push(`- estrutura: tirar do fluxo (position:${it.struct.position}, ancorado em ${it.struct.parent})`);
      if (it.intents && it.intents.length) lines.push("- intenção: " + it.intents.join(", "));
      if (it.note) lines.push("- nota: " + it.note);
      lines.push("");
    }
    return lines.join("\n");
  }

  function copySpec() {
    const spec = buildSpec();
    if (!spec.length) { uiNotifySafe("Nada no spec — mova/redimensione algo ou anote (N) um elemento.", "warn"); return; }
    const md = specMarkdown(spec);
    const json = JSON.stringify(spec, null, 2);
    writeClipboard(md + "\n```json\n" + json + "\n```\n", `Spec copiado (${spec.length} item(ns)).`);
  }

  function copyNotes() {
    if (!notes.size) { uiNotifySafe("Nenhuma nota — selecione um elemento e tecle N.", "warn"); return; }
    const arr = [];
    for (const [el, n] of notes) {
      if (!el.isConnected) continue;
      arr.push({ anchor: anchorOf(el), intents: [...n.types], note: n.text || "" });
    }
    if (!arr.length) { uiNotifySafe("As notas eram de elementos já removidos.", "warn"); return; }
    const lines = ["# design-mode notas", "", `${arr.length} elemento(s) anotado(s).`, ""];
    let i = 0;
    for (const it of arr) {
      i++;
      const a = it.anchor;
      lines.push(`## ${i}. \`${a.selector || a.tag}\``);
      const id = [];
      if (a.text) id.push(`texto: "${a.text}"`);
      if (a.role) id.push(`papel: ${a.role}`);
      if (a.near) id.push(`perto de: "${a.near}"`);
      if (id.length) lines.push("- âncora: " + id.join(" · "));
      if (it.intents.length) lines.push("- intenção: " + it.intents.join(", "));
      if (it.note) lines.push("- nota: " + it.note);
      lines.push("");
    }
    writeClipboard(lines.join("\n") + "\n```json\n" + JSON.stringify(arr, null, 2) + "\n```\n",
      `Notas copiadas (${arr.length}).`);
  }

  // ⧉ TUDO num pacote só: Spec (intenção+geometria+notas) + Layout CSS + Seletores + HTML.
  function copyAll() {
    const spec = buildSpec();                 // já reúne notas + intenção + geometria + âncora
    const blocks = layoutBlocks();            // CSS das mudanças
    // conjunto de elementos: selecionados ∪ alterados ∪ anotados, em ordem de documento
    const set = new Set([...selected]);
    for (const c of changes.values()) if (c.el && c.el.isConnected) set.add(c.el);
    for (const el of notes.keys()) if (el.isConnected) set.add(el);
    const els = [...set].filter((e) => e.isConnected).sort((a, b) =>
      (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1);
    if (!spec.length && !blocks.length && !els.length) {
      uiNotifySafe("Nada pra copiar — selecione, mova/redimensione ou anote (N) algo.", "warn");
      return;
    }
    const parts = ["# design-mode — pacote completo",
      "Intenção visual do humano pro agente programador aplicar. Seções: spec, layout, seletores, HTML.", ""];
    if (spec.length) {
      parts.push("## 1) Spec (intenção + geometria + notas)", "", specMarkdown(spec),
        "```json", JSON.stringify(spec, null, 2), "```", "");
    }
    if (blocks.length) {
      parts.push("## 2) Layout (CSS das mudanças)", "", "```css",
        "/* colar no styles.css */\n" + blocks.join("\n\n"), "```", "");
    }
    if (els.length) {
      parts.push("## 3) Seletores", "", "```", els.map(selectorOf).join(",\n"), "```", "");
      const htmls = els.map((e) => { const cl = e.cloneNode(true); stripDmState(cl); return cl.outerHTML; });
      parts.push("## 4) HTML dos elementos", "", "```html", htmls.join("\n\n"), "```", "");
    }
    writeClipboard(parts.join("\n") + "\n",
      `Tudo copiado · spec:${spec.length} · layout:${blocks.length} · elementos:${els.length}.`);
  }

  function uiNotifySafe(msg, kind) {
    if (typeof window.uiNotify === "function") window.uiNotify(msg, kind);
    else console.log("[design-mode]", msg);
  }

  // ── API pública ──
  const API = {
    __installed: true,
    version: DM_VERSION,
    setMode(m) { setMode(m); },
    select() { setMode("select"); },
    edit() { setMode("edit"); },
    enable() { setMode("edit"); },
    disable() { setMode("off"); },
    toggle() { toggle(); },
    quit() { quit(); },
    setStatic(v) { setStatic(!!v); },
    toggleStatic() { toggleStatic(); },
    isStatic() { return staticOn; },
    setTool(t) { setTool(t); },
    tool() { return tool; },
    isOn() { return mode !== "off"; },
    isEditing() { return mode === "edit"; },
    mode() { return mode; },
  };
  // ── auto-bootstrap opcional via atributo no <script> ──
  function maybeAutostart() {
    const cur = document.currentScript ||
      [...document.querySelectorAll("script[src]")].find((s) => /design-mode\.js(\?|$)/.test(s.src));
    boot(); // sempre injeta a barra
    if (cur && cur.hasAttribute("data-autostart")) setMode("edit");
  }

  // ── IFRAMES (páginas-moldura / hub com sub-apps) ───────────────────────────
  // O design-mode opera SÓ no próprio document. Uma página-MOLDURA/HUB (um shell que
  // carrega o app real dentro de <iframe> — ex.: "Intra" → /performance/...) só fica
  // editável de verdade se o design-mode DESCER pra dentro de cada iframe; senão você
  // "só edita o header/barra de cima". Aqui:
  //   • descemos pra TODOS os <iframe> mesma-origem (não só o maior ≥60%);
  //   • CONTINUAMOS observando (observer coalescido + sweep) os que aparecem/recarregam
  //     DEPOIS — SPAs (React/Vite) montam o iframe do app só após o boot, e troca de
  //     rota recria o frame;
  //   • cada frame que NASCE puxa o estado atual do pai (handshake "req:state"), então
  //     um frame montado/recarregado tarde HERDA o modo ativo da moldura — sem re-
  //     sincronizar os outros (preserva o toggle independente por frame);
  //   • um comando global (Alt+D etc.) desce UMA vez pra todos: mesma-origem chamando
  //     __applyState do frame, cross-origin via postMessage.
  // CROSS-ORIGIN (sub-app noutra porta/host, ex.: :5173 embute :3001) o navegador
  // BLOQUEIA o inject in-page: aí o sub-app só ganha a própria barra quando a EXTENSÃO
  // injeta (allFrames + host <all_urls>; o bg.js também reinjeta no recarregar do sub-
  // frame via webNavigation). O bookmarklet, por segurança do navegador, NÃO alcança
  // cross-origin — use a extensão nesse caso.
  const DM_SELF_SRC = "(" + DM_INSTALL.toString() + ")();";
  const DM_MSG = "__dm_cmd_v1"; // assinatura das mensagens entre frames

  function allFrames() { return [...document.querySelectorAll("iframe")]; }

  // injeta o design-mode DENTRO de um iframe mesma-origem. true = coberto (já tinha ou
  // acabou de receber); false = cross-origin / ainda carregando / sandbox-CSP.
  function injectInto(frame) {
    let d, w;
    try { d = frame.contentDocument; w = frame.contentWindow; } catch (_) { return false; } // cross-origin
    if (!d || !w) return false;
    try { if (w.DesignMode && w.DesignMode.__installed) return true; } catch (_) { return false; }
    if (!d.body) return false; // ainda carregando — o 'load' reinjeta
    try {
      const s = d.createElement("script");
      s.setAttribute("data-dm-injected", "");
      s.textContent = DM_SELF_SRC;
      d.body.appendChild(s);
      s.remove();
      return true;
    } catch (_) { return false; } // sandbox sem allow-scripts / CSP estrito
  }

  // garante o design-mode em CADA iframe mesma-origem; ata um 'load' (1x por frame, com
  // o handler guardado em dmWatched p/ remover no quit) pra reinjetar em recargas/
  // navegações — o doc novo perde o window.DesignMode e, ao bootar, puxa o estado do pai.
  function descendAll() {
    if (dmQuit) return;
    for (const frame of allFrames()) {
      if (!dmWatched.has(frame)) {
        const onLoad = () => { if (!dmQuit) injectInto(frame); };
        dmWatched.set(frame, onLoad);
        frame.addEventListener("load", onLoad);
      }
      injectInto(frame);
    }
  }
  // observer com coalescing: SPAs disparam mutações em rajada — agenda 1 descend só.
  function scheduleDescend() {
    if (dmQuit || frameKick) return;
    frameKick = setTimeout(() => { frameKick = null; if (!dmQuit) { descendAll(); updateMoldura(); } }, 100);
  }

  // O maior iframe (de QUALQUER origem — o tamanho é legível mesmo cross-origin) cobrindo
  // >=60% do viewport: só pra ROTULAR a barra deste frame como "moldura" (cosmético). A
  // DESCIDA acontece pra todos, à parte disto.
  function primaryChildFrame() {
    const vw = document.documentElement.clientWidth || window.innerWidth || 1;
    const vh = document.documentElement.clientHeight || window.innerHeight || 1;
    let best = null, bestArea = 0;
    for (const frame of allFrames()) {
      const r = frame.getBoundingClientRect();
      const area = Math.max(0, r.width) * Math.max(0, r.height);
      if (area > bestArea) { bestArea = area; best = frame; }
    }
    return best && bestArea / (vw * vh) >= 0.6 ? best : null;
  }
  let isMoldura = false;
  function updateMoldura() {
    const want = !!primaryChildFrame();
    if (want === isMoldura) return; // re-avalia (desfaz o rótulo se o filho dominante sumir)
    isMoldura = want;
    API.__wrapper = want || undefined;
    bar.classList.toggle("dm-bar-frame", want); // canto inferior-ESQUERDO + âmbar
    const tgl = bar.querySelector("#dm-toggle");
    if (tgl) {
      tgl.textContent = want ? "▣ moldura" : "▣ design";
      tgl.title = want
        ? "Barra da MOLDURA (edita o shell/header de cima). O APP é editado pela barra DENTRO do preview. Clique abre/fecha · arraste move."
        : "clique pra abrir/fechar · arraste pra mover";
    }
  }

  // aplica o ESTADO ABSOLUTO (modo/estático/ferramenta) NESTE frame via setters LIVRES
  // (sem re-disparar o wrapper) e desce UMA vez pros filhos. Idempotente.
  function applyState(m, st, tl) {
    if (typeof m === "string") setMode(m);
    setStatic(!!st);
    if (typeof tl === "string") setTool(tl);
    pushToChildren(m, st, tl);
  }
  // empurra o estado pra cada filho: mesma-origem chama __applyState direto (cascateia 1
  // vez — sem 3^profundidade); cross-origin manda por postMessage (o sub-app, se tiver
  // design-mode via extensão, aplica).
  function pushToChildren(m, st, tl) {
    for (const frame of allFrames()) {
      let direct = false;
      try {
        const dm = frame.contentWindow && frame.contentWindow.DesignMode;
        if (dm && dm.__installed && typeof dm.__applyState === "function") { dm.__applyState(m, st, tl); direct = true; }
      } catch (_) { /* cross-origin */ }
      if (!direct) {
        try { frame.contentWindow && frame.contentWindow.postMessage({ [DM_MSG]: true, cmd: "__sync", args: [m, st, tl] }, "*"); } catch (_) {}
      }
    }
  }

  function quitChildren() {
    for (const frame of allFrames()) {
      try { const w = frame.contentWindow; if (w && w.DesignMode && w.DesignMode.__installed) { w.DesignMode.quit(); continue; } } catch (_) {}
      try { frame.contentWindow && frame.contentWindow.postMessage({ [DM_MSG]: true, cmd: "quit", args: [] }, "*"); } catch (_) {}
    }
  }

  // diagnóstico: lista os iframes deste frame, marcando mesma-origem vs cross-origin e
  // se o design-mode chegou (covered). Rode no console: DesignMode.frameReport().
  function frameReport() {
    const frames = allFrames();
    const rows = frames.map((f) => {
      let same = false, covered = false, href = "(cross-origin — só a EXTENSÃO alcança)";
      try { if (f.contentDocument) { same = true; href = f.contentWindow.location.href; covered = !!(f.contentWindow.DesignMode && f.contentWindow.DesignMode.__installed); } } catch (_) {}
      const r = f.getBoundingClientRect();
      return { src: f.getAttribute("src") || "(sem src)", same, covered, href, size: Math.round(r.width) + "×" + Math.round(r.height) };
    });
    try {
      console.groupCollapsed(`[design-mode] ${frames.length} iframe(s) neste frame (same=mesma-origem · covered=design-mode chegou)`);
      if (console.table) console.table(rows); else console.log(rows);
      const cross = rows.filter((r) => !r.same).length;
      if (cross) console.warn(`[design-mode] ${cross} iframe(s) CROSS-ORIGIN: bookmarklet/inject in-page NÃO alcança. Use a EXTENSÃO (injeta com allFrames).`);
      console.groupEnd();
    } catch (_) {}
    return rows;
  }

  // mensagens entre frames. COMANDOS (__sync/quit) só são aceitos do PAI (descem). Um
  // FILHO meu pode PEDIR o estado ("req:state") ao nascer — respondo só pra ele.
  dmMsgHandler = function (e) {
    const d = e && e.data;
    if (!d || d[DM_MSG] !== true) return;
    if (d.req === "state") { // pull de um filho recém-nascido → devolvo o estado atual
      try { if (allFrames().some((f) => f.contentWindow === e.source)) e.source.postMessage({ [DM_MSG]: true, cmd: "__sync", args: [mode, staticOn, tool] }, "*"); } catch (_) {}
      return;
    }
    if (e.source !== window.parent) return; // comandos só DESCEM (do pai); bloqueia filho/irmão
    try {
      if (d.cmd === "__sync") { const a = Array.isArray(d.args) ? d.args : []; applyState(a[0], a[1], a[2]); }
      else if (d.cmd === "quit") { API.quit(); }
    } catch (_) {}
  };

  // Barra DESTE frame primeiro (edita ESTE documento — vale também pra moldura).
  window.DesignMode = API;
  API.__applyState = applyState; // o pai chama isto em filhos mesma-origem (cascata 1x)
  API.frameReport = frameReport;
  maybeAutostart();

  // TODO frame vira propagador (no-op se não tiver filhos): um comando global desce 1x
  // pra todos os iframes. Usa pushToChildren (não os setters wrapped) → sem 3^profundidade.
  ["setMode", "select", "edit", "enable", "disable", "toggle", "setStatic", "toggleStatic", "setTool"].forEach((m) => {
    const local = API[m];
    API[m] = function (...a) {
      const r = typeof local === "function" ? local.apply(API, a) : undefined;
      descendAll();                         // garante o script nos filhos
      pushToChildren(mode, staticOn, tool); // empurra o estado absoluto 1x
      return r;
    };
  });
  window.addEventListener("message", dmMsgHandler);
  // este frame é um FILHO? puxa o estado atual do pai (herda o modo ativo da moldura,
  // mesmo montando/recarregando depois do boot — cobre o caso do hub SPA).
  if (window.parent && window.parent !== window) {
    try { window.parent.postMessage({ [DM_MSG]: true, req: "state" }, "*"); } catch (_) {}
  }

  // descida inicial + observação contínua: SPAs montam/recarregam iframes após o boot.
  // O observer (coalescido) responde rápido; o sweep é rede de segurança. Ambos no-op
  // após ✕ (dmQuit) e são limpos no quit().
  descendAll();
  updateMoldura();
  if (mode !== "off") pushToChildren(mode, staticOn, tool); // data-autostart: propaga o modo inicial
  try {
    frameObserver = new MutationObserver(scheduleDescend);
    frameObserver.observe(document.documentElement, { childList: true, subtree: true });
  } catch (_) {}
  frameSweep = setInterval(() => { if (!dmQuit) { descendAll(); updateMoldura(); } }, 1500);
  setTimeout(() => { if (!dmQuit && allFrames().length) frameReport(); }, 1200); // 1 relatório p/ diagnóstico
})();
