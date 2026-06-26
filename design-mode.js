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
 * While ON the page is INERT: clicks/links/buttons/forms do not respond
 * (you're editing layout, not using the page). Turn OFF to restore.
 *
 * Public API: window.DesignMode.enable() / .disable() / .toggle() / .quit()
 *
 * MIT License.
 */
(function () {
  "use strict";

  if (window.DesignMode && window.DesignMode.__installed) return;

  const RESIZE_CORNER = 20; // px do canto ↘ reservados pro resize nativo
  const PASTE_OFFSET = 12; // px de offset ao colar
  const changes = new Map(); // el -> { w, h, tx, ty, el }
  const selected = new Set(); // seleção MÚLTIPLA (Shift+clique adiciona)
  const undoStack = []; // pilha de snapshots p/ desfazer (Ctrl+Z)
  const clipboard = []; // outerHTML dos elementos copiados (Ctrl+C)
  let on = false;
  let drag = null; // array de { el, btx, bty } (+ .sx/.sy) — move todos juntos
  let booted = false;

  const style = document.createElement("style");
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
    .dm-bar .dm-cur{max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#8aa}
    body.dm-on *:hover{outline:1px dashed #5b8a !important}
    .dm-sel{outline:2px solid #1dc077 !important;outline-offset:1px}
    body.dm-on .dm-editable{resize:both;overflow:auto}
  `;

  const bar = document.createElement("div");
  bar.className = "dm-bar";
  bar.innerHTML =
    '<button id="dm-toggle">✎ design: OFF</button>' +
    '<button id="dm-parent" title="selecionar elemento pai">⬆ pai</button>' +
    '<span class="dm-grp" id="dm-align" title="alinhar (2+ selecionados)">' +
      '<button data-al="left" title="alinhar à esquerda">⬅</button>' +
      '<button data-al="hcenter" title="centralizar horizontal">⬌</button>' +
      '<button data-al="right" title="alinhar à direita">➡</button>' +
      '<button data-al="top" title="alinhar ao topo">⬆</button>' +
      '<button data-al="vcenter" title="centralizar vertical">⬍</button>' +
      '<button data-al="bottom" title="alinhar à base">⬇</button>' +
    '</span>' +
    '<span class="dm-sep"></span>' +
    '<button id="dm-copyel" title="copiar elemento(s) (Ctrl+C)" disabled>⧉ copiar el</button>' +
    '<button id="dm-paste" title="colar elemento(s) (Ctrl+V)" disabled>⊕ colar</button>' +
    '<button id="dm-del" title="apagar selecionado(s) (Del)" disabled>🗑 apagar</button>' +
    '<span class="dm-sep"></span>' +
    '<button id="dm-undo" title="desfazer (Ctrl+Z)" disabled>↶ undo</button>' +
    '<button id="dm-copy" title="copiar CSS do layout">📋 copiar layout</button>' +
    '<button id="dm-reset" title="desfazer tudo">↺ reset</button>' +
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
      bar.querySelector("#dm-toggle").addEventListener("click", toggle);
      bar.querySelector("#dm-parent").addEventListener("click", selectParent);
      bar.querySelector("#dm-copy").addEventListener("click", copyLayout);
      bar.querySelector("#dm-reset").addEventListener("click", resetAll);
      bar.querySelector("#dm-undo").addEventListener("click", undo);
      bar.querySelector("#dm-copyel").addEventListener("click", copyElements);
      bar.querySelector("#dm-paste").addEventListener("click", pasteElements);
      bar.querySelector("#dm-del").addEventListener("click", deleteElements);
      bar.querySelector("#dm-quit").addEventListener("click", quit);
      bar.querySelectorAll("#dm-align button").forEach((b) =>
        b.addEventListener("click", () => align(b.getAttribute("data-al"))));
    });
  }

  function setOn(next) {
    boot();
    const want = !!next;
    if (want === on) return;
    on = want;
    document.body.classList.toggle("dm-on", on);
    const btn = bar.querySelector("#dm-toggle");
    if (btn) {
      btn.textContent = on ? "✎ design: ON" : "✎ design: OFF";
      btn.classList.toggle("on", on);
    }
    if (on) {
      document.addEventListener("pointerdown", onDown, true);
      document.addEventListener("keydown", onKey, true);
      CLICK_BLOCK_EVENTS.forEach((t) => document.addEventListener(t, onClickBlock, true));
    } else {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
      CLICK_BLOCK_EVENTS.forEach((t) => document.removeEventListener(t, onClickBlock, true));
      clearSel();
    }
  }

  function toggle() { setOn(!on); }

  // Com design ON a página fica INERTE: engole cliques/links/botões/forms (você
  // está editando o layout, não usando a página). A própria barra é exceção. Os
  // selecionar/arrastar (pointerdown) e o resize nativo (↘) seguem funcionando.
  const CLICK_BLOCK_EVENTS = ["click", "dblclick", "auxclick", "submit"];
  function onClickBlock(e) {
    if (!on || inBar(e.target)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  // QUIT: remove a ferramenta de vez (barra + estilos + listeners + artefatos),
  // deixando a página como o usuário a editou. Permite reinstalar depois (ex.:
  // clicar o bookmarklet de novo) zerando o guard __installed.
  function quit() {
    setOn(false); // remove listeners + dm-on + limpa seleção (se estava ON)
    document.querySelectorAll(".dm-editable, .dm-sel")
      .forEach((n) => n.classList.remove("dm-editable", "dm-sel"));
    if (bar.parentNode) bar.parentNode.removeChild(bar);
    if (style.parentNode) style.parentNode.removeChild(style);
    booted = false;
    try { delete window.DesignMode; } catch (_) { window.DesignMode = undefined; }
  }

  function onKey(e) {
    if (!on) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === "z" || e.key === "Z")) { e.preventDefault(); undo(); }
    else if (mod && (e.key === "c" || e.key === "C")) { e.preventDefault(); copyElements(); }
    else if (mod && (e.key === "v" || e.key === "V")) { e.preventDefault(); pasteElements(); }
    else if (e.key === "Delete" || e.key === "Backspace") {
      // Backspace só apaga quando não estamos num campo editável
      if (e.key === "Backspace" && isEditableTarget(e.target)) return;
      e.preventDefault();
      deleteElements();
    }
    else if (e.key === "Escape") { clearSel(); }
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
  function addSel(el) { selected.add(el); el.classList.add("dm-sel", "dm-editable"); updateCur(); }
  function selectOnly(el) { clearSel(); addSel(el); }
  function toggleSel(el) {
    if (selected.has(el)) { selected.delete(el); el.classList.remove("dm-sel"); }
    else { selected.add(el); el.classList.add("dm-sel", "dm-editable"); }
    updateCur();
  }
  function clearSel() {
    selected.forEach((e) => e.classList.remove("dm-sel"));
    selected.clear();
    updateCur();
  }

  function selectParent() {
    if (selected.size !== 1) return;
    const el = [...selected][0];
    if (el.parentElement && el.parentElement !== document.body) selectOnly(el.parentElement);
  }

  function updateCur() {
    const n = selected.size;
    bar.classList.toggle("dm-multi", n >= 2);
    const undoBtn = bar.querySelector("#dm-undo");
    if (undoBtn) undoBtn.disabled = undoStack.length === 0;
    const copyEl = bar.querySelector("#dm-copyel");
    const pasteEl = bar.querySelector("#dm-paste");
    const delEl = bar.querySelector("#dm-del");
    if (copyEl) copyEl.disabled = n === 0;
    if (delEl) delEl.disabled = n === 0;
    if (pasteEl) pasteEl.disabled = clipboard.length === 0;
    const cur = bar.querySelector("#dm-cur");
    if (!cur) return;
    if (n === 0) cur.textContent = changes.size ? changes.size + " edit(s)" : "—";
    else if (n === 1) cur.textContent = selectorOf([...selected][0]) + "  (" + changes.size + " edit)";
    else cur.textContent = n + " selecionados  (" + changes.size + " edit)";
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
    uiNotifySafe(`${clipboard.length} elemento(s) copiado(s). Ctrl+V pra colar.`, "ok");
  }

  function stripDmState(node) {
    node.classList && node.classList.remove("dm-sel", "dm-editable");
    const inner = node.querySelectorAll ? node.querySelectorAll(".dm-sel, .dm-editable") : [];
    inner.forEach((n) => n.classList.remove("dm-sel", "dm-editable"));
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
      if (el.parentNode) el.parentNode.removeChild(el);
    }
    selected.clear();
    pushDomUndo(ops);
    updateCur();
    uiNotifySafe(`${els.length} elemento(s) apagado(s). Ctrl+Z pra desfazer.`, "ok");
  }

  // ── alinhamento (precisa de 2+ selecionados) ──
  function avg(a) { return a.reduce((s, n) => s + n, 0) / a.length; }
  function align(kind) {
    const els = [...selected];
    if (els.length < 2) { uiNotifySafe("Selecione 2+ elementos (Shift+clique) pra alinhar.", "warn"); return; }
    pushUndo(els);
    const items = els.map((el) => ({ el, r: el.getBoundingClientRect() }));
    let target;
    if (kind === "left") target = Math.min(...items.map((o) => o.r.left));
    else if (kind === "right") target = Math.max(...items.map((o) => o.r.right));
    else if (kind === "top") target = Math.min(...items.map((o) => o.r.top));
    else if (kind === "bottom") target = Math.max(...items.map((o) => o.r.bottom));
    else if (kind === "hcenter") target = avg(items.map((o) => o.r.left + o.r.width / 2));
    else if (kind === "vcenter") target = avg(items.map((o) => o.r.top + o.r.height / 2));
    for (const o of items) {
      const c = changes.get(o.el) || {};
      let tx = c.tx || 0, ty = c.ty || 0;
      if (kind === "left") tx += target - o.r.left;
      else if (kind === "right") tx += target - o.r.right;
      else if (kind === "hcenter") tx += target - (o.r.left + o.r.width / 2);
      else if (kind === "top") ty += target - o.r.top;
      else if (kind === "bottom") ty += target - o.r.bottom;
      else if (kind === "vcenter") ty += target - (o.r.top + o.r.height / 2);
      o.el.style.transform = `translate(${Math.round(tx)}px, ${Math.round(ty)}px)`;
      record(o.el);
    }
  }

  function onDown(e) {
    if (inBar(e.target)) return; // não captura cliques na própria barra
    const el = e.target.closest("*");
    if (!el || el === document.body || el === document.documentElement) return;

    // Shift+clique: alterna o elemento na seleção múltipla (não arrasta).
    if (e.shiftKey) { e.preventDefault(); e.stopPropagation(); toggleSel(el); return; }
    // Clique simples num elemento fora da seleção: seleciona só ele.
    if (!selected.has(el)) selectOnly(el);

    const r = el.getBoundingClientRect();
    const inCorner = e.clientX > r.right - RESIZE_CORNER && e.clientY > r.bottom - RESIZE_CORNER;
    if (inCorner) {
      // deixa o resize NATIVO (resize:both) agir; só capturamos o tamanho no fim
      pushUndo([el]);
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
    drag = els.map((x) => { const c = changes.get(x) || {}; return { el: x, btx: c.tx || 0, bty: c.ty || 0 }; });
    drag.sx = e.clientX;
    drag.sy = e.clientY;
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
  }

  function onMove(e) {
    if (!drag) return;
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    for (const d of drag) { d.el.style.transform = `translate(${d.btx + dx}px, ${d.bty + dy}px)`; }
  }

  function onUp() {
    if (drag) for (const d of drag) record(d.el);
    drag = null;
    window.removeEventListener("pointermove", onMove, true);
    window.removeEventListener("pointerup", onUp, true);
  }

  function record(el) {
    const prev = changes.get(el) || {};
    const m = el.style.transform.match(/translate\(\s*(-?\d+(?:\.\d+)?)px\s*,\s*(-?\d+(?:\.\d+)?)px/);
    changes.set(el, {
      w: Math.round(el.offsetWidth),
      h: Math.round(el.offsetHeight),
      tx: m ? Math.round(parseFloat(m[1])) : prev.tx || 0,
      ty: m ? Math.round(parseFloat(m[2])) : prev.ty || 0,
      el,
    });
    updateCur();
  }

  // Seletor CSS estável-o-suficiente pra colar no styles.css.
  function selectorOf(el) {
    if (el.id) return "#" + cssEsc(el.id);
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.body) {
      let part = node.tagName.toLowerCase();
      const cls = (node.getAttribute("class") || "")
        .split(/\s+/)
        .filter((c) => c && !c.startsWith("dm-"))[0];
      if (cls) part += "." + cssEsc(cls);
      const parent = node.parentElement;
      if (parent) {
        const sib = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
        if (sib.length > 1) part += `:nth-of-type(${sib.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      if (node.id) {
        parts[0] = "#" + cssEsc(node.id);
        break;
      }
      node = parent;
    }
    return parts.join(" > ");
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
      blocks.push(`${selectorOf(c.el)} {\n${decls.join("\n")}\n}`);
    }
    const css = "/* design-mode export — colar no styles.css */\n" + blocks.join("\n\n") + "\n";
    const done = () => uiNotifySafe(`Layout copiado (${blocks.length} bloco(s)).`, "ok");
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(css).then(done, () => { console.log(css); done(); });
    } else {
      console.log(css);
      done();
    }
    console.log(css);
  }

  function resetAll() {
    if (changes.size) pushUndo([...changes.keys()]); // reset também é desfazível
    for (const c of changes.values()) {
      if (!c.el.isConnected) continue;
      c.el.style.transform = "";
      c.el.style.width = "";
      c.el.style.height = "";
      c.el.classList.remove("dm-editable", "dm-sel");
    }
    changes.clear();
    clearSel();
    uiNotifySafe("Layout resetado.", "ok");
  }

  function uiNotifySafe(msg, kind) {
    if (typeof window.uiNotify === "function") window.uiNotify(msg, kind);
    else console.log("[design-mode]", msg);
  }

  // ── API pública ──
  const API = {
    __installed: true,
    enable() { setOn(true); },
    disable() { setOn(false); },
    toggle() { toggle(); },
    quit() { quit(); },
    isOn() { return on; },
  };
  window.DesignMode = API;

  // ── auto-bootstrap opcional via atributo no <script> ──
  function maybeAutostart() {
    const cur = document.currentScript ||
      [...document.querySelectorAll("script[src]")].find((s) => /design-mode\.js(\?|$)/.test(s.src));
    boot(); // sempre injeta a barra
    if (cur && cur.hasAttribute("data-autostart")) setOn(true);
  }
  maybeAutostart();
})();
