import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = fileURLToPath(new URL("../", import.meta.url));
const sourceDirectory = resolve(root, "assets/sign-in");
const publicDirectory = resolve(root, "public");
const outputDirectory = resolve(publicDirectory, "images/workshop");
const manifestPath = resolve(root, "src/generated/workshop-images.json");
const settings = {
  widths: [480, 768, 1024, 1440],
  webp: { quality: 78, effort: 5 },
  avif: { quality: 48, effort: 5 },
  sharp: sharp.versions.sharp,
};
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const variants = ["square", "panorama", "portrait"];
const inputs = [];
for (const name of variants) {
  const file = `workshop-${name}.png`;
  const path = resolve(sourceDirectory, file);
  const bytes = await readFile(path);
  const metadata = await sharp(bytes).metadata();
  assert(metadata.width && metadata.height, `${file} needs valid dimensions`);
  assert(!metadata.orientation || metadata.orientation === 1, `${file} needs an upright source master`);
  inputs.push({ name, file, sha256: digest(bytes), width: metadata.width, height: metadata.height });
}
const signature = digest(JSON.stringify({ settings, inputs }));
let previous;
try { previous = JSON.parse(await readFile(manifestPath, "utf8")); } catch { previous = null; }
if (previous?.signature === signature) {
  const checks = await Promise.all(Object.values(previous.variants).flatMap((variant) =>
    [variant.webp, variant.avif].flat().map(async (image) => {
      try { return digest(await readFile(resolve(publicDirectory, `.${image.src}`))) === image.sha256; }
      catch { return false; }
    }),
  ));
  if (checks.every(Boolean)) {
    process.stdout.write(`Workshop delivery images unchanged: ${checks.length} verified outputs.\n`);
    process.exit(0);
  }
}

await mkdir(outputDirectory, { recursive: true });
await mkdir(resolve(root, "src/generated"), { recursive: true });
const manifest = { schemaVersion: 1, signature, settings, inputs, variants: {} };
for (const input of inputs) {
  const widths = settings.widths.filter((width) => width <= input.width);
  if (widths.length === 0) widths.push(input.width);
  const result = { aspectRatio: input.width / input.height, webp: [], avif: [] };
  for (const width of widths) {
    for (const format of ["webp", "avif"]) {
      const filename = `workshop-${input.name}-${width}.${format}`;
      const destination = resolve(outputDirectory, filename);
      const image = sharp(resolve(sourceDirectory, input.file)).resize({ width, withoutEnlargement: true });
      const info = await image[format](settings[format]).toFile(destination);
      assert(info.width <= input.width && info.height <= input.height, `${filename} enlarged its source`);
      assert.equal(info.width, width, `${filename} width differs from its descriptor`);
      assert(Math.abs(info.height - width * input.height / input.width) <= 1, `${filename} distorted its aspect ratio`);
      result[format].push({ src: `/images/workshop/${filename}`, width: info.width, height: info.height, bytes: (await stat(destination)).size, sha256: digest(await readFile(destination)) });
    }
  }
  manifest.variants[input.name] = result;
}
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
const outputs = Object.values(manifest.variants).flatMap((variant) => [...variant.webp, ...variant.avif]);
process.stdout.write(JSON.stringify({ images: outputs.length, totalBytes: outputs.reduce((sum, item) => sum + item.bytes, 0), inputs: inputs.map(({ file, width, height }) => ({ file, width, height })), maxOutputBytes: Math.max(...outputs.map((item) => item.bytes)), noEnlargement: true, noCropOrDistortion: true }) + "\n");
