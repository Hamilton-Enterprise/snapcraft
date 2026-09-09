import * as esbuild from "esbuild";
import { cpSync, mkdirSync } from "node:fs";

mkdirSync("dist", { recursive: true });

await esbuild.build({
  entryPoints: {
    background: "src/background/index.ts",
    "content-capture": "src/content/capture.ts",
    "content-bridge": "src/content/bridge.ts",
  },
  outdir: "dist",
  bundle: true,
  format: "iife",
  target: "chrome116",
  sourcemap: true,
});

cpSync("manifest.json", "dist/manifest.json");
