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
