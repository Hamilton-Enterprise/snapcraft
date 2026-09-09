import { defineConfig, type Plugin } from "vite";
import { resolve } from "node:path";
import { mkdirSync, readdirSync, renameSync, rmdirSync } from "node:fs";

// manifest.json's `side_panel.default_path` and `options_page` point at
// flat `sidepanel.html` / `options.html` files at the dist root (matching
// where esbuild.mjs already emits background.js and the content scripts).
// Vite's multi-page build mirrors each HTML entry's location relative to
// `root` instead, so without this plugin the files land nested at
// `dist/sidepanel/index.html` and `dist/options/index.html` and the real
// extension 404s on its side panel and options page. The emitted HTML only
// ever references assets via absolute `/assets/...` paths, so moving the
// files to the dist root after the bundle is written is safe.
function flattenHtmlOutputs(): Plugin {
  return {
    name: "flatten-html-outputs",
    closeBundle() {
      const outDir = resolve(__dirname, "dist");
      for (const name of ["sidepanel", "options"]) {
        const nestedDir = resolve(outDir, name);
        const nestedFile = resolve(nestedDir, "index.html");
        const flatFile = resolve(outDir, `${name}.html`);
        try {
          mkdirSync(outDir, { recursive: true });
          renameSync(nestedFile, flatFile);
          if (readdirSync(nestedDir).length === 0) rmdirSync(nestedDir);
        } catch (err) {
          // Only silently ignore if the nested file genuinely doesn't exist
          // (e.g. a partial or repeat build). Let other errors propagate.
          if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
            // Expected case: nothing to flatten on this build
          } else {
            throw err;
          }
        }
      }
    },
  };
}

export default defineConfig({
  root: "src",
  plugins: [flattenHtmlOutputs()],
  build: {
    outDir: "../dist",
    emptyOutDir: false,
    rollupOptions: {
      input: {
        sidepanel: resolve(__dirname, "src/sidepanel/index.html"),
        options: resolve(__dirname, "src/options/index.html"),
      },
    },
  },
});
