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
 * Two active modes: SELECT (🔍 inspecionar) only selects/inspects elements —
 * never moves or resizes them, safe for investigating; EDIT (✎ editar) is the
 * full editor (move/resize/align/group/copy/paste/delete). Pair with STATIC
 * (▣ estático) to freeze the page's own clicks/dropdowns/forms.
 *
 * Public API: window.DesignMode.select() / .edit() / .setMode("off"|"select"|"edit")
 *   / .toggle() / .quit() / .isEditing() / .mode()
 *
 * MIT License.
 */
(function () {
  "use strict";

  if (window.DesignMode && window.DesignMode.__installed) return;

  const RESIZE_CORNER = 20; // px do canto ↘ reservados pro resize nativo
  const PASTE_OFFSET = 12; // px de offset ao colar
  const SNAP = 6; // px de tolerância do alinhamento magnético no drag (Alt desliga)
  let groupSeq = 0; // contador de ids de grupo (data-dm-group)
  let guideV = null, guideH = null; // linhas-guia do snap (criadas sob demanda)
  const changes = new Map(); // el -> { w, h, tx, ty, z, el, snap? }
  const baselines = new Map(); // el -> { w, h, tx, ty, z } ANTES da 1ª mutação (before do spec)
  const notes = new Map(); // el -> { types:Set<string>, text:string } (intenção em linguagem natural)
  const noteBadges = new Map(); // el -> badge overlay 📌 (NUNCA filho do alvo)
  const detachOverlays = new Map(); // el -> overlay tracejado (solto do fluxo, FORA do alvo)
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
  let nudgeSession = null; // { els:Set, t:number } — coalesce de undo p/ rajadas de seta (mover/resize teclado)
  let alignKeep = true; // '@ manter': align vincula ao último selecionado (constraint mantida)

  const style = document.createElement("style");
  style.setAttribute("data-dm-style", ""); // marcador p/ remover do HTML salvo
  style.textContent = `
    .dm-bar{position:fixed;z-index:2147483647;right:12px;bottom:12px;display:flex;gap:5px;
      align-items:center;font:12px ui-monospace,monospace;background:#11151b;color:#cfe;flex-wrap:wrap;max-width:96vw;
      border:1px solid #38414e;border-radius:8px;padding:6px 8px;box-shadow:0 4px 16px #0008}
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
    body.dm-active *:hover{outline:1px dashed #5b8a !important}
    .dm-sel{outline:2px solid #1dc077 !important;outline-offset:1px}
    .dm-grouped{outline:1px dashed #c9a227 !important;outline-offset:1px}
    body.dm-edit .dm-editable{resize:both;overflow:auto}
    .dm-bar:not(.dm-editing) .dm-edit-only{display:none !important}
    .dm-bar #dm-mode-select.on{border-color:#4aa3ff;background:#0f1f2e;color:#9fd0ff}
    .dm-guide{position:fixed;z-index:2147483646;background:#ff3b8d;pointer-events:none;margin:0;padding:0}
    .dm-guide.dm-guide-v{top:0;width:1px;height:100vh}
    .dm-guide.dm-guide-h{left:0;height:1px;width:100vw}
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
  `;

  const bar = document.createElement("div");
  bar.className = "dm-bar";
  bar.innerHTML =
    '<button id="dm-mode-select" title="modo seletor — só inspeciona/seleciona; NÃO move nem redimensiona (seguro pra investigar)">🔍 inspecionar</button>' +
    '<button id="dm-mode-edit" title="modo editor — mover, redimensionar, alinhar, agrupar, copiar/colar, apagar">✎ editar</button>' +
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
    '<span class="dm-cur" id="dm-cur">—</span>';

  function ready(fn) {
    if (document.body) fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }

  function boot() {
    if (booted) return;
    booted = true;
    ready(() => {
      document.head.appendChild(style);
      document.body.appendChild(bar);
      bar.querySelector("#dm-mode-select").addEventListener("click", () => setMode(mode === "select" ? "off" : "select"));
      bar.querySelector("#dm-mode-edit").addEventListener("click", () => setMode(mode === "edit" ? "off" : "edit"));
      bar.querySelector("#dm-parent").addEventListener("click", selectParent);
      bar.querySelector("#dm-copy").addEventListener("click", copyLayout);
      bar.querySelector("#dm-copysel").addEventListener("click", copySelector);
      bar.querySelector("#dm-note").addEventListener("click", () => { if (selected.size === 1) openNote([...selected][0]); });
      bar.querySelector("#dm-copyspec").addEventListener("click", copySpec);
      bar.querySelector("#dm-copynotes").addEventListener("click", copyNotes);
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
      clearSel();
      clearNotes(); // setMode("off") limpa o Map de notas + overlays
    }
    updateCur();
  }

  function isEditing() { return mode === "edit"; }

  // toggle (ícone da extensão / API): liga em modo SELETOR (seguro p/ investigar)
  // ou desliga se já estiver ativo. Pra editar, clique "✎ editar" na barra.
  function toggle() { setMode(mode === "off" ? "select" : "off"); }

  // ── MODO ESTÁTICO ──────────────────────────────────────────────────────────
  // Toggle DEDICADO (independente do design ON/OFF): congela a página — não
  // responde a cliques, links, botões, dropdowns nem filtros. A barra é exceção.
  // Bloqueia em CAPTURA: a família click/change/submit sempre; e `mousedown` só em
  // controles interativos (assim o `<select>`, que abre no mousedown, não abre, e o
  // foco não vai pro campo) — `pointerdown` fica LIVRE pro design selecionar/arrastar
  // e o resize nativo (↘) em elementos de layout segue funcionando.
  let staticOn = false;
  const STATIC_BLOCK_EVENTS = ["click", "dblclick", "auxclick", "contextmenu", "submit", "change", "input", "beforeinput"];
  const STATIC_CTRL_SEL =
    'a,button,select,input,textarea,label,summary,details,option,[onclick],' +
    '[role="button"],[role="tab"],[role="option"],[role="menuitem"],[role="combobox"],[contenteditable]';
  function onStaticBlock(e) {
    if (inBar(e.target) || inNotePop(e.target)) return; // barra e popover de nota são exceção
    if (e.type === "mousedown") {
      const ctrl = e.target && e.target.closest ? e.target.closest(STATIC_CTRL_SEL) : null;
      if (!ctrl) return; // mousedown em layout puro passa (resize nativo / drag do design)
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
    document.body.classList.remove("dm-active", "dm-edit", "dm-static");
    document.querySelectorAll(".dm-editable, .dm-sel, .dm-grouped")
      .forEach((n) => n.classList.remove("dm-editable", "dm-sel", "dm-grouped"));
    document.querySelectorAll("[data-dm-group]").forEach((n) => n.removeAttribute("data-dm-group"));
    [guideV, guideH].forEach((g) => { if (g && g.parentNode) g.parentNode.removeChild(g); });
    guideV = guideH = null;
    for (const [, ov] of detachOverlays) { if (ov.parentNode) ov.parentNode.removeChild(ov); }
    detachOverlays.clear();
    nudgeSession = null;
    clearNotes(); // remove badges 📌 + popover; zera o Map de notas
    baselines.clear();
    fileHandle = null; // esquece o arquivo aberto (File System Access API)
    window.removeEventListener("scroll", repositionNotes, true);
    window.removeEventListener("resize", repositionNotes, true);
    if (bar.parentNode) bar.parentNode.removeChild(bar);
    if (style.parentNode) style.parentNode.removeChild(style);
    booted = false;
    try { delete window.DesignMode; } catch (_) { window.DesignMode = undefined; }
  }

  function onKey(e) {
    if (mode === "off") return;
    // o popover de nota trata as próprias teclas (Enter/Esc/digitação) — não intercepta
    if (notePop && notePop.pop.contains(e.target)) return;
    const mod = e.ctrlKey || e.metaKey;
    // ── valem nos dois modos (não mutam o layout) ──
    if (e.key === "Escape") { clearSel(); return; }
    if (mod && (e.key === "c" || e.key === "C")) { e.preventDefault(); copyElements(); return; }
    // Salvar (Ctrl+S) / Salvar como (Ctrl+Shift+S) — vale nos dois modos; bloqueia o
    // diálogo nativo "salvar página" do navegador.
    if (mod && (e.key === "s" || e.key === "S")) { e.preventDefault(); saveFile(e.shiftKey); return; }
    // Nota (intenção): 'N' com exatamente 1 selecionado — vale em select e edit.
    if (!mod && (e.key === "n" || e.key === "N")) {
      if (isEditableTarget(e.target) || inBar(e.target)) return;
      if (selected.size === 1) { e.preventDefault(); openNote([...selected][0]); }
      return;
    }
    // Navegar o DOM (Alt+setas) — SÓ-leitura, vale em select E edit: pai / filho / irmãos.
    if (e.altKey && e.key.indexOf("Arrow") === 0) {
      if (isEditableTarget(e.target) || inBar(e.target)) return;
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
      if (isEditableTarget(e.target) || inBar(e.target)) return;
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
      if (isEditableTarget(e.target) || inBar(e.target)) return;
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

  // Filhos-elemento "navegáveis": pula nós dm-* (barra/guias/badges/overlays) e os sem
  // caixa (display:none / 0×0). offsetParent==null cobre o caso normal; o rect cobre
  // position:fixed e file:// onde offsetParent pode mentir.
  function elementChildrenOf(el) {
    if (!el || !el.children) return [];
    return [...el.children].filter((c) => {
      if (c.nodeType !== 1) return false;
      if (c.classList && [...c.classList].some((k) => k.indexOf("dm-") === 0)) return false;
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
    const cur = bar.querySelector("#dm-cur");
    if (!cur) return;
    // contador combinado: edições geométricas + notas de intenção
    const meta = [];
    if (changes.size) meta.push(changes.size + " edit" + (changes.size > 1 ? "s" : ""));
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
      s.el.style.transform = s.transform;
      s.el.style.width = s.width;
      s.el.style.height = s.height;
      if (s.zIndex !== undefined) s.el.style.zIndex = s.zIndex;
      if (s.position !== undefined) s.el.style.position = s.position;
      if (s.top !== undefined) s.el.style.top = s.top;
      if (s.left !== undefined) s.el.style.left = s.left;
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
      clone.style.transform = `translate(${ox}px, ${oy}px)`;
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
      o.el.style.transform = `translate(${Math.round(tx)}px, ${Math.round(ty)}px)`;
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
      el.style.transform = `translate(${Math.round(tx)}px, ${Math.round(ty)}px)`;
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
      el.style.transform = `translate(${tx}px, ${ty}px)`;
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
      if (dw) el.style.width = Math.max(8, el.offsetWidth + dw) + "px"; // clamp 8px
      if (dh) el.style.height = Math.max(8, el.offsetHeight + dh) + "px";
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
      if (back) { el.style.position = ""; el.style.top = ""; el.style.left = ""; }
      else { el.style.position = "absolute"; el.style.top = "auto"; el.style.left = "auto"; }
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
    if (posForced) el.style.position = "relative"; // z-index só vale em elemento posicionado
    el.style.zIndex = String(z);
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

  // ── snap (alinhamento magnético no drag): coleta as linhas-alvo (bordas+centros) ──
  function buildSnapTargets(exclude) {
    drag.targetXs = [];
    drag.targetYs = [];
    let count = 0;
    for (const el of document.querySelectorAll("body *")) {
      if (count > 600) break;
      if (exclude.has(el) || inBar(el) || (el.classList && el.classList.contains("dm-guide"))) continue;
      let skip = false;
      for (const x of exclude) { if (el.contains(x) || x.contains(el)) { skip = true; break; } }
      if (skip) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) continue;
      if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
      count++;
      // alvos como OBJETOS {pos, el, edge}: guardam a IDENTIDADE da linha (de quem é,
      // qual borda) sem materializar selector (caro) — isso só acontece no vencedor, no onUp.
      drag.targetXs.push(
        { pos: r.left, el, edge: "left" },
        { pos: r.left + r.width / 2, el, edge: "centerX" },
        { pos: r.right, el, edge: "right" });
      drag.targetYs.push(
        { pos: r.top, el, edge: "top" },
        { pos: r.top + r.height / 2, el, edge: "centerY" },
        { pos: r.bottom, el, edge: "bottom" });
    }
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

  function onDown(e) {
    nudgeSession = null; // qualquer clique encerra a sessão de nudge/resize coalescida
    if (inBar(e.target)) return; // não captura cliques na própria barra
    if (notePop) {
      if (notePop.pop.contains(e.target)) return; // interagindo com o popover (chips/textarea)
      closeNote(true); // clicou fora: salva e fecha — não seleciona/arrasta nesse clique
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

    const r = el.getBoundingClientRect();
    const inCorner = e.clientX > r.right - RESIZE_CORNER && e.clientY > r.bottom - RESIZE_CORNER;
    if (inCorner) {
      // deixa o resize NATIVO (resize:both) agir; só capturamos o tamanho no fim
      pushUndo([el]);
      markBaseline(el); // grava o "before" antes da 1ª mutação
      const finish = () => {
        record(el);
        window.removeEventListener("pointerup", finish, true);
      };
      window.addEventListener("pointerup", finish, true);
      return;
    }

    // drag: move TODOS os selecionados juntos (via transform translate)
    e.preventDefault();
    e.stopPropagation();
    const els = [...selected];
    pushUndo(els);
    for (const x of els) markBaseline(x); // "before" do spec, antes de mover
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
      if (sx) { dx += sx.delta; showGuide("v", sx.pos); drag.lastSnapX = sx; } else { showGuide("v", null); drag.lastSnapX = null; }
      if (sy) { dy += sy.delta; showGuide("h", sy.pos); drag.lastSnapY = sy; } else { showGuide("h", null); drag.lastSnapY = null; }
    } else { showGuide("v", null); showGuide("h", null); drag.lastSnapX = null; drag.lastSnapY = null; }
    for (const d of drag) { d.el.style.transform = `translate(${d.btx + dx}px, ${d.bty + dy}px)`; }
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
    repositionNotes();
    window.removeEventListener("pointermove", onMove, true);
    window.removeEventListener("pointerup", onUp, true);
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

  function record(el) {
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

  function copyLayout() {
    if (!changes.size) {
      uiNotifySafe("Nenhuma alteração pra copiar — arraste/redimensione algo primeiro.", "warn");
      return;
    }
    const blocks = [];
    for (const c of changes.values()) {
      if (!c.el.isConnected) continue; // ignora nós já removidos
      const decls = [`  width: ${c.w}px;`, `  height: ${c.h}px;`];
      if (c.tx || c.ty) decls.push(`  transform: translate(${c.tx}px, ${c.ty}px);`);
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
    root.querySelectorAll(".dm-bar, .dm-guide, .dm-note-pop, .dm-note-badge, .dm-detach, [data-dm-style]")
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
    if (changes.size) pushUndo([...changes.keys()]); // reset também é desfazível
    for (const c of changes.values()) {
      if (!c.el.isConnected) continue;
      c.el.style.transform = "";
      c.el.style.width = "";
      c.el.style.height = "";
      c.el.style.zIndex = "";
      if (c.posForced) c.el.style.position = "";
      c.el.classList.remove("dm-editable", "dm-sel");
    }
    changes.clear();
    baselines.clear(); // zera os "before" do spec junto com as edições
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
  function buildSpec() {
    const els = new Set();
    for (const c of changes.values()) if (c.el && c.el.isConnected) els.add(c.el);
    for (const el of notes.keys()) if (el.isConnected) els.add(el);
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
      const constraint = (c && ruleConstraint(c)) || (c && c.snap ? snapToConstraint(c.snap) : null);
      if (constraint) entry.constraint = constraint;
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

  function uiNotifySafe(msg, kind) {
    if (typeof window.uiNotify === "function") window.uiNotify(msg, kind);
    else console.log("[design-mode]", msg);
  }

  // ── API pública ──
  const API = {
    __installed: true,
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
    isOn() { return mode !== "off"; },
    isEditing() { return mode === "edit"; },
    mode() { return mode; },
  };
  window.DesignMode = API;

  // ── auto-bootstrap opcional via atributo no <script> ──
  function maybeAutostart() {
    const cur = document.currentScript ||
      [...document.querySelectorAll("script[src]")].find((s) => /design-mode\.js(\?|$)/.test(s.src));
    boot(); // sempre injeta a barra
    if (cur && cur.hasAttribute("data-autostart")) setMode("edit");
  }
  maybeAutostart();
})();
