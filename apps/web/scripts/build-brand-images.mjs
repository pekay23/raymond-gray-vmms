import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = fileURLToPath(new URL("../", import.meta.url));
const publicDirectory = resolve(root, "public");
const sourceDirectory = resolve(publicDirectory, "brand");
const outputDirectory = resolve(sourceDirectory, "optimized");
const manifestPath = resolve(root, "src/generated/brand-images.json");
const definitions = [
  { name: "standard", file: "raymond-gray-logo.png" },
  { name: "white", file: "raymond-gray-logo-white.png" },
];
const settings = { widths: [128, 256, 384, 512, 640], format: "webp", lossless: true, effort: 6, sharp: sharp.versions.sharp };
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const inputs = [];
for (const definition of definitions) {
  const bytes = await readFile(resolve(sourceDirectory, definition.file));
  const metadata = await sharp(bytes).metadata();
  assert.equal(metadata.format, "png", `${definition.file} must remain the approved PNG source`);
  assert(metadata.width && metadata.height && metadata.hasAlpha, `${definition.file} must retain its dimensions and transparency`);
  inputs.push({ ...definition, sha256: digest(bytes), width: metadata.width, height: metadata.height, bytes: bytes.length });
}
const signature = digest(JSON.stringify({ settings, inputs }));
let previous;
try { previous = JSON.parse(await readFile(manifestPath, "utf8")); } catch { previous = null; }
if (previous?.signature === signature) {
  const checks = await Promise.all(Object.values(previous.variants).flatMap((variant) => variant.webp.map(async (image) => {
    try { return digest(await readFile(resolve(publicDirectory, `.${image.src}`))) === image.sha256; }
    catch { return false; }
  })));
  if (checks.length && checks.every(Boolean)) {
    process.stdout.write(`Raymond Gray logo derivatives unchanged: ${checks.length} verified outputs.\n`);
    process.exit(0);
  }
}

await mkdir(outputDirectory, { recursive: true });
await mkdir(resolve(root, "src/generated"), { recursive: true });
const variants = {};
for (const input of inputs) {
  const widths = settings.widths.filter((width) => width <= input.width);
  const outputs = [];
  for (const width of widths) {
    const filename = `${input.name}-${width}.webp`;
    const destination = resolve(outputDirectory, filename);
    const result = await sharp(resolve(sourceDirectory, input.file))
      .resize({ width, withoutEnlargement: true })
      .webp({ lossless: true, effort: settings.effort })
      .toFile(destination);
    assert.equal(result.width, width, `${filename} width differs from its descriptor`);
    assert(Math.abs(result.height - width * input.height / input.width) <= 1, `${filename} changes the approved logo proportions`);
    const metadata = await sharp(destination).metadata();
    assert(metadata.hasAlpha, `${filename} lost the approved transparent background`);
    outputs.push({ src: `/brand/optimized/${filename}`, width: result.width, height: result.height, bytes: (await stat(destination)).size, sha256: digest(await readFile(destination)) });
  }
  variants[input.name] = { fallback: `/brand/${input.file}`, width: input.width, height: input.height, webp: outputs };
}
const manifest = { schemaVersion: 1, signature, settings, inputs, variants };
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
const outputs = Object.values(variants).flatMap((variant) => variant.webp);
process.stdout.write(JSON.stringify({ images: outputs.length, totalBytes: outputs.reduce((sum, item) => sum + item.bytes, 0), inputs: inputs.map(({ name, width, height, bytes }) => ({ name, width, height, originalBytes: bytes })), maxOutputBytes: Math.max(...outputs.map((item) => item.bytes)), format: "lossless WebP with alpha", crop: false, distortion: false }) + "\n");
