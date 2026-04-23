'use strict';

const fs = require('fs');
const path = require('path');

// ── Contract ────────────────────────────────────────────────────────────────
// compose(screenshotPath, devicePreset, bgImagePath, outputPath, options?)
//   screenshotPath:  string | null    — path to screenshot PNG/JPEG. Null is
//                                       allowed only for "empty device" renders.
//   devicePreset:    string | object  — preset key from data/devices.json OR a
//                                       literal preset object (see schema).
//   bgImagePath:     string | null    — background image path. Null = solid or
//                                       gradient background from options.bg.
//   outputPath:      string           — final PNG path.
//
//   options = {
//     catalog?:         string        // override path to data/devices.json
//     bg?:              { kind: 'solid'|'gradient'|'image', ... }
//     screenshotFit?:   'cover' | 'contain' // default 'cover' with pad warning
//     padColor?:        string        // padding color when fit yields mismatch
//     tiltDeg?:         number        // optional visual tilt (SVG transform)
//   }
//
// Output side effects:
//   - Writes final composite to outputPath.
//   - When aspect mismatch was padded, returns warnings[] with details so the
//     skill can surface the note to the user.
//
// AI invocation:
//   This module never calls the AI model. The skill entrypoint decides whether
//   to pre-generate a background. If `bgImagePath` is already provided (or the
//   requested bg kind is solid/gradient), no generation step is needed.
// ────────────────────────────────────────────────────────────────────────────

const DEFAULT_CATALOG = path.join('data', 'devices.json');

function tryRequire(mod) {
  try { return require(mod); } catch { return null; }
}

function loadCatalog(catalogPath) {
  const resolved = path.resolve(catalogPath || DEFAULT_CATALOG);
  if (!fs.existsSync(resolved)) {
    throw new Error(`device-composer: device catalog not found: ${resolved}`);
  }
  const raw = fs.readFileSync(resolved, 'utf8');
  const json = JSON.parse(raw);
  if (!json || !json.devices || typeof json.devices !== 'object') {
    throw new Error('device-composer: catalog missing "devices" object');
  }
  return json;
}

function resolveDevicePreset(devicePreset, catalogPath) {
  if (devicePreset && typeof devicePreset === 'object') return devicePreset;
  if (typeof devicePreset !== 'string' || devicePreset.length === 0) {
    throw new Error('device-composer: devicePreset required (key or object)');
  }
  const catalog = loadCatalog(catalogPath);
  const preset = catalog.devices[devicePreset];
  if (!preset) {
    throw new Error(`device-composer: unknown device "${devicePreset}". Available: ${Object.keys(catalog.devices).join(', ')}`);
  }
  return Object.assign({ _key: devicePreset }, preset);
}

function escapeXml(str) {
  return String(str).replace(/[<>&"']/g, (ch) => (
    ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch === '&' ? '&amp;' : ch === '"' ? '&quot;' : '&apos;'
  ));
}

// Build an SVG that draws the device body + the screen area as a clip rect so
// the caller can composite a screenshot into the screen through sharp.
function buildDeviceFrameSvg(preset, width, height, options = {}) {
  const frameFill = preset.frame_fill || '#1f2937';
  const bezelFill = preset.bezel_fill || '#0b0f19';
  const cornerR = preset.body_corner_radius || 48;
  const screen = preset.screen; // {x, y, w, h, cornerRadius?}
  const screenR = screen.cornerRadius || 24;
  const tilt = typeof options.tiltDeg === 'number' ? options.tiltDeg : 0;
  const transform = tilt ? `rotate(${tilt} ${width / 2} ${height / 2})` : '';
  const label = preset.label ? `<!-- device: ${escapeXml(preset.label)} -->` : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  ${label}
  <g ${transform ? `transform="${transform}"` : ''}>
    <rect x="0" y="0" width="${width}" height="${height}" rx="${cornerR}" ry="${cornerR}" fill="${frameFill}"/>
    <rect x="${screen.x - 8}" y="${screen.y - 8}" width="${screen.w + 16}" height="${screen.h + 16}" rx="${screenR + 4}" ry="${screenR + 4}" fill="${bezelFill}"/>
  </g>
</svg>`;
}

function buildSolidBgPng(sharp, width, height, color) {
  return sharp({
    create: { width, height, channels: 4, background: color },
  }).png().toBuffer();
}

function buildGradientSvg(width, height, stops) {
  const stopsXml = stops.map((s, i) => `<stop offset="${i / (stops.length - 1)}" stop-color="${s}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">${stopsXml}</linearGradient></defs>
  <rect width="${width}" height="${height}" fill="url(#g)"/>
</svg>`;
}

async function prepareScreenshot(sharp, screenshotPath, targetW, targetH, options) {
  const fit = options.screenshotFit || 'cover';
  const padColor = options.padColor || '#000000';
  const meta = await sharp(screenshotPath).metadata();
  const srcW = meta.width || 0;
  const srcH = meta.height || 0;
  const srcAspect = srcW / srcH;
  const dstAspect = targetW / targetH;
  const mismatch = Math.abs(srcAspect - dstAspect) / dstAspect > 0.01;

  const warnings = [];
  if (mismatch) {
    warnings.push(`Screenshot aspect ${(srcAspect).toFixed(3)} does not match device screen ${(dstAspect).toFixed(3)}; padding applied with color ${padColor}.`);
  }

  const buf = await sharp(screenshotPath)
    .resize(targetW, targetH, { fit: fit === 'contain' || mismatch ? 'contain' : 'cover', background: padColor, kernel: 'lanczos3' })
    .png()
    .toBuffer();

  return { buf, warnings };
}

async function compose(screenshotPath, devicePreset, bgImagePath, outputPath, options = {}) {
  if (typeof outputPath !== 'string' || outputPath.length === 0) {
    throw new Error('device-composer: outputPath required');
  }
  if (!/\.png$/i.test(outputPath)) {
    throw new Error(`device-composer: outputPath must be PNG (got "${outputPath}")`);
  }

  const preset = resolveDevicePreset(devicePreset, options.catalog);
  const canvasW = preset.canvas && preset.canvas.width ? preset.canvas.width : preset.width;
  const canvasH = preset.canvas && preset.canvas.height ? preset.canvas.height : preset.height;
  if (!canvasW || !canvasH) {
    throw new Error(`device-composer: preset "${preset._key || '(inline)'}" missing canvas dimensions`);
  }

  const sharp = tryRequire('sharp');
  if (!sharp) {
    throw new Error('device-composer: "sharp" is required. Install it with `npm i sharp`.');
  }

  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  const warnings = [];

  // 1. Background layer ------------------------------------------------------
  let bgInput;
  if (bgImagePath && fs.existsSync(bgImagePath)) {
    bgInput = await sharp(bgImagePath)
      .resize(canvasW, canvasH, { fit: 'cover', position: 'center' })
      .png()
      .toBuffer();
  } else if (options.bg && options.bg.kind === 'gradient' && Array.isArray(options.bg.stops)) {
    bgInput = Buffer.from(buildGradientSvg(canvasW, canvasH, options.bg.stops));
  } else if (options.bg && options.bg.kind === 'solid' && options.bg.color) {
    bgInput = await buildSolidBgPng(sharp, canvasW, canvasH, options.bg.color);
  } else {
    // Transparent background by default.
    bgInput = await sharp({
      create: { width: canvasW, height: canvasH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    }).png().toBuffer();
  }

  // 2. Screenshot layer (optional) -------------------------------------------
  const composites = [];
  if (screenshotPath) {
    if (!fs.existsSync(screenshotPath)) {
      throw new Error(`device-composer: screenshot not found: ${screenshotPath}`);
    }
    const { buf: screenshotBuf, warnings: screenWarnings } = await prepareScreenshot(
      sharp, screenshotPath, preset.screen.w, preset.screen.h, options,
    );
    warnings.push(...screenWarnings);
    composites.push({ input: screenshotBuf, left: preset.screen.x, top: preset.screen.y });
  }

  // 3. Device frame SVG (drawn over screenshot so bezel/notch sits on top) ---
  const frameSvg = Buffer.from(buildDeviceFrameSvg(preset, canvasW, canvasH, options));
  composites.push({ input: frameSvg, top: 0, left: 0 });

  // 4. Final composite --------------------------------------------------------
  await sharp(bgInput)
    .composite(composites)
    .png({ compressionLevel: 9 })
    .toFile(outputPath);

  return {
    ok: true,
    engine: 'sharp+svg',
    outputPath: path.resolve(outputPath),
    device: preset._key || preset.label || '(inline)',
    canvas: { width: canvasW, height: canvasH },
    screen: preset.screen,
    warnings,
  };
}

module.exports = {
  compose,
  loadCatalog,
  resolveDevicePreset,
};
