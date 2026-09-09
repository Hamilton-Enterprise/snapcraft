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
