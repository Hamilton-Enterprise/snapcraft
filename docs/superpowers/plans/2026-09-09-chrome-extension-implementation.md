# Chrome Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a personal-use Manifest V3 Chrome extension that captures a screenshot (full page, area selection, keyboard shortcut, or right-click on an image) and hands it to the existing screenshot-to-code tab, which does the actual generation; the extension then mirrors the finished code to whichever outputs the user has enabled (side panel, clipboard, downloaded file).

**Architecture:** The extension never talks to the `/generate-code` WebSocket directly. A background service worker owns capture and settings; two content scripts bridge it to the page world — `capture.ts` runs everywhere and handles area selection, `bridge.ts` runs only on the screenshot-to-code origin and exchanges `window.postMessage` with a small hook added to the existing React app (deliver the captured image in, receive the finished code back out).

**Tech Stack:** TypeScript 5, esbuild (background + content scripts, bundled as IIFE — no module loader needed for MV3 content scripts), Vite 6 (side panel + options HTML pages, consistent with the existing frontend's build tool), Vitest (pure-logic unit tests), Jest (the one frontend-side unit test, matching the frontend's existing `test` script).

**Spec:** `docs/superpowers/specs/2026-09-09-chrome-extension-design.md`

## Global Constraints

- Extension lives in a new top-level `extension/` folder in this repository (fork of `abi/screenshot-to-code`, MIT).
- Default frontend URL `http://localhost:5173`, default backend URL `http://localhost:7001`, both user-editable in Options.
- No Chrome Web Store publishing in this phase — loaded as an unpacked extension.
- No new runtime dependency on the existing frontend's React/Zustand stack from the extension itself; the only change to the frontend is the two integration points described in Task 1.
- Every content script and the background service worker must compile with `tsc --noEmit` and contain no `any`-typed message payloads — all cross-context messages go through the shared types in `extension/src/shared/messages.ts`.

---

## File Structure

```
frontend/src/App.tsx                          # modified: 2 integration points
extension/
  package.json
  tsconfig.json
  esbuild.mjs                                 # bundles background + 2 content scripts to dist/
  vite.config.ts                              # builds sidepanel.html + options.html to dist/
  manifest.json
  src/
    shared/messages.ts                        # cross-context message contracts + type guards
    shared/settings.ts                        # ExtensionSettings type, defaults, get/set helpers
    shared/dataUrl.ts                         # blob<->dataUrl, text<->base64 dataUrl helpers
    background/index.ts                       # service worker: capture, tab handoff, outputs
    content/capture.ts                        # runs on all pages: area-selection overlay
    content/bridge.ts                         # runs only on the frontend origin: postMessage bridge
    sidepanel/index.html
    sidepanel/main.ts
    sidepanel/style.css
    options/index.html
    options/main.ts
    options/style.css
  tests/
    messages.test.ts
    settings.test.ts
    dataUrl.test.ts
```

---

### Task 1: Frontend integration points

**Files:**
- Modify: `frontend/src/App.tsx:427-439` (add outgoing broadcast inside `onVariantComplete`)
- Modify: `frontend/src/App.tsx` (add one `useEffect` near the existing mount effects at lines 173-234, and the `doCreate` call site)
- Test: `frontend/src/lib/extensionBridge.test.ts`
- Create: `frontend/src/lib/extensionBridge.ts`

**Interfaces:**
- Produces: `EXTENSION_MESSAGE_SOURCE = "s2c-extension"`, `APP_MESSAGE_SOURCE = "s2c-app"`, `buildVariantCompleteMessage(variantIndex: number, code: string): VariantCompleteMessage`, `parseCaptureMessage(data: unknown): CaptureMessage | null` — these are the exact names Task 4's `content/bridge.ts` and Task 2's `shared/messages.ts` must mirror on the extension side (the two sides don't share a module, so the wire format is what has to match, not the TypeScript types).

The wire format, fixed here because both sides implement it independently:

```json
// page -> extension, on window, targetOrigin = window.location.origin
{ "source": "s2c-app", "type": "variant-complete", "variantIndex": 0, "code": "<final code string>" }

// extension -> page, on window, targetOrigin = "*" (content script always runs on the exact frontend origin already)
{ "source": "s2c-extension", "type": "capture", "dataUrl": "data:image/png;base64,..." }
```

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/src/lib/extensionBridge.test.ts
import {
  APP_MESSAGE_SOURCE,
  EXTENSION_MESSAGE_SOURCE,
  buildVariantCompleteMessage,
  parseCaptureMessage,
} from "./extensionBridge";

describe("extensionBridge", () => {
  test("buildVariantCompleteMessage produces the fixed wire format", () => {
    expect(buildVariantCompleteMessage(2, "<div>hi</div>")).toEqual({
      source: APP_MESSAGE_SOURCE,
      type: "variant-complete",
      variantIndex: 2,
      code: "<div>hi</div>",
    });
  });

  test("parseCaptureMessage accepts a well-formed capture message", () => {
    const result = parseCaptureMessage({
      source: EXTENSION_MESSAGE_SOURCE,
      type: "capture",
      dataUrl: "data:image/png;base64,AAAA",
    });
    expect(result).toEqual({ dataUrl: "data:image/png;base64,AAAA" });
  });

  test.each([
    undefined,
    null,
    "a string",
    { source: "something-else", type: "capture", dataUrl: "x" },
    { source: EXTENSION_MESSAGE_SOURCE, type: "capture" },
    { source: EXTENSION_MESSAGE_SOURCE, type: "capture", dataUrl: 5 },
  ])("parseCaptureMessage rejects %p", (input) => {
    expect(parseCaptureMessage(input)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx jest src/lib/extensionBridge.test.ts`
Expected: FAIL with "Cannot find module './extensionBridge'"

- [ ] **Step 3: Write minimal implementation**

```typescript
// frontend/src/lib/extensionBridge.ts

/**
 * Wire format shared with extension/src/shared/messages.ts. The two sides
 * do not import from each other (different build, different runtime) so
 * this file is the single source of truth for the page-to-extension
 * postMessage contract; keep it in lockstep with the extension by hand.
 */
export const APP_MESSAGE_SOURCE = "s2c-app" as const;
export const EXTENSION_MESSAGE_SOURCE = "s2c-extension" as const;

export interface VariantCompleteMessage {
  source: typeof APP_MESSAGE_SOURCE;
  type: "variant-complete";
  variantIndex: number;
  code: string;
}

export interface CaptureMessage {
  dataUrl: string;
}

export function buildVariantCompleteMessage(
  variantIndex: number,
  code: string
): VariantCompleteMessage {
  return {
    source: APP_MESSAGE_SOURCE,
    type: "variant-complete",
    variantIndex,
    code,
  };
}

export function parseCaptureMessage(data: unknown): CaptureMessage | null {
  if (typeof data !== "object" || data === null) return null;
  const candidate = data as Record<string, unknown>;
  if (candidate.source !== EXTENSION_MESSAGE_SOURCE) return null;
  if (candidate.type !== "capture") return null;
  if (typeof candidate.dataUrl !== "string") return null;
  return { dataUrl: candidate.dataUrl };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx jest src/lib/extensionBridge.test.ts`
Expected: PASS, 5 tests (1 + 1 + 3 from `test.each`)

- [ ] **Step 5: Wire the outgoing broadcast into `onVariantComplete`**

In `frontend/src/App.tsx`, add the import near the other `./lib/...` imports (after line 23):

```typescript
import { buildVariantCompleteMessage } from "./lib/extensionBridge";
```

Then in the existing `onVariantComplete` callback (`frontend/src/App.tsx:427-439`), broadcast right after `currentCode` is computed — insert this line immediately after line 432 (`?.code || "";`) and before the `if (currentCode.trim().length > 0) {` check:

```typescript
        window.postMessage(
          buildVariantCompleteMessage(variantIndex, currentCode),
          window.location.origin
        );
```

The surrounding callback becomes:

```typescript
      onVariantComplete: (variantIndex) => {
        console.log(`Variant ${variantIndex} complete event received`);
        updateVariantStatus(commit.hash, variantIndex, "complete");
        const currentCode =
          useProjectStore.getState().commits[commit.hash]?.variants[variantIndex]
            ?.code || "";
        window.postMessage(
          buildVariantCompleteMessage(variantIndex, currentCode),
          window.location.origin
        );
        if (currentCode.trim().length > 0) {
          appendVariantHistoryMessage(
            commit.hash,
            variantIndex,
            buildAssistantHistoryMessage(currentCode)
          );
        }
```

- [ ] **Step 6: Wire the incoming capture listener**

In `frontend/src/App.tsx`, add a new `useEffect` right after the existing theme-media-query effect (after line 234, `}, [appTheme]);`):

```typescript
  // Extension bridge: content/bridge.ts (extension/src/content/bridge.ts)
  // posts a "capture" message on this window when it injects a screenshot
  // taken from the toolbar icon, area selection, shortcut, or context menu.
  useEffect(() => {
    const onExtensionMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const parsed = parseCaptureMessage(event.data);
      if (parsed === null) return;
      doCreate([parsed.dataUrl], "image");
    };
    window.addEventListener("message", onExtensionMessage);
    return () => window.removeEventListener("message", onExtensionMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

Add `parseCaptureMessage` to the import added in Step 5:

```typescript
import {
  buildVariantCompleteMessage,
  parseCaptureMessage,
} from "./lib/extensionBridge";
```

Note: `doCreate` is defined later in the same component (`frontend/src/App.tsx:571`) as a plain function, not a `useCallback`, so it closes over current props/state each render the way the rest of the component already relies on (see `regenerate` at line 258 calling it the same way) — no dependency-array warning suppression beyond what the existing effects in this file already do.

- [ ] **Step 7: Run the full frontend test suite to confirm no regression**

Run: `cd frontend && npx jest`
Expected: PASS, all existing suites plus the new `extensionBridge.test.ts`

- [ ] **Step 8: Commit**

```bash
git add frontend/src/lib/extensionBridge.ts frontend/src/lib/extensionBridge.test.ts frontend/src/App.tsx
git commit -m "Add postMessage bridge hook for the personal Chrome extension"
```

---

### Task 2: Extension scaffold (manifest, build, shared types)

**Files:**
- Create: `extension/package.json`
- Create: `extension/tsconfig.json`
- Create: `extension/esbuild.mjs`
- Create: `extension/vite.config.ts`
- Create: `extension/manifest.json`
- Create: `extension/src/shared/messages.ts`
- Test: `extension/tests/messages.test.ts`

**Interfaces:**
- Produces: `RuntimeMessage` union type and type guards `isRuntimeMessage`, used by every later task's background/content script; `PendingCapture` interface used by Task 3 and Task 5.

- [ ] **Step 1: Create the package manifest**

```json
{
  "name": "screenshot-to-code-extension",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "build": "node esbuild.mjs && vite build",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@types/chrome": "^0.0.280",
    "esbuild": "^0.24.0",
    "typescript": "^5.6.0",
    "vite": "^6.4.1",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create the TypeScript config**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "skipLibCheck": true,
    "types": ["chrome", "vite/client"],
    "noEmit": true
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 3: Write the shared message contracts**

```typescript
// extension/src/shared/messages.ts

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
```

- [ ] **Step 4: Write the failing test**

```typescript
// extension/tests/messages.test.ts
import { describe, expect, test } from "vitest";
import { isRuntimeMessage } from "../src/shared/messages";

describe("isRuntimeMessage", () => {
  test("accepts a well-formed message", () => {
    expect(isRuntimeMessage({ kind: "start-area-selection" })).toBe(true);
    expect(
      isRuntimeMessage({ kind: "area-selected", dataUrl: "data:image/png;base64,AA" })
    ).toBe(true);
  });

  test.each([undefined, null, "x", 5, {}, { kind: "unknown-kind" }])(
    "rejects %p",
    (input) => {
      expect(isRuntimeMessage(input)).toBe(false);
    }
  );
});
```

- [ ] **Step 5: Run test to verify it fails, then passes**

Run: `cd extension && npm install && npx vitest run tests/messages.test.ts`
Expected: first run fails only if `messages.ts` has a typo; as written above it should PASS immediately since Step 3 already implements it — run it anyway to confirm before moving on.

- [ ] **Step 6: Write the manifest**

```json
{
  "manifest_version": 3,
  "name": "screenshot-to-code Quick Capture",
  "version": "0.1.0",
  "description": "Personal-use capture shortcut for a local screenshot-to-code instance.",
  "permissions": [
    "activeTab",
    "storage",
    "scripting",
    "contextMenus",
    "downloads",
    "sidePanel",
    "clipboardWrite"
  ],
  "host_permissions": ["http://localhost/*"],
  "background": {
    "service_worker": "background.js"
  },
  "action": {
    "default_title": "Capture for screenshot-to-code"
  },
  "side_panel": {
    "default_path": "sidepanel.html"
  },
  "options_page": "options.html",
  "commands": {
    "capture-shortcut": {
      "suggested_key": { "default": "Ctrl+Shift+K", "mac": "Command+Shift+K" },
      "description": "Capture for screenshot-to-code (mode set in Options)"
    }
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content-capture.js"],
      "run_at": "document_idle"
    },
    {
      "matches": ["http://localhost:5173/*"],
      "js": ["content-bridge.js"],
      "run_at": "document_idle"
    }
  ]
}
```

Note: `content_scripts[1].matches` hardcodes the default frontend port. Task 7 documents this as a known limitation — changing the frontend URL in Options only changes where the background service worker opens/delivers to; it does **not** retroactively change which pages `bridge.js` is injected into, because Chrome resolves `content_scripts.matches` at install/reload time from the manifest, not at runtime. If the user changes the port, they also need `chrome://extensions` → reload the extension after editing `manifest.json`'s host entry. This is acceptable for a personal-use, unpacked extension and is called out in the Options UI in Task 7.

- [ ] **Step 7: Write the esbuild bundler script**

```javascript
// extension/esbuild.mjs
import * as esbuild from "esbuild";
import { cpSync, mkdirSync } from "node:fs";

mkdirSync("dist", { recursive: true });

await esbuild.build({
  entryPoints: {
    background: "src/background/index.ts",
    "content-capture": "src/content/capture.ts",
    "content-bridge": "src/content/bridge.ts",
  },
  outdir: "dist",
  bundle: true,
  format: "iife",
  target: "chrome116",
  sourcemap: true,
});

cpSync("manifest.json", "dist/manifest.json");
```

- [ ] **Step 8: Write the Vite config for the two HTML pages**

```typescript
// extension/vite.config.ts
import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  root: "src",
  build: {
    outDir: "../dist",
    emptyOutDir: false,
    rollupOptions: {
      input: {
        sidepanel: resolve(__dirname, "src/sidepanel/index.html"),
        options: resolve(__dirname, "src/options/index.html"),
      },
    },
  },
});
```

- [ ] **Step 9: Commit**

```bash
git add extension/package.json extension/tsconfig.json extension/esbuild.mjs extension/vite.config.ts extension/manifest.json extension/src/shared/messages.ts extension/tests/messages.test.ts
git commit -m "Scaffold the Chrome extension: manifest, build, shared message types"
```

---

### Task 3: Shared settings and data-URL helpers

**Files:**
- Create: `extension/src/shared/settings.ts`
- Create: `extension/src/shared/dataUrl.ts`
- Test: `extension/tests/settings.test.ts`
- Test: `extension/tests/dataUrl.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module)
- Produces: `ExtensionSettings`, `DEFAULT_SETTINGS`, `getSettings(): Promise<ExtensionSettings>`, `setSettings(patch: Partial<ExtensionSettings>): Promise<void>` — used by Task 4 (background), Task 6 (side panel), Task 7 (options). `textToDataUrl(text: string, mimeType: string): string`, `dataUrlToBlob(dataUrl: string): Blob` — used by Task 4 for file-save and by Task 5 for image capture.

- [ ] **Step 1: Write the failing tests**

```typescript
// extension/tests/settings.test.ts
import { describe, expect, test, vi, beforeEach } from "vitest";
import { DEFAULT_SETTINGS, getSettings, setSettings } from "../src/shared/settings";

const store: Record<string, unknown> = {};

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
  (globalThis as any).chrome = {
    storage: {
      sync: {
        get: vi.fn(async (keys: string[]) => {
          const result: Record<string, unknown> = {};
          for (const key of keys) if (key in store) result[key] = store[key];
          return result;
        }),
        set: vi.fn(async (values: Record<string, unknown>) => {
          Object.assign(store, values);
        }),
      },
    },
  };
});

describe("settings", () => {
  test("getSettings returns defaults when nothing is stored", async () => {
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  test("setSettings merges a partial update on top of stored values", async () => {
    await setSettings({ clipboardMode: "auto" });
    await setSettings({ sidePanelEnabled: false });
    expect(await getSettings()).toEqual({
      ...DEFAULT_SETTINGS,
      clipboardMode: "auto",
      sidePanelEnabled: false,
    });
  });
});
```

```typescript
// extension/tests/dataUrl.test.ts
import { describe, expect, test } from "vitest";
import { textToDataUrl, dataUrlToBlob } from "../src/shared/dataUrl";

describe("dataUrl helpers", () => {
  test("textToDataUrl round-trips through dataUrlToBlob", async () => {
    const dataUrl = textToDataUrl("<div>hello</div>", "text/html");
    expect(dataUrl.startsWith("data:text/html;base64,")).toBe(true);
    const blob = dataUrlToBlob(dataUrl);
    expect(await blob.text()).toBe("<div>hello</div>");
  });

  test("textToDataUrl handles non-ASCII content", async () => {
    const dataUrl = textToDataUrl("café ☕", "text/plain");
    const blob = dataUrlToBlob(dataUrl);
    expect(await blob.text()).toBe("café ☕");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd extension && npx vitest run tests/settings.test.ts tests/dataUrl.test.ts`
Expected: FAIL, "Cannot find module '../src/shared/settings'" and "'../src/shared/dataUrl'"

- [ ] **Step 3: Write `settings.ts`**

```typescript
// extension/src/shared/settings.ts

export type ClipboardMode = "off" | "auto" | "ask";
export type CaptureShortcutMode = "off" | "full-page" | "area";

export interface ExtensionSettings {
  frontendUrl: string;
  backendUrl: string;
  sidePanelEnabled: boolean;
  clipboardMode: ClipboardMode;
  saveFileEnabled: boolean;
  captureShortcutMode: CaptureShortcutMode;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  frontendUrl: "http://localhost:5173",
  backendUrl: "http://localhost:7001",
  sidePanelEnabled: true,
  clipboardMode: "ask",
  saveFileEnabled: false,
  captureShortcutMode: "off",
};

const SETTINGS_KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof ExtensionSettings)[];

export async function getSettings(): Promise<ExtensionSettings> {
  const stored = await chrome.storage.sync.get(SETTINGS_KEYS);
  return { ...DEFAULT_SETTINGS, ...stored } as ExtensionSettings;
}

export async function setSettings(
  patch: Partial<ExtensionSettings>
): Promise<void> {
  await chrome.storage.sync.set(patch);
}
```

- [ ] **Step 4: Write `dataUrl.ts`**

```typescript
// extension/src/shared/dataUrl.ts

export function textToDataUrl(text: string, mimeType: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:${mimeType};base64,${btoa(binary)}`;
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [header, base64] = dataUrl.split(",");
  const mimeMatch = /data:(.*);base64/.exec(header);
  const mimeType = mimeMatch ? mimeMatch[1] : "application/octet-stream";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd extension && npx vitest run tests/settings.test.ts tests/dataUrl.test.ts`
Expected: PASS, 2 tests in `settings.test.ts`, 2 tests in `dataUrl.test.ts`

- [ ] **Step 6: Commit**

```bash
git add extension/src/shared/settings.ts extension/src/shared/dataUrl.ts extension/tests/settings.test.ts extension/tests/dataUrl.test.ts
git commit -m "Add extension settings storage and data-URL helpers"
```

---

### Task 4: Background service worker

**Files:**
- Create: `extension/src/background/index.ts`

**Interfaces:**
- Consumes: `RuntimeMessage`, `isRuntimeMessage`, `PendingCapture` (Task 2); `getSettings` (Task 3); `textToDataUrl` (Task 3)
- Produces: nothing consumed by other *files* (this is the coordination hub), but establishes the runtime behavior Task 5 and Task 6 depend on: it stores the pending capture under `chrome.storage.local` key `"pendingCapture"`, and it stores the latest result under `chrome.storage.local` key `"latestResult"` as `{ variantIndex: number; code: string; receivedAt: number }`, which Task 6's side panel reads.

No unit test for this file — it is pure orchestration over `chrome.*` APIs with no branching logic worth mocking independently of an end-to-end run; it is covered by the manual QA checklist in Task 8, per the spec's own testing section.

- [ ] **Step 1: Write the service worker**

```typescript
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
  const tabs = await chrome.tabs.query({ url: `${frontendUrl}/*` });
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
  await chrome.tabs.sendMessage(activeTab.id, {
    kind: "start-area-selection",
  } satisfies RuntimeMessage);
}

chrome.action.onClicked.addListener(() => {
  captureActiveTabFullPage();
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "capture-shortcut") return;
  const settings = await getSettings();
  if (settings.captureShortcutMode === "full-page") {
    await captureActiveTabFullPage();
  } else if (settings.captureShortcutMode === "area") {
    await startAreaSelectionOnActiveTab();
  }
});

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== CONTEXT_MENU_ID || !info.srcUrl) return;
  const response = await fetch(info.srcUrl);
  const blob = await response.blob();
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  await deliverCapture(dataUrl);
});

async function applyOutputs(variantIndex: number, code: string): Promise<void> {
  const settings = await getSettings();
  await chrome.storage.local.set({
    latestResult: { variantIndex, code, receivedAt: Date.now() },
  });
  if (settings.sidePanelEnabled) {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab?.windowId !== undefined) {
      await chrome.sidePanel.open({ windowId: activeTab.windowId });
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
  handleRuntimeMessage(message, sender).then((result) => sendResponse(result));
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
```

- [ ] **Step 2: Compile-check**

Run: `cd extension && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add extension/src/background/index.ts
git commit -m "Add background service worker: capture, tab handoff, outputs"
```

---

### Task 5: Content scripts — capture overlay and frontend bridge

**Files:**
- Create: `extension/src/content/capture.ts`
- Create: `extension/src/content/bridge.ts`

**Interfaces:**
- Consumes: `RuntimeMessage`, `isRuntimeMessage`, `PendingCapture` (Task 2); the fixed wire format from Task 1 (`APP_MESSAGE_SOURCE = "s2c-app"`, `EXTENSION_MESSAGE_SOURCE = "s2c-extension"`, message shapes `{source:"s2c-app",type:"variant-complete",variantIndex,code}` and `{source:"s2c-extension",type:"capture",dataUrl}`); `getSettings` (Task 3)
- Produces: nothing consumed by other files — these are the two leaf scripts the manifest loads directly.

No unit test — DOM overlay geometry and `navigator.clipboard` are exercised by the manual QA checklist in Task 8, matching the spec's stated testing approach for the browser-facing surfaces.

- [ ] **Step 1: Write the area-selection content script**

```typescript
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
    const response = (await chrome.runtime.sendMessage({
      kind: "start-area-selection",
    } satisfies RuntimeMessage)) as { dataUrl?: string } | undefined;
    if (!response?.dataUrl) return;
    const cropped = await cropDataUrl(response.dataUrl, x, y, width, height);
    chrome.runtime.sendMessage({
      kind: "area-selected",
      dataUrl: cropped,
    } satisfies RuntimeMessage);
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
```

- [ ] **Step 2: Write the frontend bridge content script**

```typescript
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
    await navigator.clipboard.writeText(code);
  } else if (settings.clipboardMode === "ask") {
    const shouldCopy = window.confirm(
      "screenshot-to-code: copy the generated code to the clipboard?"
    );
    if (shouldCopy) await navigator.clipboard.writeText(code);
  }
});
```

- [ ] **Step 3: Compile-check**

Run: `cd extension && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add extension/src/content/capture.ts extension/src/content/bridge.ts extension/src/background/index.ts
git commit -m "Add capture overlay and frontend bridge content scripts"
```

---

### Task 6: Side panel

**Files:**
- Create: `extension/src/sidepanel/index.html`
- Create: `extension/src/sidepanel/main.ts`
- Create: `extension/src/sidepanel/style.css`

**Interfaces:**
- Consumes: `chrome.storage.local` key `"latestResult"` as written by Task 4's `applyOutputs` (`{ variantIndex: number; code: string; receivedAt: number }`)

No unit test — this is a thin DOM-rendering script over a single storage read plus a change listener; covered by the manual QA checklist (Task 8: "side panel activated alone").

- [ ] **Step 1: Write the HTML shell**

```html
<!-- extension/src/sidepanel/index.html -->
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <link rel="stylesheet" href="./style.css" />
    <title>screenshot-to-code</title>
  </head>
  <body>
    <div id="empty-state">Nothing generated yet.</div>
    <pre id="code" hidden></pre>
    <button id="copy-button" hidden>Copy</button>
    <script type="module" src="./main.ts"></script>
  </body>
</html>
```

- [ ] **Step 2: Write `main.ts`**

```typescript
// extension/src/sidepanel/main.ts

interface LatestResult {
  variantIndex: number;
  code: string;
  receivedAt: number;
}

const emptyState = document.getElementById("empty-state") as HTMLDivElement;
const codeElement = document.getElementById("code") as HTMLPreElement;
const copyButton = document.getElementById("copy-button") as HTMLButtonElement;

function render(result: LatestResult | undefined): void {
  if (!result) {
    emptyState.hidden = false;
    codeElement.hidden = true;
    copyButton.hidden = true;
    return;
  }
  emptyState.hidden = true;
  codeElement.hidden = false;
  copyButton.hidden = false;
  codeElement.textContent = result.code;
}

chrome.storage.local.get("latestResult").then((stored) => {
  render(stored.latestResult as LatestResult | undefined);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes.latestResult) return;
  render(changes.latestResult.newValue as LatestResult | undefined);
});

copyButton.addEventListener("click", () => {
  navigator.clipboard.writeText(codeElement.textContent || "");
});
```

- [ ] **Step 3: Write minimal styling**

```css
/* extension/src/sidepanel/style.css */
body {
  font-family: system-ui, sans-serif;
  margin: 0;
  padding: 12px;
}
#empty-state {
  color: #6b7280;
}
#code {
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 12px;
  background: #f3f4f6;
  padding: 8px;
  border-radius: 6px;
  max-height: 80vh;
  overflow: auto;
}
#copy-button {
  margin-top: 8px;
}
```

- [ ] **Step 4: Commit**

```bash
git add extension/src/sidepanel
git commit -m "Add side panel: shows the latest generated code"
```

---

### Task 7: Options page

**Files:**
- Create: `extension/src/options/index.html`
- Create: `extension/src/options/main.ts`
- Create: `extension/src/options/style.css`

**Interfaces:**
- Consumes: `getSettings`, `setSettings`, `DEFAULT_SETTINGS`, `ExtensionSettings` (Task 3)

No unit test — a settings form bound 1:1 to `getSettings`/`setSettings`, which already have unit coverage in Task 3; the form wiring itself is covered by the manual QA checklist.

- [ ] **Step 1: Write the HTML form**

```html
<!-- extension/src/options/index.html -->
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <link rel="stylesheet" href="./style.css" />
    <title>screenshot-to-code extension settings</title>
  </head>
  <body>
    <h1>screenshot-to-code — settings</h1>

    <label>
      Frontend URL
      <input type="text" id="frontendUrl" />
    </label>
    <label>
      Backend URL
      <input type="text" id="backendUrl" />
    </label>

    <p class="hint">
      Changing the frontend URL's port also requires editing
      <code>content_scripts</code> in <code>manifest.json</code> and
      reloading the extension — see the plan's Task 2 note.
    </p>

    <label>
      <input type="checkbox" id="sidePanelEnabled" />
      Open the side panel with the generated code
    </label>

    <label>
      Clipboard
      <select id="clipboardMode">
        <option value="off">Off</option>
        <option value="auto">Copy automatically</option>
        <option value="ask">Ask every time</option>
      </select>
    </label>

    <label>
      <input type="checkbox" id="saveFileEnabled" />
      Save the generated code as a file
    </label>

    <label>
      Keyboard shortcut (Ctrl/Cmd+Shift+K)
      <select id="captureShortcutMode">
        <option value="off">Off</option>
        <option value="full-page">Capture full page</option>
        <option value="area">Start area selection</option>
      </select>
    </label>

    <button id="save">Save</button>
    <span id="saved-indicator" hidden>Saved.</span>

    <script type="module" src="./main.ts"></script>
  </body>
</html>
```

- [ ] **Step 2: Write `main.ts`**

```typescript
// extension/src/options/main.ts
import { getSettings, setSettings, ExtensionSettings } from "../shared/settings";

const frontendUrl = document.getElementById("frontendUrl") as HTMLInputElement;
const backendUrl = document.getElementById("backendUrl") as HTMLInputElement;
const sidePanelEnabled = document.getElementById("sidePanelEnabled") as HTMLInputElement;
const clipboardMode = document.getElementById("clipboardMode") as HTMLSelectElement;
const saveFileEnabled = document.getElementById("saveFileEnabled") as HTMLInputElement;
const captureShortcutMode = document.getElementById(
  "captureShortcutMode"
) as HTMLSelectElement;
const saveButton = document.getElementById("save") as HTMLButtonElement;
const savedIndicator = document.getElementById("saved-indicator") as HTMLSpanElement;

function populate(settings: ExtensionSettings): void {
  frontendUrl.value = settings.frontendUrl;
  backendUrl.value = settings.backendUrl;
  sidePanelEnabled.checked = settings.sidePanelEnabled;
  clipboardMode.value = settings.clipboardMode;
  saveFileEnabled.checked = settings.saveFileEnabled;
  captureShortcutMode.value = settings.captureShortcutMode;
}

getSettings().then(populate);

saveButton.addEventListener("click", async () => {
  await setSettings({
    frontendUrl: frontendUrl.value,
    backendUrl: backendUrl.value,
    sidePanelEnabled: sidePanelEnabled.checked,
    clipboardMode: clipboardMode.value as ExtensionSettings["clipboardMode"],
    saveFileEnabled: saveFileEnabled.checked,
    captureShortcutMode: captureShortcutMode.value as ExtensionSettings["captureShortcutMode"],
  });
  savedIndicator.hidden = false;
  setTimeout(() => (savedIndicator.hidden = true), 1500);
});
```

- [ ] **Step 3: Write minimal styling**

```css
/* extension/src/options/style.css */
body {
  font-family: system-ui, sans-serif;
  max-width: 480px;
  margin: 24px auto;
  padding: 0 16px;
}
label {
  display: block;
  margin-bottom: 14px;
}
input[type="text"],
select {
  display: block;
  width: 100%;
  margin-top: 4px;
  padding: 6px;
}
.hint {
  font-size: 12px;
  color: #6b7280;
}
#saved-indicator {
  margin-left: 8px;
  color: #16a34a;
}
```

- [ ] **Step 4: Commit**

```bash
git add extension/src/options
git commit -m "Add extension options page"
```

---

### Task 8: Build, load unpacked, and manual QA

**Files:**
- None created — this task builds and exercises everything from Tasks 1–7.

- [ ] **Step 1: Install and build**

```bash
cd extension && npm install && npm run typecheck && npm run test && npm run build
```

Expected: `typecheck` and `test` both pass (all Vitest suites from Tasks 2–3), `build` produces `extension/dist/` containing `manifest.json`, `background.js`, `content-capture.js`, `content-bridge.js`, `sidepanel.html`, `options.html` and their JS.

- [ ] **Step 2: Run the frontend's own test suite once more**

```bash
cd ../frontend && npx jest
```

Expected: PASS (confirms Task 1's edit didn't regress anything).

- [ ] **Step 3: Load the extension unpacked**

In Chrome: `chrome://extensions` → enable Developer mode → "Load unpacked" → select `extension/dist`.

- [ ] **Step 4: Manual QA checklist**

Run each of these against the already-running local instance (`docker compose up -d` in the repo root, frontend on `:5173`, backend on `:7001`):

- [ ] Toolbar icon on an arbitrary webpage → screenshot-to-code tab opens/focuses → image appears as the reference image and generation starts
- [ ] Area selection → drag a rectangle → only that region is sent
- [ ] Keyboard shortcut set to "Capture full page" in Options → same result as the toolbar icon
- [ ] Keyboard shortcut set to "Start area selection" in Options → same result as the manual area-selection flow
- [ ] Right-click an `<img>` on any page → "Generate code from this image" → that exact image is delivered, no new screenshot taken
- [ ] With "Open the side panel" enabled: panel shows the final code after generation completes
- [ ] With "Open the side panel" disabled: panel does not auto-open
- [ ] Clipboard mode "auto": code is on the clipboard immediately after generation, no prompt
- [ ] Clipboard mode "ask": a confirm dialog appears; accepting copies, declining does not
- [ ] Clipboard mode "off": no dialog, nothing copied
- [ ] "Save as file" enabled: a `.txt` file download appears after generation
- [ ] Stop the backend container (`docker compose stop backend`) and repeat the toolbar-icon capture: the screenshot-to-code tab itself should show its own "could not connect" state (existing app behavior) rather than the extension silently doing nothing — confirm no extension-side crash in `chrome://extensions` → "Errors"
- [ ] Close the screenshot-to-code tab between capture and generation completing, then capture again: a fresh tab opens and receives the pending capture

- [ ] **Step 5: Fix anything the checklist surfaces, then commit**

```bash
git add -A
git commit -m "Fix issues found during manual QA of the Chrome extension"
```

(Only run this commit if Step 4 required changes — if the checklist passes clean, there is nothing to commit here.)
