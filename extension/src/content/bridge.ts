// extension/src/content/bridge.ts
import { isRuntimeMessage, PendingCapture } from "../shared/messages";
import { getSettings } from "../shared/settings";

const APP_MESSAGE_SOURCE = "s2c-app";
const EXTENSION_MESSAGE_SOURCE = "s2c-extension";

async function deliverPendingCaptureIfAny(): Promise<void> {
  const stored = await chrome.storage.local.get("pendingCapture");
  const pending = stored.pendingCapture as PendingCapture | undefined;
  if (!pending) return;
  await chrome.storage.local.remove("pendingCapture");
  if (Date.now() - pending.createdAt > 30_000) return;
  window.postMessage(
    { source: EXTENSION_MESSAGE_SOURCE, type: "capture", dataUrl: pending.dataUrl },
    window.location.origin
  );
}

deliverPendingCaptureIfAny();

chrome.runtime.onMessage.addListener((message: unknown) => {
  if (!isRuntimeMessage(message)) return;
  if (message.kind === "deliver-pending-capture") {
    deliverPendingCaptureIfAny();
  }
});

window.addEventListener("message", async (event: MessageEvent) => {
  if (event.origin !== window.location.origin) return;
  const data = event.data as Record<string, unknown> | undefined;
  if (data?.source !== APP_MESSAGE_SOURCE || data?.type !== "variant-complete") return;
  const variantIndex = data.variantIndex as number;
  const code = data.code as string;

  chrome.runtime.sendMessage({ kind: "variant-complete", variantIndex, code });

  const settings = await getSettings();
  if (settings.clipboardMode === "auto") {
    try {
      await navigator.clipboard.writeText(code);
    } catch (error) {
      console.error("screenshot-to-code extension: failed to copy code to clipboard", error);
    }
  } else if (settings.clipboardMode === "ask") {
    const shouldCopy = window.confirm(
      "screenshot-to-code: copy the generated code to the clipboard?"
    );
    if (shouldCopy) {
      try {
        await navigator.clipboard.writeText(code);
      } catch (error) {
        console.error("screenshot-to-code extension: failed to copy code to clipboard", error);
      }
    }
  }
});
