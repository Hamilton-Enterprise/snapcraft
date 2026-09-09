import { test, expect } from "./fixtures";

test("options page loads defaults and persists changes", async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);

  await expect(page.locator("#frontendUrl")).toHaveValue("http://localhost:5173");
  await expect(page.locator("#backendUrl")).toHaveValue("http://localhost:7001");
  await expect(page.locator("#clipboardMode")).toHaveValue("ask");

  await page.locator("#clipboardMode").selectOption("auto");
  await page.locator("#sidePanelEnabled").uncheck();
  await page.locator("#save").click();
  await expect(page.locator("#saved-indicator")).toBeVisible();

  await page.reload();
  await expect(page.locator("#clipboardMode")).toHaveValue("auto");
  await expect(page.locator("#sidePanelEnabled")).not.toBeChecked();
});
