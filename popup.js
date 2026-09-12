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
const userDetails = $("#user-details");
const vqlInput = $("#vql-input");
const runBtn = $("#run-btn");
const cancelBtn = $("#cancel-btn");
const clearBtn = $("#clear-btn");
const queryTime = $("#query-time");
const resultsHeader = $("#results-header");
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

// popup.html serves both the overlay iframe and the full-window tab. The mode is
// fixed for the lifetime of the page, so layout decisions can be made once.
const WINDOW_MODE = new URLSearchParams(location.search).get("mode") === "window";

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
  topbarChipSlot.appendChild(modelChip);
  expandBtn.classList.add("hidden");
  collapseBtn.classList.remove("hidden");
}

expandBtn.addEventListener("click", async () => {
  // Build the query string outside getURL — it takes a path, and a version that
  // escapes or drops the "?" would open the popup layout instead of the window one.
  const url = `${chrome.runtime.getURL("popup.html")}?mode=window`;
  await chrome.tabs.create({ url });
  closeOverlay();
});

// Only close this tab once the overlay is actually back up, so a missing Vault
// tab or an uninjected content script can't collapse the panel into nothing.
collapseBtn.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ url: "https://*.veevavault.com/*" });
  if (!tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { action: "openOverlay" });
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
  const saved = await chrome.storage.local.get(["vaultDomain", "queryHistory", "dataModels", "dataModel", "dataModelTime"]);
  if (saved.vaultDomain) domainInput.value = saved.vaultDomain;
  if (saved.queryHistory) state.history = saved.queryHistory;
  // Per-instance data model loading happens after autoConnect resolves the current domain.
  // Legacy single-key storage is migrated lazily inside loadDataModelForDomain().
  renderHistory();

  // Try to detect domain from active tab
  try {
    // Look for a Vault tab across all windows (popup runs in its own window).
    let vaultTabs = await chrome.tabs.query({ url: "https://*.veevavault.com/*" });
    let tab = vaultTabs.find((t) => t.active) || vaultTabs[0];
    if (!tab) {
      [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    }
    if (tab?.url) {
      const url = new URL(tab.url);
      if (url.hostname.includes("veevavault.com")) {
        domainInput.value = url.hostname;
        autoConnect(url.hostname);
      }
    }
  } catch (e) {
    // user can connect manually
  }
});

// ===================== TABS =====================
$$(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    $$(".tab").forEach((t) => t.classList.remove("active"));
    $$(".tab-content").forEach((c) => c.classList.remove("active"));
    tab.classList.add("active");
    $(`#tab-${tab.dataset.tab}`).classList.add("active");
  });
});

// Segmented tab indicator + drag-to-switch.
// Paints --tab-idx via a MutationObserver so manual classList toggles elsewhere
// in this file (e.g. after disconnect) update the thumb too.
// Note: $$ returns a NodeList — convert to Array so findIndex works.
(function initTabIndicator() {
  const tabsEl = $(".tabs");
  if (!tabsEl) return;
  const buttons = Array.from($$(".tab"));
  tabsEl.style.setProperty("--tab-count", buttons.length);

  const paint = () => {
    const idx = buttons.findIndex((b) => b.classList.contains("active"));
    if (idx >= 0) tabsEl.style.setProperty("--tab-idx", idx);
  };
  paint();
  const obs = new MutationObserver(paint);
  buttons.forEach((b) => obs.observe(b, { attributes: true, attributeFilter: ["class"] }));

  // Press-and-drag across the bar to switch. The native click on pointerdown
  // handles the initial selection; pointermove fires .click() only when the
  // hit-tested tab changes, so we don't double-trigger the active button.
  const tabAtX = (clientX) => {
    const r = tabsEl.getBoundingClientRect();
    const inner = r.width - 4;
    const i = Math.floor(((clientX - r.left - 2) / inner) * buttons.length);
    return buttons[Math.max(0, Math.min(buttons.length - 1, i))];
  };
  tabsEl.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    tabsEl.classList.add("dragging");
    let last = tabAtX(e.clientX);
    const onMove = (ev) => {
      const t = tabAtX(ev.clientX);
      if (t !== last) { last = t; t.click(); }
    };
    const onUp = () => {
      tabsEl.classList.remove("dragging");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  });
})();

// ===================== CONNECTION =====================
async function autoConnect(domain) {
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

  // Per-instance data model: load from storage if present, else prompt the user.
  await loadDataModelForDomain(domain);
}

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

function showUserInfo(data) {
  const u = data.users?.[0]?.user || data;
  const fields = [];
  if (u.user_name__v) fields.push(["User", u.user_name__v]);
  if (u.user_first_name__v && u.user_last_name__v)
    fields.push(["Name", `${u.user_first_name__v} ${u.user_last_name__v}`]);
  if (u.user_email__v) fields.push(["Email", u.user_email__v]);
  if (u.security_profile__v) fields.push(["Security Profile", u.security_profile__v]);
  if (u.vault_id__v) fields.push(["Vault ID", u.vault_id__v]);

  if (fields.length === 0) {
    fields.push(["Response", JSON.stringify(data).slice(0, 200)]);
  }

  userDetails.innerHTML = fields
    .map(
      ([label, value]) =>
        `<div class="detail"><span class="label">${esc(label)}</span><span class="value">${esc(value)}</span></div>`
    )
    .join("");
  whoamiBtn.classList.remove("hidden");

  const who = [u.user_email__v || u.user_name__v, u.security_profile__v].filter(Boolean);
  topbarUser.textContent = who.join(" · ");
  topbarUser.title = topbarUser.textContent;
}

function showVqlPanel() {
  connectionPanel.classList.add("hidden");
  vqlPanel.classList.remove("hidden");
  disconnectBtn.classList.remove("hidden");
  historyBtn.classList.remove("hidden");
  vqlInput.focus();
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
  dmTree.innerHTML = "";
  dmExpanded.clear();
  dmShowAll.clear();
  fieldStats = {};
  fieldStatsFailed.clear();
  clearTimeout(fieldStatsTimer);
  resultsContainer.innerHTML = "";
  resultsHeader.classList.add("hidden");
  queryTime.textContent = "";
  lastResultData = null;
});

// Popover toggles — close others when opening one
function closeAllPopovers() {
  whoamiPopover.classList.add("hidden");
  historyPopover.classList.add("hidden");
}

whoamiBtn.addEventListener("click", () => {
  const wasHidden = whoamiPopover.classList.contains("hidden");
  closeAllPopovers();
  if (wasHidden) whoamiPopover.classList.remove("hidden");
});

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
  historyNavIndex = -1;
  hideAc();
  resultsContainer.innerHTML = "";
  resultsContainer.style.maxHeight = "";
  resultsHeader.classList.add("hidden");
  queryTime.textContent = "";
  lastResultData = null;
  queryRows = [];
  pendingEdits = {};
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
  }
});

vqlInput.addEventListener("input", () => {
  // Any manual edit exits history-navigation mode.
  historyNavIndex = -1;
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
  resultsHeader.classList.add("hidden");
  lastResultData = null;

  const token = { aborted: false };
  activeQueryToken = token;

  const userLimit = extractVqlTopLimit(raw);
  const baseQuery = stripVqlTrailingPaging(raw);
  const startTime = performance.now();

  // --- First page: also tells us responseDetails.total ---
  const firstQ = `${baseQuery} PAGESIZE ${FETCH_ALL_PAGE_SIZE} PAGEOFFSET 0`;
  const firstResult = await apiCall("/query", "POST", `q=${encodeURIComponent(firstQ)}`);

  const resetButton = () => {
    runBtn.disabled = false;
    runBtn.innerHTML = "Run Query";
    cancelBtn.classList.add("hidden");
    cancelBtn.disabled = false;
    cancelBtn.innerHTML = "Cancel";
    if (activeQueryToken === token) activeQueryToken = null;
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

  const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
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
    resultsCount.textContent = `${finalRows.length} record${finalRows.length !== 1 ? "s" : ""}${ofTotal}`;
    resultsHeader.classList.remove("hidden");
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
    resultsHeader.classList.add("hidden");
  }
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

function csvEsc(val) {
  const str = String(val);
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
  state.history.unshift({ query, success, ts: Date.now() });
  state.history = state.history.slice(0, 20);
  chrome.storage.local.set({ queryHistory: state.history });
  renderHistory();
}

function renderHistory() {
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
    vqlInput.value = state.history[parseInt(item.dataset.index)].query;
    historyPopover.classList.add("hidden");
    // Switch to query tab
    $$(".tab").forEach((t) => t.classList.remove("active"));
    $$(".tab-content").forEach((c) => c.classList.remove("active"));
    $('[data-tab="query"]').classList.add("active");
    $("#tab-query").classList.add("active");
    vqlInput.focus();
  }
});

clearHistoryBtn.addEventListener("click", () => {
  state.history = [];
  chrome.storage.local.set({ queryHistory: [] });
  renderHistory();
});

// ===================== DATA MODEL =====================
// The chip is the only load affordance and the only readout of model state, so
// it carries all four phases: idle, loading (with progress), loaded, failed.
let modelLoading = false;

function setChipState(phase, opts = {}) {
  modelChip.classList.remove("loading", "loaded", "failed");
  modelChip.style.backgroundImage = "";

  if (phase === "loading") {
    const { done = 0, total = 0 } = opts;
    const pct = total ? Math.round((done / total) * 100) : 0;
    modelChip.classList.add("loading");
    modelChip.style.backgroundImage =
      `linear-gradient(90deg, rgba(192,138,46,.45) ${pct}%, transparent ${pct}%)`;
    modelChipLabel.textContent = total ? `${done}/${total}` : "LOADING";
    modelChip.title = opts.title || "Loading data model";
  } else if (phase === "loaded") {
    modelChip.classList.add("loaded");
    modelChipLabel.textContent = "MODELS";
    modelChip.title = opts.title || "Reload data model";
  } else if (phase === "failed") {
    modelChip.classList.add("failed");
    modelChipLabel.textContent = "FAILED";
    modelChip.title = opts.title || "Load failed — click to retry";
  } else {
    modelChipLabel.textContent = "LOAD MODEL";
    modelChip.title = "Load data model — enables autocomplete";
  }
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
    // Save under the current vault domain so each instance has its own model.
    const cur = await chrome.storage.local.get(["dataModels"]);
    const dataModels = cur.dataModels || {};
    if (state.domain) {
      dataModels[state.domain] = { model: state.dataModel, time: loadTime };
      await chrome.storage.local.set({ dataModels });
    }

    onDataModelLoaded(loadTime);
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

function onDataModelLoaded(timeStr) {
  if (!state.dataModel) return;

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
}

// ===================== DATA MODEL SEARCH =====================
// Results are grouped under the object that owns them and paged, because a
// bare query like "status" can match several hundred fields across the model.
const DM_PAGE = 25;
// An opened object shows only its most-used fields; a 146-field object dumped
// in full is the thing the search box exists to avoid.
const DM_TOP_FIELDS = 5;
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
  if (!state.dataModel) {
    dmFilters.classList.add("hidden");
    dmMore.classList.add("hidden");
    dmTree.innerHTML =
      '<div class="dm-empty">No data model loaded. Use the <strong>LOAD MODEL</strong> chip to fetch it.</div>';
    return;
  }

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
  if (row) insertIntoQuery(row.dataset.field);
});

function insertIntoQuery(text, replace = false) {
  // Switch to query tab
  $$(".tab").forEach((t) => t.classList.remove("active"));
  $$(".tab-content").forEach((c) => c.classList.remove("active"));
  $('[data-tab="query"]').classList.add("active");
  $("#tab-query").classList.add("active");

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

  // Attach click listeners for editable cells
  resultsContainer.querySelectorAll("td.editable").forEach((td) => {
    td.addEventListener("click", startEditing);
  });

}

function startEditing(e) {
  const td = e.currentTarget;
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
    td.textContent = newVal;

    if (newVal !== origVal) {
      td.classList.add("dirty");
      pendingEdits[`${ri}:${field}`] = { rowIdx: ri, field, oldVal: origVal, newVal };
    } else {
      td.classList.remove("dirty");
      delete pendingEdits[`${ri}:${field}`];
    }
    updateSaveBar();

    // Re-attach click
    td.addEventListener("click", startEditing);
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
  // Re-render the table with original data
  if (queryRows.length > 0) renderTable(queryRows);
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
const dtTree = $("#dt-tree");
const dtBreadcrumb = $("#dt-breadcrumb");
const dtFields = $("#dt-fields");

let docTypesLoaded = false;
let docProperties = null; // all document field definitions
let dtSelection = null; // { type, subtype, classification } names

// Load doc types on first tab visit
$$(".tab").forEach((tab) => {
  const origHandler = tab._dtHandler;
  tab.addEventListener("click", () => {
    if (tab.dataset.tab === "datatypes") {
      renderDataTypes();
    }
  });
});

async function loadDocTypes() {
  docTypesLoaded = true;
  dtTree.innerHTML = '<div class="dm-empty"><span class="spinner"></span> Loading types...</div>';

  // Load types and properties in parallel
  const [typesResult, propsResult] = await Promise.all([
    apiCall("/metadata/objects/documents/types"),
    docProperties ? Promise.resolve({ success: true, data: { properties: docProperties } }) : apiCall("/metadata/objects/documents/properties"),
  ]);

  if (!typesResult.success) {
    dtTree.innerHTML = `<div class="dm-empty">Failed to load types: ${esc(typesResult.error)}</div>`;
    return;
  }

  // Cache properties
  if (propsResult.success) {
    const rawProps = propsResult.data?.properties || propsResult.data || [];
    docProperties = Array.isArray(rawProps) ? rawProps : [];
  }

  const types = typesResult.data?.types || typesResult.data || [];
  renderDocTypeTree(types);
}

function renderDocTypeTree(types) {
  if (!types.length) {
    dtTree.innerHTML = '<div class="dm-empty">No document types found</div>';
    return;
  }

  let html = "";
  for (const t of types) {
    const name = t.name || t.name__v || "";
    const label = t.label || t.label__v || name;
    html += `<div class="dt-node" data-type="${esc(name)}">`;
    html += `<div class="dt-node-header" data-type="${esc(name)}">`;
    html += `<span class="dt-node-arrow">&#9654;</span>`;
    html += `<span class="dt-node-icon">&#128196;</span>`;
    html += `<span class="dt-node-label">${esc(label)}</span>`;
    html += `<span class="dt-node-sublabel">${esc(name)}</span>`;
    html += `</div>`;
    html += `<div class="dt-children"></div>`;
    html += `</div>`;
  }
  dtTree.innerHTML = html;
}

// Tree click handler — expand/collapse + select + lazy load children
dtTree?.addEventListener("click", async (e) => {
  const header = e.target.closest(".dt-node-header");
  if (!header) return;

  const node = header.closest(".dt-node");
  const typeName = node.dataset.type;
  const subtypeName = node.dataset.subtype;
  const classificationName = node.dataset.classification;

  // Build selection
  const selection = {};
  if (classificationName) {
    // It's a classification node — find parent subtype and type
    const subtypeNode = node.closest("[data-subtype]").closest(".dt-node[data-type]")
      ? node.parentElement.closest(".dt-node[data-subtype]")
      : node.parentElement.closest("[data-subtype]");
    const typeNode = node.closest(".dt-children")?.closest(".dt-children")?.closest(".dt-node[data-type]")
      || node.closest(".dt-node[data-type]");
    selection.type = typeNode?.dataset.type;
    selection.subtype = subtypeName || node.closest(".dt-children")?.closest(".dt-node")?.dataset.subtype;
    selection.classification = classificationName;
  } else if (subtypeName) {
    const typeNode = node.closest(".dt-children")?.closest(".dt-node[data-type]");
    selection.type = typeNode?.dataset.type || typeName;
    selection.subtype = subtypeName;
  } else {
    selection.type = typeName;
  }

  // Select this node visually
  dtTree.querySelectorAll(".dt-node-header.selected").forEach((h) => h.classList.remove("selected"));
  header.classList.add("selected");
  dtSelection = selection;

  // Show fields for selection
  displayDocTypeFields(selection);

  // Toggle expand
  const isExpanded = node.classList.contains("expanded");
  if (isExpanded) {
    node.classList.remove("expanded");
    return;
  }

  node.classList.add("expanded");

  // Lazy load children if not loaded yet
  const childrenEl = node.querySelector(":scope > .dt-children");
  if (childrenEl && childrenEl.children.length === 0) {
    await loadChildren(node, selection, childrenEl);
  }
});

async function loadChildren(node, selection, childrenEl) {
  childrenEl.innerHTML = '<div class="dt-children-loading"><span class="spinner"></span> Loading...</div>';

  let endpoint, childKey, childType;

  if (selection.subtype && !selection.classification) {
    // Load classifications for this subtype
    endpoint = `/metadata/objects/documents/types/${selection.type}/subtypes/${selection.subtype}`;
    childKey = "classifications";
    childType = "classification";
  } else if (selection.type && !selection.subtype) {
    // Load subtypes for this type
    endpoint = `/metadata/objects/documents/types/${selection.type}`;
    childKey = "subtypes";
    childType = "subtype";
  } else {
    childrenEl.innerHTML = "";
    node.querySelector(".dt-node-arrow")?.classList.add("empty");
    return;
  }

  const result = await apiCall(endpoint);
  if (!result.success) {
    childrenEl.innerHTML = `<div class="dt-children-loading" style="color:var(--red);">Failed to load</div>`;
    return;
  }

  const data = result.data;
  // Extract children — API may nest them in various ways
  let children = data[childKey] || [];
  // Some responses have the children inside a wrapper
  if (!children.length && data.types) children = data.types;

  if (children.length === 0) {
    childrenEl.innerHTML = "";
    node.querySelector(":scope > .dt-node-header .dt-node-arrow")?.classList.add("empty");
    return;
  }

  let html = "";
  for (const c of children) {
    const name = c.name || c.name__v || "";
    const label = c.label || c.label__v || name;
    const icon = childType === "subtype" ? "&#128194;" : "&#128203;";
    const dataAttr = childType === "classification"
      ? `data-classification="${esc(name)}" data-subtype="${esc(selection.subtype)}" data-type="${esc(selection.type)}"`
      : `data-subtype="${esc(name)}" data-type="${esc(selection.type)}"`;

    html += `<div class="dt-node" ${dataAttr}>`;
    html += `<div class="dt-node-header" ${dataAttr}>`;
    html += `<span class="dt-node-arrow${childType === "classification" ? " empty" : ""}">&#9654;</span>`;
    html += `<span class="dt-node-icon">${icon}</span>`;
    html += `<span class="dt-node-label">${esc(label)}</span>`;
    html += `<span class="dt-node-sublabel">${esc(name)}</span>`;
    html += `</div>`;
    if (childType === "subtype") {
      html += `<div class="dt-children"></div>`;
    }
    html += `</div>`;
  }
  childrenEl.innerHTML = html;
}

const dtStats = $("#dt-stats");
const dtDocCount = $("#dt-doc-count");
const dtLoadStatsBtn = $("#dt-load-stats-btn");
const dtFillBar = $("#dt-fill-bar");

let dtCurrentFields = []; // fields for the current selection

async function displayDocTypeFields(selection) {
  // Update breadcrumb
  let bc = '<span class="dt-bc-item">Documents</span>';
  if (selection.type) bc += ` <span class="dt-bc-sep">&#8250;</span> <span class="dt-bc-item">${esc(selection.type)}</span>`;
  if (selection.subtype) bc += ` <span class="dt-bc-sep">&#8250;</span> <span class="dt-bc-item">${esc(selection.subtype)}</span>`;
  if (selection.classification) bc += ` <span class="dt-bc-sep">&#8250;</span> <span class="dt-bc-item">${esc(selection.classification)}</span>`;
  dtBreadcrumb.innerHTML = bc;

  // Show stats bar, reset fill
  dtStats.classList.remove("hidden");
  dtDocCount.innerHTML = '<span class="spinner"></span>';
  dtFillBar.classList.add("hidden");
  dtFillBar.innerHTML = "";

  // Fetch doc count async (don't await)
  fetchDocCount(selection);

  // Fetch the actual fields for this type from the API
  dtFields.innerHTML = '<div class="dm-empty"><span class="spinner"></span> Loading fields...</div>';
  dtCurrentFields = [];

  // Build the deepest endpoint for this selection
  let endpoint = `/metadata/objects/documents/types/${selection.type}`;
  if (selection.subtype) endpoint += `/subtypes/${selection.subtype}`;
  if (selection.classification) endpoint += `/classifications/${selection.classification}`;

  const result = await apiCall(endpoint);

  if (!result.success) {
    dtFields.innerHTML = `<div class="dm-empty">Failed to load fields</div>`;
    return;
  }

  if (!docProperties || !docProperties.length) {
    dtFields.innerHTML = '<div class="dm-empty">No field data loaded</div>';
    dtCurrentFields = [];
    return;
  }

  // Try to get type-specific properties from the API response
  const data = result.data;
  let typeProperties = null;

  // At leaf level, the response may contain a properties array directly
  // Check common nesting patterns
  if (Array.isArray(data.properties)) typeProperties = data.properties;
  for (const key of Object.keys(data)) {
    if (typeProperties) break;
    const val = data[key];
    if (val && typeof val === "object" && !Array.isArray(val) && Array.isArray(val.properties)) {
      typeProperties = val.properties;
    }
  }

  let fields;
  if (typeProperties && typeProperties.length > 0) {
    // We got type-specific properties — use them, filter hidden
    fields = typeProperties.filter((f) => !f.hidden);
  } else {
    // Non-leaf level (has subtypes/classifications) — use global properties, filter hidden
    fields = docProperties.filter((f) => !f.hidden);
  }

  dtCurrentFields = fields;

  if (fields.length === 0) {
    dtFields.innerHTML = '<div class="dm-empty">No fields found. Try drilling into a subtype or classification.</div>';
    return;
  }

  // Group by section
  const sections = {};
  for (const f of fields) {
    const sec = f.section || f.section__v || "General";
    if (!sections[sec]) sections[sec] = [];
    sections[sec].push(f);
  }

  for (const sec of Object.keys(sections)) {
    sections[sec].sort((a, b) => {
      const pa = a.section_position || a.section_position__v || a.order || 999;
      const pb = b.section_position || b.section_position__v || b.order || 999;
      return pa - pb;
    });
  }

  const sectionNames = Object.keys(sections).sort((a, b) => {
    if (a === "General" || a === "generalProperties") return -1;
    if (b === "General" || b === "generalProperties") return 1;
    return a.localeCompare(b);
  });

  let html = `<div class="dt-field-count">${fields.length} visible fields</div>`;

  for (const secName of sectionNames) {
    html += `<div class="dt-section">`;
    html += `<div class="dt-section-header">${esc(secName)}</div>`;
    for (const f of sections[secName]) {
      const name = f.name || f.name__v || "";
      const label = f.label || f.label__v || "";
      const type = f.type || f.type__v || "";
      const required = f.required || f.required__v || false;
      const editable = f.editable || f.editable__v || false;
      const disabled = f.disabled || f.disabled__v || false;

      html += `<div class="dt-field-row" data-fname="${esc(name)}">`;
      html += `<span class="dt-field-name" title="${esc(name)}">${esc(name)}</span>`;
      html += `<span class="dt-field-label">${esc(label)}</span>`;
      html += `<span class="dt-field-badges">`;
      if (required) html += `<span class="dt-badge req">REQ</span>`;
      if (editable && !disabled) html += `<span class="dt-badge edit">EDIT</span>`;
      if (type) html += `<span class="dt-badge type-badge">${esc(type)}</span>`;
      html += `</span>`;
      html += `</div>`;
    }
    html += `</div>`;
  }

  dtFields.innerHTML = html;
}

// Fetch document count for a selection
async function fetchDocCount(selection) {
  const where = buildWhereClause(selection);
  const q = `SELECT COUNT(id) FROM documents${where}`;
  const result = await apiCall("/query", "POST", `q=${encodeURIComponent(q)}`);

  if (result.success && result.data?.responseStatus !== "FAILURE" && result.data?.data?.[0]) {
    const count = result.data.data[0]["count(id)"] || result.data.data[0]["COUNT(id)"] || Object.values(result.data.data[0])[0] || 0;
    dtDocCount.innerHTML = `${count} <small>documents</small>`;
  } else {
    dtDocCount.textContent = "-- documents";
  }
}

function buildWhereClause(selection) {
  const conditions = [];
  if (selection.type) conditions.push(`type__v = '${selection.type}'`);
  if (selection.subtype) conditions.push(`subtype__v = '${selection.subtype}'`);
  if (selection.classification) conditions.push(`classification__v = '${selection.classification}'`);
  return conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
}

// Fill rate analysis
dtLoadStatsBtn?.addEventListener("click", analyzeFillRate);

async function analyzeFillRate() {
  if (!dtSelection || !dtCurrentFields.length || !state.sessionId) return;

  dtLoadStatsBtn.disabled = true;
  dtLoadStatsBtn.innerHTML = '<span class="spinner"></span> Analyzing...';
  dtFillBar.classList.remove("hidden");
  dtFillBar.innerHTML = '<div class="dt-children-loading"><span class="spinner"></span> Querying sample...</div>';

  // Pick queryable fields (max 20 to avoid query limits)
  const queryableFields = dtCurrentFields
    .filter((f) => {
      const name = f.name || f.name__v || "";
      const queryable = f.queryable !== undefined ? f.queryable : true;
      return queryable && name && !name.startsWith("__");
    })
    .slice(0, 20);

  const fieldNames = queryableFields.map((f) => f.name || f.name__v);
  const where = buildWhereClause(dtSelection);
  const q = `SELECT ${fieldNames.join(", ")} FROM documents${where} LIMIT 200`;

  const result = await apiCall("/query", "POST", `q=${encodeURIComponent(q)}`);

  dtLoadStatsBtn.disabled = false;
  dtLoadStatsBtn.innerHTML = "Analyze Fill Rate";

  if (!result.success || result.data?.responseStatus === "FAILURE" || !result.data?.data?.length) {
    const err = result.data?.errors?.[0]?.message || "No data returned";
    dtFillBar.innerHTML = `<div style="font-size:11px;color:var(--red);padding:4px 0;">${esc(err)}</div>`;
    return;
  }

  const rows = result.data.data;
  const totalRows = rows.length;

  // Calculate fill rate per field
  const fillRates = {};
  let totalFilled = 0;
  let totalCells = 0;

  for (const fname of fieldNames) {
    let filled = 0;
    for (const row of rows) {
      const val = row[fname];
      if (val !== null && val !== undefined && val !== "") filled++;
    }
    fillRates[fname] = Math.round((filled / totalRows) * 100);
    totalFilled += filled;
    totalCells += totalRows;
  }

  const overallPct = totalCells > 0 ? Math.round((totalFilled / totalCells) * 100) : 0;

  // Sort by fill rate ascending (emptiest first)
  const sorted = fieldNames.slice().sort((a, b) => fillRates[a] - fillRates[b]);

  // Render
  let html = `<div class="dt-fill-summary">`;
  html += `Overall fill rate: <span class="dt-fill-pct">${overallPct}%</span>`;
  html += ` <small>(sample of ${totalRows} docs, ${fieldNames.length} fields)</small>`;
  html += `</div>`;

  html += `<div class="dt-fill-track"><div class="dt-fill-track-inner" style="width:${overallPct}%;background:${fillColor(overallPct)};"></div></div>`;

  html += `<div class="dt-fill-detail">`;
  for (const fname of sorted) {
    const pct = fillRates[fname];
    html += `<div class="dt-fill-field">`;
    html += `<span class="dt-fill-field-name" title="${esc(fname)}">${esc(fname)}</span>`;
    html += `<span class="dt-fill-field-bar"><span class="dt-fill-field-bar-inner" style="width:${pct}%;background:${fillColor(pct)};"></span></span>`;
    html += `<span class="dt-fill-field-pct">${pct}%</span>`;
    html += `</div>`;
  }
  html += `</div>`;

  dtFillBar.innerHTML = html;
}

function fillColor(pct) {
  if (pct >= 80) return "var(--green)";
  if (pct >= 50) return "var(--orange)";
  return "var(--red)";
}

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

// ===================== UTILS =====================
function esc(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
