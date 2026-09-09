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
