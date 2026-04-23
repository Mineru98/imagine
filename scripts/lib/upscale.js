'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ── Contract ────────────────────────────────────────────────────────────────
// upscale(imagePath, targetSize, outputPath, options?) → Promise<result>
//   imagePath:  source image (usually 1024-class).
//   targetSize: integer long-edge in pixels (e.g. 3000). Aspect preserved.
//   outputPath: final file path. Extension drives the encoder (png/jpg/jpeg).
//
//   options = {
//     engine?:     'lanczos3' | 'real-esrgan' | 'auto'  // default 'auto'
//     esrganCli?:  string                                // override binary path
//     esrganArgs?: string[]                              // extra CLI args
//     jpegQuality?: number                               // default 92
//     background?: string                                // pad color (if fit mismatches)
//   }
//
//   result = {
//     ok: boolean,
//     engine: 'lanczos3' | 'real-esrgan',
//     outputPath: string,
//     reason?: string,        // set when we fell back from esrgan → lanczos
//     dimensions: { width, height },
//   }
//
// Engine policy:
//   - Default path is sharp Lanczos3 — zero external binaries, deterministic.
//   - Power users can opt in with `engine: 'real-esrgan'`. The module shells
//     out to a user-provided CLI (`realesrgan-ncnn-vulkan` or `realesrgan-cli`
//     style) through execSync with explicit args. If the binary is missing or
//     returns non-zero, the module **falls back to Lanczos3** and records the
//     reason. It never silently claims upscale success when the external tool
//     failed.
// ────────────────────────────────────────────────────────────────────────────

const SUPPORTED_EXT = new Set(['.png', '.jpg', '.jpeg']);

function tryRequire(mod) {
  try { return require(mod); } catch { return null; }
}

async function upscaleWithSharp(sharp, imagePath, targetSize, outputPath, options) {
  const meta = await sharp(imagePath).metadata();
  const srcW = meta.width || 0;
  const srcH = meta.height || 0;
  const maxEdge = Math.max(srcW, srcH);
  if (maxEdge === 0) throw new Error('upscale: could not read source dimensions');

  const scale = targetSize / maxEdge;
  const outW = Math.round(srcW * scale);
  const outH = Math.round(srcH * scale);

  const ext = path.extname(outputPath).toLowerCase();
  let pipeline = sharp(imagePath).resize(outW, outH, {
    kernel: 'lanczos3',
    fit: 'fill',
    withoutEnlargement: false,
  });

  if (ext === '.png') {
    pipeline = pipeline.png({ compressionLevel: 9 });
  } else {
    const quality = typeof options.jpegQuality === 'number' ? options.jpegQuality : 92;
    pipeline = pipeline.jpeg({ quality, chromaSubsampling: '4:4:4', mozjpeg: true }).flatten({ background: options.background || '#ffffff' });
  }

  await pipeline.toFile(outputPath);
  return { width: outW, height: outH };
}

function tryRealEsrgan(imagePath, outputPath, options) {
  const cli = options.esrganCli || 'realesrgan-ncnn-vulkan';
  const args = Array.isArray(options.esrganArgs) && options.esrganArgs.length
    ? options.esrganArgs
    : ['-i', path.resolve(imagePath), '-o', path.resolve(outputPath), '-n', 'realesrgan-x4plus'];
  const result = spawnSync(cli, args, { stdio: 'pipe', encoding: 'utf8' });
  if (result.error || typeof result.status !== 'number' || result.status !== 0) {
    const reason = result.error
      ? `esrgan_spawn_error:${result.error.code || result.error.message}`
      : `esrgan_exit_${result.status}`;
    return { ok: false, reason };
  }
  if (!fs.existsSync(outputPath)) {
    return { ok: false, reason: 'esrgan_missing_output' };
  }
  return { ok: true };
}

async function upscale(imagePath, targetSize, outputPath, options = {}) {
  if (typeof imagePath !== 'string' || !fs.existsSync(imagePath)) {
    throw new Error(`upscale: input image not found: ${imagePath}`);
  }
  if (!Number.isInteger(targetSize) || targetSize < 64 || targetSize > 16384) {
    throw new Error(`upscale: targetSize must be an integer in [64, 16384] (got ${targetSize})`);
  }
  if (typeof outputPath !== 'string' || outputPath.length === 0) {
    throw new Error('upscale: outputPath required');
  }
  const ext = path.extname(outputPath).toLowerCase();
  if (!SUPPORTED_EXT.has(ext)) {
    throw new Error(`upscale: unsupported output extension "${ext}"; use .png / .jpg / .jpeg`);
  }
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });

  const sharp = tryRequire('sharp');
  if (!sharp) {
    throw new Error('upscale: "sharp" is required. Install it with `npm i sharp`.');
  }

  const engine = options.engine || 'auto';
  const warnings = [];

  if (engine === 'real-esrgan' || engine === 'auto' && options.esrganCli) {
    const r = tryRealEsrgan(imagePath, outputPath, options);
    if (r.ok) {
      // Esrgan wrote the file directly; re-read dimensions for the report.
      const meta = await sharp(outputPath).metadata();
      return {
        ok: true,
        engine: 'real-esrgan',
        outputPath: path.resolve(outputPath),
        dimensions: { width: meta.width || 0, height: meta.height || 0 },
      };
    }
    console.warn(`upscale: Real-ESRGAN failed (${r.reason}); falling back to Lanczos3.`);
    warnings.push(r.reason);
    if (engine === 'real-esrgan' && options.strictEngine) {
      return { ok: false, engine: 'real-esrgan', outputPath: null, reason: r.reason };
    }
  }

  const dimensions = await upscaleWithSharp(sharp, imagePath, targetSize, outputPath, options);
  return {
    ok: true,
    engine: 'lanczos3',
    outputPath: path.resolve(outputPath),
    dimensions,
    reason: warnings[0],
  };
}

module.exports = { upscale };
