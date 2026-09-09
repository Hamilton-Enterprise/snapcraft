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
