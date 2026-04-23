'use strict';

const fs = require('fs');
const path = require('path');

// ── Contract ────────────────────────────────────────────────────────────────
// makeSeamless(imagePath, outputPath, options?) → Promise<result>
//   Offsets the image by (w/2, h/2) so the original seam lands in the center
//   of the frame, feather-blurs a cross-shaped heal region there, re-injects
//   grain to match the surrounding texture, then writes to outputPath.
//
// previewTile(imagePath, outputPath, repeat=4) → Promise<result>
//   Tiles the image into a repeat × repeat grid so the caller can eyeball
//   whether the seam healed cleanly.
//
// hueShift(imagePath, outputPath, degrees) → Promise<result>
//   sharp `.modulate({ hue })` one-shot; no AI round-trip.
//
// makeVariants(imagePath, outputDir, degreesList) → Promise<[{degrees, path}]>
//   Convenience: one sharp call per entry in degreesList. Keep the AI call
//   budget at one by never regenerating — all color variants are local.
// ────────────────────────────────────────────────────────────────────────────

function tryRequire(mod) {
  try { return require(mod); } catch { return null; }
}

function requireSharp() {
  const sharp = tryRequire('sharp');
  if (!sharp) {
    throw new Error('seamless: "sharp" is required. Install it with `npm i sharp`.');
  }
  return sharp;
}

function assertImageExt(p) {
  if (!/\.(png|webp|jpe?g)$/i.test(p)) {
    throw new Error(`seamless: unsupported extension "${p}". Use .png / .webp / .jpg.`);
  }
}

async function makeSeamless(imagePath, outputPath, options = {}) {
  if (typeof imagePath !== 'string' || !fs.existsSync(imagePath)) {
    throw new Error(`seamless: input not found: ${imagePath}`);
  }
  if (typeof outputPath !== 'string' || outputPath.length === 0) {
    throw new Error('seamless: outputPath required');
  }
  assertImageExt(outputPath);
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });

  const sharp = requireSharp();
  const meta = await sharp(imagePath).metadata();
  const W = meta.width || 0;
  const H = meta.height || 0;
  if (!W || !H) throw new Error('seamless: cannot read source dimensions');

  const halfW = Math.floor(W / 2);
  const halfH = Math.floor(H / 2);

  // 1) extract four quadrants of the source
  const src = sharp(imagePath);
  const q_tl = await src.clone().extract({ left: 0,     top: 0,     width: halfW,      height: halfH      }).png().toBuffer();
  const q_tr = await src.clone().extract({ left: halfW, top: 0,     width: W - halfW,  height: halfH      }).png().toBuffer();
  const q_bl = await src.clone().extract({ left: 0,     top: halfH, width: halfW,      height: H - halfH  }).png().toBuffer();
  const q_br = await src.clone().extract({ left: halfW, top: halfH, width: W - halfW,  height: H - halfH  }).png().toBuffer();

  // 2) recompose with quadrants swapped so the original edges meet at the
  //    center — that is where the seam now lives.
  const swapped = await sharp({
    create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      { input: q_br, left: 0,     top: 0     },
      { input: q_bl, left: halfW, top: 0     },
      { input: q_tr, left: 0,     top: halfH },
      { input: q_tl, left: halfW, top: halfH },
    ])
    .png()
    .toBuffer();

  // 3) feather-blur a cross-shaped heal region centered on (halfW, halfH).
  const healRatio = typeof options.healRatio === 'number' ? options.healRatio : 0.18;
  const healW = Math.max(8, Math.round(W * healRatio));
  const healH = Math.max(8, Math.round(H * healRatio));
  const blurRadius = typeof options.blurRadius === 'number' ? options.blurRadius : 8;

  const horizontalCrop = await sharp(swapped)
    .extract({ left: 0, top: halfH - Math.floor(healH / 2), width: W, height: healH })
    .blur(blurRadius)
    .png()
    .toBuffer();
  const verticalCrop = await sharp(swapped)
    .extract({ left: halfW - Math.floor(healW / 2), top: 0, width: healW, height: H })
    .blur(blurRadius)
    .png()
    .toBuffer();

  const healed = await sharp(swapped)
    .composite([
      { input: horizontalCrop, left: 0,                             top: halfH - Math.floor(healH / 2) },
      { input: verticalCrop,   left: halfW - Math.floor(healW / 2), top: 0                             },
    ])
    .png()
    .toBuffer();

  // 4) re-inject grain over the healed regions so the blur isn't visibly soft.
  const grainSigma = typeof options.grainSigma === 'number' ? options.grainSigma : 12;
  const grain = await sharp({
    create: { width: W, height: H, channels: 4, background: { r: 128, g: 128, b: 128, alpha: 0 } },
  })
    .composite([
      {
        input: {
          create: {
            width: W,
            height: H,
            channels: 3,
            background: '#808080',
            noise: { type: 'gaussian', mean: 0, sigma: grainSigma },
          },
        },
        blend: 'overlay',
      },
    ])
    .png()
    .toBuffer();

  const finalBuf = await sharp(healed)
    .composite([{ input: grain, blend: 'overlay' }])
    .png()
    .toBuffer();

  const ext = path.extname(outputPath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') {
    await sharp(finalBuf).jpeg({ quality: 92, chromaSubsampling: '4:4:4' }).toFile(outputPath);
  } else if (ext === '.webp') {
    await sharp(finalBuf).webp({ quality: 90 }).toFile(outputPath);
  } else {
    await sharp(finalBuf).png({ compressionLevel: 9 }).toFile(outputPath);
  }

  return {
    ok: true,
    engine: 'sharp-offset-heal',
    outputPath: path.resolve(outputPath),
    dimensions: { width: W, height: H },
    heal: { width: healW, height: healH, blurRadius, grainSigma },
  };
}

async function previewTile(imagePath, outputPath, repeat = 4) {
  if (typeof imagePath !== 'string' || !fs.existsSync(imagePath)) {
    throw new Error(`seamless.previewTile: input not found: ${imagePath}`);
  }
  if (!Number.isInteger(repeat) || repeat < 2 || repeat > 8) {
    throw new Error(`seamless.previewTile: repeat must be integer in [2, 8] (got ${repeat})`);
  }
  assertImageExt(outputPath);
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });

  const sharp = requireSharp();
  const meta = await sharp(imagePath).metadata();
  const w = meta.width || 0;
  const h = meta.height || 0;
  const tile = await sharp(imagePath).png().toBuffer();

  const composites = [];
  for (let ry = 0; ry < repeat; ry++) {
    for (let rx = 0; rx < repeat; rx++) {
      composites.push({ input: tile, left: rx * w, top: ry * h });
    }
  }

  await sharp({
    create: { width: w * repeat, height: h * repeat, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite(composites)
    .png({ compressionLevel: 9 })
    .toFile(outputPath);

  return {
    ok: true,
    outputPath: path.resolve(outputPath),
    repeat,
    dimensions: { width: w * repeat, height: h * repeat },
  };
}

async function hueShift(imagePath, outputPath, degrees) {
  if (typeof degrees !== 'number' || !Number.isFinite(degrees)) {
    throw new Error(`seamless.hueShift: degrees must be a finite number (got ${degrees})`);
  }
  if (typeof imagePath !== 'string' || !fs.existsSync(imagePath)) {
    throw new Error(`seamless.hueShift: input not found: ${imagePath}`);
  }
  assertImageExt(outputPath);
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });

  const sharp = requireSharp();
  const pipeline = sharp(imagePath).modulate({ hue: degrees });
  const ext = path.extname(outputPath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') {
    await pipeline.jpeg({ quality: 92, chromaSubsampling: '4:4:4' }).toFile(outputPath);
  } else if (ext === '.webp') {
    await pipeline.webp({ quality: 90 }).toFile(outputPath);
  } else {
    await pipeline.png({ compressionLevel: 9 }).toFile(outputPath);
  }

  return { ok: true, outputPath: path.resolve(outputPath), hue: degrees };
}

async function makeVariants(imagePath, outputDir, degreesList) {
  if (!Array.isArray(degreesList) || degreesList.length === 0) {
    throw new Error('seamless.makeVariants: degreesList required');
  }
  const stem = path.parse(imagePath).name;
  const results = [];
  for (const deg of degreesList) {
    const sign = deg >= 0 ? `+${deg}` : String(deg);
    const outPath = path.join(outputDir, `${stem}_hue${sign}.png`);
    results.push(await hueShift(imagePath, outPath, deg));
  }
  return results;
}

module.exports = {
  makeSeamless,
  previewTile,
  hueShift,
  makeVariants,
};
