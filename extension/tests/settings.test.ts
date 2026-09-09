import { describe, expect, test, vi, beforeEach } from "vitest";
import { DEFAULT_SETTINGS, getSettings, setSettings } from "../src/shared/settings";

const store: Record<string, unknown> = {};

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
  (globalThis as any).chrome = {
    storage: {
      sync: {
        get: vi.fn(async (keys: string[]) => {
          const result: Record<string, unknown> = {};
          for (const key of keys) if (key in store) result[key] = store[key];
          return result;
        }),
        set: vi.fn(async (values: Record<string, unknown>) => {
          Object.assign(store, values);
        }),
      },
    },
  };
});

describe("settings", () => {
  test("getSettings returns defaults when nothing is stored", async () => {
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  test("setSettings merges a partial update on top of stored values", async () => {
    await setSettings({ clipboardMode: "auto" });
    await setSettings({ sidePanelEnabled: false });
    expect(await getSettings()).toEqual({
      ...DEFAULT_SETTINGS,
      clipboardMode: "auto",
      sidePanelEnabled: false,
    });
  });
});
