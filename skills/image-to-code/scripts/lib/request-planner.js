'use strict';

const path = require('path');

const DEFAULTS = {
  out: null,
  strict: false,
  explore: false,
  mobile: false,
};

function coerceBool(value, key) {
  if (value === undefined || value === null) return false;
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  throw new Error(`request-planner: --${key} must be a boolean (got ${JSON.stringify(value)})`);
}

function plan(flags, config) {
  const raw = flags && typeof flags === 'object' ? flags : {};

  const out = raw.out === undefined || raw.out === null ? DEFAULTS.out : String(raw.out);
  if (out !== null && out.length === 0) {
    throw new Error('request-planner: --out must be a non-empty string when provided');
  }

  const strict = coerceBool(raw.strict, 'strict');
  const explore = coerceBool(raw.explore, 'explore');
  const mobile = coerceBool(raw.mobile, 'mobile');

  if (strict && explore) {
    throw new Error(
      'request-planner: --strict and --explore are mutually exclusive (strict wants a single tight match; explore wants multiple alternatives).',
    );
  }

  const diffThreshold = strict ? 0.9 : (config && typeof config.diff_threshold === 'number' ? config.diff_threshold : 0.8);
  const outputDir = out !== null ? out : (config && config.output_dir) || './pages';

  return {
    out: out,
    outputDir,
    strict,
    explore,
    mobile,
    diffThreshold,
    viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 },
  };
}

function resolveOut(outputDir, slug) {
  if (!slug) throw new Error('resolveOut: slug required');
  return path.resolve(outputDir, slug);
}

module.exports = { plan, resolveOut, DEFAULTS };
