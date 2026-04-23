'use strict';

const fs = require('fs');
const path = require('path');

// ── Contract ────────────────────────────────────────────────────────────────
// removeBackground(imagePath, outputPath, options?) → Promise<result>
//   result = {
//     ok:       boolean,
//     outputPath: string,   // final path the caller should read
//     mode:      'cutout' | 'passthrough',
//     reason?:   string,    // populated when mode === 'passthrough'
//     engine?:   string     // e.g. '@imgly/background-removal-node'
//   }
//
// Behavior:
//   - If `@imgly/background-removal-node` is installed, run it and write a
//     transparent-background PNG to outputPath.
//   - If the library is missing OR cutout fails at runtime, emit a console
//     warning, leave the original file intact, copy it to outputPath
//     unchanged, and return mode='passthrough' with reason filled in.
//   - This module NEVER deletes or overwrites the input image.
// ────────────────────────────────────────────────────────────────────────────

function tryRequire(mod) {
  try { return require(mod); } catch { return null; }
}

async function removeBackground(imagePath, outputPath, options = {}) {
  if (typeof imagePath !== 'string' || imagePath.length === 0) {
    throw new Error('removeBackground: imagePath must be a non-empty string');
  }
  if (!fs.existsSync(imagePath)) {
    throw new Error(`removeBackground: input image not found: ${imagePath}`);
  }
  if (typeof outputPath !== 'string' || outputPath.length === 0) {
    throw new Error('removeBackground: outputPath required');
  }
  const absInput = path.resolve(imagePath);
  const absOutput = path.resolve(outputPath);
  if (absInput === absOutput) {
    throw new Error('removeBackground: outputPath must differ from imagePath (never overwrite original)');
  }
  fs.mkdirSync(path.dirname(absOutput), { recursive: true });

  const libName = options.engine || '@imgly/background-removal-node';
  const lib = tryRequire(libName);

  if (!lib || typeof lib.removeBackground !== 'function') {
    console.warn(`bg-remove: optional dependency "${libName}" not installed — returning original image as passthrough. Install it for true cutouts.`);
    fs.copyFileSync(absInput, absOutput);
    return {
      ok: false,
      outputPath: absOutput,
      mode: 'passthrough',
      reason: 'library_not_installed',
    };
  }

  try {
    const inputBuffer = fs.readFileSync(absInput);
    const blob = await lib.removeBackground(inputBuffer, options.config || undefined);
    const outBuffer = blob && typeof blob.arrayBuffer === 'function'
      ? Buffer.from(await blob.arrayBuffer())
      : Buffer.isBuffer(blob) ? blob : null;
    if (!outBuffer || outBuffer.length === 0) {
      throw new Error('background removal returned empty output');
    }
    fs.writeFileSync(absOutput, outBuffer);
    return {
      ok: true,
      outputPath: absOutput,
      mode: 'cutout',
      engine: libName,
    };
  } catch (err) {
    console.warn(`bg-remove: cutout failed (${err && err.message ? err.message : err}) — falling back to original image. Original file preserved.`);
    fs.copyFileSync(absInput, absOutput);
    return {
      ok: false,
      outputPath: absOutput,
      mode: 'passthrough',
      reason: 'runtime_error',
    };
  }
}

module.exports = { removeBackground };
