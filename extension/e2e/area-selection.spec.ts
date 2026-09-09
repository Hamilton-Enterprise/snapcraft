import { test, expect } from "./fixtures";

test("area-selection overlay opens and Escape cancels it cleanly", async ({ context }) => {
  // The MV3 service worker may not have spun up yet when the test starts;
  // wait for it the same way fixtures.ts's `extensionId` fixture does.
  let [background] = context.serviceWorkers();
  if (!background) background = await context.waitForEvent("serviceworker");
  const page = await context.newPage();
  await page.goto("http://localhost:5173");

  await background.evaluate(async () => {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab.id !== undefined) {
      await chrome.tabs.sendMessage(activeTab.id, { kind: "start-area-selection" });
    }
  });

  const overlay = page.locator('[data-testid="s2c-capture-overlay"]');
  await expect(overlay).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(overlay).toHaveCount(0);
});
