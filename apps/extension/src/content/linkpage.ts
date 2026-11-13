import type { BgRequest, BgResponse } from "../protocol";

/**
 * Runs only on our own share-link landing page (https://<api>/s/<token>).
 * Turns the page's button into: redeem this link (the server checks it), then open the drawing
 * in Excalidraw. The token never leaves this extension and our server.
 */
const token = location.pathname.split("/")[2];
const button = document.getElementById("ecd-open") as HTMLButtonElement | null;
const message = document.getElementById("ecd-msg");

if (button && message && token) {
  button.disabled = false;
  message.textContent = "Ready. If you are not signed in to Inkdrive yet, you will be asked to.";
  button.addEventListener("click", async () => {
    button.disabled = true;
    message.textContent = "Opening…";
    try {
      const res = (await chrome.runtime.sendMessage({ type: "link:open", token } satisfies BgRequest)) as BgResponse<{ kind: string; name: string }>;
      message.textContent = res.ok
        ? res.data.kind === "folder"
          ? `“${res.data.name}” was added to Shared with me in Inkdrive.`
          : `Opened “${res.data.name}” in Excalidraw.`
        : res.error;
    } catch {
      message.textContent = "Could not reach the extension. Reload this page and try again.";
    }
    button.disabled = false;
  });
}
