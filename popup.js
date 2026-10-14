// ===================== STATE =====================
let state = {
  sessionId: null,
  domain: null,
  user: null,
  history: [],
  dataModel: null,
};

// ===================== DOM REFS =====================
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
const connectionPanel = $("#connection-panel");
const vqlPanel = $("#vql-panel");
const statusPill = $("#status-pill");
const statusText = $("#status-text");
const domainInput = $("#vault-domain");
const disconnectBtn = $("#disconnect-btn");
const whoamiBtn = $("#whoami-btn");
const whoamiPopover = $("#whoami-popover");
const whoamiClose = $("#whoami-close");
const userDetails = $("#user-details");
const aiProviderTiles = $("#ai-provider");
const aiKeyInput = $("#ai-key-input");
const aiKeyReveal = $("#ai-key-reveal");
const aiKeySave = $("#ai-key-save");
const aiKeyClear = $("#ai-key-clear");
const aiKeyStatus = $("#ai-key-status");
const aiStatusTitle = $("#ai-status-title");
const aiStatusNote = $("#ai-status-note");
const vqlInput = $("#vql-input");
const runBtn = $("#run-btn");
const cancelBtn = $("#cancel-btn");
const clearBtn = $("#clear-btn");
const queryTime = $("#query-time");
const resultsPanel = $("#results-panel");
const resultsCount = $("#results-count");
const resultsContainer = $("#results-container");
const copyBtn = $("#copy-btn");
const exportCsvBtn = $("#export-csv-btn");
const historyBtn = $("#history-btn");
const historyPopover = $("#history-popover");
const historyList = $("#history-list");
const clearHistoryBtn = $("#clear-history-btn");
const acDropdown = $("#autocomplete-dropdown");

// Date chip refs
const dateChip = $("#date-chip");
const dateMenu = $("#date-menu");
const dateYears = $("#date-years");
const dateYearsGo = $("#date-years-go");
const datePreview = $("#date-preview");

// Data model refs
const modelChip = $("#model-chip");
const modelChipLabel = $("#model-chip-label");
const dmPanel = $("#dm-panel");
const dmEmptyState = $("#dm-empty-state");
const dmCounts = $("#dm-counts");
const dmSearch = $("#dm-search");
const dmSearchField = $(".dm-search-field");
const dmSearchClear = $("#dm-search-clear");
const dmFilters = $("#dm-filters");
const dmNFields = $("#dm-n-fields");
const dmNObjects = $("#dm-n-objects");
const dmTree = $("#dm-tree");
const dmMore = $("#dm-more");
const dmShowing = $("#dm-showing");
const dmShowMore = $("#dm-show-more");

// Window-mode refs
const topbarUser = $("#topbar-user");
const topbarChipSlot = $("#topbar-chip-slot");
const expandBtn = $("#expand-btn");
const collapseBtn = $("#collapse-btn");
const closeBtn = $("#close-btn");
const editorTools = $("#editor-tools");
const editorHl = $("#editor-hl");
const editorGutter = $("#editor-gutter");

// popup.html serves both the overlay iframe and the full-window tab. The mode is
// fixed for the lifetime of the page, so layout decisions can be made once.
const PAGE_PARAMS = new URLSearchParams(location.search);
const WINDOW_MODE = PAGE_PARAMS.get("mode") === "window";

// Loads the previous view was part-way through when it handed over (see
// handoffLoads). Started again once this view has connected.
const handedLoads = new Set((PAGE_PARAMS.get("resume") || "").split(","));

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);
const RUN_KEY_LABEL = IS_MAC ? "⌘↵" : "Ctrl ↵";

// The run button's resting face. The workbench gives it the play glyph and its
// shortcut; runQuery swaps in progress text and puts this back when it's done.
const RUN_LABEL = WINDOW_MODE
  ? '<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4l13 8-13 8z"/></svg>' +
    `Run query<span class="run-key">${RUN_KEY_LABEL}</span>`
  : "Run Query";

let lastResultData = null;
let acIndex = -1;
let acItems = [];

// History navigation: -1 means "not navigating"; 0..N-1 indexes into state.history.
const HISTORY_NAV_LIMIT = 10;
let historyNavIndex = -1;

// Cancellation token for the in-flight query. The cancel button flips
// `aborted = true`; the runQuery loops check it after every await and bail
// out gracefully. In-flight fetches are not cancelled at the network level —
// their responses are simply discarded once the flag is set.
let activeQueryToken = null;

// ===================== WINDOW MODE =====================
if (WINDOW_MODE) {
  document.body.classList.add("mode-window");
  // The chip reads as model state next to the vault identity here, rather than
  // as one more control in the operator row.
  topbarChipSlot.appendChild($("#chip-group"));
  expandBtn.classList.add("hidden");
  collapseBtn.classList.remove("hidden");
  // The editor's own actions sit on its toolbar, right of the operator chips.
  editorTools.append(clearBtn, cancelBtn, runBtn);
  runBtn.innerHTML = RUN_LABEL;
  runBtn.title =
    "Runs the query and fetches every page concurrently, up to the Limit when the " +
    "query has no LIMIT of its own. For stable paging on large sets, include an ORDER BY.";
  resultsContainer.dataset.empty = `Run a query to see its rows here · ${RUN_KEY_LABEL}`;
}

// Closing this view abandons any model or type load still running, so the next
// view is told to start it again rather than coming up without it.
function handoffLoads() {
  return [modelLoading && "model", dtLoading && "types"].filter(Boolean).join(",");
}

expandBtn.addEventListener("click", async () => {
  // Build the query string outside getURL — it takes a path, and a version that
  // escapes or drops the "?" would open the popup layout instead of the window one.
  // The vault goes along by name: from its own tab the window cannot tell which
  // of several open Vault tabs the panel was working in.
  const query = new URLSearchParams({ mode: "window" });
  if (state.domain) query.set("vault", state.domain);
  if (handoffLoads()) query.set("resume", handoffLoads());
  const url = `${chrome.runtime.getURL("popup.html")}?${query}`;
  await chrome.tabs.create({ url });
  closeOverlay();
});

// Only close this tab once the overlay is actually back up, so a missing Vault
// tab or an uninjected content script can't collapse the panel into nothing.
collapseBtn.addEventListener("click", async () => {
  const vaultTabs = await chrome.tabs.query({ url: "https://*.veevavault.com/*" });
  // Back into the vault this window was working in, not whichever Vault tab
  // happens to be listed first.
  const tab = vaultTabs.find((t) => hostOf(t.url) === state.domain) || vaultTabs[0];
  if (!tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { action: "openOverlay", resume: handoffLoads() });
  } catch (e) {
    return;
  }
  await chrome.tabs.update(tab.id, { active: true });
  window.close();
});

closeBtn.addEventListener("click", () => {
  if (WINDOW_MODE) window.close();
  else closeOverlay();
});

// The overlay lives in an iframe owned by content.js on the Vault page; only it
// can tear the wrapper down.
function closeOverlay() {
  window.parent.postMessage({ type: "vault-dweller-close" }, "*");
}

// The iframe wrapper has no intrinsic height, so it would leave dead space below
// a short panel. Report the real content height and let content.js shrink-wrap.
// Absolutely-positioned overlays don't grow .shell, so measure them separately
// or they get clipped by the resized iframe.
if (!WINDOW_MODE) {
  const shell = document.querySelector(".shell");
  const floatingPanels = [acDropdown, dateMenu];
  let lastHeight = 0;

  const reportHeight = () => {
    let bottom = shell.getBoundingClientRect().bottom;
    for (const el of floatingPanels) {
      if (el && !el.classList.contains("hidden")) {
        bottom = Math.max(bottom, el.getBoundingClientRect().bottom + 12);
      }
    }
    const height = Math.ceil(bottom);
    if (height === lastHeight) return;
    lastHeight = height;
    window.parent.postMessage({ type: "vault-dweller-height", height }, "*");
  };

  // Polled rather than observed. The height changes from many places — results,
  // tree, popovers, dropdowns, inline edit rows — and a ResizeObserver on .shell
  // misses some of them, leaving the iframe the wrong size until the next
  // interaction. The check is a single rect read and only posts on a change.
  reportHeight();
  setInterval(reportHeight, 200);
}

// ===================== INIT =====================
document.addEventListener("DOMContentLoaded", async () => {
  const saved = await chrome.storage.local.get([
    "vaultDomain", "queryHistory", "dataModels", "dataModel", "dataModelTime", "queryTabs", "queryLimit",
  ]);
  if (saved.vaultDomain) domainInput.value = saved.vaultDomain;
  if (saved.queryHistory) state.history = saved.queryHistory;
  // Per-instance data model loading happens after autoConnect resolves the current domain.
  // Legacy single-key storage is migrated lazily inside loadDataModelForDomain().
  if (WINDOW_MODE) initWorkbench(saved);
  renderHistory();

  try {
    let domain = handedVault();
    if (!domain) {
      // Look for a Vault tab across all windows (popup runs in its own window).
      // From the full window the extension's own tab is the active one, so the
      // vault last connected to is a better guess than "active" there.
      const vaultTabs = await chrome.tabs.query({ url: "https://*.veevavault.com/*" });
      let tab =
        (WINDOW_MODE && vaultTabs.find((t) => hostOf(t.url) === saved.vaultDomain)) ||
        vaultTabs.find((t) => t.active) ||
        vaultTabs[0];
      if (!tab) {
        [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      }
      domain = hostOf(tab?.url);
    }
    if (isVaultHost(domain)) {
      domainInput.value = domain;
      autoConnect(domain);
    }
  } catch (e) {
    // user can connect manually
  }
});

// The vault this page was opened for, when that is known rather than guessed:
// the overlay from the Vault page it is embedded in, the full window from the
// panel that opened it. Guessing from open tabs picked the wrong vault whenever
// more than one was open.
function handedVault() {
  const known = [PAGE_PARAMS.get("vault")];
  if (!WINDOW_MODE && location.ancestorOrigins?.length) {
    known.unshift(hostOf(location.ancestorOrigins[0]));
  }
  return known.find(isVaultHost) || null;
}

// ===================== TABS =====================
function activatePane(name) {
  $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  $$(".tab-content").forEach((c) => c.classList.toggle("active", c.id === `tab-${name}`));
  // Full-window mode force-shows panes as a sidebar plus a main column, so the
  // layout has to know which pane owns the main column.
  vqlPanel.dataset.activeTab = name;
}

$$(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    activatePane(tab.dataset.tab);
    if (tab.dataset.tab === "ask") refreshAskAvailability();
  });
});

// Segmented control: sliding thumb + drag-to-switch, used by the topbar tabs.
// The thumb is measured from real geometry rather than an equal-share
// calculation: options are flex:1 but cannot shrink below their label, so they
// are genuinely unequal, and the topbar hides one option in full-window mode.
// Whoever sets `.active` owns selection; this just follows it.
function initSegmented(rootEl, optSelector, thumbSelector) {
  if (!rootEl) return () => {};
  const thumb = rootEl.querySelector(thumbSelector);
  const opts = Array.from(rootEl.querySelectorAll(optSelector));
  if (!thumb || !opts.length) return () => {};

  const paint = () => {
    const active = opts.find((b) => b.classList.contains("active"));
    // No layout yet (panel still hidden) or the active option isn't rendered.
    if (!active || active.offsetParent === null) {
      thumb.style.opacity = "0";
      return;
    }
    // offsetLeft/offsetWidth, not getBoundingClientRect: rects are in
    // transformed coordinates, and the popover this can sit inside animates a
    // scale() on open — measuring mid-animation would bake the scale into the
    // CSS lengths. Both roots are position:relative, so an option's offsetParent
    // is the root, which is also the thumb's containing block.
    if (!active.offsetWidth) {
      thumb.style.opacity = "0";
      return;
    }
    thumb.style.opacity = "1";
    thumb.style.left = `${active.offsetLeft}px`;
    thumb.style.width = `${active.offsetWidth}px`;
  };

  paint();
  const obs = new MutationObserver(paint);
  opts.forEach((b) => obs.observe(b, { attributes: true, attributeFilter: ["class"] }));

  // Label widths move once the webfont lands, and the overlay is resizable.
  window.addEventListener("resize", paint);
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(paint).catch(() => {});
  }

  // Press-and-drag across the bar to switch. The native click on pointerdown
  // handles the initial selection; pointermove fires .click() only when the
  // hit-tested option changes, so we don't double-trigger the active one.
  const optAtX = (clientX) => {
    const visible = opts.filter((b) => b.offsetParent !== null);
    if (!visible.length) return null;
    let nearest = visible[0];
    let nearestGap = Infinity;
    for (const b of visible) {
      const r = b.getBoundingClientRect();
      if (clientX >= r.left && clientX <= r.right) return b;
      const gap = clientX < r.left ? r.left - clientX : clientX - r.right;
      if (gap < nearestGap) {
        nearestGap = gap;
        nearest = b;
      }
    }
    return nearest;
  };

  rootEl.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    rootEl.classList.add("dragging");
    let last = optAtX(e.clientX);
    const onMove = (ev) => {
      const t = optAtX(ev.clientX);
      if (t && t !== last) { last = t; t.click(); }
    };
    const onUp = () => {
      rootEl.classList.remove("dragging");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  });

  return paint;
}

const paintTabThumb = initSegmented($(".tabs"), ".tab", ".tab-thumb");

// ===================== CONNECTION =====================
async function autoConnect(domain) {
  // The one gate every connection passes through, whether the domain came from
  // a tab, from storage, or from the field.
  if (!isVaultHost(domain)) {
    setStatus("disconnected", "Not a Vault domain.");
    return;
  }
  setStatus("connecting", "Connecting...");
  chrome.storage.local.set({ vaultDomain: domain });

  const tokenResult = await chrome.runtime.sendMessage({
    action: "getToken",
    domain: domain,
  });

  if (!tokenResult.success) {
    setStatus("disconnected", tokenResult.error);
    return;
  }

  state.sessionId = tokenResult.token;
  state.domain = domain;
  setStatus("connecting", "Validating session via /objects/users/me...");

  const userResult = await chrome.runtime.sendMessage({
    action: "apiCall",
    domain: domain,
    sessionId: state.sessionId,
    endpoint: "/objects/users/me",
    method: "GET",
  });

  if (!userResult.success || userResult.data?.responseStatus === "FAILURE") {
    const errMsg =
      userResult.data?.errors?.[0]?.message || userResult.error || "Authentication failed";
    setStatus("disconnected", errMsg);
    state.sessionId = null;
    return;
  }

  state.user = userResult.data;
  setStatus("connected", "Connected");
  showUserInfo(userResult.data);
  showVqlPanel();

  // Per-instance data model and document types: load from storage if present,
  // else the chips prompt the user.
  await loadDataModelForDomain(domain);
  await loadDocTypesForDomain(domain);
  resumeHandedLoads();
}

function resumeHandedLoads() {
  if (!handedLoads.has("model") && !handedLoads.has("types")) return;
  if (handedLoads.has("model")) loadDataModel();
  if (handedLoads.has("types")) loadDocTypes();
  handedLoads.clear();
  // Once only: a reload of this page shouldn't start the loads over again.
  const url = new URL(location.href);
  url.searchParams.delete("resume");
  history.replaceState(null, "", url);
}

// Per-vault caches share chrome.storage.local's 10 MB with every other vault
// loaded before. If a write doesn't fit, keep only this vault's entry and try
// once more: the others can be loaded again, this one was just paid for.
async function saveVaultCache(key, domain, entry) {
  const all = (await chrome.storage.local.get([key]))[key] || {};
  all[domain] = entry;
  try {
    await chrome.storage.local.set({ [key]: all });
  } catch (e) {
    await chrome.storage.local.set({ [key]: { [domain]: entry } });
  }
}

// Another view of the same vault — the panel in a Vault tab, the full window in
// its own tab — can load the model or the types while this one is open. Take
// what it saved instead of offering to load it again. A view's own saves come
// back here too; the timestamps tell them apart.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !state.domain) return;
  const model = changes.dataModels?.newValue?.[state.domain];
  if (model?.model && model.time !== dataModelTime && !modelLoading) {
    state.dataModel = model.model;
    onDataModelLoaded(model.time);
  }
  const types = changes.docTypeCache?.newValue?.[state.domain];
  if (types?.types?.length && types.time !== docTypesTime && !dtLoading && !dtCounting) {
    applyDocTypes(types.types, types.time);
  }
});

// ===================== PER-INSTANCE DATA MODEL =====================
async function loadDataModelForDomain(domain) {
  dmExpanded.clear();
  dmShowAll.clear();
  await loadFieldStatsForDomain(domain);
  const store = await chrome.storage.local.get(["dataModels", "dataModel", "dataModelTime", "vaultDomain"]);
  let dataModels = store.dataModels || {};

  // One-time migration: if we have a legacy single dataModel, attribute it to its original vault.
  if (store.dataModel && store.vaultDomain && !dataModels[store.vaultDomain]) {
    dataModels[store.vaultDomain] = { model: store.dataModel, time: store.dataModelTime || null };
    await chrome.storage.local.set({ dataModels });
    await chrome.storage.local.remove(["dataModel", "dataModelTime"]);
  }

  const entry = dataModels[domain];
  if (entry && entry.model) {
    state.dataModel = entry.model;
    onDataModelLoaded(entry.time);
  } else {
    state.dataModel = null;
    setChipState("idle");
    renderDataModelTree("");
  }
}

function setStatus(type, text) {
  statusPill.className = `status-pill ${type}`;
  // Connected collapses to a bare dot in the overlay, so the message has to
  // survive as a tooltip. In the full window the pill names the vault instead.
  const connectedInWindow = type === "connected" && WINDOW_MODE && state.domain;
  statusText.textContent = connectedInWindow ? state.domain : text;
  statusPill.title = connectedInWindow ? `Connected — ${state.domain}` : text;
}

// Who, where, and with what rights — the three things worth knowing at a glance.
// user_name__v is the login and is usually the same string as user_email__v, so
// showing both said one thing twice; the rest (vault id, the duplicate address)
// moved into the tooltip rather than costing a row each.
function showUserInfo(data) {
  const u = data.users?.[0]?.user || data;
  const name = [u.user_first_name__v, u.user_last_name__v].filter(Boolean).join(" ");
  const login = u.user_name__v || u.user_email__v || "";
  const primary = name || login;

  if (!primary) {
    // Unexpected payload shape — show it rather than an empty panel.
    userDetails.innerHTML = `<div class="whoami-raw">${esc(
      JSON.stringify(data).slice(0, 200)
    )}</div>`;
  } else {
    const secondary = login && login !== primary ? login : "";
    const chips = [u.security_profile__v, state.domain].filter(Boolean);
    const tip = [
      name && login ? `${name} · ${login}` : primary,
      u.user_email__v && u.user_email__v !== login ? u.user_email__v : "",
      u.vault_id__v ? `Vault ID ${u.vault_id__v}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    userDetails.innerHTML =
      `<div class="whoami-who" title="${esc(tip)}">` +
      `<div class="whoami-name">${esc(primary)}</div>` +
      (secondary ? `<div class="whoami-login">${esc(secondary)}</div>` : "") +
      "</div>" +
      (chips.length
        ? `<div class="whoami-chips">${chips
            .map((c) => `<span class="whoami-chip">${esc(c)}</span>`)
            .join("")}</div>`
        : "");
  }
  whoamiBtn.classList.remove("hidden");

  // Only the full window shows this; the pill has room for the address, and the
  // security profile rides along in the tooltip.
  const who = [u.user_email__v || u.user_name__v, u.security_profile__v].filter(Boolean);
  topbarUser.textContent = who[0] || "";
  topbarUser.title = who.join(" · ");
}

function showVqlPanel() {
  connectionPanel.classList.add("hidden");
  vqlPanel.classList.remove("hidden");
  disconnectBtn.classList.remove("hidden");
  historyBtn.classList.remove("hidden");
  vqlInput.focus();
  paintTabThumb();
  // The editor was sized while hidden, when it measured nothing.
  if (WINDOW_MODE) paintEditor();
}

// ===================== DISCONNECT =====================
disconnectBtn.addEventListener("click", () => {
  state.sessionId = null;
  state.domain = null;
  state.user = null;
  state.dataModel = null;
  vqlPanel.classList.add("hidden");
  connectionPanel.classList.remove("hidden");
  disconnectBtn.classList.add("hidden");
  historyBtn.classList.add("hidden");
  historyPopover.classList.add("hidden");
  whoamiBtn.classList.add("hidden");
  whoamiPopover.classList.add("hidden");
  setStatus("disconnected", "Disconnected");
  topbarUser.textContent = "";
  dmCounts.textContent = "";
  setChipState("idle");
  dmPanel.classList.add("hidden");
  dmEmptyState.classList.remove("hidden");
  dmTree.innerHTML = "";
  dmExpanded.clear();
  dmShowAll.clear();
  fieldStats = {};
  fieldStatsFailed.clear();
  clearTimeout(fieldStatsTimer);
  docTypes = [];
  docTypesTime = null;
  dataModelTime = null;
  dtSelected = null;
  dtLayout.classList.add("hidden");
  dtTree.innerHTML = "";
  dtFields.innerHTML = "";
  dtEmpty.classList.remove("hidden");
  setDtChipState("idle");
  resultsContainer.innerHTML = "";
  setResultsShown(false);
  queryTime.textContent = "";
  lastResultData = null;
  resetResultsView();
});

// Popover toggles — close others when opening one
function closeAllPopovers() {
  whoamiPopover.classList.add("hidden");
  historyPopover.classList.add("hidden");
}

whoamiBtn.addEventListener("click", () => {
  const wasHidden = whoamiPopover.classList.contains("hidden");
  closeAllPopovers();
  if (wasHidden) {
    whoamiPopover.classList.remove("hidden");
    refreshAiKeyState();
  }
});

whoamiClose.addEventListener("click", closeAllPopovers);

historyBtn.addEventListener("click", () => {
  const wasHidden = historyPopover.classList.contains("hidden");
  closeAllPopovers();
  if (wasHidden) historyPopover.classList.remove("hidden");
});

// ===================== RUN VQL =====================
runBtn.addEventListener("click", runQuery);
cancelBtn.addEventListener("click", () => {
  if (!activeQueryToken) return;
  activeQueryToken.aborted = true;
  cancelBtn.disabled = true;
  cancelBtn.innerHTML = "Cancelling...";
  // resetButton() in runQuery will hide the button once the in-flight
  // request settles and restore its label/disabled state for next time.
});

// Clears the editor and the results together — a results table left standing
// under an empty editor no longer corresponds to anything, and its export
// buttons would hand back rows for a query that isn't on screen.
clearBtn.addEventListener("click", () => {
  vqlInput.value = "";
  editorChanged();
  historyNavIndex = -1;
  hideAc();
  resultsContainer.innerHTML = "";
  resultsContainer.style.maxHeight = "";
  setResultsShown(false);
  queryTime.textContent = "";
  lastResultData = null;
  queryRows = [];
  pendingEdits = {};
  resetResultsView();
  updateSaveBar();
  vqlInput.focus();
});

vqlInput.addEventListener("keydown", (e) => {
  // Autocomplete navigation
  if (!acDropdown.classList.contains("hidden")) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      acIndex = Math.min(acIndex + 1, acItems.length - 1);
      renderAcSelection();
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      acIndex = Math.max(acIndex - 1, 0);
      renderAcSelection();
      return;
    }
    if (e.key === "Tab" || e.key === "Enter") {
      if (acIndex >= 0 && acItems[acIndex]) {
        e.preventDefault();
        insertAcItem(acItems[acIndex]);
        hideAc();
        return;
      }
    }
    if (e.key === "Escape") {
      hideAc();
      return;
    }
  }

  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    e.preventDefault();
    runQuery();
    return;
  }

  // Tab on an empty textarea fills it with the placeholder query as a starting
  // template. Only triggers when empty so Tab still works as focus-shift /
  // indent in normal editing.
  if (e.key === "Tab" && !e.shiftKey && vqlInput.value.length === 0) {
    const template = vqlInput.getAttribute("placeholder") || "";
    if (template) {
      e.preventDefault();
      vqlInput.value = template;
      vqlInput.setSelectionRange(template.length, template.length);
      editorChanged();
      return;
    }
  }

  // History navigation via Down/Up — only kicks in when the textarea is empty
  // (or when already cycling through history) so it never fights normal cursor
  // movement inside an in-progress query.
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    const navigable = state.history.slice(0, HISTORY_NAV_LIMIT);
    if (navigable.length === 0) return;
    const isEmpty = vqlInput.value.length === 0;

    if (e.key === "ArrowDown") {
      if (historyNavIndex === -1 && !isEmpty) return;
      e.preventDefault();
      historyNavIndex = Math.min(historyNavIndex + 1, navigable.length - 1);
      vqlInput.value = navigable[historyNavIndex].query;
      vqlInput.setSelectionRange(vqlInput.value.length, vqlInput.value.length);
      editorChanged();
      return;
    }

    // ArrowUp only meaningful while already navigating.
    if (historyNavIndex === -1) return;
    e.preventDefault();
    historyNavIndex -= 1;
    if (historyNavIndex < 0) {
      historyNavIndex = -1;
      vqlInput.value = "";
    } else {
      vqlInput.value = navigable[historyNavIndex].query;
      vqlInput.setSelectionRange(vqlInput.value.length, vqlInput.value.length);
    }
    editorChanged();
  }
});

vqlInput.addEventListener("input", () => {
  // Any manual edit exits history-navigation mode.
  historyNavIndex = -1;
  editorChanged();
  showAutocomplete();
});

// Operator chips above the textarea — insert keyword at cursor with
// surrounding spaces, and (for value-taking operators) drop the cursor
// inside an empty literal so the user can type the value immediately.
const OPERATOR_TEMPLATES = {
  // [textToInsert, cursorOffsetFromStartOfInsert]
  // null offset = cursor goes to end of insert.
  WHERE:    ["WHERE ", null],
  AND:      ["AND ", null],
  CONTAINS: ["CONTAINS ('')", 11],
  LIKE:     ["LIKE ''", 6],
  EQ:       ["= ''", 3],
};

function insertAtCursor(text, cursorOffset = null) {
  const pos = vqlInput.selectionStart;
  const before = vqlInput.value.slice(0, pos);
  const after = vqlInput.value.slice(pos);
  const needsSpace =
    before.length > 0 && !/[\s(]$/.test(before);
  const lead = needsSpace ? " " : "";
  vqlInput.value = before + lead + text + after;
  const insertStart = pos + lead.length;
  const newPos = cursorOffset != null
    ? insertStart + cursorOffset
    : insertStart + text.length;
  vqlInput.setSelectionRange(newPos, newPos);
  vqlInput.focus();
  editorChanged();
  // Reset history navigation since the user is now editing.
  historyNavIndex = -1;
}

document.getElementById("operator-bar").addEventListener("click", (e) => {
  const chip = e.target.closest(".op-chip");
  if (!chip) return;
  const tpl = OPERATOR_TEMPLATES[chip.dataset.op];
  if (!tpl) return;
  insertAtCursor(tpl[0], tpl[1]);
});

// ===================== DATE CHIP =====================
// Vault wants an ISO-8601 instant; toISOString() already emits exactly the
// 2024-03-02T15:47:44.000Z shape. Anchoring to midnight UTC keeps a query
// stable when it is re-run later the same day.
function isoMidnightDaysAgo(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

function isoMidnightYearsAgo(years) {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

function closeDateMenu() {
  dateMenu.classList.add("hidden");
  dateChip.setAttribute("aria-expanded", "false");
}

function insertDateLiteral(iso) {
  insertAtCursor(`'${iso}'`);
  closeDateMenu();
}

function clampYears() {
  const n = Math.floor(Number(dateYears.value));
  return Number.isFinite(n) ? Math.min(99, Math.max(1, n)) : 1;
}

function renderDatePreview() {
  datePreview.textContent = isoMidnightYearsAgo(clampYears());
}

dateChip.addEventListener("click", () => {
  const willOpen = dateMenu.classList.contains("hidden");
  dateMenu.classList.toggle("hidden", !willOpen);
  dateChip.setAttribute("aria-expanded", String(willOpen));
  if (willOpen) renderDatePreview();
});

dateMenu.addEventListener("click", (e) => {
  const item = e.target.closest(".date-menu-item");
  if (item) insertDateLiteral(isoMidnightDaysAgo(Number(item.dataset.days)));
});

dateYears.addEventListener("input", renderDatePreview);
dateYears.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    insertDateLiteral(isoMidnightYearsAgo(clampYears()));
  }
});
dateYearsGo.addEventListener("click", () => {
  insertDateLiteral(isoMidnightYearsAgo(clampYears()));
});

document.addEventListener("click", (e) => {
  if (!dateMenu.classList.contains("hidden") && !e.target.closest(".date-chip-wrap")) {
    closeDateMenu();
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeDateMenu();
});

const FETCH_ALL_PAGE_SIZE = 1000;
const FETCH_ALL_CONCURRENCY = 5;
// Vault rejects PAGEOFFSET values above 10,000. With PAGESIZE 1000 the highest
// safe offset is 9,000 (returns rows 9000-9999). Beyond that, follow
// responseDetails.next_page tokens, which have no cap but are sequential.
const VAULT_PAGEOFFSET_LIMIT = 10000;
// Beyond this many pages (~100k rows), in-popup table rendering becomes
// painfully slow, so we skip the table and auto-download the results as xlsx.
const AUTO_EXPORT_PAGE_THRESHOLD = 100;

// Strip trailing top-level paging/sizing clauses so we can inject our own.
// Only strips what's at the very end of the statement — subqueries are untouched.
function stripVqlTrailingPaging(q) {
  let out = q.trim().replace(/;\s*$/, "");
  while (true) {
    const m = out.match(/\s+(PAGESIZE|PAGEOFFSET|LIMIT|OFFSET|MAXROWS)\s+\d+\s*$/i);
    if (!m) break;
    out = out.slice(0, m.index).trim();
  }
  return out;
}

// Extract a top-level LIMIT n (if any) so we can honor it as a cap on total rows.
function extractVqlTopLimit(q) {
  const m = q.match(/\bLIMIT\s+(\d+)\s*(?:OFFSET\s+\d+\s*)?(?:PAGESIZE\s+\d+\s*)?(?:PAGEOFFSET\s+\d+\s*)?(?:MAXROWS\s+\d+\s*)?;?\s*$/i);
  return m ? parseInt(m[1], 10) : null;
}

async function runQuery() {
  const raw = vqlInput.value.trim();
  if (!raw) return;
  if (!state.sessionId) {
    showError("Not connected. Please connect first.");
    return;
  }

  hideAc();
  runBtn.disabled = true;
  runBtn.innerHTML = '<span class="spinner"></span> Running...';
  cancelBtn.classList.remove("hidden");
  queryTime.textContent = "";
  resultsContainer.innerHTML = "";
  setResultsShown(false);
  lastResultData = null;
  resetResultsView();

  const token = { aborted: false };
  activeQueryToken = token;
  setQueryBusy(true);

  // A LIMIT written in the query wins over the toolbar's Limit.
  const userLimit = extractVqlTopLimit(raw) ?? uiRowLimit();
  const baseQuery = stripVqlTrailingPaging(raw);
  const startTime = performance.now();

  // --- First page: also tells us responseDetails.total ---
  // Under a limit smaller than a page, ask for just that many rows; the page
  // count below then comes out as one and nothing more is fetched.
  const firstPageSize = userLimit != null && userLimit > 0
    ? Math.min(FETCH_ALL_PAGE_SIZE, userLimit)
    : FETCH_ALL_PAGE_SIZE;
  const firstQ = `${baseQuery} PAGESIZE ${firstPageSize} PAGEOFFSET 0`;
  const firstResult = await apiCall("/query", "POST", `q=${encodeURIComponent(firstQ)}`);

  const resetButton = () => {
    runBtn.disabled = false;
    runBtn.innerHTML = RUN_LABEL;
    cancelBtn.classList.add("hidden");
    cancelBtn.disabled = false;
    cancelBtn.innerHTML = "Cancel";
    if (activeQueryToken === token) activeQueryToken = null;
    setQueryBusy(false);
  };

  const handleAbort = () => {
    resultsContainer.innerHTML = '<div class="result-message info">Query cancelled.</div>';
    resetButton();
  };

  if (token.aborted) { handleAbort(); return; }

  if (!firstResult.success) {
    showError(firstResult.error);
    resetButton();
    return;
  }

  const firstData = firstResult.data;
  if (firstData.responseStatus === "FAILURE") {
    const errMsg = firstData.errors?.map((e) => `${e.type}: ${e.message}`).join("\n") || "Query failed";
    showError(errMsg);
    addToHistory(raw, false);
    resetButton();
    return;
  }

  const reportedTotal = firstData.responseDetails?.total;
  const firstPageRows = firstData.data || [];
  const effectiveTotal = userLimit != null
    ? Math.min(userLimit, reportedTotal ?? firstPageRows.length)
    : (reportedTotal ?? firstPageRows.length);
  const pagesNeeded = Math.max(1, Math.ceil(effectiveTotal / FETCH_ALL_PAGE_SIZE));

  // Phase 1: parallel PAGEOFFSET fan-out, capped at Vault's 10,000 ceiling.
  const maxParallelPages = Math.floor(VAULT_PAGEOFFSET_LIMIT / FETCH_ALL_PAGE_SIZE); // 10
  const parallelPages = Math.min(pagesNeeded, maxParallelPages);
  // Store full responses so we can read next_page from the last one for Phase 2.
  const parallelResponses = new Array(parallelPages);
  parallelResponses[0] = firstData;

  let failure = null;
  let completed = 1;
  const totalLabel = pagesNeeded > maxParallelPages ? `${pagesNeeded}+` : `${pagesNeeded}`;
  const updateProgress = () => {
    runBtn.innerHTML = `<span class="spinner"></span> ${completed}/${totalLabel} pages`;
  };

  if (parallelPages > 1) {
    updateProgress();
    const offsetsToFetch = [];
    for (let p = 1; p < parallelPages; p++) offsetsToFetch.push(p * FETCH_ALL_PAGE_SIZE);

    const worker = async () => {
      while (offsetsToFetch.length && !failure && !token.aborted) {
        const off = offsetsToFetch.shift();
        const pageIndex = off / FETCH_ALL_PAGE_SIZE;
        const q = `${baseQuery} PAGESIZE ${FETCH_ALL_PAGE_SIZE} PAGEOFFSET ${off}`;
        const res = await apiCall("/query", "POST", `q=${encodeURIComponent(q)}`);
        if (failure || token.aborted) return;
        if (!res.success) { failure = res.error || "Network error"; return; }
        if (res.data?.responseStatus === "FAILURE") {
          failure = res.data.errors?.map((e) => `${e.type}: ${e.message}`).join("\n") || "Page query failed";
          return;
        }
        parallelResponses[pageIndex] = res.data;
        completed++;
        updateProgress();
      }
    };

    const workerCount = Math.min(FETCH_ALL_CONCURRENCY, parallelPages - 1);
    await Promise.all(Array.from({ length: workerCount }, worker));
  }

  if (token.aborted) { handleAbort(); return; }

  if (failure) {
    showError(`Query failed: ${failure}`);
    resetButton();
    return;
  }

  const merged = [];
  for (const resp of parallelResponses) {
    if (resp?.data) merged.push(...resp.data);
  }

  // Phase 2: follow next_page tokens for results beyond the 10,000-row cap.
  // Sequential by necessity — each page's URL is only known from the previous response.
  if (pagesNeeded > parallelPages || (userLimit == null && reportedTotal == null)) {
    let nextPage = parallelResponses[parallelPages - 1]?.responseDetails?.next_page;
    while (nextPage && !token.aborted && (userLimit == null || merged.length < userLimit)) {
      const res = await apiCall(nextPage, "GET");
      if (token.aborted) break;
      if (!res.success) { failure = res.error || "Network error"; break; }
      if (res.data?.responseStatus === "FAILURE") {
        failure = res.data.errors?.map((e) => `${e.type}: ${e.message}`).join("\n") || "Page query failed";
        break;
      }
      const pageRows = res.data?.data || [];
      if (pageRows.length === 0) break;
      merged.push(...pageRows);
      completed++;
      updateProgress();
      nextPage = res.data?.responseDetails?.next_page;
    }
  }

  if (token.aborted) { handleAbort(); return; }

  if (failure) {
    showError(`Query failed: ${failure}`);
    resetButton();
    return;
  }

  const finalRows = userLimit != null ? merged.slice(0, userLimit) : merged;

  const elapsedMs = performance.now() - startTime;
  const elapsed = (elapsedMs / 1000).toFixed(2);
  queryTime.textContent = completed > 1
    ? `${elapsed}s · ${completed} pages`
    : `${elapsed}s`;

  resetButton();

  // Combined response so Copy/CSV/Excel operate on the full set.
  lastResultData = {
    ...firstData,
    data: finalRows,
    responseDetails: {
      ...(firstData.responseDetails || {}),
      total: finalRows.length,
      pagesize: finalRows.length,
      pageoffset: 0,
    },
  };
  addToHistory(raw, true);

  if (finalRows.length > 0) {
    const ofTotal = reportedTotal != null && reportedTotal > finalRows.length ? ` of ${reportedTotal}` : "";
    if (WINDOW_MODE) {
      // Rows and time in one readout; the run button no longer has a line under
      // it for the timing to sit on.
      const n = finalRows.length;
      const pages = completed > 1 ? ` · ${completed} pages` : "";
      const of = ofTotal ? ` of ${reportedTotal.toLocaleString()}` : "";
      resultsCount.textContent =
        `${n.toLocaleString()}${of} row${n !== 1 ? "s" : ""} · ${formatMs(elapsedMs)}${pages}`;
    } else {
      resultsCount.textContent = `${finalRows.length} record${finalRows.length !== 1 ? "s" : ""}${ofTotal}`;
    }
    setResultsShown(true);
    // Large result sets: skip the in-popup table render (it would freeze the UI)
    // and stream straight to an xlsx download. Copy/CSV/Excel buttons remain
    // available so the user can re-export from lastResultData if needed.
    const autoExport = pagesNeeded > AUTO_EXPORT_PAGE_THRESHOLD || completed > AUTO_EXPORT_PAGE_THRESHOLD;
    if (autoExport) {
      downloadXlsx(finalRows);
      resultsContainer.innerHTML = `<div class="result-message info">Large result set (${finalRows.length} records, ${completed} pages) &mdash; auto-downloaded as Excel. Table render skipped to keep the popup responsive.</div>`;
    } else {
      renderTable(finalRows);
    }
  } else {
    resultsContainer.innerHTML = '<div class="result-message info">Query returned no results.</div>';
    setResultsShown(false);
  }
}

// Every caller that hid or showed the header now goes through here, because the
// full window keeps the "Results" heading up and only hides the controls.
function setResultsShown(on) {
  resultsPanel.classList.toggle("has-results", on);
}

function showError(msg) {
  resultsContainer.innerHTML = `<div class="result-message error">${esc(msg)}</div>`;
}

// ===================== COPY / EXPORT =====================
copyBtn.addEventListener("click", () => {
  if (lastResultData) {
    navigator.clipboard.writeText(JSON.stringify(lastResultData, null, 2));
    copyBtn.textContent = "Copied!";
    setTimeout(() => (copyBtn.textContent = "Copy JSON"), 1500);
  }
});

exportCsvBtn.addEventListener("click", () => {
  if (!lastResultData?.data?.length) return;
  const rows = lastResultData.data;
  const keys = Object.keys(rows[0]);
  let csv = keys.map(csvEsc).join(",") + "\n";
  for (const row of rows) csv += keys.map((k) => csvEsc(row[k] ?? "")).join(",") + "\n";
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `vql_results_${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

// Excel, Sheets and LibreOffice treat a leading =, +, @, tab or CR as the
// start of a formula, so a value stored in Vault can run on whoever opens the
// export. The apostrophe forces the cell to text and is stripped on display.
// A leading "-" is left alone for a plain negative number — prefixing those
// would turn real figures into text.
function csvEsc(val) {
  let str = String(val);
  const formulaRisk =
    /^[=+@\t\r]/.test(str) || (str.startsWith("-") && !/^-\d+(\.\d+)?$/.test(str));
  if (formulaRisk) str = `'${str}`;
  if (str.includes(",") || str.includes('"') || str.includes("\n")) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

// ===================== EXPORT EXCEL =====================
const exportXlsxBtn = $("#export-xlsx-btn");

function buildXlsxBlob(rows) {
  const keys = Object.keys(rows[0]);

  // Build sheet XML
  const xmlEsc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  let sheetRows = "";
  // Header row
  sheetRows += "<row>";
  for (const key of keys) {
    sheetRows += `<c t="inlineStr"><is><t>${xmlEsc(key)}</t></is></c>`;
  }
  sheetRows += "</row>";

  // Data rows
  for (const row of rows) {
    sheetRows += "<row>";
    for (const key of keys) {
      const val = row[key];
      if (val === null || val === undefined) {
        sheetRows += `<c t="inlineStr"><is><t></t></is></c>`;
      } else if (typeof val === "number") {
        sheetRows += `<c><v>${val}</v></c>`;
      } else {
        sheetRows += `<c t="inlineStr"><is><t>${xmlEsc(String(val))}</t></is></c>`;
      }
    }
    sheetRows += "</row>";
  }

  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetData>${sheetRows}</sheetData>
</worksheet>`;

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Results" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  // Build ZIP using minimal zip implementation
  const zip = new SimpleZip();
  zip.addFile("[Content_Types].xml", contentTypes);
  zip.addFile("_rels/.rels", rels);
  zip.addFile("xl/workbook.xml", workbook);
  zip.addFile("xl/_rels/workbook.xml.rels", workbookRels);
  zip.addFile("xl/worksheets/sheet1.xml", sheet);

  return zip.toBlob();
}

function downloadXlsx(rows, filename) {
  const blob = buildXlsxBlob(rows);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || `vql_results_${Date.now()}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

exportXlsxBtn.addEventListener("click", () => {
  if (!lastResultData?.data?.length) return;
  downloadXlsx(lastResultData.data);
});

// Minimal ZIP builder (no compression, store only — works for xlsx)
class SimpleZip {
  constructor() { this.files = []; }

  addFile(name, content) {
    const data = new TextEncoder().encode(content);
    this.files.push({ name: new TextEncoder().encode(name), data });
  }

  toBlob() {
    const localHeaders = [];
    const centralHeaders = [];
    let offset = 0;

    for (const file of this.files) {
      const crc = this._crc32(file.data);
      const localHeader = this._buildLocalHeader(file.name, file.data, crc);
      localHeaders.push(localHeader, file.data);

      const centralHeader = this._buildCentralHeader(file.name, file.data, crc, offset);
      centralHeaders.push(centralHeader);

      offset += localHeader.byteLength + file.data.byteLength;
    }

    const centralDirSize = centralHeaders.reduce((s, h) => s + h.byteLength, 0);
    const endRecord = this._buildEndRecord(this.files.length, centralDirSize, offset);

    return new Blob([...localHeaders, ...centralHeaders, endRecord], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
  }

  _buildLocalHeader(name, data, crc) {
    const buf = new ArrayBuffer(30 + name.byteLength);
    const view = new DataView(buf);
    view.setUint32(0, 0x04034b50, true); // signature
    view.setUint16(4, 20, true); // version needed
    view.setUint16(6, 0, true);  // flags
    view.setUint16(8, 0, true);  // compression (store)
    view.setUint16(10, 0, true); // mod time
    view.setUint16(12, 0, true); // mod date
    view.setUint32(14, crc, true);
    view.setUint32(18, data.byteLength, true); // compressed
    view.setUint32(22, data.byteLength, true); // uncompressed
    view.setUint16(26, name.byteLength, true);
    view.setUint16(28, 0, true); // extra field length
    new Uint8Array(buf, 30).set(name);
    return new Uint8Array(buf);
  }

  _buildCentralHeader(name, data, crc, localOffset) {
    const buf = new ArrayBuffer(46 + name.byteLength);
    const view = new DataView(buf);
    view.setUint32(0, 0x02014b50, true); // signature
    view.setUint16(4, 20, true);  // version made by
    view.setUint16(6, 20, true);  // version needed
    view.setUint16(8, 0, true);   // flags
    view.setUint16(10, 0, true);  // compression
    view.setUint16(12, 0, true);  // mod time
    view.setUint16(14, 0, true);  // mod date
    view.setUint32(16, crc, true);
    view.setUint32(20, data.byteLength, true);
    view.setUint32(24, data.byteLength, true);
    view.setUint16(28, name.byteLength, true);
    view.setUint16(30, 0, true);  // extra
    view.setUint16(32, 0, true);  // comment
    view.setUint16(34, 0, true);  // disk
    view.setUint16(36, 0, true);  // internal attrs
    view.setUint32(38, 0, true);  // external attrs
    view.setUint32(42, localOffset, true);
    new Uint8Array(buf, 46).set(name);
    return new Uint8Array(buf);
  }

  _buildEndRecord(count, centralSize, centralOffset) {
    const buf = new ArrayBuffer(22);
    const view = new DataView(buf);
    view.setUint32(0, 0x06054b50, true);
    view.setUint16(4, 0, true);  // disk
    view.setUint16(6, 0, true);  // central dir disk
    view.setUint16(8, count, true);
    view.setUint16(10, count, true);
    view.setUint32(12, centralSize, true);
    view.setUint32(16, centralOffset, true);
    view.setUint16(20, 0, true); // comment length
    return new Uint8Array(buf);
  }

  _crc32(data) {
    if (!SimpleZip._table) {
      const t = new Uint32Array(256);
      for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        t[i] = c;
      }
      SimpleZip._table = t;
    }
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < data.length; i++) crc = SimpleZip._table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
}

// ===================== HISTORY =====================
function addToHistory(query, success) {
  state.history = state.history.filter((h) => h.query !== query);
  const entry = { query, success, ts: Date.now() };
  // Which query tab ran it, so the recent list can say where it came from.
  if (WINDOW_MODE && activeTabId) entry.tab = activeTabId;
  state.history.unshift(entry);
  state.history = state.history.slice(0, 20);
  chrome.storage.local.set({ queryHistory: state.history });
  renderHistory();
}

function renderHistory() {
  renderRecent();
  if (state.history.length === 0) {
    historyList.innerHTML = '<div class="history-empty">No queries yet</div>';
    return;
  }
  historyList.innerHTML = state.history
    .map(
      (h, i) =>
        `<div class="history-item" data-index="${i}" title="${esc(h.query)}">${esc(h.query)}</div>`
    )
    .join("");
}

historyList.addEventListener("click", (e) => {
  const item = e.target.closest(".history-item");
  if (item) {
    historyPopover.classList.add("hidden");
    loadHistoryQuery(parseInt(item.dataset.index));
  }
});

// Puts a past query in the editor — in the full window, the current tab's —
// without running it.
function loadHistoryQuery(index) {
  const entry = state.history[index];
  if (!entry) return;
  vqlInput.value = entry.query;
  historyNavIndex = -1;
  activatePane("query");
  vqlInput.focus();
  vqlInput.setSelectionRange(vqlInput.value.length, vqlInput.value.length);
  editorChanged();
}

clearHistoryBtn.addEventListener("click", () => {
  state.history = [];
  chrome.storage.local.set({ queryHistory: [] });
  renderHistory();
});

// ===================== DATA MODEL =====================
// The chip is the only load affordance and the only readout of model state, so
// it carries all four phases: idle, loading (with progress), loaded, failed.
let modelLoading = false;

// Both loaders — the data model and the document types — are long, progress-
// bearing fetches, so they share one chip with four phases. Parameterised rather
// than duplicated so the two can't drift apart.
function applyChipState(chip, labelEl, phase, labels, opts = {}) {
  chip.classList.remove("loading", "loaded", "failed");
  chip.style.backgroundImage = "";

  if (phase === "loading") {
    const { done = 0, total = 0 } = opts;
    const pct = total ? Math.round((done / total) * 100) : 0;
    chip.classList.add("loading");
    chip.style.backgroundImage =
      `linear-gradient(90deg, rgba(192,138,46,.45) ${pct}%, transparent ${pct}%)`;
    labelEl.textContent = total ? `${done}/${total}` : "LOADING";
    chip.title = opts.title || labels.loadingTitle;
  } else if (phase === "loaded") {
    chip.classList.add("loaded");
    labelEl.textContent = labels.loaded;
    chip.title = opts.title || labels.loadedTitle;
  } else if (phase === "failed") {
    chip.classList.add("failed");
    labelEl.textContent = "FAILED";
    chip.title = opts.title || "Load failed — click to retry";
  } else {
    labelEl.textContent = labels.idle;
    chip.title = labels.idleTitle;
  }
}

const MODEL_CHIP_LABELS = {
  idle: "LOAD MODEL",
  idleTitle: "Load data model — enables autocomplete",
  loading: "LOADING",
  loadingTitle: "Loading data model",
  loaded: "MODELS",
  loadedTitle: "Reload data model",
};

function setChipState(phase, opts = {}) {
  applyChipState(modelChip, modelChipLabel, phase, MODEL_CHIP_LABELS, opts);
}

modelChip.addEventListener("click", () => {
  if (modelLoading) return;
  loadDataModel();
});

async function loadDataModel() {
  if (!state.sessionId) {
    dmTree.innerHTML = '<div class="dm-empty">Connect to a Vault first.</div>';
    return;
  }

  modelLoading = true;
  setChipState("loading", { title: "Fetching object list…" });
  dmTree.innerHTML = "";

  try {
    // Step 1: Get all vobjects
    const objListResult = await apiCall("/metadata/vobjects");
    if (!objListResult.success) throw new Error(objListResult.error);

    const objListData = objListResult.data;
    let objectNames = [];

    if (objListData.objects) {
      objectNames = objListData.objects.map((o) => ({
        name: o.name || o.object_name || o.name__v,
        label: o.label || o.label__v || o.name || "",
        url: o.url || "",
      }));
    }

    // Also add "documents" as a queryable object (standard Vault object)
    const hasDocuments = objectNames.some((o) => o.name === "documents");
    if (!hasDocuments) {
      objectNames.unshift({ name: "documents", label: "Documents", url: "" });
    }

    const total = objectNames.length;
    setChipState("loading", { done: 0, total, title: `Loading fields for ${total} objects…` });

    // Step 2: Fetch fields for each object in batches
    const BATCH_SIZE = 5;
    const objects = [];
    let completed = 0;

    for (let i = 0; i < objectNames.length; i += BATCH_SIZE) {
      const batch = objectNames.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        batch.map(async (obj) => {
          try {
            let endpoint;
            if (obj.name === "documents") {
              endpoint = "/metadata/objects/documents/properties";
            } else {
              endpoint = `/metadata/vobjects/${obj.name}`;
            }
            const res = await apiCall(endpoint);
            return { obj, res };
          } catch (e) {
            return { obj, res: { success: false, error: e.message } };
          }
        })
      );

      for (const { obj, res } of results) {
        completed++;
        setChipState("loading", {
          done: completed,
          total,
          title: `Loading fields… ${completed}/${total} (${obj.name})`,
        });

        const fields = extractFields(obj.name, res);
        objects.push({
          name: obj.name,
          label: obj.label,
          fields: fields,
        });
      }
    }

    // Sort objects alphabetically
    objects.sort((a, b) => a.name.localeCompare(b.name));

    state.dataModel = { objects };
    const loadTime = new Date().toISOString();
    // Save under the current vault domain so each instance has its own model,
    // and the panel and the full window both start with it. A failed save only
    // costs the next view; the model is loaded here either way.
    let unsaved = null;
    if (state.domain) {
      try {
        await saveVaultCache("dataModels", state.domain, { model: state.dataModel, time: loadTime });
      } catch (e) {
        unsaved = e;
      }
    }

    onDataModelLoaded(loadTime);
    if (unsaved) {
      setChipState("loaded", { title: `Loaded, but not saved for next time: ${unsaved.message}` });
    }
  } catch (err) {
    setChipState("failed", { title: `Load failed: ${err.message} — click to retry` });
    dmTree.innerHTML = `<div class="dm-empty">Could not load the data model.<br />${esc(err.message)}</div>`;
  } finally {
    modelLoading = false;
  }
}

function extractFields(objName, res) {
  if (!res.success || !res.data) return [];

  const data = res.data;
  let rawFields = [];

  // vobjects response: data.object.fields
  if (data.object?.fields) {
    rawFields = data.object.fields;
  }
  // Documents properties response: data.properties
  else if (data.properties) {
    rawFields = data.properties;
  }
  // Some responses have fields at top level
  else if (data.fields) {
    rawFields = data.fields;
  }
  // Array response
  else if (Array.isArray(data)) {
    rawFields = data;
  }

  return rawFields.map((f) => ({
    name: f.name || f.name__v || "",
    label: f.label || f.label__v || "",
    type: f.type || f.type__v || "unknown",
    required: f.required || f.required__v || false,
    editable: f.editable || f.editable__v || false,
    queryable: f.queryable !== undefined ? f.queryable : true,
    helpContent: f.help_content || f.help_content__v || "",
    maxLength: f.max_length || f.max_length__v || null,
    objectName: objName,
    picklist: f.picklist || f.picklist__v || null,
    relationship: f.relationship_type || f.lookup_relationship_name || null,
  }));
}

// When the model on screen was loaded, so a save echoed back by
// storage.onChanged can be told from one made by another view.
let dataModelTime = null;

function onDataModelLoaded(timeStr) {
  if (!state.dataModel) return;
  dataModelTime = timeStr || null;

  const objCount = state.dataModel.objects.length;
  const fieldCount = state.dataModel.objects.reduce((s, o) => s + o.fields.length, 0);
  const loadedAt = timeStr
    ? ` — loaded ${new Date(timeStr).toLocaleDateString()} ${new Date(timeStr).toLocaleTimeString()}`
    : "";

  dmCounts.textContent = `${objCount} objects · ${fieldCount.toLocaleString()} fields`;
  const summary = `${objCount} objects · ${fieldCount.toLocaleString()} fields${loadedAt}`;
  dmCounts.title = summary;
  setChipState("loaded", { title: `${summary} — click to reload` });

  renderDataModelTree(dmSearch.value.trim().toLowerCase());
  // Untitled tabs are named after their object's label, which only the model has.
  if (WINDOW_MODE) renderQueryTabs();
}

// ===================== DATA MODEL SEARCH =====================
// Results are grouped under the object that owns them and paged, because a
// bare query like "status" can match several hundred fields across the model.
const DM_PAGE = 25;
// An opened object shows only its most-used fields; a 146-field object dumped
// in full is the thing the search box exists to avoid. The full-window sidebar
// is tall enough for a few more.
const DM_TOP_FIELDS = WINDOW_MODE ? 8 : 5;
// A vault carries hundreds of objects, but day-to-day work happens in a handful.
// These are the landing list; everything else is reached by searching. Names are
// matched case-insensitively and silently skipped when a vault lacks one, so
// suffixed and bare spellings can both be listed — whichever exists shows, in
// the order given.
const DM_DEFAULT_OBJECTS = [
  "documents",
  "user__sys",
  "user",
  "document_usage__v",
  "activity__v",
  "activity",
];

let dmFilterMode = "fields";
let dmShown = DM_PAGE;
const dmExpanded = new Set();
const dmShowAll = new Set();

dmSearch.addEventListener("input", () => {
  dmShown = DM_PAGE;
  renderDataModelTree(dmSearch.value.trim().toLowerCase());
});

dmSearchClear.addEventListener("click", () => {
  dmSearch.value = "";
  dmShown = DM_PAGE;
  renderDataModelTree("");
  dmSearch.focus();
});

dmFilters.addEventListener("click", (e) => {
  const btn = e.target.closest(".dm-filter");
  if (!btn || btn.classList.contains("active")) return;
  dmFilterMode = btn.dataset.filter;
  dmShown = DM_PAGE;
  renderDataModelTree(dmSearch.value.trim().toLowerCase());
});

dmShowMore.addEventListener("click", () => {
  dmShown += DM_PAGE;
  renderDataModelTree(dmSearch.value.trim().toLowerCase());
});

function matchesField(f, filter) {
  return (
    f.name.toLowerCase().includes(filter) ||
    f.label.toLowerCase().includes(filter) ||
    f.type.toLowerCase().includes(filter)
  );
}

function matchesObject(o, filter) {
  return o.name.toLowerCase().includes(filter) || o.label.toLowerCase().includes(filter);
}

function groupRowHtml(obj, countText, filter, opts = {}) {
  if (WINDOW_MODE) return wbGroupRowHtml(obj, countText, filter, opts);
  const { expandable = false, expanded = false } = opts;
  let h = `<div class="dm-group${expanded ? " expanded" : ""}" data-obj="${esc(obj.name)}"`;
  h += expandable ? ` title="Open ${esc(obj.name)}">` : ` title="Insert SELECT … FROM ${esc(obj.name)}">`;
  if (expandable) h += `<span class="dm-group-arrow">&#9654;</span>`;
  h += `<span class="dm-group-label">${highlight(obj.label || obj.name, filter)}</span>`;
  h += `<span class="dm-group-api">${highlight(obj.name, filter)}</span>`;
  h += `<span class="dm-group-count">${esc(countText)}</span>`;
  if (expandable) {
    h += `<button class="dm-group-sel" data-sel="${esc(obj.name)}" title="Insert SELECT … FROM ${esc(obj.name)}">SEL</button>`;
  }
  h += `</div>`;
  return h;
}

// The at-rest list: every object, and inside an opened one its most-used fields.
function objectIndexHtml(objects) {
  let html = "";
  for (const obj of objects) {
    const open = dmExpanded.has(obj.name);
    html += groupRowHtml(obj, `${obj.fields.length} fields`, "", { expandable: true, expanded: open });
    if (!open) continue;

    const ranked = [...obj.fields].sort(fieldRanker(obj));
    const all = dmShowAll.has(obj.name);
    const shown = all ? ranked : ranked.slice(0, DM_TOP_FIELDS);

    if (!all && ranked.length > DM_TOP_FIELDS) {
      html += `<div class="dm-rank-note">${
        hasFieldStats(obj.name) ? "Top 5 by how often they're filled" : "Top 5 — measuring usage…"
      }</div>`;
    }
    for (const f of shown) html += fieldRowHtml(f, obj.name, "");
    if (ranked.length > shown.length) {
      html += `<button class="dm-group-more" data-more="${esc(obj.name)}">Show all ${ranked.length} fields</button>`;
    }
  }
  return html;
}

function fieldRowHtml(f, objName, filter) {
  if (WINDOW_MODE) return wbFieldRowHtml(f, objName, filter);
  let h = `<div class="dm-row" data-field="${esc(f.name)}" data-obj="${esc(objName)}" title="Insert ${esc(f.name)}">`;
  h += `<span class="dm-row-main">`;
  h += `<span class="dm-row-label">${highlight(f.label || f.name, filter)}</span>`;
  h += `<span class="dm-row-api">${highlight(f.name, filter)}</span>`;
  h += `</span>`;
  if (f.required) h += `<span class="dm-row-req" title="Required">*</span>`;
  h += `<span class="dm-row-type">${esc(f.type)}</span>`;
  h += `<button class="dm-row-add">Add</button>`;
  h += `</div>`;
  return h;
}

function renderDataModelTree(filter) {
  // Before anything is loaded the panel chrome says nothing useful, so it stays
  // out of the way entirely — same shape as the Doc Types tab.
  if (!state.dataModel) {
    dmPanel.classList.add("hidden");
    dmEmptyState.classList.remove("hidden");
    dmFilters.classList.add("hidden");
    dmMore.classList.add("hidden");
    dmTree.innerHTML = "";
    return;
  }

  dmPanel.classList.remove("hidden");
  dmEmptyState.classList.add("hidden");

  const objects = state.dataModel.objects;
  dmSearchField.classList.toggle("filled", !!filter);
  dmSearchClear.classList.toggle("hidden", !filter);
  dmFilters.classList.toggle("hidden", !filter);

  // At rest the panel shows only the objects most work happens in. Listing all
  // of them was an endless alphabetical scroll nobody reads to the bottom of.
  if (!filter) {
    const featured = DM_DEFAULT_OBJECTS
      .map((want) => objects.find((o) => o.name.toLowerCase() === want.toLowerCase()))
      .filter(Boolean);

    const keepScroll = dmTree.scrollTop;
    if (WINDOW_MODE) {
      // The full-window sidebar has the height to list the rest under the
      // featured ones, one line each, so browsing works as well as searching.
      const rest = objects.filter((o) => !featured.includes(o));
      dmTree.innerHTML = wbObjectIndexHtml(featured, rest);
      dmTree.scrollTop = keepScroll;
      dmMore.classList.add("hidden");
      return;
    }
    dmTree.innerHTML = featured.length
      ? objectIndexHtml(featured)
      : '<div class="dm-empty">Search to find an object or field.</div>';
    dmTree.scrollTop = keepScroll;

    const rest = objects.length - featured.length;
    dmMore.classList.remove("hidden");
    dmShowMore.classList.add("hidden");
    dmShowing.textContent = featured.length
      ? `Most used · ${rest.toLocaleString()} more — search to find them`
      : `${objects.length.toLocaleString()} objects — search to find them`;
    return;
  }

  const fieldHits = [];
  for (const obj of objects) {
    const hits = obj.fields.filter((f) => matchesField(f, filter));
    if (hits.length) fieldHits.push({ obj, hits });
  }
  const objectHits = objects.filter((o) => matchesObject(o, filter));

  const totalFields = fieldHits.reduce((n, g) => n + g.hits.length, 0);
  dmNFields.textContent = totalFields;
  dmNObjects.textContent = objectHits.length;

  // Don't report "nothing matches" while the other tab is holding results —
  // land on whichever one actually has them.
  const active = dmFilterMode === "objects" ? objectHits.length : totalFields;
  const other = dmFilterMode === "objects" ? totalFields : objectHits.length;
  if (active === 0 && other > 0) dmFilterMode = dmFilterMode === "objects" ? "fields" : "objects";

  for (const btn of dmFilters.querySelectorAll(".dm-filter")) {
    btn.classList.toggle("active", btn.dataset.filter === dmFilterMode);
  }

  let html = "";
  let rendered = 0;
  let total = 0;

  if (dmFilterMode === "objects") {
    total = objectHits.length;
    for (const o of objectHits.slice(0, dmShown)) {
      html += groupRowHtml(o, `${o.fields.length} fields`, filter);
      rendered++;
    }
  } else {
    total = totalFields;
    let budget = dmShown;
    for (const { obj, hits } of fieldHits) {
      if (budget <= 0) break;
      const slice = hits.slice(0, budget);
      html += groupRowHtml(obj, `${hits.length} match${hits.length === 1 ? "" : "es"}`, filter);
      for (const f of slice) html += fieldRowHtml(f, obj.name, filter);
      budget -= slice.length;
      rendered += slice.length;
    }
  }

  if (total === 0) {
    html = `<div class="dm-empty">Nothing matches &ldquo;${esc(filter)}&rdquo;</div>`;
  }

  dmTree.innerHTML = html;
  dmTree.scrollTop = 0;

  const more = rendered < total;
  dmMore.classList.toggle("hidden", total === 0);
  dmShowing.textContent = more ? `Showing ${rendered} of ${total}` : `${total} result${total === 1 ? "" : "s"}`;
  dmShowMore.classList.toggle("hidden", !more);
}

function highlight(text, filter) {
  if (!filter || !text) return esc(text || "");
  const escaped = esc(text);
  const idx = text.toLowerCase().indexOf(filter);
  if (idx === -1) return escaped;
  const before = esc(text.slice(0, idx));
  const match = esc(text.slice(idx, idx + filter.length));
  const after = esc(text.slice(idx + filter.length));
  return `${before}<span class="dm-highlight">${match}</span>${after}`;
}

function insertSelectTemplate(objName) {
  const obj = state.dataModel?.objects.find((o) => o.name === objName);
  if (!obj || !obj.fields.length) return;
  const fieldList = obj.fields.map((f) => `    ${f.name}`).join(",\n");
  insertIntoQuery(`SELECT\n${fieldList}\nFROM ${obj.name}`, true);
}

dmTree.addEventListener("click", (e) => {
  const sel = e.target.closest(".dm-group-sel");
  if (sel) {
    insertSelectTemplate(sel.dataset.sel);
    return;
  }

  const more = e.target.closest(".dm-group-more");
  if (more) {
    dmShowAll.add(more.dataset.more);
    renderDataModelTree("");
    return;
  }

  const group = e.target.closest(".dm-group");
  if (group) {
    const name = group.dataset.obj;
    // In search results the heading is a label for its matches, not a control;
    // in the at-rest index it opens the object.
    if (dmSearch.value.trim()) {
      insertSelectTemplate(name);
      return;
    }
    if (dmExpanded.has(name)) {
      dmExpanded.delete(name);
      dmShowAll.delete(name);
    } else {
      dmExpanded.add(name);
      // Ranking needs usage data; ask for it the moment the object is opened.
      scheduleFieldStats(name);
    }
    renderDataModelTree("");
    return;
  }

  const row = e.target.closest(".dm-row");
  if (!row) return;
  if (e.shiftKey) addFieldToSelect(row.dataset.field, row.dataset.obj);
  else insertIntoQuery(row.dataset.field);
});

function insertIntoQuery(text, replace = false) {
  activatePane("query");
  paintTabThumb();

  if (replace) {
    vqlInput.value = text;
  } else {
    const pos = vqlInput.selectionStart;
    const before = vqlInput.value.slice(0, pos);
    const after = vqlInput.value.slice(pos);
    // Add a space before if needed
    const needsSpace = before.length > 0 && !before.endsWith(" ") && !before.endsWith(",") && !before.endsWith("\n");
    vqlInput.value = before + (needsSpace ? " " : "") + text + after;
    const newPos = pos + (needsSpace ? 1 : 0) + text.length;
    vqlInput.setSelectionRange(newPos, newPos);
  }
  vqlInput.focus();
  editorChanged();
}

// Shift-click on a field: append it to the SELECT list rather than dropping it
// wherever the cursor happens to be. An empty editor gets a fresh statement.
function addFieldToSelect(field, objName) {
  const q = vqlInput.value;
  if (!q.trim()) {
    insertIntoQuery(`SELECT ${field}\nFROM ${objName}`, true);
    vqlInput.setSelectionRange(7 + field.length, 7 + field.length);
    return;
  }
  const span = vqlSelectListSpan(q);
  if (!span) {
    insertIntoQuery(field);
    return;
  }
  const list = q.slice(span.start, span.end);
  const listed = vqlSplitTopLevel(list).map((s) => s.trim().toLowerCase());
  activatePane("query");
  vqlInput.focus();
  if (listed.includes(field.toLowerCase())) {
    // Already selected — show where, rather than adding it twice. Anchored to
    // the list's commas so name__v doesn't land inside product__v.name__v.
    const m = new RegExp(`(^|,)\\s*(${field.replace(/\./g, "\\.")})\\s*(?=,|$)`, "i").exec(list);
    const at = span.start + (m ? m.index + m[0].indexOf(m[2]) : 0);
    vqlInput.setSelectionRange(at, at + field.length);
    return;
  }
  const end = span.start + list.replace(/\s+$/, "").length;
  vqlInput.value = `${q.slice(0, end)}, ${field}${q.slice(end)}`;
  const caret = end + 2 + field.length;
  vqlInput.setSelectionRange(caret, caret);
  historyNavIndex = -1;
  editorChanged();
}

// ===================== FIELD FILL STATS =====================
// Ranks autocomplete suggestions by how often a field is actually populated.
// Measured by sampling rather than scanning: ordering only needs the relative
// rank, so a couple hundred rows separates a 90%-filled field from a 5% one.
//
// Cost is bounded by only ever measuring the object the query is actually
// against — never the whole model — and caching the result per vault, so the
// first use of an object costs a handful of background queries and every use
// after that costs nothing.
const FIELD_STATS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FIELD_STATS_SAMPLE = 200;
const FIELD_STATS_CHUNK = 20;      // Vault rejects very wide SELECTs
const FIELD_STATS_CONCURRENCY = 3;
const FIELD_STATS_MAX_OBJECTS = 50;

let fieldStats = {};
const fieldStatsPending = new Set();
const fieldStatsFailed = new Set();
let fieldStatsTimer = null;

async function loadFieldStatsForDomain(domain) {
  const store = await chrome.storage.local.get(["fieldStats"]);
  fieldStats = store.fieldStats?.[domain] || {};
}

async function persistFieldStats() {
  if (!state.domain) return;
  // Keep the most recently measured objects only, so the cache can't grow
  // without bound across a large vault.
  fieldStats = Object.fromEntries(
    Object.entries(fieldStats)
      .sort((a, b) => b[1].time - a[1].time)
      .slice(0, FIELD_STATS_MAX_OBJECTS)
  );
  const store = await chrome.storage.local.get(["fieldStats"]);
  const all = store.fieldStats || {};
  all[state.domain] = fieldStats;
  await chrome.storage.local.set({ fieldStats: all });
}

// Shared ordering for "most useful field first": required, then how often the
// field is actually populated, then the model's own order. Used by both the
// autocomplete and the Models panel so the two never disagree.
function fieldRanker(obj) {
  const rates = fieldStats[obj.name]?.rates || {};
  const modelOrder = new Map(obj.fields.map((f, i) => [f.name, i]));
  return (a, b) => {
    const byRequired = (b.required === true) - (a.required === true);
    if (byRequired) return byRequired;
    const byFill = (rates[b.name] ?? -1) - (rates[a.name] ?? -1);
    if (byFill) return byFill;
    return modelOrder.get(a.name) - modelOrder.get(b.name);
  };
}

function hasFieldStats(objName) {
  return !!fieldStats[objName];
}

function scheduleFieldStats(objName) {
  if (!objName || !state.sessionId) return;
  const entry = fieldStats[objName];
  if (entry && Date.now() - entry.time < FIELD_STATS_TTL_MS) return;
  if (fieldStatsPending.has(objName) || fieldStatsFailed.has(objName)) return;
  clearTimeout(fieldStatsTimer);
  fieldStatsTimer = setTimeout(() => computeFieldStats(objName), 500);
}

async function computeFieldStats(objName) {
  if (fieldStatsPending.has(objName)) return;
  const obj = state.dataModel?.objects.find((o) => o.name === objName);
  if (!obj || !state.sessionId) return;

  // Required fields already rank above everything else, so measuring them is
  // wasted work — skip them and spend the queries on the rest.
  const names = obj.fields
    .filter((f) => f.queryable !== false && !f.required && f.name && !f.name.startsWith("__"))
    .map((f) => f.name);
  if (!names.length) return;

  fieldStatsPending.add(objName);
  try {
    const chunks = [];
    for (let i = 0; i < names.length; i += FIELD_STATS_CHUNK) {
      chunks.push(names.slice(i, i + FIELD_STATS_CHUNK));
    }

    const rates = {};
    let measured = false;

    for (let i = 0; i < chunks.length; i += FIELD_STATS_CONCURRENCY) {
      const batch = chunks.slice(i, i + FIELD_STATS_CONCURRENCY);
      const results = await Promise.all(
        batch.map(async (fields) => {
          const q = `SELECT ${fields.join(", ")} FROM ${objName} LIMIT ${FIELD_STATS_SAMPLE}`;
          const res = await apiCall("/query", "POST", `q=${encodeURIComponent(q)}`);
          return { fields, res };
        })
      );

      for (const { fields, res } of results) {
        const rows =
          res.success && res.data?.responseStatus !== "FAILURE" ? res.data?.data : null;
        if (!rows || !rows.length) continue;
        measured = true;
        for (const f of fields) {
          let filled = 0;
          for (const row of rows) {
            const v = row[f];
            if (v !== null && v !== undefined && v !== "") filled++;
          }
          rates[f] = Math.round((filled / rows.length) * 100);
        }
      }
    }

    // A vault that rejects these queries shouldn't be retried on every keystroke.
    if (!measured) {
      fieldStatsFailed.add(objName);
      return;
    }

    fieldStats[objName] = { time: Date.now(), rates };
    await persistFieldStats();

    // The panel may be showing this object's top 5 in fallback order; re-rank
    // now that real usage numbers exist.
    if (dmExpanded.has(objName) && !dmSearch.value.trim()) renderDataModelTree("");
  } finally {
    fieldStatsPending.delete(objName);
  }
}

// ===================== AUTOCOMPLETE =====================
const VQL_KEYWORDS = [
  "SELECT", "FROM", "WHERE", "AND", "OR", "NOT", "IN", "LIKE",
  "ORDER BY", "ASC", "DESC", "LIMIT", "OFFSET", "FIND",
  "MAXROWS", "SKIP", "GROUP BY", "HAVING", "COUNT", "NULL",
  "TRUE", "FALSE", "BETWEEN", "CONTAINS", "LONGTEXT",
  "RICHTEXT", "ALLVERSIONS", "LATESTVERSION", "STEADY_STATE",
];

function showAutocomplete() {
  if (!state.dataModel) {
    hideAc();
    return;
  }

  const cursorPos = vqlInput.selectionStart;
  const text = vqlInput.value;

  // Extract the current word being typed
  const beforeCursor = text.slice(0, cursorPos);
  const wordMatch = beforeCursor.match(/[\w.]+$/);
  if (!wordMatch || wordMatch[0].length < 2) {
    hideAc();
    return;
  }

  const word = wordMatch[0].toLowerCase();
  const suggestions = [];

  // Determine context: are we after FROM? then suggest objects. Otherwise fields/keywords.
  const upperBefore = beforeCursor.toUpperCase();
  const afterFrom = /\bFROM\s+[\w.]*$/.test(upperBefore);

  if (afterFrom) {
    // Suggest objects
    for (const obj of state.dataModel.objects) {
      if (obj.name.toLowerCase().includes(word)) {
        suggestions.push({
          type: "obj",
          name: obj.name,
          label: obj.label,
          detail: `${obj.fields.length} fields`,
        });
      }
      if (suggestions.length >= 15) break;
    }
  } else {
    // Determine active object from query (look for FROM <obj>)
    const fromMatch = text.match(/\bFROM\s+([\w]+)/i);
    const activeObjName = fromMatch ? fromMatch[1] : null;
    const activeObj = activeObjName
      ? state.dataModel.objects.find((o) => o.name.toLowerCase() === activeObjName.toLowerCase())
      : null;

    // Suggest fields from the active object: required first, then whichever are
    // most often actually populated, then the model's own order. Fill stats are
    // measured lazily in the background — until they land, `rates` is empty and
    // this degrades to required-first.
    if (activeObj) {
      scheduleFieldStats(activeObj.name);
      const matched = activeObj.fields.filter((f) => f.name.toLowerCase().includes(word));
      matched.sort(fieldRanker(activeObj));
      for (const f of matched.slice(0, 12)) {
        suggestions.push({
          type: "field",
          name: f.name,
          label: f.label,
          detail: f.type,
          required: f.required,
        });
      }
    }

    // Suggest VQL keywords
    for (const kw of VQL_KEYWORDS) {
      if (kw.toLowerCase().includes(word) && suggestions.length < 15) {
        suggestions.push({ type: "kw", name: kw, label: "", detail: "keyword" });
      }
    }

    // If no active object, suggest objects too
    if (!activeObj) {
      for (const obj of state.dataModel.objects) {
        if (obj.name.toLowerCase().includes(word) && suggestions.length < 15) {
          suggestions.push({
            type: "obj",
            name: obj.name,
            label: obj.label,
            detail: `${obj.fields.length} fields`,
          });
        }
      }
    }
  }

  if (suggestions.length === 0) {
    hideAc();
    return;
  }

  acItems = suggestions;
  acIndex = 0;
  renderAcDropdown();
}

function renderAcDropdown() {
  let html = "";
  for (let i = 0; i < acItems.length; i++) {
    const item = acItems[i];
    const sel = i === acIndex ? " selected" : "";
    html += `<div class="ac-item${sel}" data-ac-index="${i}">`;
    html += `<span class="ac-badge ${item.type}">${item.type === "obj" ? "OBJ" : item.type === "field" ? "FLD" : "KW"}</span>`;
    html += `<span class="ac-name">${esc(item.name)}</span>`;
    if (item.required) html += `<span class="ac-required">*</span>`;
    if (item.label) html += `<span class="ac-label">${esc(item.label)}</span>`;
    html += `<span class="ac-type">${esc(item.detail)}</span>`;
    html += `</div>`;
  }
  acDropdown.innerHTML = html;
  acDropdown.classList.remove("hidden");
}

function renderAcSelection() {
  const items = acDropdown.querySelectorAll(".ac-item");
  items.forEach((el, i) => el.classList.toggle("selected", i === acIndex));
  // Scroll into view
  if (items[acIndex]) items[acIndex].scrollIntoView({ block: "nearest" });
}

acDropdown.addEventListener("click", (e) => {
  const item = e.target.closest(".ac-item");
  if (item) {
    const idx = parseInt(item.dataset.acIndex);
    if (acItems[idx]) {
      insertAcItem(acItems[idx]);
      hideAc();
    }
  }
});

function insertAcItem(item) {
  const cursorPos = vqlInput.selectionStart;
  const text = vqlInput.value;
  const beforeCursor = text.slice(0, cursorPos);
  const afterCursor = text.slice(cursorPos);

  // Find the word to replace
  const wordMatch = beforeCursor.match(/[\w.]+$/);
  if (!wordMatch) return;

  const wordStart = cursorPos - wordMatch[0].length;
  const newText = text.slice(0, wordStart) + item.name + afterCursor;
  vqlInput.value = newText;
  const newPos = wordStart + item.name.length;
  vqlInput.setSelectionRange(newPos, newPos);
  vqlInput.focus();
  editorChanged();
}

function hideAc() {
  acDropdown.classList.add("hidden");
  acItems = [];
  acIndex = -1;
}

// Hide autocomplete when clicking outside
document.addEventListener("click", (e) => {
  if (!e.target.closest(".textarea-wrapper")) hideAc();
});

// ===================== INLINE EDITING =====================
const saveBar = $("#save-bar");
const saveBarCount = $("#save-bar-count");
const saveBtn = $("#save-btn");
const discardBtn = $("#discard-btn");

// Track edits: { "rowIndex:fieldName": { rowIdx, field, oldVal, newVal } }
let pendingEdits = {};
let queryObjectName = null; // detected from the FROM clause
let queryRows = []; // raw data rows from last query

function detectObjectFromQuery() {
  const q = vqlInput.value;
  const m = q.match(/\bFROM\s+([\w]+)/i);
  return m ? m[1] : null;
}

function getEditableFields(objectName) {
  // If we have data model, check for explicitly non-editable fields to exclude
  if (state.dataModel && objectName) {
    const obj = state.dataModel.objects.find(
      (o) => o.name.toLowerCase() === objectName.toLowerCase()
    );
    if (obj) {
      const editable = new Set();
      for (const f of obj.fields) {
        // Include field unless explicitly marked non-editable
        const isEditable = f.editable === true || f.editable === "true" || f.editable === undefined;
        if (isEditable) editable.add(f.name);
      }
      // If the set is empty (metadata didn't have editable info), return all fields
      if (editable.size === 0) return "all";
      return editable;
    }
  }
  // No data model — still allow editing, API will reject if not allowed
  return "all";
}

const RESULT_ROW_CAP = 15;

function renderTable(rows) {
  queryObjectName = detectObjectFromQuery();
  queryRows = rows;
  pendingEdits = {};
  updateSaveBar();

  const keys = [];
  const keySet = new Set();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!keySet.has(key)) {
        keySet.add(key);
        keys.push(key);
      }
    }
  }
  resultKeys = keys;

  // The workbench pages, filters and selects; it draws its own table.
  if (WINDOW_MODE) {
    resetResultsView();
    paintResultsView();
    return;
  }

  const editableFields = getEditableFields(queryObjectName);
  const hasId = keys.includes("id");
  let html = '<table class="results-table"><thead><tr>';
  for (const key of keys) {
    const isId = key === "id";
    html += `<th class="${isId ? "col-id" : ""}">${esc(key)}</th>`;
  }
  html += "</tr></thead><tbody>";

  for (let ri = 0; ri < rows.length; ri++) {
    const row = rows[ri];
    html += `<tr data-row="${ri}">`;
    for (const key of keys) {
      const val = row[key];
      const display = val === null || val === undefined ? "" : String(val);
      const isId = key === "id";
      const canEdit = hasId && !isId && editableFields && (editableFields === "all" || editableFields.has(key));

      if (canEdit) {
        html += `<td class="editable" data-row="${ri}" data-field="${esc(key)}" title="Click to edit">${esc(display)}</td>`;
      } else if (isId) {
        html += `<td class="col-id" title="${esc(display)}">${esc(display)}</td>`;
      } else {
        html += `<td title="${esc(display)}">${esc(display)}</td>`;
      }
    }
    html += "</tr>";
  }

  html += "</tbody></table>";

  // getEditableFields never returns empty, so id in the SELECT is the only gate.
  if (hasId) {
    html += '<div class="edit-hint">Click editable cells to modify values</div>';
  } else {
    html += '<div class="edit-hint">Include <b>id</b> in your SELECT to enable inline editing</div>';
  }

  resultsContainer.innerHTML = html;

  // Grow with the result set up to RESULT_ROW_CAP rows, then scroll.
  resultsContainer.style.maxHeight = "";
  const bodyRows = resultsContainer.querySelectorAll("tbody tr");
  if (bodyRows.length > RESULT_ROW_CAP) {
    const headRow = resultsContainer.querySelector("thead tr");
    const headH = headRow ? headRow.offsetHeight : 0;
    // max-height applies to the border box, so the border (and any horizontal
    // scrollbar) has to be added or the last row gets clipped.
    const frame = resultsContainer.offsetHeight - resultsContainer.clientHeight;
    resultsContainer.style.maxHeight =
      `${headH + bodyRows[0].offsetHeight * RESULT_ROW_CAP + frame}px`;
  }
}

// One listener for the life of the page rather than one per cell per render:
// the table is rebuilt on every run, page turn and filter keystroke.
resultsContainer.addEventListener("click", (e) => {
  const tr = e.target.closest("tbody tr[data-row]");
  if (!tr) return;
  if (WINDOW_MODE) selectResultRow(parseInt(tr.dataset.row));
  const td = e.target.closest("td.editable");
  if (td && !td.classList.contains("editing")) startEditing(td);
});

function startEditing(td) {
  if (td.classList.contains("editing")) return;

  const ri = parseInt(td.dataset.row);
  const field = td.dataset.field;
  const currentVal = pendingEdits[`${ri}:${field}`]?.newVal
    ?? (queryRows[ri][field] === null || queryRows[ri][field] === undefined ? "" : String(queryRows[ri][field]));

  td.classList.add("editing");
  const input = document.createElement("input");
  input.type = "text";
  input.value = currentVal;
  td.textContent = "";
  td.appendChild(input);
  input.focus();
  input.select();

  const finish = () => {
    const newVal = input.value;
    const origVal = queryRows[ri][field] === null || queryRows[ri][field] === undefined ? "" : String(queryRows[ri][field]);

    td.classList.remove("editing");
    td.innerHTML = cellContent(field, newVal);
    if (WINDOW_MODE) td.title = newVal;

    if (newVal !== origVal) {
      td.classList.add("dirty");
      pendingEdits[`${ri}:${field}`] = { rowIdx: ri, field, oldVal: origVal, newVal };
    } else {
      td.classList.remove("dirty");
      delete pendingEdits[`${ri}:${field}`];
    }
    updateSaveBar();
    // The inspector shows the edited value, not the one Vault last returned.
    if (WINDOW_MODE && resultsView.selected === ri) renderInspector();
  };

  input.addEventListener("blur", finish);
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") { input.blur(); }
    if (ev.key === "Escape") {
      // Revert to original
      const origVal = queryRows[ri][field] === null || queryRows[ri][field] === undefined ? "" : String(queryRows[ri][field]);
      input.value = pendingEdits[`${ri}:${field}`] ? pendingEdits[`${ri}:${field}`].newVal : origVal;
      input.blur();
    }
    if (ev.key === "Tab") {
      ev.preventDefault();
      input.blur();
      // Jump to next editable cell
      const allEditable = [...resultsContainer.querySelectorAll("td.editable")];
      const idx = allEditable.indexOf(td);
      const next = allEditable[ev.shiftKey ? idx - 1 : idx + 1];
      if (next) next.click();
    }
  });
}

function updateSaveBar() {
  const count = Object.keys(pendingEdits).length;
  if (count === 0) {
    saveBar.classList.add("hidden");
  } else {
    saveBar.classList.remove("hidden");
    saveBarCount.textContent = `${count} change${count !== 1 ? "s" : ""}`;
  }
}

// Discard all edits
discardBtn.addEventListener("click", () => {
  pendingEdits = {};
  // Re-render the table with original data. The workbench repaints in place so
  // the filter, page and selection survive.
  if (WINDOW_MODE) {
    paintResultsView();
    renderInspector();
  } else if (queryRows.length > 0) {
    renderTable(queryRows);
  }
  updateSaveBar();
});

// Save changes — group edits by row, send one PUT per row
saveBtn.addEventListener("click", async () => {
  if (!state.sessionId) {
    showSaveError("Not connected.");
    return;
  }
  if (!queryObjectName) {
    showSaveError("Could not detect object name from query. Make sure your query has a FROM clause.");
    return;
  }

  const editsByRow = {};
  for (const edit of Object.values(pendingEdits)) {
    if (!editsByRow[edit.rowIdx]) editsByRow[edit.rowIdx] = [];
    editsByRow[edit.rowIdx].push(edit);
  }

  if (Object.keys(editsByRow).length === 0) return;

  saveBtn.disabled = true;
  saveBtn.innerHTML = '<span class="spinner"></span> Saving...';

  const isDoc = queryObjectName.toLowerCase() === "documents";
  const errors = [];

  for (const [rowIdxStr, edits] of Object.entries(editsByRow)) {
    const ri = parseInt(rowIdxStr);
    const row = queryRows[ri];
    if (!row) { errors.push(`Row ${ri}: not found in data`); continue; }

    const recordId = row.id;
    if (!recordId) { errors.push(`Row ${ri}: no id field — include id in your SELECT`); continue; }

    const tr = resultsContainer.querySelector(`tr[data-row="${ri}"]`);
    if (tr) tr.classList.add("saving");

    const endpoint = isDoc
      ? `/objects/documents/${recordId}`
      : `/vobjects/${queryObjectName}/${recordId}`;

    const body = edits
      .map((e) => `${encodeURIComponent(e.field)}=${encodeURIComponent(e.newVal)}`)
      .join("&");

    const result = await apiCall(endpoint, "PUT", body);

    if (tr) tr.classList.remove("saving");

    if (result.success && result.data?.responseStatus !== "FAILURE") {
      for (const e of edits) {
        queryRows[ri][e.field] = e.newVal;
        delete pendingEdits[`${e.rowIdx}:${e.field}`];
        const td = resultsContainer.querySelector(`td[data-row="${ri}"][data-field="${e.field}"]`);
        if (td) td.classList.remove("dirty");
      }
      if (tr) {
        tr.classList.add("save-ok");
        setTimeout(() => tr.classList.remove("save-ok"), 1500);
      }
    } else {
      const errMsg = result.data?.errors?.map((e) => e.message).join(", ") || result.error || "Unknown error";
      errors.push(`Row ${ri} (id: ${recordId}): ${errMsg}`);
      if (tr) {
        tr.classList.add("save-err");
        tr.title = errMsg;
        setTimeout(() => { tr.classList.remove("save-err"); tr.title = ""; }, 5000);
      }
    }
  }

  saveBtn.disabled = false;
  saveBtn.innerHTML = "Save Changes";
  updateSaveBar();
  if (WINDOW_MODE) renderInspector();

  if (errors.length > 0) {
    showSaveError(errors.join("\n"));
  }
});

function showSaveError(msg) {
  // Show error below the save bar
  let errDiv = resultsContainer.parentElement.querySelector(".save-error");
  if (!errDiv) {
    errDiv = document.createElement("div");
    errDiv.className = "save-error result-message error";
    saveBar.after(errDiv);
  }
  errDiv.textContent = msg;
  errDiv.style.marginTop = "8px";
  setTimeout(() => errDiv.remove(), 8000);
}

// ===================== DOC TYPES =====================
// Two calls to enumerate: list the types, then follow each type's own link to
// get its properties[] — Vault has no page-layout endpoint, so the field set
// comes back as part of the type.
const dtChip = $("#dt-chip");
const dtChipLabel = $("#dt-chip-label");
const dtLayout = $("#dt-layout");
const dtEmpty = $("#dt-empty");
const dtCountBtn = $("#dt-count-btn");
const dtSortDir = $("#dt-sort-dir");
const dtTree = $("#dt-tree");
const dtBreadcrumb = $("#dt-breadcrumb");
const dtFields = $("#dt-fields");
const dtStats = $("#dt-stats");
const dtFieldCount = $("#dt-field-count");

const DT_BATCH = 5;          // concurrent type fetches

let docTypes = [];
let docTypesTime = null;     // when the types on screen were loaded or counted
let dtSelected = null;
let dtSortDirection = null; // null | "desc" | "asc"
let dtCounting = false;
let dtLoading = false;

// An HTTP 200 from Vault can still be a failure; the real verdict is in the body.
function apiOk(result) {
  return !!result?.success && result.data?.responseStatus !== "FAILURE";
}

function apiErr(result) {
  return (
    result?.data?.errors?.[0]?.message ||
    result?.error ||
    "Vault returned no explanation"
  );
}

// The type list hands back absolute links that already carry /api/vXX.X/. Reduce
// them to a path so the request still goes through the background worker's
// versioning rule — and never follow a link pointing off our own vault.
function vaultPath(link) {
  if (!link) return null;
  try {
    const u = new URL(link);
    if (state.domain && u.hostname !== state.domain) return null;
    return u.pathname + (u.search || "");
  } catch (e) {
    return link.startsWith("/") ? link : "/" + link;
  }
}

// Single quotes are the only thing that can break out of a VQL literal.
function vqlStr(s) {
  return String(s == null ? "" : s).replace(/'/g, "''");
}

const DT_CHIP_LABELS = {
  idle: "LOAD TYPES",
  idleTitle: "Load document types and the fields on each layout",
  loading: "LOADING",
  loadingTitle: "Loading document types",
  loaded: "TYPES",
  loadedTitle: "Reload document types",
};

function setDtChipState(phase, opts = {}) {
  applyChipState(dtChip, dtChipLabel, phase, DT_CHIP_LABELS, opts);
}

dtChip.addEventListener("click", () => {
  if (dtLoading) return;
  loadDocTypes();
});

async function loadDocTypes() {
  if (dtLoading) return;
  if (!state.sessionId) {
    setDtChipState("failed", { title: "Connect to a Vault first" });
    return;
  }

  dtLoading = true;
  setDtChipState("loading", { title: "Listing document types…" });
  dtTree.innerHTML = '<div class="dt-children-loading"><span class="spinner"></span> Loading…</div>';
  dtFields.innerHTML = "";
  dtBreadcrumb.innerHTML = "";
  dtStats.classList.add("hidden");
  dtSelected = null;

  try {
    // Call 1 — the list. `label` is display text; the API name is the last
    // segment of `value` and is never derived from the label.
    const listed = await apiCall("/metadata/objects/documents/types");
    if (!apiOk(listed)) {
      setDtChipState("failed", { title: `Couldn't list types: ${apiErr(listed)}` });
      // The tree was blanked to a spinner before this call; say what happened
      // rather than leaving it spinning with the reason hidden in a tooltip.
      dtTree.innerHTML = `<div class="dm-empty">Couldn't list document types.<br />${esc(
        apiErr(listed)
      )}</div>`;
      return;
    }

    const raw = listed.data?.types || [];
    const types = raw.map((t) => {
      const link = t.value || "";
      const tail = link.split("/").pop() || "";
      return {
        label: t.label || tail || "(unnamed)",
        name: t.name || tail,
        link,
        properties: null,
        subtypes: [],
        error: null,
      };
    });

    if (!types.length) {
      setDtChipState("loaded", { title: "No document types in this vault" });
      dtEmpty.textContent = "This vault has no document types.";
      return;
    }

    // Call 2 — one per type, following the link Vault handed back.
    let done = 0;
    for (let i = 0; i < types.length; i += DT_BATCH) {
      const batch = types.slice(i, i + DT_BATCH);
      await Promise.all(
        batch.map(async (t) => {
          const path = vaultPath(t.link);
          if (!path) {
            t.error = "type link missing or points off-domain";
            return;
          }
          const res = await apiCall(path);
          if (!apiOk(res)) {
            t.error = apiErr(res);
            return;
          }
          t.properties = res.data?.properties || [];
          t.subtypes = res.data?.subtypes || [];
        })
      );
      done += batch.length;
      setDtChipState("loading", {
        done,
        total: types.length,
        title: `Fetching fields… ${done}/${types.length}`,
      });
    }

    applyDocTypes(types, new Date().toISOString());
    // Saved per vault, like the data model, so switching between the panel and
    // the full window doesn't mean loading them all over again.
    const unsaved = await saveDocTypes();
    if (unsaved) {
      setDtChipState("loaded", { title: `Loaded, but not saved for next time: ${unsaved.message}` });
    }
  } catch (err) {
    setDtChipState("failed", { title: `Load failed: ${err.message}` });
  } finally {
    dtLoading = false;
  }
}

function docTypesSummary(types) {
  const failed = types.filter((t) => t.error).length;
  const withFields = types.filter((t) => t.properties).length;
  return `${types.length} types · ${withFields} with fields` + (failed ? ` · ${failed} failed` : "");
}

// Puts a set of types on screen: freshly loaded, restored from storage on
// connect, or saved by another view while this one was open.
function applyDocTypes(types, time) {
  const keep = dtSelected?.name;
  docTypes = types;
  docTypesTime = time || null;
  dtSelected = null;
  dtFields.innerHTML = "";
  dtBreadcrumb.innerHTML = "";
  dtStats.classList.add("hidden");
  paintDtCountControls();
  renderDocTypeList();
  dtLayout.classList.remove("hidden");
  dtEmpty.classList.add("hidden");
  // A type that was open stays open if it's still there.
  if (keep) {
    dtTree.querySelector(`.dt-node[data-name="${CSS.escape(keep)}"] .dt-node-header`)?.click();
  }
  const when = time ? ` · loaded ${new Date(time).toLocaleString()}` : "";
  setDtChipState("loaded", { title: `${docTypesSummary(types)}${when} — click to reload` });
}

// Only what the Doc Types pane and Ask read. Raw properties carry much more,
// and across every type of a large vault that runs to megabytes of storage.
const DT_KEEP_PROPS = [
  "name", "label", "type", "required", "editable", "repeating", "hidden", "disabled", "scope",
  "section", "section__v", "sectionPosition", "section_position", "order",
];

function slimDocType(t) {
  const pick = (p) =>
    Object.fromEntries(DT_KEEP_PROPS.filter((k) => p[k] !== undefined).map((k) => [k, p[k]]));
  return {
    label: t.label,
    name: t.name,
    link: t.link,
    error: t.error || null,
    subtypes: t.subtypes || [],
    properties: t.properties ? t.properties.map(pick) : null,
    docCount: t.docCount ?? null,
    countError: t.countError || null,
  };
}

// Returns the error when the save fails, so the caller can say so; the types
// stay loaded in this view either way.
async function saveDocTypes() {
  if (!state.domain || !docTypes.length) return null;
  try {
    await saveVaultCache("docTypeCache", state.domain, {
      time: docTypesTime,
      types: docTypes.map(slimDocType),
    });
    return null;
  } catch (e) {
    return e;
  }
}

async function loadDocTypesForDomain(domain) {
  const store = await chrome.storage.local.get(["docTypeCache"]);
  const entry = store.docTypeCache?.[domain];
  if (entry?.types?.length) applyDocTypes(entry.types, entry.time);
}

// The count button and sort arrow follow whether the types on screen carry
// counts — they may have arrived counted, from storage.
function paintDtCountControls() {
  const counted = docTypes.filter((t) => t.docCount != null).length;
  const failed = docTypes.filter((t) => t.countError).length;
  if (counted || failed) {
    dtCountBtn.textContent = failed ? `Recount (${failed} failed)` : "Recount records";
    dtCountBtn.title = `${counted} of ${docTypes.length} types counted`;
  } else {
    dtCountBtn.textContent = "Count records";
    dtCountBtn.title = "";
  }
  dtSortDir.disabled = counted === 0;
  if (!counted) {
    dtSortDirection = null;
    dtSortDir.textContent = "↕";
    dtSortDir.classList.remove("active");
    dtSortDir.title = "Sort by record count";
  } else if (!dtSortDirection) {
    dtSortDirection = "desc";
    dtSortDir.textContent = "↓";
    dtSortDir.classList.add("active");
    dtSortDir.title = "Most records first";
  }
}

function renderDocTypeList() {
  // Record count descending puts the types people actually use at the top;
  // A-Z is the predictable default.
  // A-Z until counts exist and the arrow asks for a count order.
  const ordered = [...docTypes].sort((a, b) => {
    if (dtSortDirection) {
      const av = a.docCount ?? -1;
      const bv = b.docCount ?? -1;
      const diff = dtSortDirection === "desc" ? bv - av : av - bv;
      if (diff) return diff;
    }
    return a.label.localeCompare(b.label);
  });

  let html = "";
  for (const t of ordered) {
    const sub = t.subtypes && t.subtypes.length ? ` · ${t.subtypes.length} subtypes` : "";
    const tip = t.error
      ? t.error
      : `${t.name}${sub}` +
        (t.docCount != null ? ` · ${t.docCount.toLocaleString()} documents` : "") +
        (t.countError ? ` · count failed: ${t.countError}` : "") +
        (t.properties ? ` · ${t.properties.length} fields` : "");

    let cell;
    if (t.docCount != null) {
      cell =
        `<span class="dt-type-count counted t${countTier(t.docCount)}">` +
        `${esc(compactCount(t.docCount))}</span>`;
    } else if (t.countError) {
      cell = '<span class="dt-type-count failed">!</span>';
    } else {
      // Not counted yet: the quiet field tally, as before.
      const fieldCount = t.error ? "!" : t.properties ? String(t.properties.length) : "–";
      cell = `<span class="dt-type-count">${esc(fieldCount)}</span>`;
    }

    html += `<div class="dt-node" data-name="${esc(t.name)}">`;
    html += `<div class="dt-node-header" title="${esc(tip)}">`;
    html += `<span class="dt-node-icon">&#128196;</span>`;
    html += `<span class="dt-node-label">${esc(t.label)}</span>`;
    html += `<span class="dt-node-sublabel">${esc(t.name)}</span>`;
    html += cell;
    html += `</div></div>`;
  }
  dtTree.innerHTML = html;
}

// Depth of tint, not length of bar. Document counts in a vault run from single
// digits to millions; a bar scaled to the largest type would leave every other
// row empty, and scaling it logarithmically would draw a proportion the data
// does not support. One hue, five steps, deeper = bigger — and the exact figure
// sits on top, so magnitude is never carried by colour alone.
function countTier(n) {
  if (n === 0) return 0;
  if (n < 100) return 1;
  if (n < 1000) return 2;
  if (n < 10000) return 3;
  if (n < 100000) return 4;
  return 5;
}

// Exact while it fits the column, compact past it; the row tooltip always
// carries the full figure.
function compactCount(n) {
  if (n < 10000) return n.toLocaleString();
  if (n < 1000000) {
    const k = n / 1000;
    return `${k < 100 ? k.toFixed(1).replace(/\.0$/, "") : Math.round(k)}K`;
  }
  const m = n / 1000000;
  return `${m < 10 ? m.toFixed(1).replace(/\.0$/, "") : Math.round(m)}M`;
}

dtSortDir.addEventListener("click", () => {
  if (dtSortDir.disabled) return;
  dtSortDirection = dtSortDirection === "desc" ? "asc" : "desc";
  dtSortDir.textContent = dtSortDirection === "desc" ? "↓" : "↑";
  dtSortDir.classList.add("active");
  dtSortDir.title =
    dtSortDirection === "desc" ? "Most records first" : "Fewest records first";
  renderDocTypeList();
});

// One button, one query per type: SELECT id FROM documents WHERE type__v = '<label>'.
// responseDetails.total carries the full count, so PAGESIZE 1 keeps the payload
// tiny while still answering "how many".
dtCountBtn.addEventListener("click", countDocTypeRecords);

async function countDocTypeRecords() {
  if (dtCounting || !docTypes.length || !state.sessionId) return;

  dtCounting = true;
  dtCountBtn.disabled = true;
  const total = docTypes.length;
  let done = 0;

  const runOne = async (t) => {
    const q = `SELECT id FROM documents WHERE type__v = '${vqlStr(t.label)}' PAGESIZE 1`;
    const res = await apiCall("/query", "POST", `q=${encodeURIComponent(q)}`);
    if (apiOk(res)) {
      const reported = Number(res.data?.responseDetails?.total);
      t.docCount = Number.isFinite(reported)
        ? reported
        : (res.data?.data || []).length;
      // Clear the other side, or a recount that succeeds keeps reporting the
      // previous failure in the button and the row tooltips.
      t.countError = null;
    } else {
      t.countError = apiErr(res);
      t.docCount = null;
    }
    done++;
    dtCountBtn.textContent = `Counting… ${done}/${total}`;
  };

  try {
    for (let i = 0; i < docTypes.length; i += DT_BATCH) {
      await Promise.all(docTypes.slice(i, i + DT_BATCH).map(runOne));
      renderDocTypeList();
    }

    paintDtCountControls();
    renderDocTypeList();
    // Counts are worth keeping too: they cost one query per type.
    docTypesTime = new Date().toISOString();
    await saveDocTypes();
  } finally {
    dtCounting = false;
    dtCountBtn.disabled = false;
  }
}

dtTree.addEventListener("click", (e) => {
  const header = e.target.closest(".dt-node-header");
  if (!header) return;
  const name = header.closest(".dt-node")?.dataset.name;
  const type = docTypes.find((t) => t.name === name);
  if (!type) return;

  dtTree.querySelectorAll(".dt-node-header.selected").forEach((h) => h.classList.remove("selected"));
  header.classList.add("selected");
  dtSelected = type;
  showDocTypeFields(type);
});

// ---- layout placement ------------------------------------------------------
// The doc info panel is built from section + sectionPosition, so a property with
// no section has no placement on the form. Prior work in this repo disagreed on
// the spelling, so read both rather than betting on one.
// Vault returns file_info__v at the top of the layout, but it is boilerplate
// (file name, size, format) rather than classification data, so it reads better
// last. Matches either a section heading or a field name.
const DT_PIN_LAST = ["file_info__v"];

function isPinnedLast(name) {
  const n = String(name || "").toLowerCase();
  return DT_PIN_LAST.some((p) => p.toLowerCase() === n);
}

function fieldSection(p) {
  const s = p.section != null ? p.section : p.section__v;
  return s == null || s === "" ? null : String(s);
}

function fieldSectionPos(p) {
  const v =
    p.sectionPosition != null
      ? p.sectionPosition
      : p.section_position != null
      ? p.section_position
      : p.order;
  const n = Number(v);
  return Number.isFinite(n) ? n : 9999;
}

// Returns { onLayout, off, detected }. When no property in the set carries a
// section at all, placement isn't on this response — report everything rather
// than an empty panel that reads as a failed load.
function splitByLayout(props) {
  if (!props.some((p) => fieldSection(p) !== null)) {
    return { onLayout: props, off: [], detected: false };
  }
  const onLayout = [];
  const off = [];
  for (const p of props) {
    const placed =
      fieldSection(p) !== null && p.hidden !== true && p.disabled !== true;
    (placed ? onLayout : off).push(p);
  }
  return { onLayout, off, detected: true };
}

// Not fieldRowHtml: that is the data model's row builder, and a second
// top-level function of the same name silently replaces the first everywhere.
function dtFieldRowHtml(p) {
  let h = `<div class="dt-field-row" data-fname="${esc(p.name || "")}">`;
  h += `<span class="dt-field-name" title="${esc(p.name || "")}">${esc(p.name || "")}</span>`;
  h += `<span class="dt-field-label">${esc(p.label || "")}</span>`;
  h += `<span class="dt-field-badges">`;
  if (p.required === true) h += '<span class="dt-badge req">REQ</span>';
  if (p.editable === false) h += '<span class="dt-badge locked">READ-ONLY</span>';
  if (p.repeating === true) h += '<span class="dt-badge rep">MULTI</span>';
  if (p.hidden === true) h += '<span class="dt-badge locked">HIDDEN</span>';
  if (p.scope) h += `<span class="dt-badge scope">${esc(p.scope)}</span>`;
  if (p.type) h += `<span class="dt-badge type-badge">${esc(p.type)}</span>`;
  h += `</span></div>`;
  return h;
}

function showDocTypeFields(type) {
  dtBreadcrumb.innerHTML =
    '<span class="dt-bc-item">Documents</span>' +
    ' <span class="dt-bc-sep">&#8250;</span> ' +
    `<span class="dt-bc-item">${esc(type.label)}</span>`;

  if (type.error) {
    dtStats.classList.add("hidden");
    dtFields.innerHTML = `<div class="dm-empty">Couldn't load this type.<br />${esc(type.error)}</div>`;
    return;
  }

  const props = type.properties || [];
  const { onLayout, off, detected } = splitByLayout(props);
  type._layout = onLayout;
  type._layoutDetected = detected;

  dtStats.classList.remove("hidden");
  dtFieldCount.innerHTML = detected
    ? `${onLayout.length} <small>on layout &middot; ${props.length} total</small>`
    : `${props.length} <small>fields on this type</small>`;

  if (!props.length) {
    dtFields.innerHTML = '<div class="dm-empty">This type declares no fields.</div>';
    return;
  }

  let html = "";

  if (!detected) {
    html +=
      '<div class="dt-field-count">' +
      `${props.length} fields &middot; no section data on this response, showing all` +
      "</div>";
    // No placement data, so payload order is the only sequence Vault gives —
    // bar the pinned boilerplate, which still belongs at the end.
    const order = new Map(props.map((p, i) => [p, i]));
    const flat = [...props].sort(
      (a, b) =>
        (isPinnedLast(a.name) ? 1 : 0) - (isPinnedLast(b.name) ? 1 : 0) ||
        order.get(a) - order.get(b)
    );
    for (const p of flat) html += dtFieldRowHtml(p);
    dtFields.innerHTML = html;
    return;
  }

  // Group into sections and reproduce the panel's own order: fields by
  // sectionPosition within a section, sections by where they first appear.
  const groups = new Map();
  for (const p of onLayout) {
    const s = fieldSection(p) || "General";
    if (!groups.has(s)) groups.set(s, []);
    groups.get(s).push(p);
  }
  // Fields read in true form order: sectionPosition within the section, then the
  // order Vault returned. Required fields are badged, not reordered — moving them
  // would break the sequence someone filling the form actually sees.
  const payloadOrder = new Map(props.map((p, i) => [p, i]));
  for (const list of groups.values()) {
    list.sort(
      (a, b) =>
        (isPinnedLast(a.name) ? 1 : 0) - (isPinnedLast(b.name) ? 1 : 0) ||
        fieldSectionPos(a) - fieldSectionPos(b) ||
        payloadOrder.get(a) - payloadOrder.get(b)
    );
  }
  // Order the sections themselves. sectionPosition may be numbered globally
  // across the layout or restarted per section — Vault is not documented either
  // way — so take each section's lowest position and fall back to the order it
  // first appeared in the payload. Global numbering sorts correctly; per-section
  // numbering ties on 1 and keeps payload order. Right under both readings.
  const sectionFirstSeen = new Map();
  for (const [name, list] of groups) {
    sectionFirstSeen.set(name, Math.min(...list.map((p) => payloadOrder.get(p))));
  }
  const sectionNames = [...groups.keys()].sort((a, b) => {
    const pinned = (isPinnedLast(a) ? 1 : 0) - (isPinnedLast(b) ? 1 : 0);
    if (pinned) return pinned;
    const pa = Math.min(...groups.get(a).map(fieldSectionPos));
    const pb = Math.min(...groups.get(b).map(fieldSectionPos));
    return pa - pb || sectionFirstSeen.get(a) - sectionFirstSeen.get(b);
  });

  const requiredCount = onLayout.filter((p) => p.required === true).length;
  html += `<div class="dt-field-count">${onLayout.length} on layout &middot; ${requiredCount} required &middot; ${sectionNames.length} section${sectionNames.length === 1 ? "" : "s"}</div>`;

  for (const name of sectionNames) {
    html += '<div class="dt-section">';
    html += `<div class="dt-section-header">${esc(name)}</div>`;
    for (const p of groups.get(name)) html += dtFieldRowHtml(p);
    html += "</div>";
  }

  if (off.length) {
    const offSorted = [...off].sort((a, b) => payloadOrder.get(a) - payloadOrder.get(b));
    html += '<div class="dt-offlayout" id="dt-offlayout">';
    html += `<button type="button" class="dt-offlayout-toggle" aria-expanded="false">`;
    html += `<span class="dt-offlayout-arrow">&#9654;</span> Not on layout (${off.length})`;
    html += `</button>`;
    html += '<div class="dt-offlayout-body">';
    for (const p of offSorted) html += dtFieldRowHtml(p);
    html += "</div></div>";
  }

  dtFields.innerHTML = html;
}

dtFields.addEventListener("click", (e) => {
  const btn = e.target.closest(".dt-offlayout-toggle");
  if (!btn) return;
  const wrap = btn.closest(".dt-offlayout");
  const open = wrap.classList.toggle("open");
  btn.setAttribute("aria-expanded", String(open));
});


// ===================== AI PROVIDER KEY =====================
// The key is written to and verified by background.js and never read back into
// this page — popup.js only ever learns whether one exists and its last 4 chars.
let aiProvider = "anthropic";

const AI_PROVIDER_META = {
  anthropic: {
    label: "Anthropic",
    prefix: "sk-ant-",
  },
  openai: {
    label: "OpenAI",
    prefix: "sk-proj-",
  },
  gemini: {
    label: "Gemini",
    prefix: "AIza",
  },
};

const aiMeta = (id) => AI_PROVIDER_META[id] || AI_PROVIDER_META.anthropic;

// The status block is always on screen, so every state has a title and a note.
function setAiStatus(state, title, note) {
  aiKeyStatus.className = `ai-status ${state}`;
  aiStatusTitle.textContent = title;
  aiStatusNote.textContent = note;
}

// Nothing saved is the starting point, not news — the none state renders as
// empty space (see .ai-status.none).
function setAiStatusNone() {
  setAiStatus("none", "", "");
}

function setAiStatusOk(provider, model, hint) {
  const tail = (hint || "").replace(/^…/, "");
  setAiStatus(
    "ok",
    `Verified · ${aiMeta(provider).label}`,
    `${model || "The model"} responded.${tail ? ` Key ends ${tail}.` : ""}`
  );
}

function setAiStatusBad(detail) {
  setAiStatus(
    "bad",
    "Rejected",
    detail || `Enter a key beginning ${aiMeta(aiProvider).prefix} and try again.`
  );
}

function paintAiProvider() {
  for (const tile of aiProviderTiles.querySelectorAll(".ai-tile")) {
    tile.classList.toggle("active", tile.dataset.provider === aiProvider);
  }
  aiKeyInput.placeholder = `${aiMeta(aiProvider).prefix}…`;
}

function setAiKeyMasked(masked) {
  aiKeyInput.type = masked ? "password" : "text";
  aiKeyReveal.textContent = masked ? "show" : "hide";
}

async function refreshAiKeyState() {
  const state = await chrome.runtime.sendMessage({ action: "aiKeyState" });
  if (!state?.success) return;
  aiProvider = state.provider || "anthropic";
  paintAiProvider();
  aiKeyInput.value = "";
  setAiKeyMasked(true);
  aiKeyClear.disabled = !state.hasKey;

  if (!state.hasKey) {
    setAiStatusNone();
    return;
  }
  if (state.verified === true) {
    setAiStatusOk(state.provider, state.model, state.hint);
    return;
  }
  if (state.verified === null) {
    // Stored before verification was tracked — test it once rather than
    // showing a state we cannot vouch for.
    await runAiVerify();
    return;
  }
  setAiStatusBad("This key has not passed a test request yet. Save & verify to check it.");
}

// Shared by "Save & verify" and the one-off migration check above.
async function runAiVerify() {
  setAiStatus("checking", "Verifying…", `Sending a one-token test request to ${aiMeta(aiProvider).label}.`);
  const res = await chrome.runtime.sendMessage({ action: "aiVerifyKey" });
  if (res?.success) {
    setAiStatusOk(res.provider, res.model, res.hint);
  } else {
    setAiStatusBad(res?.error);
  }
  refreshAskAvailability();
  return !!res?.success;
}

aiProviderTiles.addEventListener("click", (e) => {
  const tile = e.target.closest(".ai-tile");
  if (!tile || tile.dataset.provider === aiProvider) return;
  aiProvider = tile.dataset.provider;
  paintAiProvider();
  // A key belongs to one provider — switching invalidates what was verified.
  setAiStatusNone();
});

aiKeyReveal.addEventListener("click", () => {
  setAiKeyMasked(aiKeyInput.type !== "password");
  aiKeyInput.focus();
});

// One action: store the key, then prove it works.
aiKeySave.addEventListener("click", async () => {
  const key = aiKeyInput.value.trim();
  if (!key) {
    setAiStatusBad(`Paste a key beginning ${aiMeta(aiProvider).prefix} first.`);
    return;
  }
  aiKeySave.disabled = true;
  setAiStatus("checking", "Verifying…", `Sending a one-token test request to ${aiMeta(aiProvider).label}.`);

  const res = await chrome.runtime.sendMessage({
    action: "aiSaveKey",
    provider: aiProvider,
    key: key,
  });
  if (!res?.success) {
    aiKeySave.disabled = false;
    setAiStatusBad(res?.error || "Could not save the key.");
    return;
  }
  // Clear the field immediately — nothing needs it in the page after this.
  aiKeyInput.value = "";
  setAiKeyMasked(true);
  aiKeyClear.disabled = false;
  await runAiVerify();
  aiKeySave.disabled = false;
});

aiKeyClear.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ action: "aiSaveKey", provider: aiProvider, key: "" });
  aiKeyInput.value = "";
  setAiKeyMasked(true);
  aiKeyClear.disabled = true;
  setAiStatusNone();
  refreshAskAvailability();
});


// ===================== ASK (VAULT DOCS) =====================
const askNoKey = $("#ask-nokey");
const askPanel = $("#ask-panel");
const askPlatformBtn = $("#ask-platform");
const askPlatformMenu = $("#ask-platform-menu");
const askSourceBtn = $("#ask-source");
const askSourceMenu = $("#ask-source-menu");
const askLog = $("#ask-log");
const askInput = $("#ask-input");
const askSend = $("#ask-send");
const askClear = $("#ask-clear");

const ASK_PLATFORMS = [
  { value: "platform", label: "Platform" },
  { value: "clinical", label: "Clinical" },
  { value: "commercial", label: "Commercial" },
  { value: "quality", label: "Quality" },
  { value: "qualityone", label: "QualityOne" },
  { value: "medical", label: "Medical" },
  { value: "regulatory", label: "Regulatory" },
  { value: "safety", label: "Safety" },
  { value: "vault_crm", label: "Vault CRM" },
];

const ASK_SOURCES = [
  { value: "vault_api_reference", label: "API reference" },
  { value: "vault_developer_documentation", label: "Developer docs" },
  { value: "vault_help_documentation", label: "Vault Help" },
  { value: "vault_java_sdk_javadocs", label: "Java SDK javadocs" },
  { value: "vapil_javadocs", label: "VAPIL javadocs" },
];

const ASK_BLURB =
  "Answers are grounded in Veeva's own documentation and cite the pages they used.";

let askPlatform = "platform";
let askSource = "vault_api_reference";
let askTurns = [];
let askBusy = false;
// Bumped by "new conversation"; an in-flight answer from an older epoch is
// discarded rather than landing in the fresh thread.
let askEpoch = 0;
// The newest question's node — what the log scrolls to and reserves room for.
let askLastQuestion = null;

const askLabel = (list, value) => (list.find((o) => o.value === value) || list[0]).label;

// ---- Vault context ---------------------------------------------------------
// The retrieval in background.js answers "what does Vault do"; this answers
// "what is in THIS vault". It is retrieval too, not a dump: the loaded data
// model runs to hundreds of objects and thousands of fields, so the question
// picks what travels. Only configuration the session already loaded and the
// query in the editor are ever sent — never a record, never a result row.
const ASK_CTX_OBJECTS = 6;
const ASK_CTX_FIELDS = 14;
const ASK_CTX_TYPES = 10;
const ASK_CTX_CHARS = 3200;

// Ordinary English that would rank everything equally. Domain words like
// "document" or "field" are deliberately NOT here — they are how a question
// reaches the right part of the schema.
const ASK_CTX_STOP = new Set([
  "the", "and", "for", "with", "from", "that", "this", "what", "how", "does",
  "can", "are", "you", "all", "get", "use", "using", "when", "which", "into",
  "show", "write", "give", "there", "have", "has", "its", "any", "was", "were",
]);

// Whether the model's schema is worth sending at all when nothing matched
// by name — a question about authentication has no use for object fields.
const ASK_SCHEMA_HINT =
  /\b(vql|select|from|where|query|queries|field|fields|object|objects|record|records|column|columns|picklist|relationship)\b/i;
const ASK_TYPE_HINT = /\b(doc|docs|document|documents|type|types|binder|binders)\b/i;

function askTokens(text) {
  const found = String(text).toLowerCase().match(/[a-z_][a-z0-9_]{2,}/g) || [];
  return [...new Set(found)].filter((t) => !ASK_CTX_STOP.has(t));
}

// Substring rather than whole-word: a question about "status" has to reach
// status__v. Plurals are folded too — "products" must find product__v, which a
// plain substring test misses because the haystack holds the singular.
function askVariants(token) {
  const out = [token];
  if (token.endsWith("ies") && token.length > 4) out.push(`${token.slice(0, -3)}y`);
  if (token.endsWith("es") && token.length > 3) out.push(token.slice(0, -2));
  if (token.endsWith("s") && token.length > 3) out.push(token.slice(0, -1));
  return out;
}

function askScore(tokens, ...fragments) {
  const hay = fragments.filter(Boolean).join(" ").toLowerCase();
  let score = 0;
  for (const t of tokens) {
    const hit = askVariants(t).find((v) => hay.includes(v));
    if (hit) score += hit.length >= 5 ? 3 : 2;
  }
  return score;
}

function askRank(items, tokens, ...keys) {
  return items
    .map((item) => ({ item, score: askScore(tokens, ...keys.map((k) => item[k])) }))
    .sort((a, b) => b.score - a.score);
}

// Returns { text, summary } — summary is what the answer's context chip shows.
function buildVaultContext(question) {
  const tokens = askTokens(question);
  const parts = [];
  const summary = [];

  const objects = state.dataModel?.objects || [];
  if (objects.length) {
    const ranked = askRank(objects, tokens, "name", "label");
    const picked = ranked.filter((r) => r.score > 0).slice(0, ASK_CTX_OBJECTS).map((r) => r.item);
    // Most VQL is written against documents, so it rides along for a question
    // that is about querying but named no object of its own.
    const schemaQuestion = picked.length || ASK_SCHEMA_HINT.test(question);
    if (schemaQuestion && !picked.some((o) => o.name === "documents")) {
      const docs = objects.find((o) => o.name === "documents");
      if (docs) picked.push(docs);
    }
    for (const o of picked) {
      const fields = askRank(o.fields || [], tokens, "name", "label")
        .slice(0, ASK_CTX_FIELDS)
        .map((r) => r.item)
        .filter((f) => f.name)
        .map((f) => `${f.name} (${f.type}${f.required ? ", required" : ""})`);
      if (!fields.length) continue;
      parts.push(`OBJECT ${o.name}${o.label ? ` — ${o.label}` : ""}\n  ${fields.join("\n  ")}`);
    }
    if (picked.length) summary.push(`${picked.length} object${picked.length === 1 ? "" : "s"}`);
  }

  if (docTypes.length) {
    const ranked = askRank(docTypes, tokens, "name", "label");
    const matched = ranked.filter((r) => r.score > 0);
    // Named types win; otherwise the list travels only for a question that is
    // actually about document types.
    const picked = (matched.length
      ? matched
      : ASK_TYPE_HINT.test(question)
        ? ranked
        : []
    )
      .slice(0, ASK_CTX_TYPES)
      .map((r) => r.item);
    if (picked.length) {
      const lines = picked.map(
        (t) =>
          `${t.label} (${t.name})` + (t.docCount != null ? ` — ${t.docCount} documents` : "")
      );
      parts.push(`DOCUMENT TYPES\n  ${lines.join("\n  ")}`);
      summary.push(`${picked.length} doc type${picked.length === 1 ? "" : "s"}`);
    }
  }

  const vql = vqlInput.value.trim();
  if (vql) {
    parts.push(`QUERY CURRENTLY IN THE EDITOR\n  ${vql.slice(0, 400)}`);
    summary.push("current query");
  }

  if (!parts.length) return { text: "", summary: "" };
  let text = parts.join("\n\n");
  if (text.length > ASK_CTX_CHARS) text = `${text.slice(0, ASK_CTX_CHARS)}\n…(truncated)`;
  return { text, summary: summary.join(" · ") };
}

function paintAskScope() {
  askPlatformBtn.querySelector(".ask-pill-text").textContent = askLabel(ASK_PLATFORMS, askPlatform);
  askSourceBtn.querySelector(".ask-pill-text").textContent = askLabel(ASK_SOURCES, askSource);
}

function renderAskMenu(menuEl, options, current) {
  menuEl.innerHTML = options
    .map(
      (o) =>
        `<button class="ask-menu-item${o.value === current ? " active" : ""}" data-value="${esc(
          o.value
        )}">${esc(o.label)}</button>`
    )
    .join("");
}

function closeAskMenus(except) {
  for (const [btn, menu] of [
    [askPlatformBtn, askPlatformMenu],
    [askSourceBtn, askSourceMenu],
  ]) {
    if (menu === except) continue;
    menu.classList.add("hidden");
    btn.setAttribute("aria-expanded", "false");
  }
}

function toggleAskMenu(btn, menu, options, current) {
  const willOpen = menu.classList.contains("hidden");
  closeAskMenus(willOpen ? menu : null);
  if (!willOpen) {
    menu.classList.add("hidden");
    btn.setAttribute("aria-expanded", "false");
    return;
  }
  renderAskMenu(menu, options, current);
  menu.classList.remove("hidden");
  btn.setAttribute("aria-expanded", "true");
}

askPlatformBtn.addEventListener("click", () =>
  toggleAskMenu(askPlatformBtn, askPlatformMenu, ASK_PLATFORMS, askPlatform)
);
askSourceBtn.addEventListener("click", () =>
  toggleAskMenu(askSourceBtn, askSourceMenu, ASK_SOURCES, askSource)
);

askPlatformMenu.addEventListener("click", (e) => {
  const item = e.target.closest(".ask-menu-item");
  if (!item) return;
  askPlatform = item.dataset.value;
  // Vault CRM content lives only in Vault Help.
  if (askPlatform === "vault_crm") askSource = "vault_help_documentation";
  closeAskMenus();
  paintAskScope();
});

askSourceMenu.addEventListener("click", (e) => {
  const item = e.target.closest(".ask-menu-item");
  if (!item) return;
  askSource = item.dataset.value;
  if (askSource.endsWith("javadocs")) askPlatform = "platform";
  closeAskMenus();
  paintAskScope();
});

document.addEventListener("click", (e) => {
  if (!e.target.closest(".ask-pill-wrap")) closeAskMenus();
});

// Model output is untrusted text: escape everything, then re-introduce only
// inline code spans.
function askInline(text) {
  return esc(text).replace(/`([^`]+)`/g, "<code>$1</code>");
}

function askCodeCard(lang, code) {
  return (
    '<div class="ask-code">' +
    '<div class="ask-code-bar">' +
    `<span class="ask-code-lang">${esc(lang || "code")}</span>` +
    '<button class="ask-copy" type="button">copy</button>' +
    "</div>" +
    `<pre>${esc(code)}</pre>` +
    "</div>"
  );
}

// Fenced blocks become their own cards; everything else stays flowing text.
function askFormat(text) {
  const re = /```([A-Za-z0-9+#._-]*)\n?([\s\S]*?)```/g;
  let html = "";
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    const before = text.slice(last, m.index);
    if (before.trim()) html += `<div class="ask-text">${askInline(before.trim())}</div>`;
    html += askCodeCard(m[1], m[2].replace(/\n+$/, ""));
    last = re.lastIndex;
  }
  const rest = text.slice(last);
  if (rest.trim() || !html) html += `<div class="ask-text">${askInline(rest.trim())}</div>`;
  return html;
}

function askEmptyState() {
  return (
    '<div class="ask-empty">' +
    '<div class="ask-empty-title">Ask anything about the Vault API.</div>' +
    `<div class="ask-empty-body">${esc(ASK_BLURB)}</div>` +
    "</div>"
  );
}

// Long answers are clamped to a readable opening and opened by the row beneath
// them. That keeps the panel from growing without bound, which is what made the
// overlay thrash the host page on every height report.
const ASK_CLAMP_AT = 300;
const ASK_CLAMP_TO = 240;
const ASK_PIN_GAP = 10;
const ASK_OPEN_LABEL = "show full answer \u25be";
const ASK_CLOSE_LABEL = "collapse \u25b4";

const reducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function askSourcesHtml(sources, context) {
  // The vault chip is not a citation — it tells the user which of their own
  // configuration went to the provider with the question.
  const ctxPill = context
    ? `<span class="ask-source ask-context" title="Sent with your question: ${esc(
        context
      )}. Configuration only — no record data.">` +
      `<span class="ask-source-n">&#9733;</span>` +
      `<span class="ask-source-title">your vault · ${esc(context)}</span></span>`
    : "";
  const pills = (sources || [])
    .map((sref) => ({ ...sref, url: safeUrl(sref.url) }))
    .filter((sref) => sref.url)
    .map(
      (sref, i) =>
        `<a class="ask-source" href="${esc(sref.url)}" target="_blank" rel="noopener noreferrer" title="${esc(
          sref.title
        )}"><span class="ask-source-n">${i + 1}</span><span class="ask-source-title">${esc(
          sref.title
        )}</span></a>`
    )
    .join("");
  return pills || ctxPill ? `<div class="ask-sources">${ctxPill}${pills}</div>` : "";
}

function askTurnHtml(t) {
  if (t.role === "user") {
    return `<div class="ask-msg user"><div class="ask-msg-body">${esc(t.content)}</div></div>`;
  }
  const cls = t.error ? "error" : "assistant";
  const body = t.pending
    ? '<div class="ask-thinking"><div class="ask-dots"><span></span><span></span><span></span></div>' +
      `<span class="ask-thinking-label">searching ${esc(askLabel(ASK_SOURCES, askSource))}</span></div>`
    : `<div class="ask-answer">${askFormat(t.content)}</div>` +
      (t.sources?.length || t.context ? askSourcesHtml(t.sources, t.context) : "");
  return (
    `<div class="ask-msg ${cls}"><div class="ask-msg-row">` +
    `<span class="ask-avatar">V</span><div class="ask-msg-body">${body}</div>` +
    "</div></div>"
  );
}

// Turns are appended as nodes. Rebuilding the whole log on every reply meant
// re-parsing every earlier answer — the cost the user felt as lag.
function askAppendTurn(t) {
  const holder = document.createElement("div");
  holder.innerHTML = askTurnHtml(t);
  const node = holder.firstElementChild;
  const spacer = askLog.querySelector(".ask-spacer");
  if (spacer) askLog.insertBefore(node, spacer);
  else askLog.appendChild(node);
  return node;
}

// Clamps an answer that runs past ASK_CLAMP_AT and gives it the opener row.
function askClamp(node) {
  const answer = node?.querySelector(".ask-answer");
  if (!answer || answer.dataset.clamped) return;
  if (answer.scrollHeight <= ASK_CLAMP_AT) return;
  answer.dataset.clamped = "1";
  answer.classList.add("collapsed");
  const row = document.createElement("button");
  row.type = "button";
  row.className = "ask-expand";
  row.textContent = ASK_OPEN_LABEL;
  answer.after(row);
}

function askToggleAnswer(row) {
  const answer = row.previousElementSibling;
  if (!answer?.classList.contains("ask-answer")) return;
  const opening = answer.classList.contains("collapsed");
  const start = answer.getBoundingClientRect().height;

  answer.classList.toggle("collapsed", !opening);
  row.textContent = opening ? ASK_CLOSE_LABEL : ASK_OPEN_LABEL;

  if (reducedMotion()) {
    answer.style.maxHeight = opening ? "none" : "";
    askAfterToggle(row, opening);
    return;
  }

  // Animated between measured heights rather than to a max-height the content
  // never reaches, so the easing matches the distance actually travelled.
  answer.style.maxHeight = "none";
  const end = opening ? answer.scrollHeight : ASK_CLAMP_TO;
  answer.style.maxHeight = `${start}px`;
  void answer.offsetHeight;
  answer.style.transition = "max-height .3s cubic-bezier(.4,0,.2,1)";
  answer.style.maxHeight = `${end}px`;

  // Hands height back to the stylesheet once the glide is over. The timer is a
  // fallback: a transitionend that never arrives would pin the answer at a
  // pixel height forever.
  const settle = () => {
    answer.removeEventListener("transitionend", onEnd);
    answer.style.transition = "";
    answer.style.maxHeight = opening ? "none" : "";
  };
  const onEnd = (e) => {
    if (e.propertyName === "max-height") settle();
  };
  answer.addEventListener("transitionend", onEnd);
  setTimeout(settle, 400);

  askAfterToggle(row, opening);
}

// Closing an answer leaves a hole below it; reopening changes how much room the
// newest question needs. Both want the reserve recomputed.
function askAfterToggle(row, opened) {
  askReserveRoom();
  if (opened) return;
  const msg = row.closest(".ask-msg");
  if (msg === askLastQuestion?.nextElementSibling) askPinQuestion("smooth");
  else if (msg) askLog.scrollTo({
    top: Math.max(0, askOffsetOf(msg) - ASK_PIN_GAP),
    behavior: reducedMotion() ? "auto" : "smooth",
  });
}

// How much room the overlay has on the host page. content.js sends it, because
// this window's own viewport is just the height we last reported.
let askSpace = 0;

window.addEventListener("message", (e) => {
  if (e.source !== window.parent) return;
  // Only the host page this overlay is embedded in, or ourselves in full-window
  // mode. Anything else running on that page can post here too.
  let fromHost = false;
  try {
    fromHost = e.origin === location.origin || isVaultHost(new URL(e.origin).hostname);
  } catch (err) {
    fromHost = false;
  }
  if (!fromHost) return;
  if (e.data?.type !== "vault-dweller-space") return;
  const h = Number(e.data.height);
  if (!Number.isFinite(h) || h <= 0) return;
  askSpace = h;
  fitAskLog();
});

// Gives the conversation a fixed height filling the room the overlay has.
// Fixed, not max — a height that grows with the content resizes the panel the
// moment a question is asked, which moves the whole layout under the user.
// Everything above and below the log stays put; only the log scrolls.
function fitAskLog() {
  if (WINDOW_MODE || !askSpace) return;
  const logH = askLog.getBoundingClientRect().height;
  if (!logH) return; // Ask tab not on screen; nothing to measure against.
  const shellH = document.querySelector(".shell").getBoundingClientRect().height;
  const chrome = shellH - logH;
  // The floor is deliberately low: on a short browser window a cramped
  // conversation beats a panel whose composer is off screen.
  const h = Math.max(120, Math.min(560, askSpace - chrome - 10));
  document.documentElement.style.setProperty("--ask-log-h", `${h}px`);
}

// Distance from the top of the log's scrollable content to a turn.
function askOffsetOf(node) {
  return (
    node.getBoundingClientRect().top -
    askLog.getBoundingClientRect().top +
    askLog.scrollTop
  );
}

function askSpacerEl() {
  let el = askLog.querySelector(".ask-spacer");
  if (!el) {
    el = document.createElement("div");
    el.className = "ask-spacer";
  }
  if (el !== askLog.lastElementChild) askLog.appendChild(el);
  return el;
}

// Reserves room under the newest exchange so its question can actually reach
// the top of the log. Without it the scroll runs out partway and the question
// stops wherever it happened to land.
// Run twice: the first pass can push the log itself to its max height, which
// changes the room available to the second.
function askReserveRoom() {
  const q = askLastQuestion;
  if (!q || !askLog.contains(q)) return;
  const spacer = askSpacerEl();
  for (let pass = 0; pass < 2; pass++) {
    spacer.style.height = "0px";
    const below = askLog.scrollHeight - askOffsetOf(q);
    spacer.style.height = `${Math.max(0, askLog.clientHeight - below - ASK_PIN_GAP)}px`;
  }
}

// Puts the question the user just asked at the top of the log. Instant by
// default: an animated scroll here races the answer landing and the composer
// taking focus, and losing that race is what put the view at the bottom.
function askPinQuestion(behavior) {
  const q = askLastQuestion;
  if (!q || !askLog.contains(q)) return;
  fitAskLog();
  askReserveRoom();
  askLog.scrollTo({
    top: Math.max(0, askOffsetOf(q) - ASK_PIN_GAP),
    behavior: reducedMotion() ? "auto" : behavior || "auto",
  });
}

// Full rebuild — only for the empty state and "new conversation".
function renderAskLog() {
  askLog.innerHTML = "";
  if (!askTurns.length) {
    askLog.innerHTML = askEmptyState();
    return;
  }
  let lastUser = null;
  for (const t of askTurns) {
    const node = askAppendTurn(t);
    if (t.role === "user") lastUser = node;
    else askClamp(node);
  }
  askLastQuestion = lastUser;
  askPinQuestion("auto");
}

// Measured while the tab is still hidden, scrollHeight reads 0 — the floor
// keeps the field one line tall until it has real content to size to.
function autoGrowAskInput() {
  askInput.style.height = "auto";
  askInput.style.height = `${Math.min(Math.max(askInput.scrollHeight, 26), 120)}px`;
  // A taller composer shortens the conversation rather than the panel.
  fitAskLog();
}

// Only a verified key unlocks Ask — a stored-but-rejected key would just fail
// on the first question.
async function refreshAskAvailability() {
  const state = await chrome.runtime.sendMessage({ action: "aiKeyState" });
  const ready = !!state?.hasKey && state.verified !== false;
  if (state?.provider) aiProvider = state.provider;
  askPanel.classList.toggle("hidden", !ready);
  askNoKey.classList.toggle("hidden", ready);
  if (ready && !askLog.innerHTML) renderAskLog();
  if (ready) fitAskLog();
}

// Replays only exchanges that completed. Dropping a failed answer on its own
// would leave two user turns next to each other, which Anthropic and Gemini
// reject outright — one failed question would poison the rest of the thread.
function askHistory() {
  const out = [];
  for (let i = 0; i < askTurns.length; i++) {
    const q = askTurns[i];
    const a = askTurns[i + 1];
    if (q.role !== "user") continue;
    if (!a || a.role !== "assistant" || a.error) continue;
    out.push({ role: "user", content: q.content });
    out.push({ role: "assistant", content: a.content });
  }
  return out;
}

async function sendAsk(text) {
  const question = (text ?? askInput.value).trim();
  if (!question || askBusy) return;

  askBusy = true;
  askSend.disabled = true;
  askInput.value = "";
  autoGrowAskInput();

  if (!askTurns.length) askLog.innerHTML = "";
  const userTurn = { role: "user", content: question };
  askTurns.push(userTurn);
  const userNode = askAppendTurn(userTurn);
  const pendingNode = askAppendTurn({ role: "assistant", content: "", pending: true });
  askLastQuestion = userNode;
  askPinQuestion();

  const ctx = buildVaultContext(question);
  // A "new conversation" mid-flight must not let this answer land in the
  // cleared thread, where it would become an assistant turn with no question
  // in front of it and break the next request.
  const epoch = askEpoch;

  let res;
  try {
    res = await chrome.runtime.sendMessage({
      action: "aiChat",
      platform: askPlatform,
      source: askSource,
      vaultContext: ctx.text,
      messages: askHistory().concat([{ role: "user", content: question }]),
    });
  } catch (err) {
    // A closed port rejects rather than returning; without this the composer
    // would stay disabled for good.
    res = { success: false, error: err?.message || "The extension worker is unavailable." };
  } finally {
    askBusy = false;
    askSend.disabled = false;
  }

  if (epoch !== askEpoch) return;

  const answer = res?.success
    ? {
        role: "assistant",
        content: res.answer,
        provider: res.provider,
        sources: res.sources,
        context: ctx.summary,
      }
    : { role: "assistant", content: res?.error || "Request failed.", error: true };
  askTurns.push(answer);

  pendingNode.remove();
  const answerNode = askAppendTurn(answer);
  askClamp(answerNode);
  // The answer replaced a short placeholder, so the room below changed — pin
  // again to hold the question at the top.
  askPinQuestion();

  // preventScroll matters: the composer sits below the log, so a plain focus()
  // scrolls the page down to reveal it and undoes the pin.
  askInput.focus({ preventScroll: true });
}

askSend.addEventListener("click", () => sendAsk());

askInput.addEventListener("input", autoGrowAskInput);

askInput.addEventListener("keydown", (e) => {
  // Enter sends; Shift+Enter is a newline, as in any chat composer.
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendAsk();
  }
});

askLog.addEventListener("click", async (e) => {
  const expander = e.target.closest(".ask-expand");
  if (expander) {
    askToggleAnswer(expander);
    return;
  }
  const copy = e.target.closest(".ask-copy");
  if (!copy) return;
  const pre = copy.closest(".ask-code")?.querySelector("pre");
  if (!pre) return;
  await navigator.clipboard.writeText(pre.textContent);
  copy.textContent = "copied";
  copy.classList.add("copied");
  setTimeout(() => {
    copy.textContent = "copy";
    copy.classList.remove("copied");
  }, 1200);
});

askClear.addEventListener("click", () => {
  askTurns = [];
  askLastQuestion = null;
  askEpoch++;
  renderAskLog();
  askInput.focus({ preventScroll: true });
});

paintAskScope();
autoGrowAskInput();

// ===================== API HELPER =====================
async function apiCall(endpoint, method = "GET", body = null) {
  return chrome.runtime.sendMessage({
    action: "apiCall",
    domain: state.domain,
    sessionId: state.sessionId,
    endpoint,
    method,
    body,
  });
}

// ===================== DATA TYPES TAB =====================
const DATA_TYPE_CATEGORIES = [
  { key: "documents", label: "Documents", match: (o) => o.name === "documents" || /document/i.test(o.name) },
  { key: "users",     label: "Users",     match: (o) => /user/i.test(o.name) },
  { key: "products",  label: "Products",  match: (o) => /product/i.test(o.name) },
];

function renderDataTypes() {
  const empty = document.getElementById("datatypes-empty");
  const container = document.getElementById("datatypes-sections");
  if (!container || !empty) return;

  if (!state.dataModel || !state.dataModel.objects) {
    empty.style.display = "";
    container.innerHTML = "";
    empty.textContent = state.sessionId
      ? "Load the data model first (Data Model tab) to browse data types."
      : "Connect to a Vault first.";
    return;
  }
  empty.style.display = "none";

  // Avoid re-rendering if already built; just refresh contents.
  if (container.dataset.built === "1") return;
  container.dataset.built = "1";

  container.innerHTML = DATA_TYPE_CATEGORIES.map((cat) => `
    <div class="dt-cat" data-cat="${cat.key}">
      <div class="dt-cat-header">
        <span class="dt-cat-arrow">&#9654;</span>
        <span class="dt-cat-label">${esc(cat.label)}</span>
        <span class="dt-cat-count" id="dt-cat-count-${cat.key}"></span>
      </div>
      <div class="dt-cat-body">
        <input type="text" class="dt-cat-search" placeholder="Search ${esc(cat.label.toLowerCase())} by label..." data-cat="${cat.key}" />
        <div class="dt-cat-list" id="dt-cat-list-${cat.key}"></div>
      </div>
    </div>
  `).join("");

  // Wire collapse + search
  container.querySelectorAll(".dt-cat").forEach((catEl) => {
    const key = catEl.dataset.cat;
    const header = catEl.querySelector(".dt-cat-header");
    header.addEventListener("click", () => {
      catEl.classList.toggle("open");
    });
    const search = catEl.querySelector(".dt-cat-search");
    search.addEventListener("click", (e) => e.stopPropagation());
    search.addEventListener("input", () => renderDataTypeCategory(key, search.value));
  });

  // Initial render of all three lists
  DATA_TYPE_CATEGORIES.forEach((cat) => renderDataTypeCategory(cat.key, ""));
}

function renderDataTypeCategory(key, filter) {
  const cat = DATA_TYPE_CATEGORIES.find((c) => c.key === key);
  if (!cat) return;
  const listEl = document.getElementById(`dt-cat-list-${key}`);
  const countEl = document.getElementById(`dt-cat-count-${key}`);
  if (!listEl || !state.dataModel) return;

  const objs = state.dataModel.objects.filter(cat.match);
  const f = (filter || "").trim().toLowerCase();

  // For each matching object, filter its fields by label (or name) when searching.
  const visible = objs.map((o) => {
    if (!f) return { obj: o, fields: o.fields, hidden: false };
    const objMatches = (o.label || "").toLowerCase().includes(f) || o.name.toLowerCase().includes(f);
    const fields = o.fields.filter(
      (fl) => (fl.label || "").toLowerCase().includes(f) || fl.name.toLowerCase().includes(f)
    );
    return { obj: o, fields, hidden: !objMatches && fields.length === 0 };
  }).filter((x) => !x.hidden);

  countEl.textContent = `${visible.length} / ${objs.length}`;

  if (visible.length === 0) {
    listEl.innerHTML = `<div class="dm-empty">No matches.</div>`;
    return;
  }

  listEl.innerHTML = visible.map(({ obj, fields }) => `
    <div class="dt-obj">
      <div class="dt-obj-header">
        <span class="dt-obj-arrow">&#9654;</span>
        <span class="dt-obj-label">${esc(obj.label || obj.name)}</span>
        <span class="dt-obj-name">${esc(obj.name)}</span>
        <span class="dt-obj-count">${fields.length}</span>
      </div>
      <div class="dt-obj-fields">
        ${fields.map((fl) => `
          <div class="dt-obj-field">
            <span class="dt-obj-field-label">${esc(fl.label || fl.name)}</span>
            <span class="dt-obj-field-name">${esc(fl.name)}</span>
            <span class="dt-obj-field-type">${esc(fl.type || "")}</span>
          </div>
        `).join("")}
      </div>
    </div>
  `).join("");

  listEl.querySelectorAll(".dt-obj-header").forEach((h) => {
    h.addEventListener("click", () => h.parentElement.classList.toggle("open"));
  });
}

// Re-render data types whenever the data model changes (loaded/cleared/switched).
const _origOnDataModelLoaded = onDataModelLoaded;
onDataModelLoaded = function (timeStr) {
  _origOnDataModelLoaded(timeStr);
  const container = document.getElementById("datatypes-sections");
  if (container) container.dataset.built = "";
  // If the Data Types tab is currently active, refresh it now.
  const dtTab = document.querySelector('#tab-datatypes.active');
  if (dtTab) renderDataTypes();
};

// ===================== FULL-WINDOW WORKBENCH =====================
// popup.html?mode=window is laid out as a workbench: the data model down the
// left, a tabbed editor over a paged results table in the middle, and an
// inspector for the selected row on the right. Everything below is either
// window-only or a no-op in the overlay, whose layout is unchanged.

const queryTabsEl = $("#query-tabs");
const formatBtn = $("#format-btn");
const limitSelect = $("#limit-select");
const resultsFilter = $("#results-filter");
const columnsBtn = $("#columns-btn");
const columnsMenu = $("#columns-menu");
const resultsRange = $("#results-range");
const resultsHint = $("#results-hint");
const pagePrev = $("#page-prev");
const pageNext = $("#page-next");
const inspEmpty = $("#insp-empty");
const inspBody = $("#insp-body");
const inspTitle = $("#insp-title");
const inspFields = $("#insp-fields");
const inspOpen = $("#insp-open");
const inspCopy = $("#insp-copy");
const recentList = $("#recent-list");

// Called once, from init, in window mode only.
function initWorkbench(saved) {
  const stored = saved.queryTabs;
  const seen = new Set();
  const tabs = (Array.isArray(stored?.tabs) ? stored.tabs : [])
    .filter((t) => t && typeof t.id === "string" && !seen.has(t.id) && seen.add(t.id))
    .map((t) => ({
      id: t.id,
      title: typeof t.title === "string" && t.title.trim() ? t.title.trim().slice(0, 60) : null,
      query: typeof t.query === "string" ? t.query : "",
    }));
  queryTabs = tabs.length ? tabs : [blankTab()];
  activeTabId = queryTabs.some((t) => t.id === stored?.active) ? stored.active : queryTabs[0].id;
  vqlInput.value = activeTab().query;

  // "All" unless the user has picked a cap: the editor has always fetched every
  // page, and a silent 100-row default would read as missing data.
  const limits = [...limitSelect.options].map((o) => o.value);
  limitSelect.value = limits.includes(saved.queryLimit) ? saved.queryLimit : "";

  // The empty states point at the top bar, where the load chips live here.
  dmEmptyState.innerHTML =
    '<div class="dm-empty-title">No data model yet</div>' +
    "<p>Load it once per vault to browse objects and fields here and get autocomplete in the editor.</p>" +
    '<button type="button" class="dm-empty-load">Load data model</button>';
  dtEmpty.innerHTML = "Use <strong>LOAD TYPES</strong> in the top bar.";

  wireWorkbench();
  paintEditor();
  renderQueryTabs();
  resetResultsView();
  renderRecent();
  // Relative times ("5 min ago") go stale while the tab sits open.
  setInterval(renderRecent, 60 * 1000);
}

function wireWorkbench() {
  vqlInput.addEventListener("scroll", syncEditorScroll);
  window.addEventListener("resize", fitEditor);

  formatBtn.addEventListener("click", formatEditor);
  limitSelect.addEventListener("change", () => {
    chrome.storage.local.set({ queryLimit: limitSelect.value });
  });

  queryTabsEl.addEventListener("click", (e) => {
    if (e.target.closest(".qtab-rename")) return;
    if (e.target.closest(".qtab-new")) return newQueryTab();
    const close = e.target.closest("[data-close]");
    if (close) return closeQueryTab(close.dataset.close);
    const tab = e.target.closest(".qtab");
    if (tab) switchQueryTab(tab.dataset.tabId);
  });
  queryTabsEl.addEventListener("dblclick", (e) => {
    const tab = e.target.closest(".qtab");
    if (tab && !e.target.closest("[data-close], .qtab-rename")) renameQueryTab(tab.dataset.tabId);
  });
  // Middle-click closes, as it does for browser tabs.
  queryTabsEl.addEventListener("auxclick", (e) => {
    const tab = e.target.closest(".qtab");
    if (e.button === 1 && tab) closeQueryTab(tab.dataset.tabId);
  });
  queryTabsEl.addEventListener("keydown", (e) => {
    const tab = e.target.closest(".qtab");
    if (!tab || e.target.closest(".qtab-rename")) return;
    if (e.key === "F2" || e.key === "Enter") {
      e.preventDefault();
      renameQueryTab(tab.dataset.tabId);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const i = queryTabs.findIndex((t) => t.id === activeTabId);
      const next = queryTabs[i + (e.key === "ArrowLeft" ? -1 : 1)];
      if (!next) return;
      switchQueryTab(next.id);
      queryTabsEl.querySelector(".qtab.active")?.focus();
    }
  });

  resultsFilter.addEventListener("input", () => {
    if (!resultsView.active) return;
    resultsView.filter = resultsFilter.value;
    resultsView.page = 0;
    paintResultsView();
    resultsContainer.scrollTop = 0;
  });
  pagePrev.addEventListener("click", () => turnResultsPage(-1));
  pageNext.addEventListener("click", () => turnResultsPage(1));

  columnsBtn.addEventListener("click", () => {
    if (!columnsMenu.classList.contains("hidden")) return closeColumnsMenu();
    renderColumnsMenu();
    columnsMenu.classList.remove("hidden");
    columnsBtn.setAttribute("aria-expanded", "true");
  });
  columnsMenu.addEventListener("change", (e) => {
    const box = e.target.closest("input[data-col]");
    if (!box) return;
    if (box.checked) resultsView.hidden.delete(box.dataset.col);
    else resultsView.hidden.add(box.dataset.col);
    columnsMenu.querySelector(".columns-all").disabled = !resultsView.hidden.size;
    paintColumnsButton();
    paintResultsView();
  });
  columnsMenu.addEventListener("click", (e) => {
    if (!e.target.closest(".columns-all")) return;
    resultsView.hidden.clear();
    paintColumnsButton();
    paintResultsView();
    renderColumnsMenu();
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".columns-wrap")) closeColumnsMenu();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeColumnsMenu();
  });

  inspCopy.addEventListener("click", async () => {
    const row = queryRows[resultsView.selected];
    if (!row) return;
    await navigator.clipboard.writeText(JSON.stringify(row, null, 2));
    inspCopy.textContent = "Copied";
    setTimeout(() => (inspCopy.textContent = "Copy JSON"), 1200);
  });

  recentList.addEventListener("click", (e) => {
    const item = e.target.closest(".recent-item");
    if (item) loadHistoryQuery(parseInt(item.dataset.index));
  });

  dmEmptyState.addEventListener("click", (e) => {
    if (e.target.closest(".dm-empty-load")) modelChip.click();
  });

  // Object headings are divs (they hold the SEL button), so they need the
  // keyboard activation a real button would get for free.
  dmTree.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target.classList.contains("dm-group")) {
      e.preventDefault();
      const name = e.target.dataset.obj;
      e.target.click();
      // The click rebuilt the tree; put focus back on the same heading.
      dmTree.querySelector(`.dm-group[data-obj="${CSS.escape(name)}"]`)?.focus();
    }
  });

  // "/" jumps to the data model search from anywhere that isn't a text field.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest?.("input, textarea, select, [contenteditable='true']")) return;
    if (vqlPanel.classList.contains("hidden") || dmPanel.classList.contains("hidden")) return;
    e.preventDefault();
    dmSearch.focus();
    dmSearch.select();
  });

  // Flush a debounced save if the tab closes mid-typing.
  window.addEventListener("pagehide", persistTabs);
}

// ---- Editor: highlighting and line numbers --------------------------------
const VQL_KEYWORD_SET = new Set([
  ...VQL_KEYWORDS.flatMap((k) => k.split(" ")),
  "IS", "BY", "AS", "PAGESIZE", "PAGEOFFSET", "ESCAPE",
]);

// Every character lands in exactly one token, so joining the tokens gives back
// the input — the highlight layer has to line up with the textarea glyph for
// glyph. Literals come first so a keyword inside quotes stays a literal, and an
// unterminated one runs to the end rather than flipping colours as you type.
const VQL_TOKEN_RE = /'(?:[^'\\]|\\.)*'?|\s+|[A-Za-z_][\w.]*|\d+(?:\.\d+)?|[^\sA-Za-z_'\d]/g;

const isVqlKeyword = (tok) => /^[A-Za-z_]+$/.test(tok) && VQL_KEYWORD_SET.has(tok.toUpperCase());

function highlightVql(text) {
  let html = "";
  for (const tok of text.match(VQL_TOKEN_RE) || []) {
    if (tok[0] === "'") html += `<span class="hl-str">${esc(tok)}</span>`;
    else if (isVqlKeyword(tok)) html += `<span class="hl-kw">${esc(tok)}</span>`;
    else html += esc(tok);
  }
  return html;
}

// Called after anything rewrites the editor — typing, inserts, history, tab
// switches — to repaint the layers and keep the tab's copy current.
function editorChanged() {
  if (!WINDOW_MODE) return;
  paintEditor();
  const tab = activeTab();
  if (tab && tab.query !== vqlInput.value) {
    const before = tabLabel(tab);
    tab.query = vqlInput.value;
    // Untitled tabs follow the FROM clause; skip the rebuild when they don't move.
    if (tabLabel(tab) !== before) renderQueryTabs();
    persistTabsSoon();
  }
}

function paintEditor() {
  const text = vqlInput.value;
  // A <pre> gives a trailing newline no line of its own, so the caret's last
  // line would have nothing under it.
  editorHl.innerHTML = highlightVql(text) + (text.endsWith("\n") ? " " : "");
  const lines = text.split("\n").length;
  editorGutter.textContent = Array.from({ length: lines }, (_, i) => i + 1).join("\n");
  fitEditor();
  syncEditorScroll();
}

// Grows with the query up to a share of the window, then scrolls; the results
// card takes whatever height is left.
function fitEditor() {
  if (!WINDOW_MODE) return;
  const max = Math.max(220, Math.round(window.innerHeight * 0.45));
  vqlInput.style.height = "auto";
  // offsetHeight - clientHeight is the horizontal scrollbar when a line runs
  // long; without it the last line hides under the bar.
  const want = vqlInput.scrollHeight + (vqlInput.offsetHeight - vqlInput.clientHeight);
  vqlInput.style.height = `${Math.min(want, max)}px`;
}

function syncEditorScroll() {
  editorHl.scrollTop = vqlInput.scrollTop;
  editorHl.scrollLeft = vqlInput.scrollLeft;
  editorGutter.scrollTop = vqlInput.scrollTop;
}

// ---- Format ---------------------------------------------------------------
const VQL_BREAK_BEFORE = new Set([
  "FROM", "WHERE", "FIND", "HAVING", "LIMIT", "OFFSET", "PAGESIZE", "PAGEOFFSET", "MAXROWS", "SKIP",
]);

// One clause per line, AND/OR indented under WHERE, keywords upper-cased, a
// long SELECT list wrapped under its first field. Only the top level is
// touched: a subquery in the SELECT list stays on its line.
function formatVql(src) {
  const toks = src.trim().match(VQL_TOKEN_RE) || [];
  const nextWord = (i) => {
    for (let j = i + 1; j < toks.length; j++) if (!/^\s/.test(toks[j])) return toks[j].toUpperCase();
    return "";
  };
  const lineLength = (s) => s.length - s.lastIndexOf("\n") - 1;

  let out = "";
  let depth = 0;
  let inSelect = false;
  let inBetween = false;
  for (let i = 0; i < toks.length; i++) {
    let t = toks[i];
    if (/^\s/.test(t)) {
      if (out && !/[ \n]$/.test(out)) out += " ";
      continue;
    }
    if (t === ",") {
      out = `${out.replace(/ $/, "")}, `;
      continue;
    }
    if (t === "(") depth++;
    else if (t === ")") depth = Math.max(0, depth - 1);
    else if (isVqlKeyword(t)) {
      const up = t.toUpperCase();
      t = up;
      if (depth === 0 && out) {
        const clause = VQL_BREAK_BEFORE.has(up) || ((up === "ORDER" || up === "GROUP") && nextWord(i) === "BY");
        // The AND inside BETWEEN … AND … is part of one condition.
        const joiner = (up === "AND" && !inBetween) || up === "OR";
        if (clause) out = `${out.replace(/ $/, "")}\n`;
        else if (joiner) out = `${out.replace(/ $/, "")}\n  `;
      }
      if (depth === 0) {
        if (up === "SELECT") inSelect = true;
        if (up === "FROM") inSelect = false;
        if (up === "BETWEEN") inBetween = true;
        else if (up === "AND") inBetween = false;
      }
    }
    if (inSelect && depth === 0 && out.endsWith(", ") && lineLength(out) + t.length > 78) {
      out = `${out.slice(0, -1)}\n       `;
    }
    out += t;
  }
  return out;
}

function formatEditor() {
  const src = vqlInput.value;
  if (!src.trim()) return;
  const formatted = formatVql(src);
  if (formatted === src) return;
  // Through execCommand rather than .value so Ctrl+Z can take the format back.
  vqlInput.focus();
  vqlInput.select();
  if (!document.execCommand("insertText", false, formatted)) vqlInput.value = formatted;
  hideAc();
  historyNavIndex = -1;
  editorChanged();
}

// ---- Select-list helpers (shift-click a field) ------------------------------
// The span of the top-level SELECT list: from after SELECT up to its FROM,
// skipping anything inside parentheses or quotes.
function vqlSelectListSpan(q) {
  const re = new RegExp(VQL_TOKEN_RE.source, "g");
  let depth = 0;
  let start = -1;
  let m;
  while ((m = re.exec(q))) {
    const t = m[0];
    if (t === "(") depth++;
    else if (t === ")") depth = Math.max(0, depth - 1);
    else if (depth === 0 && /^select$/i.test(t) && start === -1) start = m.index + t.length;
    else if (depth === 0 && /^from$/i.test(t) && start !== -1) return { start, end: m.index };
  }
  return null;
}

function vqlSplitTopLevel(list) {
  const parts = [];
  let depth = 0;
  let cur = "";
  for (const t of list.match(VQL_TOKEN_RE) || []) {
    if (t === "(") depth++;
    else if (t === ")") depth = Math.max(0, depth - 1);
    if (t === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else {
      cur += t;
    }
  }
  parts.push(cur);
  return parts;
}

// ---- Limit ----------------------------------------------------------------
function uiRowLimit() {
  if (!WINDOW_MODE) return null;
  const n = Number(limitSelect.value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ---- Query tabs -------------------------------------------------------------
// Tabs keep their queries in storage; results live in memory only, since a
// result set can run to thousands of rows.
let queryTabs = [];
let activeTabId = null;
let renamingTabId = null;
let persistTabsTimer = null;
const tabResults = new Map();

const blankTab = () => ({
  id: `q${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
  title: null,
  query: "",
});

function activeTab() {
  return queryTabs.find((t) => t.id === activeTabId) || null;
}

// An untitled tab is named after the object it queries — its label when the
// model is loaded, the API name otherwise.
function derivedTabLabel(t) {
  const m = (t.query || "").match(/\bFROM\s+(\w+)/i);
  if (!m) return "New query";
  const obj = state.dataModel?.objects.find((o) => o.name.toLowerCase() === m[1].toLowerCase());
  return obj?.label || m[1];
}

function tabLabel(t) {
  return t.title || derivedTabLabel(t);
}

function persistTabs() {
  clearTimeout(persistTabsTimer);
  if (!queryTabs.length) return;
  chrome.storage.local.set({
    queryTabs: {
      active: activeTabId,
      tabs: queryTabs.map(({ id, title, query }) => ({ id, title, query })),
    },
  });
}

function persistTabsSoon() {
  clearTimeout(persistTabsTimer);
  persistTabsTimer = setTimeout(persistTabs, 400);
}

function renderQueryTabs() {
  if (!WINDOW_MODE || renamingTabId) return;
  let html = "";
  for (const t of queryTabs) {
    const on = t.id === activeTabId;
    const label = tabLabel(t);
    const preview = t.query.trim() ? t.query.trim().slice(0, 300) : "Empty query";
    const tip = on ? `${preview}\n\nDouble-click to rename` : preview;
    html +=
      `<div class="qtab${on ? " active" : ""}" role="tab" tabindex="${on ? 0 : -1}" ` +
      `aria-selected="${on}" data-tab-id="${esc(t.id)}" title="${esc(tip)}">` +
      `<span class="qtab-label">${esc(label)}</span>` +
      (on
        ? `<button type="button" class="qtab-close" data-close="${esc(t.id)}" title="Close tab" aria-label="Close ${esc(label)}">&times;</button>`
        : "") +
      "</div>";
  }
  html += '<button type="button" class="qtab-new" title="New query tab" aria-label="New query tab">+</button>';
  queryTabsEl.innerHTML = html;
}

// Results land in whatever tab is showing when they arrive, so the tabs hold
// still while a query runs.
function setQueryBusy(on) {
  if (!WINDOW_MODE) return;
  queryTabsEl.classList.toggle("busy", on);
}

function stashActiveTab() {
  const t = activeTab();
  if (!t) return;
  t.query = vqlInput.value;
  tabResults.set(t.id, snapshotResults());
}

function loadActiveTab() {
  const t = activeTab();
  vqlInput.value = t ? t.query : "";
  historyNavIndex = -1;
  hideAc();
  paintEditor();
  vqlInput.scrollTop = 0;
  vqlInput.scrollLeft = 0;
  syncEditorScroll();
  restoreResults(tabResults.get(activeTabId));
  renderQueryTabs();
  renderRecent();
}

function switchQueryTab(id) {
  if (id === activeTabId || activeQueryToken || !queryTabs.some((t) => t.id === id)) return;
  stashActiveTab();
  activeTabId = id;
  loadActiveTab();
  persistTabs();
}

function newQueryTab() {
  if (activeQueryToken) return;
  stashActiveTab();
  const t = blankTab();
  queryTabs.push(t);
  activeTabId = t.id;
  loadActiveTab();
  persistTabs();
  vqlInput.focus();
  queryTabsEl.scrollLeft = queryTabsEl.scrollWidth;
}

function closeQueryTab(id) {
  const i = queryTabs.findIndex((t) => t.id === id);
  if (i === -1) return;
  const closingActive = id === activeTabId;
  if (closingActive && activeQueryToken) return;
  const edits = closingActive ? pendingEdits : tabResults.get(id)?.edits || {};
  const unsaved = Object.keys(edits).length;
  if (unsaved && !confirm(`Close this tab and discard ${unsaved} unsaved change${unsaved === 1 ? "" : "s"}?`)) return;

  queryTabs.splice(i, 1);
  tabResults.delete(id);
  // The strip never goes empty; closing the last tab leaves a fresh one.
  if (!queryTabs.length) queryTabs.push(blankTab());
  if (closingActive) {
    activeTabId = queryTabs[Math.min(i, queryTabs.length - 1)].id;
    loadActiveTab();
  } else {
    renderQueryTabs();
    renderRecent();
  }
  persistTabs();
}

function renameQueryTab(id) {
  const t = queryTabs.find((x) => x.id === id);
  const label = queryTabsEl.querySelector(`.qtab[data-tab-id="${CSS.escape(id)}"] .qtab-label`);
  if (!t || !label) return;
  renamingTabId = id;
  const input = document.createElement("input");
  input.className = "qtab-rename";
  input.value = tabLabel(t);
  input.maxLength = 60;
  input.size = Math.max(8, input.value.length);
  input.setAttribute("aria-label", "Tab name");
  label.replaceWith(input);
  input.focus();
  input.select();

  let done = false;
  const finish = (commit) => {
    if (done) return;
    done = true;
    renamingTabId = null;
    if (commit) {
      // Clearing the name, or leaving the one it already had, hands the tab
      // back to following its query.
      const v = input.value.trim();
      t.title = v && v !== derivedTabLabel(t) ? v : null;
      persistTabs();
    }
    renderQueryTabs();
    renderRecent();
  };
  input.addEventListener("input", () => (input.size = Math.max(8, input.value.length)));
  input.addEventListener("blur", () => finish(true));
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      finish(true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      finish(false);
    }
  });
}

// Everything the results area shows, so a tab comes back exactly as it was
// left: rows, unsaved edits, filter, page, hidden columns and selection.
function snapshotResults() {
  return {
    table: resultsView.active,
    message: resultsView.active ? "" : resultsContainer.innerHTML,
    rows: queryRows,
    keys: resultKeys,
    objectName: queryObjectName,
    data: lastResultData,
    edits: pendingEdits,
    view: resultsView,
    count: resultsCount.textContent,
    shown: resultsPanel.classList.contains("has-results"),
  };
}

function restoreResults(s) {
  closeColumnsMenu();
  resultsPanel.querySelector(".save-error")?.remove();
  if (!s) {
    queryRows = [];
    resultKeys = [];
    queryObjectName = null;
    lastResultData = null;
    pendingEdits = {};
    resultsContainer.innerHTML = "";
    resultsCount.textContent = "";
    setResultsShown(false);
    resetResultsView();
    updateSaveBar();
    return;
  }
  queryRows = s.rows;
  resultKeys = s.keys;
  queryObjectName = s.objectName;
  lastResultData = s.data;
  pendingEdits = s.edits;
  resultsView = s.view;
  resultsCount.textContent = s.count;
  resultsFilter.value = resultsView.filter;
  setResultsShown(s.shown);
  paintColumnsButton();
  if (s.table) {
    paintResultsView();
  } else {
    resultsContainer.innerHTML = s.message;
    resultsPanel.classList.remove("has-table");
  }
  updateSaveBar();
  renderInspector();
}

// ---- Results view -----------------------------------------------------------
// The workbench pages the table instead of rendering every row: a fetch-all
// query can return tens of thousands, and the card has a fixed height anyway.
const RESULTS_PAGE = 100;

let resultKeys = [];
let resultsView = freshResultsView();

function freshResultsView() {
  return { active: false, filter: "", page: 0, hidden: new Set(), selected: null };
}

function resetResultsView() {
  resultsView = freshResultsView();
  if (!WINDOW_MODE) return;
  resultsFilter.value = "";
  resultsPanel.classList.remove("has-table");
  closeColumnsMenu();
  paintColumnsButton();
  renderInspector();
}

function displayValue(v) {
  if (v === null || v === undefined) return "";
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}

// What the cell shows: an unsaved edit wins over what Vault returned.
function effectiveValue(ri, key) {
  const edit = pendingEdits[`${ri}:${key}`];
  return edit ? edit.newVal : displayValue(queryRows[ri]?.[key]);
}

function visibleRowIndices() {
  const f = resultsView.filter.trim().toLowerCase();
  const out = [];
  for (let ri = 0; ri < queryRows.length; ri++) {
    if (!f || resultKeys.some((k) => effectiveValue(ri, k).toLowerCase().includes(f))) out.push(ri);
  }
  return out;
}

const STATUS_COL_RE = /(^|_)(status|state)__[a-z]+$/i;
const NAME_COL_RE = /^(name|title|label)__[a-z]+$/i;

// Tone for a lifecycle value — a reading aid only; the value itself is always
// printed in the pill.
function statusTone(value) {
  const s = value.toLowerCase();
  if (/inactive|reject|cancel|withdrawn|expired|obsolete|retired|fail|error/.test(s)) return "bad";
  if (/approved|active|effective|released|available|complete|final|current|steady/.test(s)) return "ok";
  if (/draft|review|pending|progress|planned|open/.test(s)) return "warn";
  return "neutral";
}

// Inner HTML for a data cell. The overlay prints plain text; the workbench
// pills status values and sets names in the reading face.
function cellContent(key, value) {
  if (!WINDOW_MODE || value === "") return esc(value);
  if (STATUS_COL_RE.test(key)) return `<span class="cell-pill ${statusTone(value)}">${esc(value)}</span>`;
  if (NAME_COL_RE.test(key)) return `<span class="cell-text">${esc(value)}</span>`;
  return esc(value);
}

// Vault's own deep links (Vault Help: "Vault Document URLs" and "Viewing Object
// Records"): /ui/#doc_info/{id} for documents, /ui/#object/{object}/{id} for
// object records.
function recordUrl(row) {
  const id = displayValue(row?.id);
  if (!id || !state.domain || !queryObjectName) return "";
  const path = queryObjectName.toLowerCase() === "documents"
    ? `doc_info/${encodeURIComponent(id)}`
    : `object/${encodeURIComponent(queryObjectName)}/${encodeURIComponent(id)}`;
  return `https://${state.domain}/ui/#${path}`;
}

function paintResultsView() {
  if (!WINDOW_MODE) return;
  resultsView.active = true;
  const idx = visibleRowIndices();
  const pages = Math.max(1, Math.ceil(idx.length / RESULTS_PAGE));
  resultsView.page = Math.min(resultsView.page, pages - 1);
  const start = resultsView.page * RESULTS_PAGE;
  const slice = idx.slice(start, start + RESULTS_PAGE);
  const keys = resultKeys.filter((k) => !resultsView.hidden.has(k));
  const editable = getEditableFields(queryObjectName);
  const hasId = resultKeys.includes("id");

  let html = '<table class="results-table"><thead><tr><th class="row-num" scope="col">#</th>';
  for (const k of keys) html += `<th scope="col"${k === "id" ? ' class="col-id"' : ""}>${esc(k)}</th>`;
  html += "</tr></thead><tbody>";
  for (const ri of slice) {
    html += `<tr data-row="${ri}"${ri === resultsView.selected ? ' class="selected"' : ""}>`;
    html += `<td class="row-num">${ri + 1}</td>`;
    for (const k of keys) {
      const v = effectiveValue(ri, k);
      if (k === "id") {
        const url = recordUrl(queryRows[ri]);
        html += url
          ? `<td class="col-id"><a class="id-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer" title="Open in Vault">${esc(v)}</a></td>`
          : `<td class="col-id" title="${esc(v)}">${esc(v)}</td>`;
        continue;
      }
      const canEdit = hasId && (editable === "all" || editable.has(k));
      const cls = canEdit ? `editable${pendingEdits[`${ri}:${k}`] ? " dirty" : ""}` : "";
      html +=
        `<td${cls ? ` class="${cls}" data-row="${ri}" data-field="${esc(k)}"` : ""} title="${esc(v)}">` +
        `${cellContent(k, v)}</td>`;
    }
    html += "</tr>";
  }
  html += "</tbody></table>";
  if (!slice.length) {
    html = `<div class="result-message info">No rows match &ldquo;${esc(resultsView.filter.trim())}&rdquo;.</div>`;
  }
  resultsContainer.innerHTML = html;
  resultsPanel.classList.add("has-table");

  const total = queryRows.length;
  const shown = idx.length;
  const filtered = shown !== total ? ` (filtered from ${total.toLocaleString()})` : "";
  resultsRange.textContent = shown
    ? `Showing ${(start + 1).toLocaleString()}–${(start + slice.length).toLocaleString()} of ${shown.toLocaleString()}${filtered}`
    : `0 of ${total.toLocaleString()}`;
  resultsHint.textContent = hasId ? "Click a cell to edit it" : "Add id to the SELECT to edit cells";
  pagePrev.disabled = resultsView.page === 0;
  pageNext.disabled = resultsView.page >= pages - 1;
}

function turnResultsPage(step) {
  if (!resultsView.active) return;
  resultsView.page = Math.max(0, resultsView.page + step);
  paintResultsView();
  resultsContainer.scrollTop = 0;
}

function selectResultRow(ri) {
  if (!Number.isInteger(ri) || !queryRows[ri] || resultsView.selected === ri) return;
  resultsView.selected = ri;
  resultsContainer.querySelector("tbody tr.selected")?.classList.remove("selected");
  resultsContainer.querySelector(`tbody tr[data-row="${ri}"]`)?.classList.add("selected");
  renderInspector();
}

function formatMs(ms) {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
}

// ---- Columns menu -----------------------------------------------------------
// Hides columns from the table only; Copy and the exports keep every column.
function paintColumnsButton() {
  const n = resultsView.hidden.size;
  columnsBtn.textContent = n ? `Columns · ${n} hidden` : "Columns";
}

function renderColumnsMenu() {
  columnsMenu.innerHTML =
    '<div class="columns-head"><span>Show columns</span>' +
    `<button type="button" class="columns-all"${resultsView.hidden.size ? "" : " disabled"}>Show all</button></div>` +
    resultKeys
      .map(
        (k) =>
          `<label class="columns-opt"><input type="checkbox" data-col="${esc(k)}"` +
          `${resultsView.hidden.has(k) ? "" : " checked"} /><span>${esc(k)}</span></label>`
      )
      .join("");
}

function closeColumnsMenu() {
  if (!WINDOW_MODE) return;
  columnsMenu.classList.add("hidden");
  columnsBtn.setAttribute("aria-expanded", "false");
}

// ---- Inspector --------------------------------------------------------------
function rowTitle(ri) {
  for (const k of ["name__v", "title__v", "label__v", "username__sys", "name__sys"]) {
    const v = effectiveValue(ri, k);
    if (v) return v;
  }
  const id = effectiveValue(ri, "id");
  return id ? `Record ${id}` : `Row ${ri + 1}`;
}

function renderInspector() {
  if (!WINDOW_MODE) return;
  const ri = resultsView.selected;
  const row = ri != null ? queryRows[ri] : null;
  inspEmpty.classList.toggle("hidden", !!row);
  inspBody.classList.toggle("hidden", !row);
  if (!row) return;

  inspTitle.textContent = rowTitle(ri);
  let html = "";
  for (const k of resultKeys) {
    const v = effectiveValue(ri, k);
    const cls = [v === "" ? "empty" : "", pendingEdits[`${ri}:${k}`] ? "dirty" : ""].filter(Boolean).join(" ");
    html += `<dt title="${esc(k)}">${esc(k)}</dt>`;
    html += `<dd${cls ? ` class="${cls}"` : ""}>${v === "" ? "&mdash;" : esc(v)}</dd>`;
  }
  inspFields.innerHTML = html;

  const url = recordUrl(row);
  inspOpen.classList.toggle("hidden", !url);
  if (url) inspOpen.href = url;
  else inspOpen.removeAttribute("href");
}

// ---- Recent queries ---------------------------------------------------------
const RECENT_LIMIT = 8;

function relativeTime(ts) {
  if (!ts) return "Earlier";
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const d = new Date(ts);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return "Earlier today";
  today.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Yesterday";
  return d.toLocaleDateString();
}

function renderRecent() {
  if (!WINDOW_MODE) return;
  const items = state.history.slice(0, RECENT_LIMIT);
  if (!items.length) {
    recentList.innerHTML = '<div class="insp-empty recent-empty">Queries you run show up here.</div>';
    return;
  }
  recentList.innerHTML = items
    .map((h, i) => {
      const meta = [relativeTime(h.ts)];
      const tab = h.tab && queryTabs.find((t) => t.id === h.tab);
      if (tab) meta.push(tab.id === activeTabId ? "this tab" : `${tabLabel(tab)} tab`);
      const failed = h.success === false;
      return (
        `<button type="button" class="recent-item" data-index="${i}" title="${esc(h.query)}">` +
        `<span class="recent-q">${esc(h.query.replace(/\s+/g, " "))}</span>` +
        `<span class="recent-meta">${esc(meta.join(" · "))}` +
        `${failed ? ' · <span class="recent-fail">failed</span>' : ""}</span>` +
        "</button>"
      );
    })
    .join("");
}

// ---- Data model sidebar -----------------------------------------------------
function wbTypeLabel(type) {
  const t = String(type || "").toLowerCase();
  return t === "objectreference" ? "object" : t;
}

const DM_CHEVRON =
  '<svg class="dm-group-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
  'stroke-width="3" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';

function wbGroupRowHtml(obj, countText, filter, opts = {}) {
  const { expandable = false, expanded = false } = opts;
  const tip = expandable
    ? `${obj.label || obj.name} · ${obj.fields.length} fields`
    : `Insert SELECT … FROM ${obj.name}`;
  let h =
    `<div class="dm-group${expanded ? " expanded" : ""}${expandable ? "" : " dm-group-hit"}" ` +
    `data-obj="${esc(obj.name)}" title="${esc(tip)}" role="button" tabindex="0"` +
    `${expandable ? ` aria-expanded="${expanded}"` : ""}>`;
  if (expandable) h += DM_CHEVRON;
  h += `<span class="dm-group-label">${highlight(obj.label || obj.name, filter)}</span>`;
  h += `<span class="dm-group-api">${highlight(obj.name, filter)}</span>`;
  h += `<span class="dm-group-count">${esc(countText)}</span>`;
  if (expandable) {
    h += `<button type="button" class="dm-group-sel" data-sel="${esc(obj.name)}" title="Insert SELECT … FROM ${esc(obj.name)} with every field">SEL</button>`;
  }
  return `${h}</div>`;
}

function wbFieldRowHtml(f, objName, filter) {
  const type = wbTypeLabel(f.type);
  const tip = [f.label && f.label !== f.name ? f.label : "", type, f.required ? "required" : ""]
    .filter(Boolean)
    .join(" · ");
  // A search that matched the label rather than the API name shows the label,
  // or the row would appear with nothing highlighted.
  const labelHit =
    filter && f.label && !f.name.toLowerCase().includes(filter) && f.label.toLowerCase().includes(filter);
  return (
    `<button type="button" class="dm-row" data-field="${esc(f.name)}" data-obj="${esc(objName)}" title="${esc(tip)}">` +
    `<span class="dm-row-name">${highlight(f.name, filter)}</span>` +
    (f.required ? '<span class="dm-row-req" aria-label="required">*</span>' : "") +
    (labelHit ? `<span class="dm-row-label">${highlight(f.label, filter)}</span>` : "") +
    `<span class="dm-row-type">${esc(type)}</span>` +
    "</button>"
  );
}

function wbObjectHtml(obj, compact) {
  const open = dmExpanded.has(obj.name);
  if (compact && !open) {
    return (
      `<div class="dm-group dm-group-line" data-obj="${esc(obj.name)}" role="button" tabindex="0" aria-expanded="false" ` +
      `title="${esc(`${obj.label || obj.name} · ${obj.fields.length} fields`)}">` +
      `<span class="dm-group-api">${esc(obj.name)}</span>` +
      `<span class="dm-group-count">${obj.fields.length}</span></div>`
    );
  }
  let html = `<div class="dm-obj${open ? " open" : ""}">`;
  html += wbGroupRowHtml(obj, String(obj.fields.length), "", { expandable: true, expanded: open });
  if (open) {
    const ranked = [...obj.fields].sort(fieldRanker(obj));
    const shown = dmShowAll.has(obj.name) ? ranked : ranked.slice(0, DM_TOP_FIELDS);
    html += '<div class="dm-fields">';
    for (const f of shown) html += wbFieldRowHtml(f, obj.name, "");
    const more = ranked.length - shown.length;
    if (more > 0) {
      html += `<button type="button" class="dm-group-more" data-more="${esc(obj.name)}">+ ${more.toLocaleString()} more field${more === 1 ? "" : "s"}</button>`;
    }
    html += "</div>";
  }
  return `${html}</div>`;
}

function wbObjectIndexHtml(featured, rest) {
  let html = "";
  if (featured.length) {
    html += '<div class="dm-section">Most used</div>';
    for (const obj of featured) html += wbObjectHtml(obj, false);
  }
  html += `<div class="dm-section">${featured.length ? "All objects" : "Objects"} · ${rest.length.toLocaleString()}</div>`;
  for (const obj of rest) html += wbObjectHtml(obj, true);
  return html;
}

// ===================== UTILS =====================
// Escapes for both text and quoted-attribute contexts. The textContent round
// trip this used to do leaves " and ' untouched, so any value interpolated
// into title="…" or data-x="…" could close the attribute and add its own —
// a document named `" onmouseover="…` was enough to run script in here.
const ESC_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function esc(str) {
  return String(str == null ? "" : str).replace(/[&<>"']/g, (ch) => ESC_MAP[ch]);
}

// Only ever emit links we can vouch for. Source URLs arrive from the
// documentation server, and `javascript:` in an href runs in this page, which
// holds the Vault session.
function safeUrl(url) {
  try {
    const parsed = new URL(String(url), location.href);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : "";
  } catch (e) {
    return "";
  }
}

// Vault tenants are subdomains of veevavault.com and nothing else. A substring
// test passes "veevavault.com.attacker.example", which would send the session
// token and every query to that host.
const VAULT_HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.veevavault\.com$/i;

function isVaultHost(host) {
  return VAULT_HOST_RE.test(String(host || ""));
}

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch (e) {
    return "";
  }
}
