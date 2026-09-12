// Background service worker — reads TK cookie and handles Vault API calls

// Toolbar click toggles the overlay iframe injected by content.js into the Vault tab.
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id) return;
  if (!tab.url || !/^https:\/\/[^/]*\.veevavault\.com\//.test(tab.url)) {
    // Not a Vault tab — nothing to inject into.
    return;
  }
  try {
    await chrome.tabs.sendMessage(tab.id, { action: "toggleOverlay" });
  } catch (e) {
    // Content script may not be loaded yet (e.g. after install). Inject and retry.
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    await chrome.tabs.sendMessage(tab.id, { action: "toggleOverlay" });
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getToken") {
    getVaultToken(request.domain).then(sendResponse);
    return true; // keep channel open for async
  }

  if (request.action === "apiCall") {
    makeVaultApiCall(request.domain, request.sessionId, request.endpoint, request.method, request.body)
      .then(sendResponse);
    return true;
  }

});

async function getVaultToken(domain) {
  try {
    // Try multiple cookie names Veeva Vault may use
    const cookieNames = ["TK", "tk"];
    for (const name of cookieNames) {
      const cookie = await chrome.cookies.get({
        url: `https://${domain}`,
        name: name,
      });
      if (cookie) {
        return { success: true, token: cookie.value };
      }
    }
    // Fallback: search all cookies for the domain for any token-like cookie
    const allCookies = await chrome.cookies.getAll({ domain: domain });
    const tkCookie = allCookies.find(
      (c) => c.name.toUpperCase() === "TK" || c.name === "sessionId"
    );
    if (tkCookie) {
      return { success: true, token: tkCookie.value };
    }
    return { success: false, error: "No TK token found. Make sure you are logged into Veeva Vault." };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function makeVaultApiCall(domain, sessionId, endpoint, method = "GET", body = null) {
  try {
    // Vault's responseDetails.next_page returns paths that already include
    // /api/vXX.X/... — pass those through unchanged. Otherwise prepend the version.
    const url = /^\/api\/v\d+(\.\d+)?\//.test(endpoint)
      ? `https://${domain}${endpoint}`
      : `https://${domain}/api/v24.1${endpoint}`;
    const options = {
      method,
      headers: {
        "Authorization": sessionId,
        "Accept": "application/json",
      },
    };
    if (body) {
      if (typeof body === "string") {
        options.headers["Content-Type"] = "application/x-www-form-urlencoded";
        options.body = body;
      } else {
        options.headers["Content-Type"] = "application/json";
        options.body = JSON.stringify(body);
      }
    }
    const response = await fetch(url, options);
    const data = await response.json();
    return { success: true, data };
  } catch (err) {
    return { success: false, error: err.message };
  }
}
