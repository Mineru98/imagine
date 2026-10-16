/**
 * Codex CLI image backend (v2).
 *
 * Runs `codex exec` non-interactively and lets Codex's built-in `image_gen` tool render the
 * image with the user's existing ChatGPT login. Codex saves each result under
 * `$CODEX_HOME/generated_images/<thread_id>/`; we read the thread id from the JSON event stream
 * and pick the files up from there. No local proxy, no API key, and no auth files are touched.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const SIZES = ["1024x1024", "1024x1536", "1536x1024"];
export const QUALITIES = ["low", "medium", "high"];

const SIZE_HINT = {
  "1024x1024": "square 1:1 aspect ratio (1024x1024)",
  "1024x1536": "portrait 2:3 aspect ratio (1024x1536)",
  "1536x1024": "landscape 3:2 aspect ratio (1536x1024)",
};
const QUALITY_HINT = {
  low: "quick draft quality",
  medium: "standard quality",
  high: "high detail, polished quality",
};
const IMAGE_EXTENSIONS = new Set([".png", ".webp", ".jpg", ".jpeg"]);

export function codexHome() {
  return process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
}

/** The instruction handed to Codex: one built-in tool call, no shell, no file access. */
export function buildInstruction({ prompt, size, quality, edit = false }) {
  return [
    edit
      ? "Call your built-in image_gen tool exactly once to edit the attached image."
      : "Call your built-in image_gen tool exactly once to generate one image.",
    "Do not run shell commands, do not read or write files, and do not open any skill files.",
    `Output: ${SIZE_HINT[size]}, ${QUALITY_HINT[quality]}.`,
    edit ? "Preserve the original composition, subject, and pose while applying the requested change." : null,
    "Follow the request exactly. Render any requested text with accurate spelling.",
    "",
    "Request:",
    prompt,
    "",
    "After the tool returns, reply with only DONE.",
  ]
    .filter((line) => line !== null)
    .join("\n");
}

/** Quote one argument for cmd.exe (Windows runs the npm `codex.cmd` shim through the shell). */
function quoteForCmd(arg) {
  return /^[\w\-.:/\\=]+$/.test(arg) ? arg : `"${arg.replace(/"/g, '""')}"`;
}

function spawnCodex(args, { input } = {}) {
  const bin = process.env.IMAGINE_CODEX_BIN || "codex";
  const env = { ...process.env };
  // Keep the run on the ChatGPT login: never let an API key turn this into a billed API call.
  for (const key of ["OPENAI_API_KEY", "CODEX_API_KEY"]) delete env[key];
  const child =
    process.platform === "win32"
      ? spawn([bin, ...args].map(quoteForCmd).join(" "), { shell: true, env, windowsHide: true })
      : spawn(bin, args, { env });
  if (input !== undefined) child.stdin.end(input);
  else child.stdin.end();
  return child;
}

/** Fail fast with an actionable message when the Codex CLI is missing or logged out. */
export async function ensureCodexReady() {
  const { code, output } = await new Promise((resolve) => {
    let output = "";
    const child = spawnCodex(["login", "status"]);
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    child.on("error", () => resolve({ code: -1, output }));
    child.on("close", (code) => resolve({ code, output }));
  });
  if (code !== 0 || !/logged in/i.test(output)) {
    throw new Error(
      "Codex CLI is not ready. Install or update it with `npm install -g @openai/codex@latest`, " +
        "then sign in with your ChatGPT account: `codex login`.",
    );
  }
}

async function collectImages(threadId) {
  const dir = path.join(codexHome(), "generated_images", threadId);
  if (!existsSync(dir)) return [];
  const files = [];
  for (const name of await readdir(dir)) {
    if (!IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase())) continue;
    const full = path.join(dir, name);
    files.push({ full, mtime: (await stat(full)).mtimeMs });
  }
  return files.sort((a, b) => a.mtime - b.mtime).map((f) => f.full);
}

/**
 * Generate (or edit, when `images` is given) one image through Codex.
 * Resolves with the generated file paths inside `$CODEX_HOME/generated_images/<thread_id>/`.
 */
export async function runCodexImage({ prompt, size, quality, images = [], timeoutMs = 300_000 }) {
  const args = ["exec", "--json", "--skip-git-repo-check", "--sandbox", "read-only", "--color", "never"];
  for (const image of images) args.push("--image", path.resolve(image));
  args.push("-");
  const instruction = buildInstruction({ prompt, size, quality, edit: images.length > 0 });

  return await new Promise((resolve, reject) => {
    const child = spawnCodex(args, { input: instruction });
    let threadId = null;
    let usage = null;
    let lastMessage = "";
    const failures = [];
    let buffer = "";

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Codex did not finish within ${Math.round(timeoutMs / 1000)}s.`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line.startsWith("{")) continue;
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }
        if (event.type === "thread.started") threadId = event.thread_id;
        if (event.type === "turn.completed") usage = event.usage ?? null;
        if (event.type === "turn.failed") failures.push(event.error?.message ?? "turn failed");
        if (event.type === "error") failures.push(event.message ?? "error");
        if (event.type === "item.completed" && event.item?.type === "agent_message" && event.item.text) {
          lastMessage = event.item.text;
        }
      }
    });
    child.stderr.on("data", () => {
      // Codex prints progress and config notices on stderr; never echo it (it may include paths/env).
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`Could not start the Codex CLI: ${error.message}`));
    });
    child.on("close", async (code) => {
      clearTimeout(timer);
      if (!threadId) {
        reject(new Error(`Codex exited (code ${code}) before starting a session. ${failures.join("; ")}`.trim()));
        return;
      }
      const files = await collectImages(threadId);
      if (files.length === 0) {
        const reason = failures.join("; ") || lastMessage || `exit code ${code}`;
        reject(new Error(`Codex finished without producing an image (${reason}).`));
        return;
      }
      resolve({ files, threadId, usage });
    });
  });
}
