'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MAX_EDGE = 2048;
const CACHE_DIR = path.join('.cache', 'image-to-code');

function loadSharp() {
  try {
    return require('sharp');
  } catch {
    return null;
  }
}

function hashFile(filePath) {
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(filePath));
  return h.digest('hex').slice(0, 16);
}

async function normalize(imagePath) {
  if (typeof imagePath !== 'string' || imagePath.length === 0) {
    throw new Error('normalize: imagePath must be a non-empty string');
  }
  const originalPath = path.resolve(imagePath);
  if (!fs.existsSync(originalPath)) {
    throw new Error(`normalize: input image not found: ${originalPath}`);
  }

  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const hash = hashFile(originalPath);
  const sharp = loadSharp();

  if (!sharp) {
    const ext = path.extname(originalPath) || '.bin';
    const fallbackPath = path.resolve(CACHE_DIR, `${hash}${ext}`);
    if (!fs.existsSync(fallbackPath)) {
      fs.copyFileSync(originalPath, fallbackPath);
    }
    console.warn(
      'input-normalizer: optional dependency "sharp" not installed — skipping PNG conversion and resize; using original image as-is.',
    );
    return { normalizedPath: fallbackPath, originalPath, wasResized: false };
  }

  const meta = await sharp(originalPath).metadata();
  const width = meta.width || 0;
  const height = meta.height || 0;
  const needsResize = Math.max(width, height) > MAX_EDGE;

  const tag = needsResize ? `${hash}_r${MAX_EDGE}` : hash;
  const normalizedPath = path.resolve(CACHE_DIR, `${tag}.png`);

  if (!fs.existsSync(normalizedPath)) {
    let pipeline = sharp(originalPath).rotate();
    if (needsResize) {
      pipeline = pipeline.resize({
        width: width >= height ? MAX_EDGE : null,
        height: height > width ? MAX_EDGE : null,
        fit: 'inside',
        withoutEnlargement: true,
      });
    }
    await pipeline.png().toFile(normalizedPath);
  }

  return { normalizedPath, originalPath, wasResized: needsResize };
}

module.exports = { normalize, MAX_EDGE, CACHE_DIR };
