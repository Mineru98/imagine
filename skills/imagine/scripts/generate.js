#!/usr/bin/env node
/**
 * gpt-img2-for_kimi generate script v2
 * Features: parallel generation, user config, history logging, format selection
 * Usage: node generate.js --prompt "a cat" --quality medium --size 1024x1024 --n 2 --format png --out-dir ./images
 */
import { spawn } from "child_process";
import { createServer } from "node:net";
import { writeFile, mkdir, readFile, rename, rm } from "fs/promises";
import { existsSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { validateImage } from "./verify.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OAUTH_PORT = 10531;
const OAUTH_URL = `http://127.0.0.1:${OAUTH_PORT}`;
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
  const base = join(outDir, `gpt-img2_${Date.now()}_${index}`);
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

function checkOAuthSession() {
  if (process.env.IMAGINE_ENABLE_LEGACY_PROXY !== "1") {
    throw new Error("The legacy OAuth proxy is disabled. Use the host-native image tool, or set IMAGINE_ENABLE_LEGACY_PROXY=1 only for an explicitly configured legacy run.");
  }
}

/* ── OAuth Proxy ── */
async function healthCheck(attempt, maxAttempts) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const r = await fetch(`${OAUTH_URL}/v1/models`, { signal: AbortSignal.timeout(1000) });
      if (r.ok) return true;
    } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

async function isPortFree(port) {
  return await new Promise((resolvePort) => {
    const server = createServer();
    server.once("error", () => resolvePort(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolvePort(true)));
  });
}

async function startOAuthProxy(maxRetries = 3) {
  if (!(await isPortFree(OAUTH_PORT))) {
    throw new Error(`Legacy proxy port ${OAUTH_PORT} is already in use; refusing to contact an unrelated local listener.`);
  }
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    console.log(`[ima2] Starting OAuth proxy (attempt ${attempt}/${maxRetries})...`);

    const safeEnv = { ...process.env };
    for (const key of ["OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_ORG_ID", "OPENAI_PROJECT_ID", "CODEX_ACCESS_TOKEN"]) delete safeEnv[key];
    const child = spawn("npx", ["--yes", "openai-oauth", "--port", String(OAUTH_PORT)], { stdio: ["ignore", "pipe", "pipe"], env: safeEnv });

    child.stdout.on("data", d => { const m = d.toString().trim(); if (m) console.log(`[oauth] ${m}`); });
    child.stderr.on("data", d => {
      const m = d.toString().trim();
      if (!m) return;
      if (m.includes("npm warn")) return;
      if (m.includes("npm notice")) return;
      if (m.includes("ExperimentalWarning")) return;
      if (/^\(node:\d+\)/.test(m)) return;
      console.error(`[oauth] ${m}`);
    });

    child.on("error", err => { console.error(`[oauth] Process error: ${err.message}`); });
    child.on("exit", (code, signal) => {
      if (code !== 0 && code !== null) console.error(`[oauth] Proxy exited with code ${code}`);
    });

    const ready = await healthCheck(attempt, 30);
    if (ready) {
      console.log(`[ima2] OAuth proxy ready (attempt ${attempt})`);
      return child;
    }

    console.error(`[ima2] Proxy did not respond on attempt ${attempt}`);
    child.kill();
  }

  console.error("================================================================================");
  console.error("ERROR: OAuth proxy failed to start after 3 attempts on port 10531.");
  console.error("");
  console.error("Possible causes:");
  console.error("  1. Another process is stubbornly holding port 10531.");
  console.error("  2. openai-oauth is not installed: npm install -g openai-oauth");
  console.error("  3. Your OAuth session has expired completely.");
  console.error("");
  console.error("Manual fix steps:");
  console.error("  1. Stop only a proxy process that you started yourself, then retry:");
  console.error("  2. Re-authenticate:");
  console.error("     npx @openai/codex login");
  console.error("  3. Test proxy manually:");
  console.error("     npx openai-oauth --port 10531");
  console.error("================================================================================");
  process.exit(1);
}

/* ── Generate One ── */
async function generateOne({ prompt, quality, size }) {
  const developerPrompt = `You are an image generator. Always invoke the image_generation tool; never respond with text only. Render all text and typography in the image with accurate spelling and layout. Follow the user's prompt exactly — do not add stylistic modifiers, quality keywords, or other content the user did not explicitly request.`;

  const res = await fetch(`${OAUTH_URL}/v1/responses`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({
      model: "gpt-5.4",
      input: [
        { role: "developer", content: developerPrompt },
        { role: "user", content: `Generate an image: ${prompt}` },
      ],
      tools: [{ type: "image_generation", quality, size }],
      tool_choice: "required",
      stream: true,
    }),
  });

  if (!res.ok) { const text = await res.text(); throw new Error(`OAuth proxy returned ${res.status}: ${text.slice(0, 200)}`); }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let imageB64 = null;
  let usage = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary;
    while ((boundary = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
      let eventData = "";
      for (const line of block.split("\n")) if (line.startsWith("data: ")) eventData += line.slice(6);
      if (!eventData || eventData === "[DONE]") continue;
      try {
        const data = JSON.parse(eventData);
        if (data.type === "response.output_item.done" && data.item?.type === "image_generation_call" && data.item.result) imageB64 = data.item.result;
        if (data.type === "response.completed") usage = data.response?.usage || null;
        if (data.type === "error") throw new Error(data.error?.message || JSON.stringify(data));
      } catch (e) { if (e.message && !e.message.startsWith("Unexpected")) throw e; }
    }
  }

  if (!imageB64) {
    const retryRes = await fetch(`${OAUTH_URL}/v1/responses`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-5.4", input: [{ role: "user", content: prompt }], tools: [{ type: "image_generation", quality, size }], stream: false }),
    });
    if (retryRes.ok) {
      const json = await retryRes.json();
      for (const item of json.output || []) if (item.type === "image_generation_call" && item.result) { imageB64 = item.result; usage = json.usage; break; }
    }
  }
  if (!imageB64) throw new Error("No image data received");
  return { b64: imageB64, usage };
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
  if (!["low", "medium", "high"].includes(quality)) throw new Error(`Invalid --quality: ${quality}`);
  if (!["1024x1024", "1024x1536", "1536x1024"].includes(size)) throw new Error(`Invalid --size: ${size}`);
  if (format !== "png") throw new Error("Only PNG output is supported until real JPEG/WebP transcoding is available.");
  if (!Number.isInteger(count) || count < 1 || count > 8) throw new Error("--n must be an integer from 1 to 8.");
  checkOAuthSession();

  console.log(`[ima2] Config: quality=${quality}, size=${size}, format=${format}, n=${count}`);

  const proxy = await startOAuthProxy();
  const startTime = Date.now();
  let saved = 0;
  const failedOutputs = [];

  try {
    await mkdir(outDir, { recursive: true });
    const results = Array(count);
    let cursor = 0;
    const worker = async () => {
      while (cursor < count) {
        const index = cursor++;
        try { results[index] = { status: "fulfilled", value: await generateOne({ prompt: args.prompt, quality, size }) }; }
        catch (reason) { results[index] = { status: "rejected", reason }; }
      }
    };
    await Promise.all(Array.from({ length: Math.min(2, count) }, worker));

    let totalTokens = 0;
    const outputs = [];

    const verifiedOutputs = [];

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === "fulfilled" && r.value.b64) {
      const outPath = allocateOutputPath(outDir, i, format);
      const tempPath = join(outDir, `.tmp-${process.pid}-${i}.png`);
      await writeFile(tempPath, Buffer.from(r.value.b64, "base64"));
      await rename(tempPath, outPath);
      console.log(`[ima2] [${i + 1}/${count}] Saved: ${outPath}`);

      // Verify the generated image
      const verifyResult = await validateImage(outPath);
      if (verifyResult.valid) {
        console.log(`[ima2] [${i + 1}/${count}] ✅ Verified: ${verifyResult.png?.dimensions?.width}x${verifyResult.png?.dimensions?.height}`);
        verifiedOutputs.push(outPath);
      } else {
        console.error(`[ima2] [${i + 1}/${count}] ❌ Verification failed:`);
        for (const [check, passed] of Object.entries(verifyResult.checks)) {
          if (!passed) console.error(`       - ${check}`);
        }
        failedOutputs.push({ path: outPath, checks: verifyResult.checks });
        await rm(outPath, { force: true });
      }

      outputs.push(outPath);
      saved++;
      if (r.value.usage?.total_tokens) totalTokens += r.value.usage.total_tokens;
    } else {
      console.error(`[ima2] [${i + 1}/${count}] Failed:`, r.reason?.message);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[ima2] Done: ${saved}/${count} images saved in ${elapsed}s`);
  if (verifiedOutputs.length > 0) console.log(`[ima2] Verified: ${verifiedOutputs.length}/${saved}`);
  if (failedOutputs.length > 0) console.error(`[ima2] Verification failures: ${failedOutputs.length}/${saved}`);

  await logHistory({ type: "generate", prompt: args.prompt, quality, size, format, count, saved, verified: verifiedOutputs.length, outputs, total_tokens: totalTokens, elapsed });
  } catch (err) {
    console.error("[ima2] Error:", err.message);
    proxy.kill(); process.exit(1);
  }

  proxy.kill();
  process.exitCode = saved === count && failedOutputs.length === 0 ? 0 : 1;
}

main().catch((error) => { console.error(`[ima2] Error: ${error.message}`); process.exitCode = 2; });
