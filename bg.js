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

async function injectLocal(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId }, world: "MAIN",
    files: ["design-mode.js"],
  });
}

async function injectRemote(tabId) {
  const res = await fetch(`${RAW}/design-mode.js?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const code = await res.text();
  await chrome.scripting.executeScript({
    target: { tabId }, world: "MAIN", args: [code],
    func: (src) => {
      const s = document.createElement("script");
      s.textContent = src;
      (document.head || document.documentElement).appendChild(s);
      s.remove();
    },
  });
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id) return;
  try {
    if (await isLoaded(tab.id)) {
      await toggleOnPage(tab.id);
    } else if (SOURCE === "remote") {
      try { await injectRemote(tab.id); }
      catch (e) { console.warn("[design-mode] remote falhou, caindo pro local:", e); await injectLocal(tab.id); }
    } else {
      await injectLocal(tab.id);
    }
  } catch (e) {
    console.error("[design-mode ext] injeção falhou:", e);
  }
  checkForUpdates(); // revalida oportunisticamente após o uso
});

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

chrome.runtime.onInstalled.addListener(checkForUpdates);
chrome.runtime.onStartup.addListener(checkForUpdates);
chrome.alarms.create("dm-update-check", { periodInMinutes: 360 });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === "dm-update-check") checkForUpdates(); });
