import { getSettings, setSettings, ExtensionSettings } from "../shared/settings";

const frontendUrl = document.getElementById("frontendUrl") as HTMLInputElement;
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
  sidePanelEnabled.checked = settings.sidePanelEnabled;
  clipboardMode.value = settings.clipboardMode;
  saveFileEnabled.checked = settings.saveFileEnabled;
  captureShortcutMode.value = settings.captureShortcutMode;
}

getSettings().then(populate);

saveButton.addEventListener("click", async () => {
  await setSettings({
    frontendUrl: frontendUrl.value,
    sidePanelEnabled: sidePanelEnabled.checked,
    clipboardMode: clipboardMode.value as ExtensionSettings["clipboardMode"],
    saveFileEnabled: saveFileEnabled.checked,
    captureShortcutMode: captureShortcutMode.value as ExtensionSettings["captureShortcutMode"],
  });
  savedIndicator.hidden = false;
  setTimeout(() => (savedIndicator.hidden = true), 1500);
});
