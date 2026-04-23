'use strict';

const fs = require('fs');
const path = require('path');

const AXES = {
  composition: ['wide establishing shot', 'tight close-up framing'],
  lighting: ['soft diffused lighting', 'dramatic high-contrast lighting'],
  style: ['photorealistic rendering', 'illustrated stylized rendering'],
};

// Four corners of the 2^3 cube chosen so every axis value appears at least twice.
const VARIANT_MATRIX = [
  { composition: 0, lighting: 0, style: 0 },
  { composition: 1, lighting: 1, style: 0 },
  { composition: 0, lighting: 1, style: 1 },
  { composition: 1, lighting: 0, style: 1 },
];

function axisDiff(pick) {
  const labels = {
    composition: { 0: 'wide', 1: 'tight' },
    lighting: { 0: 'soft', 1: 'dramatic' },
    style: { 0: 'realistic', 1: 'illustrated' },
  };
  return `${labels.composition[pick.composition]} / ${labels.lighting[pick.lighting]} / ${labels.style[pick.style]}`;
}

function renderVariant(basePrompt, pick) {
  const tags = [
    AXES.composition[pick.composition],
    AXES.lighting[pick.lighting],
    AXES.style[pick.style],
  ];
  return `${basePrompt}. ${tags.join(', ')}`;
}

// Only activate when caller has explicitly opted in via `--explore`.
// This helper is exposed so scripts gate calls to explore() cleanly.
function isExploreRequested(argv) {
  return Array.isArray(argv) && argv.includes('--explore');
}

function explore(basePrompt, plan = {}, options = {}) {
  if (typeof basePrompt !== 'string' || basePrompt.length === 0) {
    throw new Error('explore: basePrompt must be a non-empty string');
  }

  const variants = VARIANT_MATRIX.map((pick, idx) => ({
    index: idx,
    prompt: renderVariant(basePrompt, pick),
    summary: axisDiff(pick),
    axes: {
      composition: AXES.composition[pick.composition],
      lighting: AXES.lighting[pick.lighting],
      style: AXES.style[pick.style],
    },
  }));

  const isSufficient =
    variants.length === 4 &&
    new Set(variants.map((v) => v.prompt)).size === 4;

  if (isSufficient || typeof options.llmFallback !== 'function') {
    return variants;
  }

  // Template produced duplicates or was rejected by the caller's heuristic;
  // hand off to an LLM-backed fallback exactly once. The fallback must return
  // an array of 4 { prompt, summary } objects.
  const fallback = options.llmFallback(basePrompt, plan);
  if (!Array.isArray(fallback) || fallback.length !== 4) {
    return variants;
  }
  return fallback.map((entry, idx) => ({
    index: idx,
    prompt: String(entry.prompt || ''),
    summary: String(entry.summary || ''),
    axes: entry.axes || null,
  }));
}

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function saveVariants(outputs, baseDir) {
  if (!Array.isArray(outputs) || outputs.length === 0) {
    throw new Error('saveVariants: outputs must be a non-empty array');
  }
  if (typeof baseDir !== 'string' || baseDir.length === 0) {
    throw new Error('saveVariants: baseDir must be a non-empty string');
  }

  const ts = timestamp();
  const dir = path.resolve(baseDir, 'variants', ts);
  fs.mkdirSync(dir, { recursive: true });

  const saved = [];
  outputs.forEach((item, idx) => {
    if (!item || (!item.buffer && !item.data)) {
      throw new Error(`saveVariants: output[${idx}] missing buffer/data`);
    }
    const ext = (item.ext || 'png').replace(/^\./, '');
    const filename = `variant_${String(idx + 1).padStart(2, '0')}.${ext}`;
    const full = path.join(dir, filename);
    fs.writeFileSync(full, item.buffer || item.data);
    saved.push({
      path: full,
      summary: item.summary || '',
    });
  });

  return { dir, files: saved };
}

module.exports = {
  AXES,
  explore,
  saveVariants,
  isExploreRequested,
};
