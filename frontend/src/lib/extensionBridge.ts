/**
 * Wire format shared with extension/src/shared/messages.ts. The two sides
 * do not import from each other (different build, different runtime) so
 * this file is the single source of truth for the page-to-extension
 * postMessage contract; keep it in lockstep with the extension by hand.
 */
export const APP_MESSAGE_SOURCE = "s2c-app" as const;
export const EXTENSION_MESSAGE_SOURCE = "s2c-extension" as const;

export interface VariantCompleteMessage {
  source: typeof APP_MESSAGE_SOURCE;
  type: "variant-complete";
  variantIndex: number;
  code: string;
}

export interface CaptureMessage {
  dataUrl: string;
}

export function buildVariantCompleteMessage(
  variantIndex: number,
  code: string
): VariantCompleteMessage {
  return {
    source: APP_MESSAGE_SOURCE,
    type: "variant-complete",
    variantIndex,
    code,
  };
}

export function parseCaptureMessage(data: unknown): CaptureMessage | null {
  if (typeof data !== "object" || data === null) return null;
  const candidate = data as Record<string, unknown>;
  if (candidate.source !== EXTENSION_MESSAGE_SOURCE) return null;
  if (candidate.type !== "capture") return null;
  if (typeof candidate.dataUrl !== "string") return null;
  return { dataUrl: candidate.dataUrl };
}
