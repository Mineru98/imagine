'use strict';

const fs = require('fs');
const path = require('path');

// ── Contract ────────────────────────────────────────────────────────────────
// compositeText(bgImagePath, textOptions, outputPath) → writes composite image.
//   textOptions = {
//     title:       string  (required — rendered as the main text)
//     subtitle?:   string
//     side?:       'left' | 'right' | 'center'  (default 'left')
//     color?:      string   (overrides auto luminance-based choice)
//     font?:       string   (CSS font-family; default system sans)
//     titleSize?:  number   (default scales to image height)
//     subtitleSize?: number
//     safeZone?:   number   (0..1, width ratio used for text; default 0.45)
//     shadow?:     boolean  (default true)
//   }
//
// Text is ALWAYS rendered locally via SVG → sharp composite. The AI model is
// never asked to draw the title characters, which is the whole point of this
// module for YouTube-style thumbnails where Hangul / CJK glyphs would break.
// ────────────────────────────────────────────────────────────────────────────

function loadSharp() {
  try {
    return require('sharp');
  } catch {
    return null;
  }
}

function escapeXml(str) {
  return String(str).replace(/[<>&"']/g, (ch) => (
    ch === '<' ? '&lt;' :
    ch === '>' ? '&gt;' :
    ch === '&' ? '&amp;' :
    ch === '"' ? '&quot;' : '&apos;'
  ));
}

// Relative luminance per WCAG (sRGB linearization).
function srgbToLinear(c) {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function relativeLuminance(r, g, b) {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

// Mean luminance of a safe-zone rectangle on the background image.
async function measureZoneLuminance(sharp, bgImagePath, zone) {
  const meta = await sharp(bgImagePath).metadata();
  const W = meta.width || 0;
  const H = meta.height || 0;
  const left = Math.max(0, Math.round(zone.x * W));
  const top = Math.max(0, Math.round(zone.y * H));
  const width = Math.max(1, Math.round(zone.w * W));
  const height = Math.max(1, Math.round(zone.h * H));
  const stats = await sharp(bgImagePath)
    .extract({ left, top, width: Math.min(width, W - left), height: Math.min(height, H - top) })
    .removeAlpha()
    .stats();
  const [r, g, b] = stats.channels;
  return relativeLuminance(r.mean, g.mean, b.mean);
}

function pickTextColor(luminance) {
  // WCAG threshold for light/dark split on mid-grey is ~0.18; use 0.5 for bold
  // thumbnail contrast so mid-tones still pick white for punch.
  return luminance < 0.5 ? '#ffffff' : '#111111';
}

function renderSvg({ width, height, title, subtitle, side, color, font, titleSize, subtitleSize, safeZone, shadow }) {
  const zoneW = Math.round(width * safeZone);
  const zoneX = side === 'right'
    ? width - zoneW - Math.round(width * 0.05)
    : side === 'center'
      ? Math.round((width - zoneW) / 2)
      : Math.round(width * 0.05);
  const anchor = side === 'right' ? 'end' : side === 'center' ? 'middle' : 'start';
  const textX = side === 'right' ? zoneX + zoneW : side === 'center' ? zoneX + zoneW / 2 : zoneX;
  const titleY = Math.round(height * 0.55);
  const subY = titleY + Math.round(titleSize * 1.1);
  const shadowFilter = shadow
    ? '<filter id="s" x="-10%" y="-10%" width="120%" height="120%"><feDropShadow dx="0" dy="4" stdDeviation="6" flood-opacity="0.55"/></filter>'
    : '';
  const filterAttr = shadow ? ' filter="url(#s)"' : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>${shadowFilter}</defs>
  <style>
    .title { font-family: ${font}; font-weight: 900; font-size: ${titleSize}px; fill: ${color}; }
    .sub   { font-family: ${font}; font-weight: 600; font-size: ${subtitleSize}px; fill: ${color}; opacity: 0.92; }
  </style>
  <text x="${textX}" y="${titleY}" text-anchor="${anchor}" class="title"${filterAttr}>${escapeXml(title)}</text>
  ${subtitle ? `<text x="${textX}" y="${subY}" text-anchor="${anchor}" class="sub"${filterAttr}>${escapeXml(subtitle)}</text>` : ''}
</svg>`;
}

async function compositeText(bgImagePath, textOptions, outputPath) {
  if (typeof bgImagePath !== 'string' || !fs.existsSync(bgImagePath)) {
    throw new Error(`compositeText: background image not found: ${bgImagePath}`);
  }
  if (!textOptions || typeof textOptions.title !== 'string' || textOptions.title.length === 0) {
    throw new Error('compositeText: textOptions.title is required');
  }
  if (typeof outputPath !== 'string' || outputPath.length === 0) {
    throw new Error('compositeText: outputPath required');
  }

  const sharp = loadSharp();
  if (!sharp) {
    const err = new Error('compositeText: optional dependency "sharp" not installed; text compositing unavailable. Install `sharp` to render thumbnail text.');
    err.code = 'SHARP_MISSING';
    throw err;
  }

  const meta = await sharp(bgImagePath).metadata();
  const width = meta.width || 0;
  const height = meta.height || 0;
  if (!width || !height) throw new Error('compositeText: could not read background dimensions');

  const side = textOptions.side || 'left';
  const safeZone = typeof textOptions.safeZone === 'number' ? textOptions.safeZone : 0.45;
  const titleSize = textOptions.titleSize || Math.round(height * 0.11);
  const subtitleSize = textOptions.subtitleSize || Math.round(titleSize * 0.45);
  const font = textOptions.font || "'Pretendard','Noto Sans KR','Apple SD Gothic Neo','Helvetica Neue',Arial,sans-serif";

  let color = textOptions.color;
  if (!color) {
    const zone = {
      x: side === 'right' ? 0.55 : side === 'center' ? 0.25 : 0.05,
      y: 0.35,
      w: safeZone,
      h: 0.35,
    };
    const lum = await measureZoneLuminance(sharp, bgImagePath, zone);
    color = pickTextColor(lum);
  }

  const svg = renderSvg({
    width, height,
    title: textOptions.title,
    subtitle: textOptions.subtitle || '',
    side,
    color,
    font,
    titleSize,
    subtitleSize,
    safeZone,
    shadow: textOptions.shadow !== false,
  });

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  await sharp(bgImagePath)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .jpeg({ quality: 88, mozjpeg: true })
    .toFile(outputPath);

  return { outputPath, width, height, color };
}

module.exports = {
  compositeText,
  pickTextColor,
  relativeLuminance,
};
