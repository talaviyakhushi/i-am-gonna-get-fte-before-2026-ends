import { build } from "esbuild";
import { cpSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dev = process.argv.includes("--dev");
const outdir = path.join(here, "dist");

mkdirSync(outdir, { recursive: true });

await build({
  entryPoints: {
    background: path.join(here, "src/background/index.ts"),
    content: path.join(here, "src/content/extract.ts"),
    popup: path.join(here, "src/popup/main.tsx"),
    options: path.join(here, "src/options/main.tsx"),
  },
  outdir,
  bundle: true,
  format: "iife",
  target: "chrome120",
  minify: !dev,
  sourcemap: dev ? "inline" : false,
  define: {
    __DEV__: JSON.stringify(dev),
    "process.env.NODE_ENV": JSON.stringify(dev ? "development" : "production"),
  },
});

cpSync(path.join(here, "public"), outdir, { recursive: true });
console.log(`Extension built to ${outdir} (${dev ? "dev" : "prod"})`);
