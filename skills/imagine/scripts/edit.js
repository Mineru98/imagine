#!/usr/bin/env node
/**
 * gpt-img2-for_kimi edit script v2
 * Features: user config, history logging, format selection
 * Usage: node edit.js --input photo.png --prompt "pen sketch" --quality high --size 1024x1536 --format png --out result.png
 */
import { spawn } from "child_process";
import { createServer } from "node:net";
import { writeFile, readFile, mkdir, rename, rm } from "fs/promises";
import { existsSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { validateImage } from "./verify.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OAUTH_PORT = 10531;
const OAUTH_URL = `http://127.0.0.1:${OAUTH_PORT}`;
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

function checkOAuthSession() {
  if (process.env.IMAGINE_ENABLE_LEGACY_PROXY !== "1") {
    throw new Error("The legacy OAuth proxy is disabled. Use the host-native image tool, or set IMAGINE_ENABLE_LEGACY_PROXY=1 only for an explicitly configured legacy run.");
  }
}

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
    console.log(`[edit] Starting OAuth proxy (attempt ${attempt}/${maxRetries})...`);

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
      console.log(`[edit] OAuth proxy ready (attempt ${attempt})`);
      return child;
    }

    console.error(`[edit] Proxy did not respond on attempt ${attempt}`);
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

async function editImage({ input, prompt, quality, size }) {
  const imageBuffer = await readFile(input);
  const imageB64 = imageBuffer.toString("base64");
  const developerPrompt = `You are an image editor. Always invoke the image_generation tool; never respond with text only. Preserve the original image's composition, subject, and pose while applying the requested transformation. Render all text and typography with accurate spelling and layout. Follow the user's prompt exactly — do not add stylistic modifiers, quality keywords, or other content the user did not explicitly request.`;

  const res = await fetch(`${OAUTH_URL}/v1/responses`, {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({
      model: "gpt-5.4",
      input: [
        { role: "developer", content: developerPrompt },
        { role: "user", content: [{ type: "input_image", image_url: `data:image/png;base64,${imageB64}` }, { type: "input_text", text: `Transform this image: ${prompt}` }] },
      ],
      tools: [{ type: "image_generation", quality, size }], tool_choice: "required", stream: true,
    }),
  });
  if (!res.ok) { const text = await res.text(); throw new Error(`OAuth proxy returned ${res.status}: ${text.slice(0, 200)}`); }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "", resultB64 = null, usage = null;
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
        if (data.type === "response.output_item.done" && data.item?.type === "image_generation_call" && data.item.result) resultB64 = data.item.result;
        if (data.type === "response.completed") usage = data.response?.usage || null;
        if (data.type === "error") throw new Error(data.error?.message || JSON.stringify(data));
      } catch (e) { if (e.message && !e.message.startsWith("Unexpected")) throw e; }
    }
  }
  if (!resultB64) {
    const retryRes = await fetch(`${OAUTH_URL}/v1/responses`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-5.4", input: [{ type: "input_image", image_url: `data:image/png;base64,${imageB64}` }, { type: "input_text", text: prompt }], tools: [{ type: "image_generation", quality, size }], stream: false }),
    });
    if (retryRes.ok) {
      const json = await retryRes.json();
      for (const item of json.output || []) if (item.type === "image_generation_call" && item.result) { resultB64 = item.result; usage = json.usage; break; }
    }
  }
  if (!resultB64) throw new Error("No image data received from OAuth proxy");
  return { b64: resultB64, usage };
}

async function main() {
  const args = parseArgs();
  const config = await loadConfig();

  const quality = args.quality || config.default_quality || "medium";
  const size = args.size || config.default_size || "1024x1024";
  const format = args.format || config.default_format || "png";
  if (!["low", "medium", "high"].includes(quality)) throw new Error(`Invalid --quality: ${quality}`);
  if (!["1024x1024", "1024x1536", "1536x1024"].includes(size)) throw new Error(`Invalid --size: ${size}`);
  if (format !== "png") throw new Error("Only PNG output is supported until real JPEG/WebP transcoding is available.");
  checkOAuthSession();

  if (!existsSync(args.input)) { console.error(`ERROR: Input file not found: ${args.input}`); process.exit(1); }

  const proxy = await startOAuthProxy();
  const startTime = Date.now();
  let verified = false;

  try {
    const result = await editImage({ input: args.input, prompt: args.prompt, quality, size });
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    // Rename output extension if format differs
    const outPath = resolve(process.cwd(), args.out.endsWith(".png") ? args.out : `${args.out}.png`);
    if (existsSync(outPath)) throw new Error(`Refusing to overwrite existing output: ${outPath}`);
    await mkdir(dirname(outPath), { recursive: true });
    const tempPath = join(dirname(outPath), `.tmp-${process.pid}-${Date.now()}.png`);
    await writeFile(tempPath, Buffer.from(result.b64, "base64"));
    await rename(tempPath, outPath);

    console.log(`[edit] Saved: ${outPath} (${elapsed}s)`);

    // Verify the edited image
    const verifyResult = await validateImage(outPath);
    verified = verifyResult.valid;
    if (verifyResult.valid) {
      console.log(`[edit] ✅ Verified: ${verifyResult.png?.dimensions?.width}x${verifyResult.png?.dimensions?.height}`);
    } else {
      console.error(`[edit] ❌ Verification failed:`);
      for (const [check, passed] of Object.entries(verifyResult.checks)) {
        if (!passed) console.error(`       - ${check}`);
      }
      await rm(outPath, { force: true });
    }

    if (result.usage) console.log("[edit] Usage:", JSON.stringify(result.usage));

    await logHistory({ type: "edit", input: args.input, prompt: args.prompt, quality, size, format, output: outPath, verified: verifyResult.valid, total_tokens: result.usage?.total_tokens || 0, elapsed });
  } catch (err) {
    console.error("[edit] Error:", err.message);
    console.error("       Hint: If the proxy returned 401/403, your OAuth session may have expired.");
    console.error("       Run \"npx @openai/codex login\" to refresh.");
    console.error("       If you see \"rate limit\" errors, wait a few minutes and retry.");
    proxy.kill(); process.exitCode = 1; return;
  }
  proxy.kill();
  process.exitCode = verified ? 0 : 1;
}

main().catch((error) => { console.error(`[edit] Error: ${error.message}`); process.exitCode = 2; });
