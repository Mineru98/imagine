'use strict';

// ── Run Manifest (imagine + image-to-code) ──────────────────────────────────
// Shape returned by createManifest(skillName, params):
//   {
//     skill:        'imagine' | 'imagine-thumb' | 'imagine-og' | 'image-to-code' | …
//     ts:           ISO-8601 string
//     params:       sanitized clone of the user-supplied params
//     outputs:      string[]          // absolute or project-relative file paths
//     agent_tokens: { [agent]: { input, output, total } }   // per-agent usage
//     diff_score:   number | null     // image-to-code visual verifier SSIM (0..1)
//     warnings:     string[]
//   }
//
// ⚠️ DO NOT record any of the following anywhere in this object:
//   - OAuth tokens, access_token, refresh_token, API keys, passwords, secrets
//   - Full `~/.codex/auth.json` path or its contents
//   - User image original bytes or base64 (any form of image payload)
//   - Raw stderr buffers from spawned subprocesses
// The SENSITIVE_KEYS whitelist below is enforced recursively on `params`.
// Additional manifest helpers (addAgentTokens, setDiffScore, addWarning) go
// through the same sanitizer so callers cannot slip a forbidden field in.
// ────────────────────────────────────────────────────────────────────────────

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
  'image_bytes',
  'file_contents',
  'auth_json_path',
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
  if (typeof skillName !== 'string' || skillName.length === 0) {
    throw new Error('createManifest: skillName (string) required');
  }
  return {
    skill: skillName,
    ts: new Date().toISOString(),
    params: sanitizeParams(params || {}),
    outputs: [],
    agent_tokens: {},
    diff_score: null,
    warnings: [],
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

function addAgentTokens(manifest, agentName, usage) {
  if (!manifest || typeof manifest.agent_tokens !== 'object') {
    throw new Error('addAgentTokens: invalid manifest');
  }
  if (typeof agentName !== 'string' || agentName.length === 0) {
    throw new Error('addAgentTokens: agentName required');
  }
  const clean = sanitizeParams(usage || {});
  const input = Number(clean.input || clean.prompt || 0) || 0;
  const output = Number(clean.output || clean.completion || 0) || 0;
  const existing = manifest.agent_tokens[agentName] || { input: 0, output: 0, total: 0 };
  const merged = {
    input: existing.input + input,
    output: existing.output + output,
    total: existing.input + input + existing.output + output,
  };
  manifest.agent_tokens[agentName] = merged;
  return manifest;
}

function setDiffScore(manifest, score) {
  if (!manifest) throw new Error('setDiffScore: invalid manifest');
  if (score === null || score === undefined) {
    manifest.diff_score = null;
    return manifest;
  }
  const n = Number(score);
  if (!Number.isFinite(n) || n < 0 || n > 1) {
    throw new Error(`setDiffScore: score must be a number in [0, 1] (got ${score})`);
  }
  manifest.diff_score = n;
  return manifest;
}

function addWarning(manifest, message) {
  if (!manifest || !Array.isArray(manifest.warnings)) {
    throw new Error('addWarning: invalid manifest');
  }
  if (typeof message !== 'string' || message.length === 0) {
    throw new Error('addWarning: message required');
  }
  manifest.warnings.push(message);
  return manifest;
}

module.exports = {
  createManifest,
  addOutput,
  addAgentTokens,
  setDiffScore,
  addWarning,
  SENSITIVE_KEYS,
};
