# design-mode

A standalone, **zero-dependency** in-browser design tool. Drop a single
`<script>` into *any* page or project and get a floating toolbar that lets you
drag, resize, multi-select, align, copy/paste and delete DOM elements directly
on the live page — then export the result as CSS.

No framework, no build step, vanilla ES. Works on any DOM.

## Quick start

Drop-in via `<script src>`:

```html
<script src="design-mode.js"></script>
```

A floating toolbar appears in the bottom-right corner. Click **✎ design: OFF**
to turn it on.

Auto-start (toolbar on immediately) via the `data-autostart` attribute:

```html
<script src="design-mode.js" data-autostart></script>
```

Or paste the contents of `design-mode.js` into the devtools console of any page
to instrument it on the fly.

Try the included demo: open [`index.html`](./index.html) in a browser.

## Shortcuts

| Action | How |
| --- | --- |
| Select | Click an element |
| Multi-select | **Shift+click** (toggles each element) |
| Select parent | **⬆ pai** button |
| Move | **Drag** the selection (moves all selected together) |
| Resize | Drag the **↘ bottom-right corner** |
| Align (2+ selected) | **⬅ ⬌ ➡ / ⬆ ⬍ ⬇** buttons |
| Copy element(s) | **Ctrl+C** (or **⧉ copiar el**) |
| Paste element(s) | **Ctrl+V** (or **⊕ colar**) — pastes as a sibling with a +12px offset, already selected |
| Delete element(s) | **Del** (or **🗑 apagar**) |
| Undo | **Ctrl+Z** (or **↶ undo**) — covers move/resize/align **and** paste/delete |
| Reset all | **↺ reset** |
| Export CSS | **📋 copiar layout** — copies generated CSS to the clipboard |
| Deselect | **Esc** |

Moves are applied as `transform: translate(...)`; resize uses native CSS
`resize: both`. The CSS export emits `width` / `height` / `transform` blocks
keyed by a stable-enough selector (`#id` when present, otherwise a
`tag.class:nth-of-type(n)` path).

## API

```js
window.DesignMode.enable();   // turn design mode on
window.DesignMode.disable();  // turn it off
window.DesignMode.toggle();   // flip
window.DesignMode.quit();     // remove the tool entirely (bar + styles + listeners)
window.DesignMode.isOn();     // -> boolean
```

The toolbar is injected on first load regardless; `enable/disable/toggle` just
flip the active state (same as clicking the toggle button). `quit` (the **✕ sair**
button) tears the tool out completely and leaves the page as you edited it — run
the bookmarklet again to bring it back.

**While ON the page is inert:** clicks, links, buttons and form submits do not
respond (you're editing the layout, not using the page). The toolbar itself still
works, and select/drag/resize behave as usual. Turn OFF (or quit) to restore the
page's normal click behaviour.

## Copy / paste behaviour

- **Ctrl+C** clones the selected node(s) (deep clone, internal tool classes
  stripped) into an in-memory clipboard.
- **Ctrl+V** inserts each clone as a **sibling** of the last selected element
  (or `<body>` if nothing is selected), offset by +12px,+12px, and selects the
  new clones.
- Both paste and delete are pushed onto the **undo** stack, so **Ctrl+Z**
  reverses them (re-inserting deleted nodes at their original position).

## License

MIT — see [LICENSE](./LICENSE).
