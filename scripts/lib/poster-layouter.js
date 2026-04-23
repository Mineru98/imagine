'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ── Contract ────────────────────────────────────────────────────────────────
// layoutPoster(bgImagePath, eventData, outputPath, options?) → Promise<report>
//   eventData = { title, subtitle, date, venue, speakers: [{name, role, photo?}], cta, theme }
//   options = {
//     format: 'poster' | 'banner' | 'card'  (controls aspect + defaults)
//     width?:  number                        // override final width
//     height?: number                        // override final height
//     fontFamily?: string
//     themeTokens?: { fg, accent, muted }    // palette tokens pulled from the theme catalog
//   }
//
// Rendering engine selection (any of these is acceptable):
//   - satori + @resvg/resvg-js (React → SVG → PNG)
//   - sharp + hand-written SVG  ← the default fallback implemented here
//   - @napi-rs/canvas (Canvas 2D draw) — caller may inject via options.engine
//
// All are optional dependencies. If none of them are present, the module
// returns { ok: false, reason: 'no_rendering_engine' } and leaves the bg file
// untouched.
//
// Privacy guarantee:
//   Speaker photos stay on the local disk. The manifest produced by this
//   module (and returned in the report) contains only a sha256 hash of each
//   photo path + pixel dimensions. No base64, no EXIF, no file contents.
// ────────────────────────────────────────────────────────────────────────────

function tryRequire(mod) {
  try { return require(mod); } catch { return null; }
}

function escapeXml(str) {
  return String(str).replace(/[<>&"']/g, (ch) => (
    ch === '<' ? '&lt;' :
    ch === '>' ? '&gt;' :
    ch === '&' ? '&amp;' :
    ch === '"' ? '&quot;' : '&apos;'
  ));
}

function hashPath(absPath) {
  return crypto.createHash('sha256').update(absPath).digest('hex').slice(0, 16);
}

const FORMAT_ASPECTS = {
  poster: { w: 2480, h: 3508 },  // A4 300dpi (3:4.24)
  banner: { w: 1920, h: 1080 },  // 16:9
  card:   { w: 1080, h: 1080 },  // 1:1
};

function wordWrap(text, maxCharsPerLine) {
  if (!text) return [];
  const words = String(text).split(/\s+/);
  const lines = [];
  let current = '';
  for (const w of words) {
    if ((current + ' ' + w).trim().length > maxCharsPerLine && current) {
      lines.push(current);
      current = w;
    } else {
      current = (current + ' ' + w).trim();
    }
  }
  if (current) lines.push(current);
  return lines;
}

// Build a circular avatar PNG (centered crop, no face detection) for a
// speaker photo, using sharp. Returns a Buffer sized `size x size`.
async function makeCircularAvatar(sharp, photoPath, size) {
  const circleMask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`,
  );
  return sharp(photoPath)
    .resize(size, size, { fit: 'cover', position: 'center' })
    .composite([{ input: circleMask, blend: 'dest-in' }])
    .png()
    .toBuffer();
}

function buildPosterSvg({ width, height, fontFamily, tokens, event, wraps, speakerLayout }) {
  const fg = (tokens && tokens.fg) || '#f8fafc';
  const accent = (tokens && tokens.accent) || '#a78bfa';
  const muted = (tokens && tokens.muted) || '#cbd5e1';

  const titleSize = Math.round(height * 0.065);
  const subSize = Math.round(height * 0.032);
  const metaSize = Math.round(height * 0.022);
  const ctaSize = Math.round(height * 0.022);
  const titleY = Math.round(height * 0.18);
  const metaStartY = Math.round(height * 0.55);

  const titleLines = (wraps.title || []).map((line, i) => (
    `<text x="${width / 2}" y="${titleY + i * titleSize * 1.15}" text-anchor="middle" font-family="${fontFamily}" font-weight="900" font-size="${titleSize}" fill="${fg}">${escapeXml(line)}</text>`
  )).join('\n');

  const subtitle = event.subtitle
    ? `<text x="${width / 2}" y="${titleY + (wraps.title.length + 1) * titleSize * 1.15}" text-anchor="middle" font-family="${fontFamily}" font-weight="600" font-size="${subSize}" fill="${accent}">${escapeXml(event.subtitle)}</text>`
    : '';

  const meta = [];
  if (event.date)  meta.push(`📅 ${event.date}`);
  if (event.venue) meta.push(`📍 ${event.venue}`);
  const metaSvg = meta.map((line, i) => (
    `<text x="${width / 2}" y="${metaStartY + i * metaSize * 1.4}" text-anchor="middle" font-family="${fontFamily}" font-weight="500" font-size="${metaSize}" fill="${muted}">${escapeXml(line)}</text>`
  )).join('\n');

  const speakerLabels = speakerLayout.map((s) => (
    `<g>
       <text x="${s.cx}" y="${s.cy + s.r + metaSize * 1.6}" text-anchor="middle" font-family="${fontFamily}" font-weight="700" font-size="${metaSize}" fill="${fg}">${escapeXml(s.name)}</text>
       <text x="${s.cx}" y="${s.cy + s.r + metaSize * 2.8}" text-anchor="middle" font-family="${fontFamily}" font-weight="500" font-size="${Math.round(metaSize * 0.8)}" fill="${muted}">${escapeXml(s.role || '')}</text>
     </g>`
  )).join('\n');

  const cta = event.cta
    ? `<text x="${width / 2}" y="${Math.round(height * 0.93)}" text-anchor="middle" font-family="${fontFamily}" font-weight="700" font-size="${ctaSize}" fill="${accent}">${escapeXml(event.cta)}</text>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <filter id="textShadow" x="-5%" y="-5%" width="110%" height="110%">
      <feDropShadow dx="0" dy="3" stdDeviation="4" flood-opacity="0.55"/>
    </filter>
  </defs>
  <g filter="url(#textShadow)">
    ${titleLines}
    ${subtitle}
    ${metaSvg}
    ${speakerLabels}
    ${cta}
  </g>
</svg>`;
}

function computeSpeakerLayout(speakers, width, height, format) {
  const count = speakers.length;
  if (count === 0) return [];
  const rowY = format === 'banner' ? Math.round(height * 0.65) : Math.round(height * 0.78);
  const avatarR = format === 'card'
    ? Math.round(width * 0.08)
    : format === 'banner'
      ? Math.round(height * 0.10)
      : Math.round(width * 0.07);
  const spacing = avatarR * 2 + Math.round(avatarR * 0.6);
  const totalWidth = (count - 1) * spacing;
  const startX = (width - totalWidth) / 2;
  return speakers.map((sp, i) => ({
    name: sp.name,
    role: sp.role,
    photo: sp.photo,
    cx: startX + i * spacing,
    cy: rowY,
    r: avatarR,
    size: avatarR * 2,
  }));
}

async function layoutPoster(bgImagePath, eventData, outputPath, options = {}) {
  if (typeof bgImagePath !== 'string' || !fs.existsSync(bgImagePath)) {
    throw new Error(`layoutPoster: background not found: ${bgImagePath}`);
  }
  if (!eventData || typeof eventData !== 'object') {
    throw new Error('layoutPoster: eventData required');
  }
  if (typeof eventData.title !== 'string' || eventData.title.length === 0) {
    throw new Error('layoutPoster: eventData.title required');
  }
  if (typeof outputPath !== 'string' || outputPath.length === 0) {
    throw new Error('layoutPoster: outputPath required');
  }

  const sharp = tryRequire('sharp');
  const satori = tryRequire('satori');
  const resvg = tryRequire('@resvg/resvg-js');
  const canvas = tryRequire('@napi-rs/canvas');

  if (!sharp && !(satori && resvg) && !canvas) {
    console.warn('poster-layouter: no rendering engine available. Install "sharp" (recommended) or "satori"+"@resvg/resvg-js" or "@napi-rs/canvas".');
    return { ok: false, reason: 'no_rendering_engine', outputPath: null };
  }

  const format = options.format || 'poster';
  const aspect = FORMAT_ASPECTS[format] || FORMAT_ASPECTS.poster;
  const width = options.width || aspect.w;
  const height = options.height || aspect.h;
  const fontFamily = options.fontFamily || "'Pretendard','Noto Sans KR','Apple SD Gothic Neo','Inter',sans-serif";

  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });

  // ── Speaker manifest entries (hash-only, no image bytes) ──
  const speakersInput = Array.isArray(eventData.speakers) ? eventData.speakers : [];
  const speakerManifest = [];
  for (const sp of speakersInput) {
    if (!sp || !sp.photo) {
      speakerManifest.push({ name: sp && sp.name, role: sp && sp.role, photo_hash: null });
      continue;
    }
    const abs = path.resolve(sp.photo);
    let dimensions = null;
    if (sharp && fs.existsSync(abs)) {
      try {
        const meta = await sharp(abs).metadata();
        dimensions = { width: meta.width || null, height: meta.height || null };
      } catch { /* ignore */ }
    }
    speakerManifest.push({
      name: sp.name,
      role: sp.role,
      photo_hash: hashPath(abs),
      photo_dimensions: dimensions,
    });
  }

  // ── If sharp is available, compose background + SVG text + speaker avatars ──
  if (sharp) {
    const speakerLayout = computeSpeakerLayout(speakersInput, width, height, format);
    const wraps = {
      title: wordWrap(eventData.title, format === 'banner' ? 40 : format === 'card' ? 22 : 26),
    };

    // Resize background to target canvas first (cover-fit).
    const bgBuf = await sharp(bgImagePath)
      .resize(width, height, { fit: 'cover', position: 'center' })
      .png()
      .toBuffer();

    const composites = [];

    // Speaker circular avatars.
    for (const s of speakerLayout) {
      if (!s.photo) continue;
      const abs = path.resolve(s.photo);
      if (!fs.existsSync(abs)) continue;
      try {
        const avatarBuf = await makeCircularAvatar(sharp, abs, s.size);
        composites.push({ input: avatarBuf, left: Math.round(s.cx - s.r), top: Math.round(s.cy - s.r) });
      } catch {
        // skip speaker avatar on read failure, manifest still captures the hash
      }
    }

    // Text layer (SVG).
    const svg = buildPosterSvg({
      width, height, fontFamily,
      tokens: options.themeTokens,
      event: eventData,
      wraps,
      speakerLayout,
    });
    composites.push({ input: Buffer.from(svg), top: 0, left: 0 });

    await sharp(bgBuf)
      .composite(composites)
      .png({ compressionLevel: 9 })
      .toFile(outputPath);

    return {
      ok: true,
      engine: 'sharp+svg',
      outputPath: path.resolve(outputPath),
      format,
      dimensions: { width, height },
      speakers_manifest: speakerManifest,
    };
  }

  // Minimal fallback: rendering engine exists but not sharp. Caller should
  // swap in a satori/canvas-backed renderer. We surface the request shape
  // and manifest so the caller can proceed without losing context.
  return {
    ok: false,
    reason: 'sharp_required_for_default_renderer',
    outputPath: null,
    format,
    dimensions: { width, height },
    speakers_manifest: speakerManifest,
  };
}

module.exports = {
  layoutPoster,
  FORMAT_ASPECTS,
  hashPath,
};
