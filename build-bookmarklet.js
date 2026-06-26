/*
 * build-bookmarklet.js — gera bookmarklet.html (link arrastável pros favoritos)
 * a partir do design-mode.js. Self-contained: inlina o script inteiro, então
 * funciona em QUALQUER página sem precisar hospedar nada (o repo é privado).
 * Rode de novo sempre que mudar o design-mode.js:  node build-bookmarklet.js
 */
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "design-mode.js"), "utf8");

// 1º clique: injeta o script — a barra aparece em modo OFF (maybeAutostart faz boot()
// sem ligar). Cliques seguintes: alterna ON/OFF (já está carregado). Design mode SEMPRE
// inicia em OFF; o usuário liga pelo toggle da barra (ou re-clicando no favorito).
const wrapper =
  "(function(){if(window.DesignMode){window.DesignMode.toggle();return;}" +
  src +
  "})();";

// encodeURIComponent deixa o href seguro pra atributo (sem aspas/&/</>), e o
// navegador decodifica antes de executar o javascript: — método padrão de bookmarklet.
const href = "javascript:" + encodeURIComponent(wrapper);

const html = `<!doctype html>
<meta charset="utf-8">
<title>Design Mode — bookmarklet</title>
<link rel="icon" href="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiI+PHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiByeD0iNyIgZmlsbD0iIzEzMjQxYiIvPjx0ZXh0IHg9IjE2IiB5PSIyMiIgZm9udC1mYW1pbHk9InVpLW1vbm9zcGFjZSxtb25vc3BhY2UiIGZvbnQtc2l6ZT0iMTQiIGZvbnQtd2VpZ2h0PSI3MDAiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZpbGw9IiM5ZmY3NjUiPiZsdDsvJmd0OzwvdGV4dD48L3N2Zz4=">
<style>
  body{font:15px/1.6 system-ui,sans-serif;max-width:680px;margin:48px auto;padding:0 20px;background:#0b0d10;color:#dde}
  a.bm{display:inline-block;font:14px ui-monospace,monospace;padding:10px 16px;background:#13241b;color:#9f7;border:1px solid #1dc077;border-radius:8px;text-decoration:none;cursor:grab}
  code{background:#1b222c;padding:2px 6px;border-radius:4px;color:#cfe}
  kbd{background:#1b222c;border:1px solid #38414e;border-radius:4px;padding:1px 6px;font:12px ui-monospace,monospace}
  .muted{color:#8aa}
</style>
<h1>🎨 Design Mode</h1>
<p><b>Arraste o botão abaixo pra sua barra de favoritos</b> (mostre-a com <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd>):</p>
<p><a class="bm" href="${href}">&lt;/&gt; Design Mode</a></p>
<p>Depois, em <b>qualquer página</b>, clique no favorito: a barra aparece no canto inferior-direito <b>em modo OFF</b> (a página segue normal). Ligue a edição pelo toggle <code>✎ design</code> da barra — ou clicando de novo no favorito.</p>
<h3>Atalhos</h3>
<ul>
  <li>Clique = selecionar · <kbd>Shift</kbd>+clique = multi-seleção · <kbd>Esc</kbd> = limpar</li>
  <li>Arrastar = mover · canto <code>↘</code> = redimensionar</li>
  <li><kbd>Ctrl</kbd>+<kbd>C</kbd> / <kbd>Ctrl</kbd>+<kbd>V</kbd> = copiar / colar · <kbd>Del</kbd> = apagar</li>
  <li><kbd>Ctrl</kbd>+<kbd>Z</kbd> = desfazer · botão <b>copiar layout</b> = exporta o CSS</li>
</ul>
<p class="muted">Não dá pra digitar bookmarklet na barra de endereço (é grande demais) — tem que <b>arrastar</b> o botão. Em qualquer projeto seu, é só usar este mesmo favorito.</p>
`;

fs.writeFileSync(path.join(__dirname, "bookmarklet.html"), html);
console.log("bookmarklet.html gerado · href =", href.length, "chars");
