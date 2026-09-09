/**
 * Messages sent through chrome.runtime.sendMessage between the background
 * service worker, content/capture.ts, and content/bridge.ts. Distinct from
 * the window.postMessage contract with the page itself, which lives in
 * frontend/src/lib/extensionBridge.ts (kept in lockstep by hand — see the
 * comment there).
 */
export type RuntimeMessage =
  | { kind: "start-area-selection" }
  | { kind: "area-selected"; dataUrl: string }
  | { kind: "area-selection-cancelled" }
  | { kind: "context-menu-capture"; dataUrl: string }
  | { kind: "variant-complete"; variantIndex: number; code: string }
  | { kind: "deliver-pending-capture" };

export interface PendingCapture {
  dataUrl: string;
  createdAt: number;
}

const RUNTIME_MESSAGE_KINDS: ReadonlySet<RuntimeMessage["kind"]> = new Set([
  "start-area-selection",
  "area-selected",
  "area-selection-cancelled",
  "context-menu-capture",
  "variant-complete",
  "deliver-pending-capture",
]);

export function isRuntimeMessage(data: unknown): data is RuntimeMessage {
  if (typeof data !== "object" || data === null) return false;
  const kind = (data as Record<string, unknown>).kind;
  return typeof kind === "string" && RUNTIME_MESSAGE_KINDS.has(kind as RuntimeMessage["kind"]);
}
