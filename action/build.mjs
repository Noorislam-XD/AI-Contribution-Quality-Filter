import { build } from "esbuild";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

await build({
  entryPoints: [resolve(__dirname, "src/main.ts")],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outfile: resolve(__dirname, "../dist/index.js"),
  sourcemap: false,
  minify: false,
  external: [],
  define: {
    "process.env.NODE_ENV": '"production"',
  },
});

console.log("Build complete: dist/index.js");
