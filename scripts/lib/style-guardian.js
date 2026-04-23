'use strict';

const fs = require('fs');
const path = require('path');

const STYLE_KEYS = [
  'palette',
  'art_style',
  'corner_radius_estimate',
  'lighting',
  'composition',
  'texture',
  'mood',
];

// Auto-invocation trigger points (detection itself happens upstream in the agent layer):
//   - CLI flag: `--keep`
//   - Natural language cues (ko): "방금 거랑 비슷하게", "저번 거랑 같은 스타일", "같은 톤으로"
//   - Natural language cues (en): "same style as before", "keep the style"
// When any of these match, the caller should load the most recent manifest and
// pass the returned tokens through buildStylePrefix(). This module stays pure
// data access; it does NOT sniff argv or user text on its own.

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function loadStyle(manifestPath) {
  if (typeof manifestPath !== 'string' || manifestPath.length === 0) {
    throw new Error('loadStyle: manifestPath must be a non-empty string');
  }
  if (!fs.existsSync(manifestPath)) return {};
  const manifest = readJson(manifestPath);
  const source = manifest.style && typeof manifest.style === 'object' ? manifest.style : manifest;
  const tokens = {};
  for (const key of STYLE_KEYS) {
    if (source[key] !== undefined && source[key] !== null && source[key] !== '') {
      tokens[key] = source[key];
    }
  }
  return tokens;
}

function formatValue(value) {
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}

function buildStylePrefix(tokens) {
  if (!tokens || typeof tokens !== 'object') return '';
  const parts = [];
  for (const key of STYLE_KEYS) {
    if (tokens[key] === undefined || tokens[key] === null || tokens[key] === '') continue;
    const label = key.replace(/_/g, ' ');
    parts.push(`${label}: ${formatValue(tokens[key])}`);
  }
  if (parts.length === 0) return '';
  return `[style continuity — ${parts.join('; ')}]`;
}

function saveStyle(manifestPath, tokens) {
  if (typeof manifestPath !== 'string' || manifestPath.length === 0) {
    throw new Error('saveStyle: manifestPath must be a non-empty string');
  }
  if (!tokens || typeof tokens !== 'object') {
    throw new Error('saveStyle: tokens must be an object');
  }
  let manifest = {};
  if (fs.existsSync(manifestPath)) {
    try {
      manifest = readJson(manifestPath);
    } catch {
      manifest = {};
    }
  }
  const existingStyle = manifest.style && typeof manifest.style === 'object' ? manifest.style : {};
  const merged = { ...existingStyle };
  for (const key of STYLE_KEYS) {
    if (tokens[key] !== undefined) merged[key] = tokens[key];
  }
  manifest.style = merged;
  writeJson(manifestPath, manifest);
  return merged;
}

module.exports = {
  STYLE_KEYS,
  loadStyle,
  buildStylePrefix,
  saveStyle,
};
