# Installation & Configuration Guide

Everything you need to do **once** before the `imagine` skill will work. The main `SKILL.md` intentionally stays lean; dig into this file when you need to (re)install, tweak defaults, or debug a broken run.

---

## 1. Requirements

| Requirement | Why |
|-------------|-----|
| **Node.js ≥ 18** | Only needed for the optional legacy local CLI; the package declares its ES module boundary explicitly. |
| **A host image tool or ChatGPT-authenticated bridge** | Image generation uses the configured subscription route; no separate Images API key is required. |
| **`npx` available** | Only needed for an explicitly enabled legacy proxy run. |

Optional but useful: a host CLI that knows how to invoke skills (Claude Code, Kimi CLI, etc.). You can also run the scripts directly with `node`.

---

## 2. One-time authentication

The preferred route is the host-native image tool or a supported ChatGPT-authenticated
Codex bridge. The old local OAuth proxy is retained only as an explicit compatibility
path and is disabled by default; this avoids trusting a fixed unauthenticated local
port during ordinary image work.

```bash
npx @openai/codex login
```

Complete the login through the supported host/bridge. The Imagine scripts do not read
or inspect `auth.json`.

**When to re-run login:**
- First install.
- `401` / `403` errors from the proxy (token expired).
- You switched ChatGPT accounts.

---

## 3. The OAuth proxy (auto-managed)

Only when `IMAGINE_ENABLE_LEGACY_PROXY=1` is explicitly set, `generate.js` / `edit.js`:

1. Start the compatibility proxy as a child process with API-related environment
   variables removed.
2. Spawn `npx openai-oauth --port 10531` as a child process.
3. Poll `http://127.0.0.1:10531/v1/models` up to 30× (500 ms each) until it's healthy.
4. Do the image call.
5. Kill only the child process that this invocation started.

You should **not** need to start the proxy manually. If you do want to, the exact command is:

```bash
npx openai-oauth --port 10531
```

**Port:** `10531` is a legacy compatibility default. If another process is holding
that port, the scripts fail without killing or modifying the unrelated process.

---

## 4. Configuration file

`config.json` (next to `SKILL.md`) sets the defaults that every CLI invocation inherits when a flag is omitted.

```json
{
  "default_quality": "medium",
  "default_size": "1024x1536",
  "default_format": "png",
  "output_dir": "./images"
}
```

| Key | Accepted values | Notes |
|-----|-----------------|-------|
| `default_quality` | `low`, `medium`, `high` | Higher = more tokens and slower. Most prompts look great at `medium`. |
| `default_size` | `1024x1024`, `1024x1536`, `1536x1024` | Square / portrait / landscape. |
| `default_format` | `png` | The current runner writes and verifies PNG bytes. JPEG/WebP require a future real transcoding adapter; extensions are never relabeled. |
| `output_dir` | Any path | **Relative paths resolve against the current working directory.** The default `./images` means generated files land in `<project-root>/images/` when you invoke the skill from a project root. Use `~/Pictures/...` or an absolute path if you want a global collection instead. |

You can always override per-invocation with CLI flags:

```bash
node scripts/generate.js --prompt "..." --quality high --size 1536x1024 --n 4 --out-dir ./renders
```

---

## 5. Output directory conventions

The skill is designed so that **results stay inside the project it was run from**:

- Default `output_dir` is `./images` (relative → resolved against `process.cwd()`).
- If `output_dir` is missing from `config.json`, scripts fall back to `<cwd>/images`.
- The directory is created on demand — no need to `mkdir` it yourself.
- Filenames are `gpt-img2_<unix-ms>_<index>.<ext>` so parallel runs don't collide.

To centralize outputs globally instead, set an absolute path in `config.json`, e.g. `"output_dir": "/Users/<you>/Pictures/codex-images"`.

---

## 6. History log

History is opt-in: set `IMAGINE_HISTORY=1` to append a redacted run receipt under
the active workspace's `.imagine/history.jsonl`. It is off by default and never
contains authentication data or image bytes.

If you're sharing this skill via git, consider `.gitignore`-ing `history.jsonl` so you don't leak prompt history.

---

## 7. Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `Legacy OAuth proxy is disabled` | Native tool/bridge should be used. | Use the host-native image tool; set `IMAGINE_ENABLE_LEGACY_PROXY=1` only for an explicitly configured compatibility run. |
| `Proxy did not respond` | Port 10531 is held, or the compatibility package is unavailable. | Stop the process you own, or return to the native tool/bridge route. |
| `OAuth proxy returned 401` / `403` | Token expired or revoked. | Re-run `npx @openai/codex login`. |
| `OAuth proxy returned 429` / `Rate limit` | Hit ChatGPT tier limit. | Wait a few minutes; reduce `--n`; drop `--quality` to `medium`. |
| `No image data received` | Stream interrupted or model refused. | Retry once. If persistent, simplify the prompt. |
| Verification failures (`pngSignature`, `ihdrPresent`) | Corrupt write, usually from an interrupted stream. | Re-run the same prompt. |
| `ENOENT` on `config.json` | Config file deleted. | Scripts tolerate a missing config — they fall back to built-in defaults. Recreate from the template in §4 if you want persistent preferences. |

---

## 8. Uninstalling

Remove this skill folder through the host's normal plugin manager. If the legacy
proxy was installed globally, remove only that package with your package manager;
do not delete broad authentication directories. Revoke a ChatGPT session through
the official Codex/ChatGPT account controls.
