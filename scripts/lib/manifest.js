'use strict';

const SENSITIVE_KEYS = new Set([
  'auth',
  'authorization',
  'token',
  'access_token',
  'refresh_token',
  'api_key',
  'apikey',
  'secret',
  'password',
  'stderr',
  'raw_stderr',
  'image_base64',
  'imageBase64',
  'base64',
  'b64_json',
  'image_data',
]);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeParams(value) {
  if (Array.isArray(value)) {
    return value.map(sanitizeParams);
  }
  if (isPlainObject(value)) {
    const result = {};
    for (const [key, val] of Object.entries(value)) {
      if (SENSITIVE_KEYS.has(key.toLowerCase())) continue;
      result[key] = sanitizeParams(val);
    }
    return result;
  }
  return value;
}

function createManifest(skillName, params) {
  return {
    skill: skillName,
    ts: new Date().toISOString(),
    params: sanitizeParams(params || {}),
    outputs: [],
  };
}

function addOutput(manifest, filePath) {
  if (!manifest || !Array.isArray(manifest.outputs)) {
    throw new Error('addOutput: invalid manifest');
  }
  if (typeof filePath !== 'string' || filePath.length === 0) {
    throw new Error('addOutput: filePath must be a non-empty string');
  }
  manifest.outputs.push(filePath);
  return manifest;
}

module.exports = { createManifest, addOutput };
