/*
 * bg.js — service worker da extensão Design Mode.
 *
 * Clique no ícone da barra (ou atalho Alt+D):
 *   1ª vez na aba   → injeta o design-mode.js; a barra aparece em OFF.
 *   vezes seguintes → window.DesignMode.toggle() (alterna ON/OFF; já está carregado).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SOURCE — de onde a extensão pega o design-mode.js ao injetar:
 *   "local"  → arquivo embutido na pasta da extensão. Edita o design-mode.js,
 *              aperta ↻ no card da extensão, clica o ícone → versão fresca.
 *              Ideal NESTA máquina (dev).
 *   "remote" → baixa do GitHub (raw) a cada carga. Sempre a última versão pushada,
 *              sem clonar/pull/recarregar. Ideal em OUTRA máquina onde você só USA.
 *              (Pode falhar em sites com CSP estrito; em file:// e localhost funciona.)
 * Tudo roda no mundo MAIN (contexto da página), igual a um <script> normal.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const SOURCE = "local";

const REPO = { owner: "gabrielmatricial", name: "design-mode", branch: "master" };
const RAW = `https://raw.githubusercontent.com/${REPO.owner}/${REPO.name}/${REPO.branch}`;

// ── injeção ──────────────────────────────────────────────────────────────────
async function isLoaded(tabId) {
  const [r] = await chrome.scripting.executeScript({
    target: { tabId }, world: "MAIN",
    func: () => !!(window.DesignMode && window.DesignMode.__installed),
  });
  return !!(r && r.result);
}

async function toggleOnPage(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId }, world: "MAIN",
    func: () => { if (window.DesignMode) window.DesignMode.toggle(); },
  });
}

// Alvo da injeção: sem frameId = TODOS os frames da aba (1ª injeção — inclui iframes
// CROSS-ORIGIN, micro-front-ends de hub em outra porta/host; é o único caminho que
// alcança cross-origin, já que o inject in-page do design-mode só cobre mesma-origem).
// Com frameId = reinjeta SÓ aquele sub-frame (recarga de sub-app, via webNavigation).
function injectTarget(tabId, frameId) {
  return frameId == null ? { tabId, allFrames: true } : { tabId, frameIds: [frameId] };
}

async function injectLocal(tabId, frameId) {
  await chrome.scripting.executeScript({
    target: injectTarget(tabId, frameId), world: "MAIN",
    files: ["design-mode.js"],
  });
}

async function injectRemote(tabId, frameId) {
  const res = await fetch(`${RAW}/design-mode.js?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const code = await res.text();
  await chrome.scripting.executeScript({
    target: injectTarget(tabId, frameId), world: "MAIN", args: [code],
    func: (src) => {
      const s = document.createElement("script");
      s.textContent = src;
      (document.head || document.documentElement).appendChild(s);
      s.remove();
    },
  });
}

async function inject(tabId, frameId) {
  if (SOURCE === "remote") {
    try { await injectRemote(tabId, frameId); }
    catch (e) { console.warn("[design-mode] remote falhou, caindo pro local:", e); await injectLocal(tabId, frameId); }
  } else {
    await injectLocal(tabId, frameId);
  }
}

// Abas onde o usuário ativou o design-mode — usado pra reinjetar sub-frames que
// recarregam (webNavigation). É memória do service worker (some se o SW reciclar);
// no pior caso o auto-reinject só volta após o próximo Alt+D, que repovoa o set.
const activeTabs = new Set();

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id) return;
  try {
    if (await isLoaded(tab.id)) {
      await toggleOnPage(tab.id);
    } else {
      await inject(tab.id); // allFrames: top + todos os iframes (inclui cross-origin)
    }
    activeTabs.add(tab.id);
  } catch (e) {
    console.error("[design-mode ext] injeção falhou:", e);
  }
  checkForUpdates(); // revalida oportunisticamente após o uso
});

chrome.tabs.onRemoved.addListener((tabId) => activeTabs.delete(tabId));

// Sub-app (iframe) que RECARREGA/navega perde o design-mode (doc novo). Se a aba já está
// com o design-mode ativo, reinjeta SÓ naquele sub-frame — cobre o HMR/refresh do sub-app
// CROSS-ORIGIN, que o inject in-page do design-mode não consegue reinjetar sozinho.
// onCommitted = navegação real (doc trocado); pushState não dispara (e nem perde o script).
if (chrome.webNavigation && chrome.webNavigation.onCommitted) {
  chrome.webNavigation.onCommitted.addListener(async (d) => {
    if (!d || d.frameId === 0 || !activeTabs.has(d.tabId)) return; // só sub-frames de abas ativas
    try { await inject(d.tabId, d.frameId); } catch (_) { /* frame restrito / já trocou: ignora */ }
  });
}

// ── check de update (compara a versão do manifest local vs. a do GitHub) ──────
// "Update disponível" = o shell da extensão (manifest/bg.js/icons) tem versão nova
// no GitHub. Em modo "remote" o design-mode.js já vem sempre fresco sozinho; o badge
// é o sinal de que vale dar git pull + ↻ recarregar pra atualizar a própria extensão.
function cmpVersion(a, b) {
  const pa = String(a).split("."), pb = String(b).split(".");
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (Number(pa[i]) || 0) - (Number(pb[i]) || 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

async function checkForUpdates() {
  try {
    const res = await fetch(`${RAW}/manifest.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return;
    const remote = await res.json();
    const local = chrome.runtime.getManifest().version;
    if (cmpVersion(remote.version, local) > 0) {
      await chrome.action.setBadgeText({ text: "↑" });
      await chrome.action.setBadgeBackgroundColor({ color: "#1dc077" });
      await chrome.action.setTitle({
        title: `Design Mode — nova versão ${remote.version} no GitHub (instalada: ${local}). git pull + ↻ recarregar.`,
      });
    } else {
      await chrome.action.setBadgeText({ text: "" });
      await chrome.action.setTitle({ title: "Design Mode (clique = liga/alterna)" });
    }
  } catch (_) { /* offline / sem rede: ignora */ }
}

// Recarrega a extensão direto do disco (Alt+Shift+D) — pega edições de
// design-mode.js / bg.js / manifest sem precisar abrir chrome://extensions.
chrome.commands.onCommand.addListener((cmd) => {
  if (cmd === "reload-extension") chrome.runtime.reload();
});

chrome.runtime.onInstalled.addListener(checkForUpdates);
chrome.runtime.onStartup.addListener(checkForUpdates);
chrome.alarms.create("dm-update-check", { periodInMinutes: 360 });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === "dm-update-check") checkForUpdates(); });
