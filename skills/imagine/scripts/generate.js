#!/usr/bin/env node
/**
 * imagine generate script v2 — Codex CLI built-in image_gen backend
 * Features: bounded parallel generation, user config, opt-in history, PNG verification
 * Usage: node generate.js --prompt "a cat" --quality medium --size 1024x1024 --n 2 --format png --out-dir ./images
 */
import { copyFile, mkdir, readFile, rename, rm, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { QUALITIES, SIZES, ensureCodexReady, runCodexImage } from "./codex-backend.js";
import { validateImage } from "./verify.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(__dirname, "..", "config.json");

/* ── Config ── */
async function loadConfig() {
  if (existsSync(CONFIG_PATH)) {
    try { return JSON.parse(await readFile(CONFIG_PATH, "utf-8")); } catch {}
  }
  return {};
}

/* ── History ── */
async function logHistory(entry) {
  if (process.env.IMAGINE_HISTORY !== "1") return;
  const historyPath = join(process.cwd(), ".imagine", "history.jsonl");
  await mkdir(dirname(historyPath), { recursive: true });
  const line = JSON.stringify({ timestamp: new Date().toISOString(), ...entry }) + "\n";
  await writeFile(historyPath, line, { flag: "a", mode: 0o600 });
}

function allocateOutputPath(outDir, index, extension) {
  const base = join(outDir, `imagine_${Date.now()}_${index}`);
  for (let version = 0; version < 10_000; version += 1) {
    const suffix = version === 0 ? "" : `-v${version}`;
    const candidate = `${base}${suffix}.${extension}`;
    if (!existsSync(candidate)) return candidate;
  }
  throw new Error(`Could not allocate a non-conflicting output path in ${outDir}`);
}

/* ── Args ── */
function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = { prompt: "", quality: "", size: "", n: "1", format: "png", outDir: "" };
  const names = new Map([["out-dir", "outDir"], ["prompt", "prompt"], ["quality", "quality"], ["size", "size"], ["n", "n"], ["format", "format"]]);
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (!token.startsWith("--")) throw new Error(`Unexpected positional argument: ${token}`);
    const name = names.get(token.slice(2));
    if (!name) throw new Error(`Unknown option: ${token}`);
    const value = args[i + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${token}`);
    parsed[name] = value;
    i += 1;
  }
  if (!parsed.prompt.trim()) {
    throw new Error("Usage: node generate.js --prompt <text> [--quality low|medium|high] [--size 1024x1024|1024x1536|1536x1024] [--n 1-8] [--format png] [--out-dir <dir>]");
  }
  if (parsed.prompt.length > 20_000) throw new Error("--prompt must be 20,000 characters or fewer.");
  return parsed;
}

/* ── Main ── */
async function main() {
  const args = parseArgs();
  const config = await loadConfig();

  // Apply defaults from config if not specified
  const quality = args.quality || config.default_quality || "medium";
  const size = args.size || config.default_size || "1024x1024";
  const format = args.format || config.default_format || "png";
  const outDir = resolve(process.cwd(), args.outDir || config.output_dir || "images");
  const count = Number(args.n);
  if (!QUALITIES.includes(quality)) throw new Error(`Invalid --quality: ${quality}`);
  if (!SIZES.includes(size)) throw new Error(`Invalid --size: ${size}`);
  if (format !== "png") throw new Error("Only PNG output is supported until real JPEG/WebP transcoding is available.");
  if (!Number.isInteger(count) || count < 1 || count > 8) throw new Error("--n must be an integer from 1 to 8.");

  await ensureCodexReady();
  console.log(`[imagine] Codex built-in image_gen: quality=${quality}, size=${size}, format=${format}, n=${count}`);

  const startTime = Date.now();
  await mkdir(outDir, { recursive: true });

  // Each image is its own Codex session; run at most two at a time.
  const results = Array(count);
  let cursor = 0;
  const worker = async () => {
    while (cursor < count) {
      const index = cursor++;
      try { results[index] = { status: "fulfilled", value: await runCodexImage({ prompt: args.prompt, quality, size }) }; }
      catch (reason) { results[index] = { status: "rejected", reason }; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(2, count) }, worker));

  let saved = 0;
  let totalTokens = 0;
  const outputs = [];
  const verifiedOutputs = [];
  const failedOutputs = [];

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status !== "fulfilled") {
      console.error(`[imagine] [${i + 1}/${count}] Failed: ${r.reason?.message}`);
      continue;
    }
    const source = r.value.files[r.value.files.length - 1];
    const outPath = allocateOutputPath(outDir, i, format);
    const tempPath = join(outDir, `.tmp-${process.pid}-${i}.png`);
    await copyFile(source, tempPath);
    await rename(tempPath, outPath);
    console.log(`[imagine] [${i + 1}/${count}] Saved: ${outPath}`);

    const verifyResult = await validateImage(outPath);
    if (verifyResult.valid) {
      console.log(`[imagine] [${i + 1}/${count}] ✅ Verified: ${verifyResult.png?.dimensions?.width}x${verifyResult.png?.dimensions?.height}`);
      verifiedOutputs.push(outPath);
    } else {
      console.error(`[imagine] [${i + 1}/${count}] ❌ Verification failed:`);
      for (const [check, passed] of Object.entries(verifyResult.checks)) {
        if (!passed) console.error(`       - ${check}`);
      }
      failedOutputs.push({ path: outPath, checks: verifyResult.checks });
      await rm(outPath, { force: true });
    }

    outputs.push(outPath);
    saved++;
    if (r.value.usage?.input_tokens) totalTokens += r.value.usage.input_tokens + (r.value.usage.output_tokens ?? 0);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[imagine] Done: ${saved}/${count} images saved in ${elapsed}s`);
  if (verifiedOutputs.length > 0) console.log(`[imagine] Verified: ${verifiedOutputs.length}/${saved}`);
  if (failedOutputs.length > 0) console.error(`[imagine] Verification failures: ${failedOutputs.length}/${saved}`);

  await logHistory({ type: "generate", prompt: args.prompt, quality, size, format, count, saved, verified: verifiedOutputs.length, outputs, total_tokens: totalTokens, elapsed });
  process.exitCode = saved === count && failedOutputs.length === 0 ? 0 : 1;
}

main().catch((error) => { console.error(`[imagine] Error: ${error.message}`); process.exitCode = 2; });
