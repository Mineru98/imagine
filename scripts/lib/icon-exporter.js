'use strict';

const fs = require('fs');
const path = require('path');

// ── Contract ────────────────────────────────────────────────────────────────
// exportSizes(masterPath, targets, outputDir, options?) → Promise<report>
//   targets: subset of ['ios', 'android', 'web'].
//   outputDir: directory root — per-target subfolders are created under it.
//   options:
//     { androidBackground?: '#RRGGBB' | 'auto',
//       adaptiveSafeZonePx?: 108,    // Android adaptive safe zone in dp-equiv
//       writeManifest?: boolean }    // emit manifest.webmanifest (web)
//
// Resize policy:
//   sharp available → Lanczos3 (.resize(..., { kernel: 'lanczos3' }))
//   sharp absent + pngjs available → box-averaged downsample (quality warning)
//   neither available → throw with clear install hint
// ────────────────────────────────────────────────────────────────────────────

function tryRequire(mod) {
  try { return require(mod); } catch { return null; }
}

const IOS_SIZES = [
  { name: 'AppIcon-1024.png', w: 1024, h: 1024 },
];
const WEB_SIZES = [
  { name: 'favicon-16.png', w: 16, h: 16 },
  { name: 'favicon-32.png', w: 32, h: 32 },
  { name: 'favicon-48.png', w: 48, h: 48 },
  { name: 'apple-touch-icon-180.png', w: 180, h: 180 },
  { name: 'pwa-192.png', w: 192, h: 192 },
  { name: 'pwa-512.png', w: 512, h: 512 },
];
const ANDROID_ADAPTIVE_SIZE = 432;   // foreground visual target
const ANDROID_CANVAS = 512;           // full adaptive canvas

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

// ── Pure-JS fallback: box-averaged downsample using pngjs ──
function pureJsResize(PNG, srcBuffer, targetW, targetH) {
  const src = PNG.sync.read(srcBuffer);
  const sw = src.width;
  const sh = src.height;
  const out = new PNG({ width: targetW, height: targetH });
  const scaleX = sw / targetW;
  const scaleY = sh / targetH;
  for (let y = 0; y < targetH; y++) {
    const y0 = Math.floor(y * scaleY);
    const y1 = Math.min(sh, Math.floor((y + 1) * scaleY));
    for (let x = 0; x < targetW; x++) {
      const x0 = Math.floor(x * scaleX);
      const x1 = Math.min(sw, Math.floor((x + 1) * scaleX));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const idx = (sw * yy + xx) * 4;
          r += src.data[idx];
          g += src.data[idx + 1];
          b += src.data[idx + 2];
          a += src.data[idx + 3];
          n++;
        }
      }
      if (n === 0) n = 1;
      const outIdx = (targetW * y + x) * 4;
      out.data[outIdx] = Math.round(r / n);
      out.data[outIdx + 1] = Math.round(g / n);
      out.data[outIdx + 2] = Math.round(b / n);
      out.data[outIdx + 3] = Math.round(a / n);
    }
  }
  return PNG.sync.write(out);
}

function solidColorPng(PNG, color, size) {
  const hex = color.replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const png = new PNG({ width: size, height: size });
  for (let i = 0; i < size * size; i++) {
    const idx = i * 4;
    png.data[idx] = r;
    png.data[idx + 1] = g;
    png.data[idx + 2] = b;
    png.data[idx + 3] = 255;
  }
  return PNG.sync.write(png);
}

// Sample average of four corner tiles (16x16 each) of the master as background.
function sampleCornerColor(PNG, masterBuffer) {
  const m = PNG.sync.read(masterBuffer);
  const tile = 16;
  const points = [
    { x: 0, y: 0 },
    { x: m.width - tile, y: 0 },
    { x: 0, y: m.height - tile },
    { x: m.width - tile, y: m.height - tile },
  ];
  let r = 0, g = 0, b = 0, n = 0;
  for (const p of points) {
    for (let yy = p.y; yy < p.y + tile; yy++) {
      for (let xx = p.x; xx < p.x + tile; xx++) {
        const idx = (m.width * yy + xx) * 4;
        r += m.data[idx]; g += m.data[idx + 1]; b += m.data[idx + 2]; n++;
      }
    }
  }
  const toHex = (v) => Math.round(v / n).toString(16).padStart(2, '0');
  return '#' + toHex(r) + toHex(g) + toHex(b);
}

async function resizeWithSharp(sharp, masterPath, w, h, outPath) {
  await sharp(masterPath)
    .resize(w, h, { kernel: 'lanczos3', fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toFile(outPath);
}

function resizeWithPngjs(PNG, masterBuffer, w, h, outPath) {
  const out = pureJsResize(PNG, masterBuffer, w, h);
  fs.writeFileSync(outPath, out);
}

async function exportSizes(masterPath, targets, outputDir, options = {}) {
  if (typeof masterPath !== 'string' || !fs.existsSync(masterPath)) {
    throw new Error(`icon-exporter: master not found: ${masterPath}`);
  }
  if (!Array.isArray(targets) || targets.length === 0) {
    throw new Error('icon-exporter: targets must be a non-empty array subset of ["ios","android","web"]');
  }
  if (typeof outputDir !== 'string' || outputDir.length === 0) {
    throw new Error('icon-exporter: outputDir required');
  }

  const sharp = tryRequire('sharp');
  const pngjs = tryRequire('pngjs');
  const PNG = pngjs && pngjs.PNG;

  if (!sharp && !PNG) {
    throw new Error('icon-exporter: neither "sharp" nor "pngjs" is installed. Install one: `npm i sharp` (preferred) or `npm i pngjs` for degraded fallback.');
  }
  if (!sharp) {
    console.warn('icon-exporter: "sharp" not installed — falling back to pngjs box-averaged resize. Quality at small sizes (16/32) will be degraded; install sharp for Lanczos3.');
  }

  ensureDir(outputDir);

  const report = {
    master: masterPath,
    resize_engine: sharp ? 'sharp-lanczos3' : 'pngjs-box-average',
    targets: {},
    warnings: [],
  };

  const masterBuffer = sharp ? null : fs.readFileSync(masterPath);

  // ── iOS ──
  if (targets.includes('ios')) {
    const iosDir = path.join(outputDir, 'ios');
    ensureDir(iosDir);
    const written = [];
    for (const size of IOS_SIZES) {
      const outPath = path.join(iosDir, size.name);
      if (sharp) await resizeWithSharp(sharp, masterPath, size.w, size.h, outPath);
      else resizeWithPngjs(PNG, masterBuffer, size.w, size.h, outPath);
      written.push(outPath);
    }
    report.targets.ios = { dir: iosDir, files: written };
  }

  // ── Android adaptive ──
  if (targets.includes('android')) {
    const androidDir = path.join(outputDir, 'android');
    ensureDir(androidDir);
    const fgPath = path.join(androidDir, 'ic_launcher_foreground.png');
    const bgPath = path.join(androidDir, 'ic_launcher_background.png');
    const safeZone = options.adaptiveSafeZonePx || 108;

    // Foreground: centered master scaled to 432x432 inside a 512x512 transparent canvas
    if (sharp) {
      const fgBuf = await sharp(masterPath)
        .resize(ANDROID_ADAPTIVE_SIZE, ANDROID_ADAPTIVE_SIZE, { kernel: 'lanczos3', fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();
      await sharp({
        create: {
          width: ANDROID_CANVAS,
          height: ANDROID_CANVAS,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
      })
        .composite([{ input: fgBuf, gravity: 'center' }])
        .png({ compressionLevel: 9 })
        .toFile(fgPath);
    } else {
      resizeWithPngjs(PNG, masterBuffer, ANDROID_ADAPTIVE_SIZE, ANDROID_ADAPTIVE_SIZE, fgPath);
      report.warnings.push('android: pngjs fallback produced unpadded foreground (no transparent 512 canvas). Install sharp for proper adaptive icon.');
    }

    // Background: solid color sampled from master corners, unless caller provided one.
    let bgColor = options.androidBackground;
    if (!bgColor || bgColor === 'auto') {
      if (sharp) {
        const stats = await sharp(masterPath).stats();
        const [r, g, b] = stats.channels;
        const toHex = (v) => Math.round(v.mean).toString(16).padStart(2, '0');
        bgColor = '#' + toHex(r) + toHex(g) + toHex(b);
      } else {
        bgColor = sampleCornerColor(PNG, masterBuffer);
      }
    }
    if (sharp) {
      await sharp({
        create: { width: ANDROID_CANVAS, height: ANDROID_CANVAS, channels: 4, background: bgColor },
      }).png().toFile(bgPath);
    } else {
      fs.writeFileSync(bgPath, solidColorPng(PNG, bgColor, ANDROID_CANVAS));
    }

    report.targets.android = {
      dir: androidDir,
      foreground: fgPath,
      background: bgPath,
      background_color: bgColor,
      safe_zone_px: safeZone,
    };
  }

  // ── Web ──
  if (targets.includes('web')) {
    const webDir = path.join(outputDir, 'web');
    ensureDir(webDir);
    const written = [];
    for (const size of WEB_SIZES) {
      const outPath = path.join(webDir, size.name);
      if (sharp) await resizeWithSharp(sharp, masterPath, size.w, size.h, outPath);
      else resizeWithPngjs(PNG, masterBuffer, size.w, size.h, outPath);
      written.push(outPath);
    }
    if (options.writeManifest) {
      const manifest = {
        icons: [
          { src: 'web/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'web/pwa-512.png', sizes: '512x512', type: 'image/png' },
        ],
      };
      const mfPath = path.join(outputDir, 'manifest.webmanifest');
      fs.writeFileSync(mfPath, JSON.stringify(manifest, null, 2));
      written.push(mfPath);
    }
    report.targets.web = { dir: webDir, files: written };
  }

  return report;
}

module.exports = {
  exportSizes,
  IOS_SIZES,
  WEB_SIZES,
};
