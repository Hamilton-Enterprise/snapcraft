// extension/src/content/capture.ts
import { isRuntimeMessage, RuntimeMessage } from "../shared/messages";

function startAreaSelection(): void {
  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:2147483647;cursor:crosshair;background:rgba(0,0,0,0.15);";
  const rect = document.createElement("div");
  rect.style.cssText =
    "position:fixed;border:2px solid #6366f1;background:rgba(99,102,241,0.15);display:none;";
  overlay.appendChild(rect);
  document.body.appendChild(overlay);

  let startX = 0;
  let startY = 0;
  let dragging = false;

  function cleanup() {
    overlay.remove();
    document.removeEventListener("keydown", onKeyDown);
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      cleanup();
      chrome.runtime.sendMessage({
        kind: "area-selection-cancelled",
      } satisfies RuntimeMessage);
    }
  }

  overlay.addEventListener("mousedown", (event) => {
    dragging = true;
    startX = event.clientX;
    startY = event.clientY;
    rect.style.display = "block";
    rect.style.left = `${startX}px`;
    rect.style.top = `${startY}px`;
    rect.style.width = "0px";
    rect.style.height = "0px";
  });

  overlay.addEventListener("mousemove", (event) => {
    if (!dragging) return;
    const x = Math.min(event.clientX, startX);
    const y = Math.min(event.clientY, startY);
    const width = Math.abs(event.clientX - startX);
    const height = Math.abs(event.clientY - startY);
    rect.style.left = `${x}px`;
    rect.style.top = `${y}px`;
    rect.style.width = `${width}px`;
    rect.style.height = `${height}px`;
  });

  overlay.addEventListener("mouseup", async (event) => {
    dragging = false;
    const x = Math.min(event.clientX, startX);
    const y = Math.min(event.clientY, startY);
    const width = Math.abs(event.clientX - startX);
    const height = Math.abs(event.clientY - startY);
    cleanup();
    if (width < 4 || height < 4) return;
    try {
      const response = (await chrome.runtime.sendMessage({
        kind: "start-area-selection",
      } satisfies RuntimeMessage)) as { dataUrl?: string } | undefined;
      if (!response?.dataUrl) return;
      const cropped = await cropDataUrl(response.dataUrl, x, y, width, height);
      chrome.runtime.sendMessage({
        kind: "area-selected",
        dataUrl: cropped,
      } satisfies RuntimeMessage);
    } catch (error) {
      console.error(
        "screenshot-to-code extension: failed to capture or crop the selected area",
        error
      );
    }
  });

  document.addEventListener("keydown", onKeyDown);
}

async function cropDataUrl(
  dataUrl: string,
  cssX: number,
  cssY: number,
  cssWidth: number,
  cssHeight: number
): Promise<string> {
  const image = await loadImage(dataUrl);
  const ratio = window.devicePixelRatio || 1;
  const canvas = document.createElement("canvas");
  canvas.width = cssWidth * ratio;
  canvas.height = cssHeight * ratio;
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;
  ctx.drawImage(
    image,
    cssX * ratio,
    cssY * ratio,
    cssWidth * ratio,
    cssHeight * ratio,
    0,
    0,
    cssWidth * ratio,
    cssHeight * ratio
  );
  return canvas.toDataURL("image/png");
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = dataUrl;
  });
}

chrome.runtime.onMessage.addListener((message: unknown) => {
  if (!isRuntimeMessage(message)) return;
  if (message.kind === "start-area-selection") {
    startAreaSelection();
  }
});
