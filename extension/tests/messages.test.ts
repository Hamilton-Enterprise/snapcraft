import { describe, expect, test } from "vitest";
import { isRuntimeMessage } from "../src/shared/messages";

describe("isRuntimeMessage", () => {
  test("accepts a well-formed message", () => {
    expect(isRuntimeMessage({ kind: "start-area-selection" })).toBe(true);
    expect(
      isRuntimeMessage({ kind: "area-selected", dataUrl: "data:image/png;base64,AA" })
    ).toBe(true);
  });

  test.each([undefined, null, "x", 5, {}, { kind: "unknown-kind" }])(
    "rejects %p",
    (input) => {
      expect(isRuntimeMessage(input)).toBe(false);
    }
  );
});
