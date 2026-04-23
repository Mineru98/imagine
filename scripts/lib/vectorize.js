'use strict';

const fs = require('fs');
const path = require('path');

// ── Contract ────────────────────────────────────────────────────────────────
// vectorize(imagePath, outputSvgPath, options?) → Promise<result>
//   result = {
//     ok:        boolean,
//     mode:      'svg' | 'passthrough',
//     outputPath: string,          // svg path on success, original png copy on passthrough
//     engine?:   'potrace',
//     reason?:   'potrace_not_installed' | 'runtime_error' | 'input_assumptions_violated'
//   }
//
// Assumptions on input image (documented for the caller):
//   - PNG, 1:1 square preferred.
//   - FLAT colors, BOLD edges, NO gradient. Anti-aliased soft edges and
//     gradients will produce ragged vector output.
// If potrace is not installed OR tracing throws, the module emits a console
// warning and returns `mode: 'passthrough'` with the original PNG copied to
// a sibling path (never deletes or overwrites the source).
// ────────────────────────────────────────────────────────────────────────────

function tryRequire(mod) {
  try { return require(mod); } catch { return null; }
}

function fallbackToPassthrough(imagePath, outputSvgPath, reason) {
  const fallbackPath = outputSvgPath.replace(/\.svg$/i, '.png');
  const absFallback = path.resolve(fallbackPath);
  fs.mkdirSync(path.dirname(absFallback), { recursive: true });
  if (path.resolve(imagePath) !== absFallback) {
    fs.copyFileSync(imagePath, absFallback);
  }
  return { ok: false, mode: 'passthrough', outputPath: absFallback, reason };
}

function runPotrace(potrace, imagePath, options) {
  return new Promise((resolve, reject) => {
    const fn = typeof potrace.trace === 'function' ? potrace.trace : potrace;
    fn(imagePath, options, (err, svg) => {
      if (err) return reject(err);
      resolve(svg);
    });
  });
}

async function vectorize(imagePath, outputSvgPath, options = {}) {
  if (typeof imagePath !== 'string' || imagePath.length === 0) {
    throw new Error('vectorize: imagePath must be a non-empty string');
  }
  if (!fs.existsSync(imagePath)) {
    throw new Error(`vectorize: input image not found: ${imagePath}`);
  }
  if (typeof outputSvgPath !== 'string' || outputSvgPath.length === 0) {
    throw new Error('vectorize: outputSvgPath required');
  }
  if (path.resolve(imagePath) === path.resolve(outputSvgPath)) {
    throw new Error('vectorize: outputSvgPath must differ from imagePath');
  }

  const potrace = tryRequire('potrace');
  if (!potrace || !(typeof potrace.trace === 'function' || typeof potrace === 'function')) {
    console.warn('vectorize: optional dependency "potrace" not installed — falling back to PNG passthrough. Install `potrace` to enable SVG tracing.');
    return fallbackToPassthrough(imagePath, outputSvgPath, 'potrace_not_installed');
  }

  const traceOptions = {
    threshold: typeof options.threshold === 'number' ? options.threshold : 170,
    turdSize: typeof options.turdSize === 'number' ? options.turdSize : 2,
    optCurve: options.optCurve !== false,
    optTolerance: typeof options.optTolerance === 'number' ? options.optTolerance : 0.2,
    color: options.color || 'auto',
    background: options.background || 'transparent',
  };

  try {
    const svg = await runPotrace(potrace, path.resolve(imagePath), traceOptions);
    if (typeof svg !== 'string' || svg.length === 0) {
      throw new Error('potrace returned empty SVG');
    }
    const absOut = path.resolve(outputSvgPath);
    fs.mkdirSync(path.dirname(absOut), { recursive: true });
    fs.writeFileSync(absOut, svg, 'utf8');
    return { ok: true, mode: 'svg', outputPath: absOut, engine: 'potrace' };
  } catch (err) {
    console.warn(`vectorize: tracing failed (${err && err.message ? err.message : err}) — falling back to PNG passthrough. The input may violate the 'flat, bold edges, no gradient' assumption.`);
    return fallbackToPassthrough(imagePath, outputSvgPath, 'runtime_error');
  }
}

module.exports = { vectorize };
