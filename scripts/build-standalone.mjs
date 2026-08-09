import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { build } from "esbuild";

const project = resolve(import.meta.dirname, "..");
const sourceDir = resolve(project, "standalone", "src");
const output = resolve(project, "standalone", "dist", "neko-control.html");

const [template, css] = await Promise.all([
  readFile(resolve(sourceDir, "index.html"), "utf8"),
  readFile(resolve(sourceDir, "styles.css"), "utf8"),
]);
const result = await build({
  entryPoints: [resolve(sourceDir, "main.js")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["es2020"],
  write: false,
  minify: true,
});
const script = result.outputFiles[0].text;
const scriptMarker = '<script type="module" src="./main.js"></script>';
if (!template.includes("</head>") || !template.includes(scriptMarker)) {
  throw new Error("Standalone template is missing a required build marker");
}
const html = template
  .replace("</head>", `<style>${css}</style></head>`)
  .replace(scriptMarker, `<script>${script}</script>`);
if (html.includes(scriptMarker) || !html.includes(script) || !html.includes(css)) {
  throw new Error("Standalone build output is incomplete");
}

await mkdir(dirname(output), { recursive: true });
await writeFile(output, html, "utf8");
console.log(`Built ${output} (${Buffer.byteLength(html)} bytes)`);
