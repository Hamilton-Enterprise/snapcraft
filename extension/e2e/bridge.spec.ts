import { test, expect } from "./fixtures";

const FRONTEND_URL = "http://localhost:5173";

test("delivers a pending capture into the frontend page on load", async ({ context }) => {
  // The MV3 service worker may not have spun up yet when the test starts;
  // wait for it the same way fixtures.ts's `extensionId` fixture does.
  let [background] = context.serviceWorkers();
  if (!background) background = await context.waitForEvent("serviceworker");
  await background.evaluate(() =>
    chrome.storage.local.set({
      pendingCapture: { dataUrl: "data:image/png;base64,AAAA", createdAt: Date.now() },
    })
  );

  const page = await context.newPage();
  // Registering the listener via page.evaluate() on the still-blank page
  // and only awaiting it after page.goto() races the navigation: that
  // evaluate() runs in the about:blank execution context, which gets torn
  // down the moment the page navigates, before the extension's
  // content-bridge.ts (which posts the message at document_idle on the
  // real page) ever gets a chance to run. addInitScript() instead installs
  // the listener into every future document's context before that
  // document's own scripts run, so it survives the navigation.
  await page.addInitScript(() => {
    (window as unknown as { __capturePromise: Promise<unknown> }).__capturePromise = new Promise(
      (resolve) => {
        window.addEventListener("message", function handler(event) {
          if (event.data?.source === "s2c-extension" && event.data?.type === "capture") {
            window.removeEventListener("message", handler);
            resolve(event.data);
          }
        });
      }
    );
  });
  await page.goto(FRONTEND_URL);
  const captureMessage = (await page.evaluate(
    () => (window as unknown as { __capturePromise: Promise<unknown> }).__capturePromise
  )) as { source: string; type: string; dataUrl: string };
  expect(captureMessage.dataUrl).toBe("data:image/png;base64,AAAA");
});

test("forwards variant-complete to the background and offers a clipboard prompt", async ({
  context,
}) => {
  let [background] = context.serviceWorkers();
  if (!background) background = await context.waitForEvent("serviceworker");
  await background.evaluate(() => chrome.storage.local.clear());

  const page = await context.newPage();
  await page.goto(FRONTEND_URL);

  // bridge.ts's message handler is async (it forwards to the background,
  // then awaits getSettings() before calling window.confirm()), so the
  // dialog fires after this evaluate() call has already resolved. Checking
  // a variable set by an on("dialog") listener synchronously right after
  // would race that async chain; waitForEvent("dialog") actually awaits it.
  const dialogPromise = page.waitForEvent("dialog");

  await page.evaluate(() => {
    window.postMessage(
      { source: "s2c-app", type: "variant-complete", variantIndex: 0, code: "<p>ok</p>" },
      window.location.origin
    );
  });

  const dialog = await dialogPromise;
  const dialogMessage = dialog.message();
  await dialog.dismiss();

  expect(dialogMessage).toContain("copy the generated code");
  await expect
    .poll(async () => {
      const stored = (await background.evaluate(() =>
        chrome.storage.local.get("latestResult")
      )) as { latestResult?: { code?: string } };
      return stored.latestResult?.code;
    })
    .toBe("<p>ok</p>");
});
