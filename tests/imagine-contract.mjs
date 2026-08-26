#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateImage } from "../skills/imagine/scripts/verify.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temp = await mkdtemp(path.join(os.tmpdir(), "imagine-contract-"));
const validPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

async function run(script, args) {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { cwd: root });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

try {
  const goodPath = path.join(temp, "good.png");
  const badPath = path.join(temp, "bad.png");
  await writeFile(goodPath, validPng);
  await writeFile(badPath, validPng.subarray(0, validPng.length - 8));

  const good = await validateImage(goodPath);
  assert.equal(good.valid, true, "valid PNG should pass all structural checks");
  assert.equal(good.checks.iendPresent, true);
  assert.equal(good.checks.complete, true);

  const bad = await validateImage(badPath);
  assert.equal(bad.valid, false, "truncated PNG must fail closed");
  assert.equal(bad.checks.complete, false);

  const format = await run("skills/imagine/scripts/generate.js", ["--prompt", "cat", "--format", "jpeg"]);
  assert.notEqual(format.code, 0);
  assert.match(format.stdout + format.stderr, /Only PNG output is supported/);

  const defaultRoute = await run("skills/imagine/scripts/generate.js", ["--prompt", "cat"]);
  assert.notEqual(defaultRoute.code, 0);
  assert.match(defaultRoute.stdout + defaultRoute.stderr, /legacy OAuth proxy is disabled/);

  const unknown = await run("skills/imagine/scripts/generate.js", ["--prompt", "cat", "--unknown", "x"]);
  assert.notEqual(unknown.code, 0);
  assert.match(unknown.stdout + unknown.stderr, /Unknown option/);

  const generated = await readFile(path.join(root, "skills/imagine/scripts/generate.js"), "utf8");
  const edited = await readFile(path.join(root, "skills/imagine/scripts/edit.js"), "utf8");
  assert.equal(generated.includes("kill -9"), false);
  assert.equal(edited.includes("kill -9"), false);
  assert.equal(generated.includes("auth.json"), false);
  assert.equal(edited.includes("auth.json"), false);

  console.log("imagine contract checks passed");
} finally {
  await rm(temp, { recursive: true, force: true });
}
