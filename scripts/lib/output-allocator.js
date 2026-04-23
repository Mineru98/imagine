'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function ensureInsideDir(dir, targetAbs) {
  const rootAbs = path.resolve(dir);
  const relative = path.relative(rootAbs, targetAbs);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`path escape detected: "${targetAbs}" is not inside "${rootAbs}"`);
  }
}

function allocate(outDir, basename, ext) {
  if (typeof outDir !== 'string' || outDir.length === 0) {
    throw new Error('allocate: outDir must be a non-empty string');
  }
  if (typeof basename !== 'string' || basename.length === 0) {
    throw new Error('allocate: basename must be a non-empty string');
  }
  if (typeof ext !== 'string' || ext.length === 0) {
    throw new Error('allocate: ext must be a non-empty string');
  }

  const outDirAbs = path.resolve(outDir);
  const finalTarget = path.resolve(outDirAbs, basename);
  ensureInsideDir(outDirAbs, finalTarget);

  fs.mkdirSync(outDirAbs, { recursive: true });

  const ts = Date.now();
  const suffix = crypto.randomBytes(4).toString('hex');
  const cleanExt = ext.startsWith('.') ? ext.slice(1) : ext;
  const tempName = `.tmp_${ts}_${suffix}.${cleanExt}`;
  const tempPath = path.join(outDirAbs, tempName);
  ensureInsideDir(outDirAbs, tempPath);
  return tempPath;
}

function commit(tempPath, finalPath) {
  if (typeof tempPath !== 'string' || typeof finalPath !== 'string') {
    throw new Error('commit: tempPath and finalPath must be strings');
  }
  if (!fs.existsSync(tempPath)) {
    throw new Error(`commit: temp file not found: ${tempPath}`);
  }
  if (fs.existsSync(finalPath)) {
    throw new Error(`commit: refusing to overwrite existing file: ${finalPath}`);
  }
  fs.mkdirSync(path.dirname(finalPath), { recursive: true });
  fs.renameSync(tempPath, finalPath);
  return finalPath;
}

function abort(tempPath) {
  if (typeof tempPath !== 'string' || tempPath.length === 0) return false;
  try {
    fs.unlinkSync(tempPath);
    return true;
  } catch (err) {
    if (err && err.code === 'ENOENT') return false;
    throw err;
  }
}

module.exports = { allocate, commit, abort };
