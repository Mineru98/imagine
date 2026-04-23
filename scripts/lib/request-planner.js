'use strict';

const { parseArgs } = require('./args.js');

const SIZE_ENUM = ['1024x1024', '1024x1536', '1536x1024'];
const QUALITY_ENUM = ['low', 'medium', 'high'];
const FORMAT_ENUM = ['png', 'jpeg', 'webp'];

const SCHEMA = {
  prompt: { type: 'string', required: true },
  n: { type: 'number', default: 1 },
  size: { type: 'string', default: '1024x1024', enum: SIZE_ENUM },
  quality: { type: 'string', default: 'medium', enum: QUALITY_ENUM },
  format: { type: 'string', default: 'png', enum: FORMAT_ENUM },
  outDir: { type: 'string', default: './images' },
};

function enforceN(value) {
  if (!Number.isInteger(value) || value < 1 || value > 8) {
    console.error(`Error: --n must be an integer in [1, 8] (got "${value}")`);
    process.exit(1);
  }
  return value;
}

function plan(rawArgs) {
  const parsed = Array.isArray(rawArgs) ? parseArgs(rawArgs, SCHEMA) : { ...rawArgs };

  if (!Array.isArray(rawArgs)) {
    for (const key of ['size', 'quality', 'format']) {
      if (parsed[key] === undefined) parsed[key] = SCHEMA[key].default;
      const allowed = SCHEMA[key].enum;
      if (!allowed.includes(parsed[key])) {
        console.error(`Error: --${key} must be one of [${allowed.join(', ')}] (got "${parsed[key]}")`);
        process.exit(1);
      }
    }
    if (parsed.n === undefined) parsed.n = SCHEMA.n.default;
    if (parsed.outDir === undefined) parsed.outDir = SCHEMA.outDir.default;
    if (parsed.prompt === undefined || parsed.prompt === '') {
      console.error('Error: missing required field "prompt"');
      process.exit(1);
    }
  }

  const n = enforceN(parsed.n);
  const warnings = [];
  if (n >= 4 && parsed.quality === 'high') {
    warnings.push(`High-quality batch of ${n} images will be slow and consume more credits.`);
  }

  return {
    prompt: parsed.prompt,
    n,
    size: parsed.size,
    quality: parsed.quality,
    format: parsed.format,
    outDir: parsed.outDir,
    warnings,
  };
}

module.exports = { plan };
