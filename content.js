// Injects Vault Dweller popup.html as an overlay iframe on Vault pages.
// Toggled by clicking the extension toolbar icon.

(function () {
  const IFRAME_ID = "vault-dweller-overlay-iframe";
  const WRAP_ID = "vault-dweller-overlay-wrap";

  function create() {
    const wrap = document.createElement("div");
    wrap.id = WRAP_ID;
    Object.assign(wrap.style, {
      position: "fixed",
      top: "20px",
      right: "20px",
      width: "660px",
      // Height tracks the panel's own content (see vault-dweller-height below),
      // so only the width is user-resizable. It is eased rather than snapped:
      // the panel reports a new height whenever an answer lands or opens.
      height: "300px",
      transition: "height .22s cubic-bezier(.4, 0, .2, 1)",
      minWidth: "360px",
      maxWidth: "calc(100vw - 40px)",
      maxHeight: "calc(100vh - 40px)",
      resize: "horizontal",
      zIndex: "2147483647",
      boxShadow: "0 10px 40px rgba(0,0,0,0.25)",
      borderRadius: "14px",
      overflow: "hidden",
      background: "#f0f2f5",
      border: "1px solid rgba(0,0,0,0.1)",
    });

    const iframe = document.createElement("iframe");
    iframe.id = IFRAME_ID;
    iframe.src = chrome.runtime.getURL("popup.html");
    Object.assign(iframe.style, {
      width: "100%",
      height: "100%",
      border: "0",
      display: "block",
    });

    // The panel sizes its conversation to the room actually available. It
    // cannot read that itself: inside the iframe the viewport is whatever
    // height we just gave it, so asking there would be circular.
    iframe.addEventListener("load", postSpace);

    wrap.appendChild(iframe);
    document.documentElement.appendChild(wrap);
  }

  function postSpace() {
    const iframe = document.getElementById(IFRAME_ID);
    if (!iframe || !iframe.contentWindow) return;
    // Addressed to the extension origin rather than "*", so the message is not
    // delivered if the frame is ever navigated elsewhere.
    iframe.contentWindow.postMessage(
      { type: "vault-dweller-space", height: window.innerHeight - 40 },
      new URL(chrome.runtime.getURL("popup.html")).origin
    );
  }

  window.addEventListener("resize", postSpace);

  function toggle() {
    const existing = document.getElementById(WRAP_ID);
    if (existing) {
      existing.remove();
    } else {
      create();
    }
  }

  function open() {
    if (!document.getElementById(WRAP_ID)) create();
  }

  function close() {
    document.getElementById(WRAP_ID)?.remove();
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg) return;
    if (msg.action === "toggleOverlay") toggle();
    if (msg.action === "openOverlay") open();
  });

  function setHeight(px) {
    const wrap = document.getElementById(WRAP_ID);
    if (!wrap || !Number.isFinite(px)) return;
    const max = window.innerHeight - 40;
    wrap.style.height = `${Math.max(120, Math.min(px, max))}px`;
  }

  // The panel reports its own height and asks for teardown from inside the
  // iframe. Only trust these when they actually came from that iframe's window —
  // any script on the host page can post to us.
  window.addEventListener("message", (e) => {
    const type = e.data?.type;
    if (type !== "vault-dweller-close" && type !== "vault-dweller-height") return;
    const iframe = document.getElementById(IFRAME_ID);
    if (!iframe || e.source !== iframe.contentWindow) return;
    if (type === "vault-dweller-close") close();
    else setHeight(e.data.height);
  });
})();
