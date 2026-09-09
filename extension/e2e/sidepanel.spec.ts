import { test, expect } from "./fixtures";

test("side panel shows empty state, then the latest result", async ({ context, extensionId }) => {
  const [background] = context.serviceWorkers();
  await background.evaluate(() => chrome.storage.local.clear());

  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(page.locator("#empty-state")).toBeVisible();
  await expect(page.locator("#code")).toBeHidden();

  await background.evaluate(() =>
    chrome.storage.local.set({
      latestResult: { variantIndex: 0, code: "<div>hello</div>", receivedAt: Date.now() },
    })
  );
  await expect(page.locator("#code")).toBeVisible();
  await expect(page.locator("#code")).toHaveText("<div>hello</div>");
  await expect(page.locator("#empty-state")).toBeHidden();
});
