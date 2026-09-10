import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

// This spec drives the real Snapcraft frontend + backend, with the backend's
// MOCK_CODE_GENERATION flag on so it returns a fixed HTML fixture instead of
// calling a real, paid LLM provider. It verifies the full upload -> generate
// -> render pipeline for free and deterministically. It does NOT load the
// extension (that mechanic is covered by the other specs in this folder,
// which mock the postMessage instead) and it requires a backend already
// running with MOCK_CODE_GENERATION=true at SNAPCRAFT_TEST_APP_URL (defaults
// to http://localhost:5173, the normal dev port).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_URL = process.env.SNAPCRAFT_TEST_APP_URL ?? "http://localhost:5173";
const FIXTURE_IMAGE = path.join(
  __dirname,
  "..",
  "..",
  "frontend",
  "src",
  "tests",
  "fixtures",
  "simple_button.png",
);

test.describe("mock code generation (backend must run with MOCK_CODE_GENERATION=true)", () => {
  test("uploading a screenshot renders the mock fixture, with no console errors", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    await page.goto(APP_URL);
    await page.locator('input[type="file"]').setInputFiles(FIXTURE_IMAGE);
    await page.getByRole("button", { name: /Generate Code/i }).click();

    const marker = page
      .frameLocator("iframe")
      .first()
      .locator('[data-testid="mock-generation-marker"]');
    await expect(marker).toBeVisible({ timeout: 20_000 });
    await expect(marker).toContainText("Snapcraft mock generation output");

    expect(
      consoleErrors,
      `Unexpected console errors:\n${consoleErrors.join("\n")}`,
    ).toEqual([]);
  });
});
