#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildInstruction } from "../skills/imagine/scripts/codex-backend.js";
import { validateImage } from "../skills/imagine/scripts/verify.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temp = await mkdtemp(path.join(os.tmpdir(), "imagine-contract-"));
const validPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

async function run(script, args, env = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { cwd: root, env: { ...process.env, ...env } });
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

  // Codex CLI 가 없거나 로그인되지 않았으면 생성 전에 명확한 안내와 함께 멈춘다
  const noCodex = await run("skills/imagine/scripts/generate.js", ["--prompt", "cat"], {
    IMAGINE_CODEX_BIN: "imagine-missing-codex-binary",
  });
  assert.notEqual(noCodex.code, 0);
  assert.match(noCodex.stdout + noCodex.stderr, /Codex CLI is not ready/);

  const unknown = await run("skills/imagine/scripts/generate.js", ["--prompt", "cat", "--unknown", "x"]);
  assert.notEqual(unknown.code, 0);
  assert.match(unknown.stdout + unknown.stderr, /Unknown option/);

  // Codex 에는 내장 image_gen 한 번만 쓰고 셸·파일 접근은 하지 말라고 지시한다
  const instruction = buildInstruction({ prompt: "a red apple", size: "1536x1024", quality: "high" });
  assert.match(instruction, /built-in image_gen tool exactly once/);
  assert.match(instruction, /Do not run shell commands/);
  assert.match(instruction, /landscape 3:2/);
  assert.match(instruction, /a red apple/);
  assert.match(buildInstruction({ prompt: "x", size: "1024x1024", quality: "low", edit: true }), /edit the attached image/);

  const sources = await Promise.all(
    ["generate.js", "edit.js", "codex-backend.js"].map((name) => readFile(path.join(root, "skills/imagine/scripts", name), "utf8")),
  );
  for (const source of sources) {
    assert.equal(source.includes("kill -9"), false);
    assert.equal(source.includes("auth.json"), false);
    // v2 는 서드파티 OAuth 프록시와 Responses API 직접 호출을 쓰지 않는다
    assert.equal(source.includes("openai-oauth"), false);
    assert.equal(source.includes("v1/responses"), false);
    assert.equal(source.includes("tool_choice"), false);
  }

  console.log("imagine contract checks passed");
} finally {
  await rm(temp, { recursive: true, force: true });
}
