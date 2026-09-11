/**
 * Turns public/logo.jpeg into a transparent PNG of just the mark, and writes it
 * out as a base64 module the PDF template can embed.
 *
 * The source is a 1024x1024 JPEG: the triangle mark above a "vitti.capital"
 * wordmark, both on a flat navy ground. Two problems for the deck — the ground
 * is a different navy from the page, so a rectangle would show; and the stacked
 * wordmark is illegible at corner size. So this keys the ground out by distance
 * from the corner colour and crops to the mark alone; the wordmark is set as
 * type in the template, which stays crisp at any size.
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const SOURCE = "public/logo.jpeg";
const OUT_TS = "src/lib/report/logo.ts";
/** Optional: a PNG written out so the keyed-out mark can be eyeballed. */
const OUT_PNG = process.argv[2] ?? null;

const image = sharp(SOURCE);
const { width, height } = await image.metadata();
const { data, info } = await image
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });

const channels = info.channels;
const at = (x, y) => {
  const index = (y * info.width + x) * channels;
  return [data[index], data[index + 1], data[index + 2]];
};

const background = at(2, 2);
console.log("background rgb:", background, "=>", `#${background.map((c) => c.toString(16).padStart(2, "0")).join("")}`);

const distance = (pixel) =>
  Math.sqrt(
    (pixel[0] - background[0]) ** 2 +
      (pixel[1] - background[1]) ** 2 +
      (pixel[2] - background[2]) ** 2,
  );

/** The bounding box of everything that is not the ground, in the top 62%. */
const markLimit = Math.round(info.height * 0.62);
let minX = info.width;
let maxX = 0;
let minY = info.height;
let maxY = 0;
for (let y = 0; y < markLimit; y += 1) {
  for (let x = 0; x < info.width; x += 1) {
    if (distance(at(x, y)) < 40) continue;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
}
console.log("mark bbox:", { minX, maxX, minY, maxY, source: { width, height } });

/**
 * Alpha from distance to the ground, so anti-aliased edges fade instead of
 * leaving a hard fringe. Anything past `solid` is fully opaque; the ramp below
 * it keeps the diagonal strokes smooth.
 */
const SOLID = 110;
for (let index = 0; index < data.length; index += channels) {
  const pixel = [data[index], data[index + 1], data[index + 2]];
  const d = distance(pixel);
  data[index + 3] = d >= SOLID ? 255 : Math.round((d / SOLID) * 255);
}

const pad = 6;
const png = await sharp(data, {
  raw: { width: info.width, height: info.height, channels },
})
  .extract({
    left: Math.max(0, minX - pad),
    top: Math.max(0, minY - pad),
    width: Math.min(info.width, maxX - minX + pad * 2),
    height: Math.min(info.height, maxY - minY + pad * 2),
  })
  .resize({ width: 240 })
  .png({ compressionLevel: 9, palette: true, quality: 90 })
  .toBuffer();

const meta = await sharp(png).metadata();
if (OUT_PNG) {
  fs.mkdirSync(path.dirname(OUT_PNG), { recursive: true });
  fs.writeFileSync(OUT_PNG, png);
}
console.log(`png: ${meta.width}x${meta.height}, ${(png.length / 1024).toFixed(1)} KB`);

const base64 = png.toString("base64");
const lines = base64.match(/.{1,96}/g) ?? [];

const moduleSource = `/**
 * The Vitti Capital mark, inlined as a PNG data URI.
 *
 * Derived from \`public/logo.jpeg\` by \`scripts/build-logo.mjs\`: the flat navy
 * ground is keyed out by distance from the corner colour — with a soft ramp, so
 * the diagonal strokes keep their anti-aliasing — and the image is cropped to
 * the mark and scaled to ${meta.width}px. The stacked "vitti.capital" wordmark in the
 * source is not included: at corner size it is illegible as a raster, and the
 * template sets it as type instead, which stays crisp at any scale.
 *
 * **Why a data URI rather than reading \`public/logo.jpeg\` at render time.** The
 * PDF is rendered inside a serverless function, whose filesystem contains only
 * the files Next.js traced into the bundle — \`public/\` is served statically and
 * is not guaranteed to be there. A path that works in \`next dev\` and throws in
 * production is the worst version of this, so the bytes travel with the code.
 * ${(png.length / 1024).toFixed(1)} KB of PNG, ${(base64.length / 1024).toFixed(1)} KB as base64.
 *
 * Regenerate after changing the source: \`npm run logo:build\`.
 */
export const VITTI_MARK_PNG =
  "data:image/png;base64," +
${lines.map((line) => `  "${line}"`).join(" +\n")};

/** The mark is this many times wider than it is tall. */
export const VITTI_MARK_RATIO = ${(meta.width / meta.height).toFixed(4)};
`;

fs.writeFileSync(OUT_TS, moduleSource);
console.log(`module: ${OUT_TS}, ${(moduleSource.length / 1024).toFixed(1)} KB`);
