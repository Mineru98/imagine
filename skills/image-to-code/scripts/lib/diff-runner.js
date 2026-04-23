'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const THRESHOLDS = { pass: 0.80, warn: 0.65 };

function tryRequire(mod) {
  try {
    return require(mod);
  } catch {
    return null;
  }
}

function cropTopLeft(png, w, h) {
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    const srcStart = png.width * y * 4;
    png.data.copy(out, w * y * 4, srcStart, srcStart + w * 4);
  }
  return { data: out, width: w, height: h };
}

function extractHotspots(diffPng, w, h) {
  const GRID = 4;
  const cw = Math.floor(w / GRID);
  const ch = Math.floor(h / GRID);
  if (cw === 0 || ch === 0) return [];
  const cells = [];
  for (let gy = 0; gy < GRID; gy++) {
    for (let gx = 0; gx < GRID; gx++) {
      let diffCount = 0;
      for (let y = 0; y < ch; y++) {
        const rowStart = ((gy * ch + y) * w + gx * cw) * 4;
        for (let x = 0; x < cw; x++) {
          const idx = rowStart + x * 4;
          if (diffPng.data[idx] !== 0 || diffPng.data[idx + 1] !== 0 || diffPng.data[idx + 2] !== 0) {
            diffCount++;
          }
        }
      }
      const ratio = diffCount / (cw * ch);
      if (ratio > 0.15) {
        cells.push({
          grid: { x: gx, y: gy },
          bbox: { x: gx / GRID, y: gy / GRID, w: 1 / GRID, h: 1 / GRID },
          diff_ratio: Number(ratio.toFixed(3)),
        });
      }
    }
  }
  return cells;
}

async function runDiff(htmlPath, originalImagePath, options = {}) {
  if (typeof htmlPath !== 'string' || htmlPath.length === 0) {
    throw new Error('runDiff: htmlPath must be a non-empty string');
  }
  if (typeof originalImagePath !== 'string' || originalImagePath.length === 0) {
    throw new Error('runDiff: originalImagePath must be a non-empty string');
  }
  if (!fs.existsSync(htmlPath)) {
    throw new Error(`runDiff: html not found: ${htmlPath}`);
  }
  if (!fs.existsSync(originalImagePath)) {
    throw new Error(`runDiff: original image not found: ${originalImagePath}`);
  }

  const playwright = tryRequire('playwright');
  if (!playwright || !playwright.chromium) {
    console.warn('diff-runner: Playwright not installed — skipping visual verification. Install "playwright" + "playwright install chromium" to enable.');
    return { skipped: true, reason: 'playwright_not_installed' };
  }

  const pixelmatch = tryRequire('pixelmatch');
  const pngjs = tryRequire('pngjs');
  const ssimLib = tryRequire('ssim.js');
  const PNG = pngjs && pngjs.PNG;

  const canPixelmatch = typeof pixelmatch === 'function' && PNG;
  const canSsim = ssimLib && (typeof ssimLib.ssim === 'function' || typeof ssimLib === 'function');

  if (!canPixelmatch && !canSsim) {
    console.warn('diff-runner: Neither "pixelmatch" nor "ssim.js" installed — cannot score diff.');
    return { skipped: true, reason: 'scorer_not_installed' };
  }

  const viewport = options.viewport || { width: 1280, height: 800 };
  const browser = await playwright.chromium.launch();
  let ssim = null;
  let pixelScore = null;
  let hotspots = [];

  try {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    await page.goto(pathToFileURL(path.resolve(htmlPath)).toString(), { waitUntil: 'networkidle' });
    const renderedBuf = await page.screenshot({ fullPage: true, type: 'png' });

    if (PNG) {
      const originalPng = PNG.sync.read(fs.readFileSync(originalImagePath));
      const renderedPng = PNG.sync.read(renderedBuf);
      const W = Math.min(originalPng.width, renderedPng.width);
      const H = Math.min(originalPng.height, renderedPng.height);
      const origCrop = cropTopLeft(originalPng, W, H);
      const rendCrop = cropTopLeft(renderedPng, W, H);

      if (canPixelmatch) {
        const diffPng = new PNG({ width: W, height: H });
        const mismatched = pixelmatch(origCrop.data, rendCrop.data, diffPng.data, W, H, { threshold: 0.1 });
        pixelScore = 1 - mismatched / (W * H);
        hotspots = extractHotspots(diffPng, W, H);
      }

      if (canSsim) {
        const ssimFn = typeof ssimLib.ssim === 'function' ? ssimLib.ssim : ssimLib;
        const result = ssimFn(
          { data: origCrop.data, width: W, height: H },
          { data: rendCrop.data, width: W, height: H },
        );
        ssim = typeof result === 'number' ? result : (result && (result.mssim ?? result.score)) ?? null;
      }
    }
  } finally {
    await browser.close();
  }

  const referenceScore = ssim !== null ? ssim : pixelScore;
  const pass = typeof referenceScore === 'number' && referenceScore >= THRESHOLDS.pass;

  return {
    pass,
    ssim,
    pixelScore,
    hotspots: pass ? [] : hotspots,
  };
}

module.exports = { runDiff, THRESHOLDS };
