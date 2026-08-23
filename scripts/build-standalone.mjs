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
const carriageReturn = String.fromCharCode(13);
const normalizedTemplate = template.replaceAll(carriageReturn, "");
const normalizedCss = css.replaceAll(carriageReturn, "");

// Inline self-hosted fonts as base64 so the single-file HTML stays self-contained.
const fontUrlPattern = /url\("\.\/fonts\/([^"]+\.woff2)"\)/g;
let inlinedCss = normalizedCss;
for (const [match, fontFile] of [...normalizedCss.matchAll(fontUrlPattern)]) {
  const fontPath = resolve(sourceDir, "fonts", fontFile);
  const fontData = await readFile(fontPath);
  inlinedCss = inlinedCss.replaceAll(
    match,
    `url(data:font/woff2;base64,${fontData.toString("base64")})`,
  );
}

const html = normalizedTemplate
  .replace("</head>", `<style>${inlinedCss}</style></head>`)
  .replace(scriptMarker, `<script>${script}</script>`);
if (html.includes(scriptMarker) || !html.includes(script) || !html.includes(inlinedCss)) {
  throw new Error("Standalone build output is incomplete");
}
if (/url\("\.\/fonts\//.test(html)) {
  throw new Error("Standalone build output still references external font files");
}

await mkdir(dirname(output), { recursive: true });
await writeFile(output, html, "utf8");
console.log(`Built ${output} (${Buffer.byteLength(html)} bytes)`);
