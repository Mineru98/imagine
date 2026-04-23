'use strict';

const fs = require('fs');
const path = require('path');

// ── Contract ────────────────────────────────────────────────────────────────
// composeSheet(framePaths, frameSize, padding, outputPath, options?)
//   framePaths: string[]            — per-frame PNG paths, in order.
//   frameSize:  number              — square frame edge (e.g. 32). Each frame
//                                     is center-cropped to frameSize × frameSize.
//   padding:    number              — transparent padding between frames (0..2).
//   outputPath: string              — base path. Will write `outputPath` (PNG)
//                                     and the sibling JSON (same basename + .json).
//   options = {
//     direction?: 'horizontal' | 'vertical'  // default 'horizontal'
//     alignment?: 'center'                    // current only 'center'
//     engine?:    'sharp' | 'pngjs'           // force an engine; default auto
//   }
//
// Output:
//   <outputPath> (PNG)         — strip of frames with optional padding
//   <outputPath>.json          — Aseprite-compatible meta:
//     {
//       frames: [{ filename, frame: {x,y,w,h}, duration }, ...],
//       frameSize, padding, direction, meta: { size, scale: "1", engine }
//     }
//
// Rendering engine selection:
//   - sharp (preferred)        — uses composite() with per-frame extract().
//   - pngjs (pure JS fallback) — manual blit of frame pixels into the strip.
//   - neither → return { ok: false, reason: 'no_image_engine' } and skip.
// ────────────────────────────────────────────────────────────────────────────

function tryRequire(mod) {
  try { return require(mod); } catch { return null; }
}

function assertPngPath(p) {
  if (!/\.png$/i.test(p)) {
    throw new Error(`sheet-composer: outputPath must be PNG (got "${p}")`);
  }
}

function centerCropBox(srcW, srcH, frameSize) {
  // Return the largest centered frameSize × frameSize box that still fits.
  // Guarantees (x, y, w, h) inside source bounds even if source is smaller.
  const w = Math.min(srcW, frameSize);
  const h = Math.min(srcH, frameSize);
  const x = Math.max(0, Math.floor((srcW - w) / 2));
  const y = Math.max(0, Math.floor((srcH - h) / 2));
  return { x, y, w, h };
}

async function composeWithSharp(sharp, framePaths, frameSize, padding, outputPath, direction) {
  const horizontal = direction !== 'vertical';
  const stride = frameSize + padding;
  const sheetW = horizontal ? stride * framePaths.length - padding : frameSize;
  const sheetH = horizontal ? frameSize : stride * framePaths.length - padding;

  const composites = [];
  const frameMeta = [];
  for (let i = 0; i < framePaths.length; i++) {
    const fp = framePaths[i];
    const meta = await sharp(fp).metadata();
    const box = centerCropBox(meta.width || 0, meta.height || 0, frameSize);
    const cropped = await sharp(fp)
      .extract({ left: box.x, top: box.y, width: box.w, height: box.h })
      .resize(frameSize, frameSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: 'nearest' })
      .png()
      .toBuffer();
    const left = horizontal ? i * stride : 0;
    const top  = horizontal ? 0 : i * stride;
    composites.push({ input: cropped, left, top });
    frameMeta.push({
      filename: path.basename(fp),
      frame: { x: left, y: top, w: frameSize, h: frameSize },
      duration: 100,
    });
  }

  await sharp({
    create: { width: sheetW, height: sheetH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite(composites)
    .png({ compressionLevel: 9 })
    .toFile(outputPath);

  return { sheetW, sheetH, frameMeta };
}

function blitPng(dest, src, dx, dy) {
  const W = dest.width;
  const H = dest.height;
  const sw = src.width;
  const sh = src.height;
  for (let y = 0; y < sh; y++) {
    const tY = dy + y;
    if (tY < 0 || tY >= H) continue;
    for (let x = 0; x < sw; x++) {
      const tX = dx + x;
      if (tX < 0 || tX >= W) continue;
      const si = (sw * y + x) * 4;
      const di = (W * tY + tX) * 4;
      dest.data[di] = src.data[si];
      dest.data[di + 1] = src.data[si + 1];
      dest.data[di + 2] = src.data[si + 2];
      dest.data[di + 3] = src.data[si + 3];
    }
  }
}

function cropPngCenter(PNG, src, frameSize) {
  const box = centerCropBox(src.width, src.height, frameSize);
  const out = new PNG({ width: frameSize, height: frameSize });
  for (let y = 0; y < box.h; y++) {
    for (let x = 0; x < box.w; x++) {
      const si = (src.width * (box.y + y) + (box.x + x)) * 4;
      const dx = Math.floor((frameSize - box.w) / 2) + x;
      const dy = Math.floor((frameSize - box.h) / 2) + y;
      const di = (frameSize * dy + dx) * 4;
      out.data[di] = src.data[si];
      out.data[di + 1] = src.data[si + 1];
      out.data[di + 2] = src.data[si + 2];
      out.data[di + 3] = src.data[si + 3];
    }
  }
  return out;
}

function composeWithPngjs(PNG, framePaths, frameSize, padding, outputPath, direction) {
  const horizontal = direction !== 'vertical';
  const stride = frameSize + padding;
  const sheetW = horizontal ? stride * framePaths.length - padding : frameSize;
  const sheetH = horizontal ? frameSize : stride * framePaths.length - padding;
  const sheet = new PNG({ width: sheetW, height: sheetH });
  // initialize as fully transparent (pngjs zero-fills Buffer, so alpha=0 already)
  const frameMeta = [];
  for (let i = 0; i < framePaths.length; i++) {
    const fp = framePaths[i];
    const buf = fs.readFileSync(fp);
    const src = PNG.sync.read(buf);
    const centered = cropPngCenter(PNG, src, frameSize);
    const left = horizontal ? i * stride : 0;
    const top  = horizontal ? 0 : i * stride;
    blitPng(sheet, centered, left, top);
    frameMeta.push({
      filename: path.basename(fp),
      frame: { x: left, y: top, w: frameSize, h: frameSize },
      duration: 100,
    });
  }
  fs.writeFileSync(outputPath, PNG.sync.write(sheet));
  return { sheetW, sheetH, frameMeta };
}

async function composeSheet(framePaths, frameSize, padding, outputPath, options = {}) {
  if (!Array.isArray(framePaths) || framePaths.length === 0) {
    throw new Error('composeSheet: framePaths must be a non-empty array');
  }
  for (const fp of framePaths) {
    if (typeof fp !== 'string' || !fs.existsSync(fp)) {
      throw new Error(`composeSheet: frame not found: ${fp}`);
    }
  }
  if (!Number.isInteger(frameSize) || frameSize <= 0) {
    throw new Error(`composeSheet: frameSize must be a positive integer (got ${frameSize})`);
  }
  if (!Number.isInteger(padding) || padding < 0 || padding > 2) {
    throw new Error(`composeSheet: padding must be an integer in [0, 2] (got ${padding})`);
  }
  if (typeof outputPath !== 'string' || outputPath.length === 0) {
    throw new Error('composeSheet: outputPath required');
  }
  assertPngPath(outputPath);
  if (/\.jpe?g$/i.test(outputPath)) {
    throw new Error('composeSheet: JPEG output forbidden for pixel sprite sheets');
  }

  const direction = options.direction === 'vertical' ? 'vertical' : 'horizontal';
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });

  const preferred = options.engine;
  const sharp = (!preferred || preferred === 'sharp') ? tryRequire('sharp') : null;
  const pngjs = (!sharp || preferred === 'pngjs') ? tryRequire('pngjs') : null;
  const PNG = pngjs && pngjs.PNG;

  let result;
  let engine;
  if (sharp) {
    engine = 'sharp';
    result = await composeWithSharp(sharp, framePaths, frameSize, padding, outputPath, direction);
  } else if (PNG) {
    engine = 'pngjs';
    result = composeWithPngjs(PNG, framePaths, frameSize, padding, outputPath, direction);
  } else {
    console.warn('sheet-composer: neither "sharp" nor "pngjs" installed — cannot compose sheet.');
    return { ok: false, reason: 'no_image_engine', outputPath: null, jsonPath: null };
  }

  const jsonPath = outputPath.replace(/\.png$/i, '.json');
  const meta = {
    frames: result.frameMeta,
    frameSize,
    padding,
    direction,
    meta: {
      app: 'imagine-sprite',
      version: '1',
      size: { w: result.sheetW, h: result.sheetH },
      scale: '1',
      engine,
      format: 'RGBA8888',
    },
  };
  fs.writeFileSync(jsonPath, JSON.stringify(meta, null, 2));

  return {
    ok: true,
    engine,
    outputPath: path.resolve(outputPath),
    jsonPath: path.resolve(jsonPath),
    frameSize,
    padding,
    frames: result.frameMeta.length,
    sheetDimensions: { width: result.sheetW, height: result.sheetH },
  };
}

module.exports = { composeSheet };
