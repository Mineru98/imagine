#!/usr/bin/env node
/**
 * imagine edit script v2 — Codex CLI built-in image_gen backend
 * Features: user config, opt-in history, PNG verification, no-overwrite output
 * Usage: node edit.js --input photo.png --prompt "pen sketch" --quality high --size 1024x1536 --format png --out result.png
 */
import { copyFile, mkdir, readFile, rename, rm, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { QUALITIES, SIZES, ensureCodexReady, runCodexImage } from "./codex-backend.js";
import { validateImage } from "./verify.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(__dirname, "..", "config.json");

async function loadConfig() {
  if (existsSync(CONFIG_PATH)) { try { return JSON.parse(await readFile(CONFIG_PATH, "utf-8")); } catch {} }
  return {};
}

async function logHistory(entry) {
  if (process.env.IMAGINE_HISTORY !== "1") return;
  const historyPath = join(process.cwd(), ".imagine", "history.jsonl");
  await mkdir(dirname(historyPath), { recursive: true });
  const line = JSON.stringify({ timestamp: new Date().toISOString(), ...entry }) + "\n";
  await writeFile(historyPath, line, { flag: "a", mode: 0o600 });
}

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = { input: "", prompt: "", quality: "", size: "", format: "png", out: "" };
  const names = new Map([["input", "input"], ["prompt", "prompt"], ["quality", "quality"], ["size", "size"], ["format", "format"], ["out", "out"]]);
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
  if (!parsed.input || !parsed.prompt.trim() || !parsed.out) {
    throw new Error("Usage: node edit.js --input <img> --prompt <desc> [--quality low|medium|high] [--size 1024x1024|1024x1536|1536x1024] [--format png] --out <file>");
  }
  if (parsed.prompt.length > 20_000) throw new Error("--prompt must be 20,000 characters or fewer.");
  return parsed;
}

async function main() {
  const args = parseArgs();
  const config = await loadConfig();

  const quality = args.quality || config.default_quality || "medium";
  const size = args.size || config.default_size || "1024x1024";
  const format = args.format || config.default_format || "png";
  if (!QUALITIES.includes(quality)) throw new Error(`Invalid --quality: ${quality}`);
  if (!SIZES.includes(size)) throw new Error(`Invalid --size: ${size}`);
  if (format !== "png") throw new Error("Only PNG output is supported until real JPEG/WebP transcoding is available.");
  if (!existsSync(args.input)) throw new Error(`Input file not found: ${args.input}`);

  const outPath = resolve(process.cwd(), args.out.endsWith(".png") ? args.out : `${args.out}.png`);
  if (existsSync(outPath)) throw new Error(`Refusing to overwrite existing output: ${outPath}`);

  await ensureCodexReady();
  const startTime = Date.now();
  const result = await runCodexImage({ prompt: args.prompt, quality, size, images: [args.input] });
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  await mkdir(dirname(outPath), { recursive: true });
  const tempPath = join(dirname(outPath), `.tmp-${process.pid}-${Date.now()}.png`);
  await copyFile(result.files[result.files.length - 1], tempPath);
  await rename(tempPath, outPath);
  console.log(`[edit] Saved: ${outPath} (${elapsed}s)`);

  const verifyResult = await validateImage(outPath);
  if (verifyResult.valid) {
    console.log(`[edit] ✅ Verified: ${verifyResult.png?.dimensions?.width}x${verifyResult.png?.dimensions?.height}`);
  } else {
    console.error(`[edit] ❌ Verification failed:`);
    for (const [check, passed] of Object.entries(verifyResult.checks)) {
      if (!passed) console.error(`       - ${check}`);
    }
    await rm(outPath, { force: true });
  }

  await logHistory({ type: "edit", input: args.input, prompt: args.prompt, quality, size, format, output: outPath, verified: verifyResult.valid, elapsed });
  process.exitCode = verifyResult.valid ? 0 : 1;
}

main().catch((error) => {
  console.error(`[edit] Error: ${error.message}`);
  console.error("       If Codex reports a login problem, run `codex login`; on a rate limit, wait a few minutes and retry.");
  process.exitCode = 2;
});
