// extension/src/background/index.ts
import { isRuntimeMessage, RuntimeMessage, PendingCapture } from "../shared/messages";
import { getSettings } from "../shared/settings";
import { textToDataUrl } from "../shared/dataUrl";

const CONTEXT_MENU_ID = "s2c-generate-from-image";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: CONTEXT_MENU_ID,
    title: "Generate code from this image",
    contexts: ["image"],
  });
});

async function findOrOpenFrontendTab(frontendUrl: string): Promise<chrome.tabs.Tab> {
  // chrome.tabs.query's match pattern is invalid if frontendUrl has a
  // trailing slash (e.g. "http://localhost:5173/" would produce
  // "http://localhost:5173//*", which chrome.tabs.query rejects), so a
  // user who saves the URL with a trailing slash in Options must not break
  // this lookup.
  const normalizedFrontendUrl = frontendUrl.replace(/\/+$/, "");
  const tabs = await chrome.tabs.query({ url: `${normalizedFrontendUrl}/*` });
  if (tabs.length > 0 && tabs[0].id !== undefined) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    if (tabs[0].windowId !== undefined) {
      await chrome.windows.update(tabs[0].windowId, { focused: true });
    }
    return tabs[0];
  }
  return chrome.tabs.create({ url: frontendUrl, active: true });
}

async function deliverCapture(dataUrl: string): Promise<void> {
  const pending: PendingCapture = { dataUrl, createdAt: Date.now() };
  await chrome.storage.local.set({ pendingCapture: pending });
  const settings = await getSettings();
  const tab = await findOrOpenFrontendTab(settings.frontendUrl);
  if (tab.id === undefined) return;
  chrome.tabs
    .sendMessage(tab.id, { kind: "deliver-pending-capture" } satisfies RuntimeMessage)
    .catch(() => {
      // Tab was just created and bridge.ts hasn't attached its listener
      // yet; it will read chrome.storage.local itself on load.
    });
}

async function captureActiveTabFullPage(): Promise<void> {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (activeTab?.windowId === undefined) return;
  const dataUrl = await chrome.tabs.captureVisibleTab(activeTab.windowId, {
    format: "png",
  });
  await deliverCapture(dataUrl);
}

async function startAreaSelectionOnActiveTab(): Promise<void> {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (activeTab?.id === undefined) return;
  await chrome.tabs
    .sendMessage(activeTab.id, {
      kind: "start-area-selection",
    } satisfies RuntimeMessage)
    .catch((error) => {
      console.error(
        "screenshot-to-code extension: failed to start area selection on active tab",
        error
      );
    });
}

chrome.action.onClicked.addListener(() => {
  captureActiveTabFullPage().catch((error) => {
    console.error("screenshot-to-code extension: toolbar capture failed", error);
  });
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "capture-shortcut") return;
  try {
    const settings = await getSettings();
    if (settings.captureShortcutMode === "full-page") {
      await captureActiveTabFullPage();
    } else if (settings.captureShortcutMode === "area") {
      await startAreaSelectionOnActiveTab();
    }
  } catch (error) {
    console.error("screenshot-to-code extension: capture-shortcut command failed", error);
  }
});

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== CONTEXT_MENU_ID || !info.srcUrl) return;
  try {
    const response = await fetch(info.srcUrl);
    const blob = await response.blob();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    await deliverCapture(dataUrl);
  } catch (error) {
    // fetch() rejects here for a genuinely cross-origin image whose host
    // does not send CORS headers — the same canvas/fetch same-origin
    // policy that taints a <canvas> drawn from such an image. This is a
    // browser platform limitation, not something this extension can work
    // around (reading the pixels from the content script instead would
    // hit the same tainting, since it applies regardless of which context
    // reads the image). Suggest area-selection as the fallback for images
    // that fail this way.
    console.error(
      "screenshot-to-code extension: failed to fetch image for context-menu capture " +
        "(if this is a cross-origin image with no CORS headers, try area-selection instead)",
      error
    );
  }
});

async function applyOutputs(variantIndex: number, code: string): Promise<void> {
  const settings = await getSettings();
  await chrome.storage.local.set({
    latestResult: { variantIndex, code, receivedAt: Date.now() },
  });
  if (settings.sidePanelEnabled) {
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (activeTab?.windowId !== undefined) {
        await chrome.sidePanel.open({ windowId: activeTab.windowId });
      }
    } catch (error) {
      // chrome.sidePanel.open() requires a user gesture, which is not
      // present in this call chain (this runs from a runtime.onMessage
      // handler responding to a page postMessage). A rejection here must
      // not prevent the download step below from running — the side panel
      // already reactively re-renders from storage.onChanged, so a user
      // who opens it manually still sees the result.
      console.error("screenshot-to-code extension: failed to auto-open side panel", error);
    }
  }
  if (settings.saveFileEnabled) {
    await chrome.downloads.download({
      url: textToDataUrl(code, "text/plain"),
      filename: `screenshot-to-code-variant-${variantIndex}.txt`,
      saveAs: false,
    });
  }
  // clipboardMode "auto" and "ask" are handled in content/bridge.ts, not
  // here: only a document context (the bridge script's page) can write to
  // navigator.clipboard, a service worker cannot.
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (!isRuntimeMessage(message)) return undefined;
  handleRuntimeMessage(message, sender)
    .then((result) => sendResponse(result))
    .catch((error) => {
      console.error(
        "screenshot-to-code extension: failed to handle runtime message",
        message.kind,
        error
      );
      sendResponse(undefined);
    });
  return true; // keep the message channel open for the async response
});

async function handleRuntimeMessage(
  message: RuntimeMessage,
  _sender: chrome.runtime.MessageSender
): Promise<{ dataUrl?: string } | void> {
  if (message.kind === "area-selected") {
    await deliverCapture(message.dataUrl);
  } else if (message.kind === "variant-complete") {
    await applyOutputs(message.variantIndex, message.code);
  } else if (message.kind === "start-area-selection") {
    // content/capture.ts re-uses this message kind to ask the background
    // to capture the full visible tab, which it then crops locally where
    // DOM/canvas access exists. Distinct from the background sending this
    // same kind via chrome.tabs.sendMessage to a content script to make it
    // *start* the overlay (see startAreaSelectionOnActiveTab above) — one
    // direction is chrome.runtime.sendMessage (reaches the background),
    // the other is chrome.tabs.sendMessage (reaches one tab's content
    // script). Standard MV3 plumbing, easy to misread.
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab?.windowId === undefined) return;
    const dataUrl = await chrome.tabs.captureVisibleTab(activeTab.windowId, {
      format: "png",
    });
    return { dataUrl };
  }
}
