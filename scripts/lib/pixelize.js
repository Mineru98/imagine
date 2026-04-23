'use strict';

const fs = require('fs');
const path = require('path');

// ── Contract ────────────────────────────────────────────────────────────────
// pixelize(imagePath, targetSize, paletteSize, outputPath, options?) → Promise<result>
//   targetSize:  16 | 32 | 48 | 64 (integer pixel edge, required)
//   paletteSize: 8 | 16 | 32 (number of colors after quantization)
//   outputPath:  directory-ish prefix OR explicit base path. Extensions appended.
//
//   options = {
//     paletteRef?:    string  // path to a palette PNG; extract colors and snap to them
//     previewScale?:  number  // default 8 (produces `<base>_<N>@8x.png`)
//     preserveAlpha?: boolean // default true
//     dither?:        'none'  // reserved; only 'none' supported for now
//   }
//
// Pipeline (enforced — "skip snap and save raw" is explicitly forbidden):
//   1. Decode source PNG (pngjs).
//   2. Nearest-neighbor downsample to targetSize × targetSize.
//   3. Palette quantize:
//        - paletteRef given → extract its unique colors, closest-color map.
//        - otherwise       → median-cut quantization to paletteSize colors.
//   4. Write the clamped targetSize PNG (`<base>_<N>.png`).
//   5. Write an `<base>_<N>@<previewScale>x.png` nearest-neighbor upscale.
//   6. Write `palette.png` — the active palette as a 1-row strip.
// ────────────────────────────────────────────────────────────────────────────

const ALLOWED_TARGET_SIZES = new Set([16, 32, 48, 64]);
const ALLOWED_PALETTE_SIZES = new Set([8, 16, 32]);

function tryRequire(mod) {
  try { return require(mod); } catch { return null; }
}

function assertFormatPng(p) {
  if (!/\.png$/i.test(p)) {
    throw new Error(`pixelize: output must be PNG (got "${p}"). JPEG destroys pixel-art color fidelity — never use it here.`);
  }
}

function nearestDownsample(PNG, src, targetSize) {
  const out = new PNG({ width: targetSize, height: targetSize });
  const sx = src.width / targetSize;
  const sy = src.height / targetSize;
  for (let y = 0; y < targetSize; y++) {
    for (let x = 0; x < targetSize; x++) {
      const srcX = Math.min(src.width - 1, Math.floor((x + 0.5) * sx));
      const srcY = Math.min(src.height - 1, Math.floor((y + 0.5) * sy));
      const si = (src.width * srcY + srcX) * 4;
      const oi = (targetSize * y + x) * 4;
      out.data[oi] = src.data[si];
      out.data[oi + 1] = src.data[si + 1];
      out.data[oi + 2] = src.data[si + 2];
      out.data[oi + 3] = src.data[si + 3];
    }
  }
  return out;
}

function nearestUpscale(PNG, src, scale) {
  const W = src.width * scale;
  const H = src.height * scale;
  const out = new PNG({ width: W, height: H });
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const si = (src.width * Math.floor(y / scale) + Math.floor(x / scale)) * 4;
      const oi = (W * y + x) * 4;
      out.data[oi] = src.data[si];
      out.data[oi + 1] = src.data[si + 1];
      out.data[oi + 2] = src.data[si + 2];
      out.data[oi + 3] = src.data[si + 3];
    }
  }
  return out;
}

function extractPaletteColors(PNG, imagePath) {
  const buf = fs.readFileSync(imagePath);
  const png = PNG.sync.read(buf);
  const seen = new Map();
  for (let i = 0; i < png.data.length; i += 4) {
    const a = png.data[i + 3];
    if (a < 8) continue; // skip transparent/near-transparent entries
    const r = png.data[i];
    const g = png.data[i + 1];
    const b = png.data[i + 2];
    const key = (r << 16) | (g << 8) | b;
    if (!seen.has(key)) seen.set(key, { r, g, b });
  }
  return Array.from(seen.values());
}

// Median-cut quantization (classic). Returns up to `count` centroid colors.
function medianCutPalette(samples, count) {
  if (samples.length === 0) return [];
  const buckets = [samples];
  while (buckets.length < count) {
    // find bucket with the largest color range and split it on its widest axis
    let target = -1;
    let targetRange = -1;
    let axis = 0;
    for (let i = 0; i < buckets.length; i++) {
      const b = buckets[i];
      if (b.length < 2) continue;
      let minR = 255, maxR = 0, minG = 255, maxG = 0, minB = 255, maxB = 0;
      for (const c of b) {
        if (c.r < minR) minR = c.r; if (c.r > maxR) maxR = c.r;
        if (c.g < minG) minG = c.g; if (c.g > maxG) maxG = c.g;
        if (c.b < minB) minB = c.b; if (c.b > maxB) maxB = c.b;
      }
      const rR = maxR - minR, rG = maxG - minG, rB = maxB - minB;
      const range = Math.max(rR, rG, rB);
      if (range > targetRange) {
        targetRange = range;
        target = i;
        axis = rR >= rG && rR >= rB ? 0 : (rG >= rB ? 1 : 2);
      }
    }
    if (target < 0) break;
    const sorted = buckets[target].slice().sort((a, b) => (axis === 0 ? a.r - b.r : axis === 1 ? a.g - b.g : a.b - b.b));
    const mid = Math.floor(sorted.length / 2);
    buckets[target] = sorted.slice(0, mid);
    buckets.push(sorted.slice(mid));
  }
  return buckets.map((b) => {
    let r = 0, g = 0, _b = 0;
    for (const c of b) { r += c.r; g += c.g; _b += c.b; }
    const n = Math.max(1, b.length);
    return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(_b / n) };
  });
}

function sampleOpaquePixels(png) {
  const out = [];
  for (let i = 0; i < png.data.length; i += 4) {
    const a = png.data[i + 3];
    if (a < 8) continue;
    out.push({ r: png.data[i], g: png.data[i + 1], b: png.data[i + 2] });
  }
  return out;
}

function dist2(a, r, g, b) {
  const dr = a.r - r, dg = a.g - g, db = a.b - b;
  return dr * dr + dg * dg + db * db;
}

function snapToPalette(PNG, src, palette, preserveAlpha) {
  const out = new PNG({ width: src.width, height: src.height });
  for (let i = 0; i < src.data.length; i += 4) {
    const a = src.data[i + 3];
    if (preserveAlpha && a < 8) {
      out.data[i] = 0; out.data[i + 1] = 0; out.data[i + 2] = 0; out.data[i + 3] = 0;
      continue;
    }
    const r = src.data[i], g = src.data[i + 1], b = src.data[i + 2];
    let best = palette[0];
    let bestD = dist2(best, r, g, b);
    for (let p = 1; p < palette.length; p++) {
      const d = dist2(palette[p], r, g, b);
      if (d < bestD) { bestD = d; best = palette[p]; }
    }
    out.data[i] = best.r;
    out.data[i + 1] = best.g;
    out.data[i + 2] = best.b;
    out.data[i + 3] = preserveAlpha ? a : 255;
  }
  return out;
}

function writePalettePng(PNG, palette, outPath, swatch = 16) {
  const W = palette.length * swatch;
  const H = swatch;
  const png = new PNG({ width: W, height: H });
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = palette[Math.floor(x / swatch)];
      const idx = (W * y + x) * 4;
      png.data[idx] = c.r;
      png.data[idx + 1] = c.g;
      png.data[idx + 2] = c.b;
      png.data[idx + 3] = 255;
    }
  }
  fs.writeFileSync(outPath, PNG.sync.write(png));
}

async function pixelize(imagePath, targetSize, paletteSize, outputPath, options = {}) {
  if (typeof imagePath !== 'string' || !fs.existsSync(imagePath)) {
    throw new Error(`pixelize: input image not found: ${imagePath}`);
  }
  if (!ALLOWED_TARGET_SIZES.has(targetSize)) {
    throw new Error(`pixelize: targetSize must be one of [${Array.from(ALLOWED_TARGET_SIZES).join(', ')}]; got ${targetSize}`);
  }
  if (!ALLOWED_PALETTE_SIZES.has(paletteSize)) {
    throw new Error(`pixelize: paletteSize must be one of [${Array.from(ALLOWED_PALETTE_SIZES).join(', ')}]; got ${paletteSize}`);
  }
  if (typeof outputPath !== 'string' || outputPath.length === 0) {
    throw new Error('pixelize: outputPath required');
  }
  if (/\.jpe?g$/i.test(outputPath)) {
    throw new Error('pixelize: JPEG output is forbidden. Pixel art must be saved as PNG.');
  }

  const pngjs = tryRequire('pngjs');
  const PNG = pngjs && pngjs.PNG;
  if (!PNG) {
    throw new Error('pixelize: "pngjs" is required. Install it with `npm i pngjs`.');
  }

  // Normalize base path → strip .png to build suffix variants.
  const base = outputPath.replace(/\.png$/i, '');
  const rawPath = `${base}_${targetSize}.png`;
  const previewScale = options.previewScale || 8;
  const previewPath = `${base}_${targetSize}@${previewScale}x.png`;
  const palettePath = path.join(path.dirname(rawPath), 'palette.png');
  assertFormatPng(rawPath);
  assertFormatPng(previewPath);
  assertFormatPng(palettePath);

  const preserveAlpha = options.preserveAlpha !== false;

  // 1. decode source
  const srcBuf = fs.readFileSync(imagePath);
  const srcPng = PNG.sync.read(srcBuf);

  // 2. nearest-neighbor downsample → targetSize
  const down = nearestDownsample(PNG, srcPng, targetSize);

  // 3. palette selection: paletteRef wins over median-cut
  let palette;
  if (options.paletteRef && fs.existsSync(options.paletteRef)) {
    palette = extractPaletteColors(PNG, options.paletteRef);
    if (palette.length === 0) {
      throw new Error(`pixelize: palette reference "${options.paletteRef}" had no opaque colors to extract`);
    }
  } else {
    const samples = sampleOpaquePixels(down);
    palette = medianCutPalette(samples, paletteSize);
  }

  // 4. snap downsampled pixels to chosen palette
  const snapped = snapToPalette(PNG, down, palette, preserveAlpha);

  // 5. write raw targetSize PNG
  fs.mkdirSync(path.dirname(path.resolve(rawPath)), { recursive: true });
  fs.writeFileSync(rawPath, PNG.sync.write(snapped));

  // 6. write @Nx preview (nearest-neighbor upscale)
  const preview = nearestUpscale(PNG, snapped, previewScale);
  fs.writeFileSync(previewPath, PNG.sync.write(preview));

  // 7. write palette strip
  writePalettePng(PNG, palette, palettePath);

  return {
    ok: true,
    engine: 'pngjs+nn+median-cut',
    targetSize,
    paletteSize: palette.length,
    rawPath,
    previewPath,
    palettePath,
    paletteSource: options.paletteRef ? 'palette_ref' : 'median_cut',
    palette: palette.map((c) => '#' + [c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, '0')).join('')),
  };
}

module.exports = {
  pixelize,
  ALLOWED_TARGET_SIZES,
  ALLOWED_PALETTE_SIZES,
};
