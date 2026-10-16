# Installation & Configuration Guide

Everything you need to do **once** before the `imagine` scripts will work. The main `SKILL.md` intentionally stays lean; dig into this file when you need to (re)install, tweak defaults, or debug a broken run.

---

## 1. Requirements

| Requirement | Why |
|-------------|-----|
| **Node.js ≥ 18** | Runs `generate.js` / `edit.js`; the package declares its ES module boundary explicitly. |
| **Codex CLI (latest)** | v2 renders images through Codex's built-in `image_gen` tool (`codex features list` shows `image_generation  stable  true`; verified on 0.162). |
| **ChatGPT Plus/Pro login in Codex** | Image generation counts against the subscription; no OpenAI API key is used. |

---

## 2. One-time setup

```bash
npm install -g @openai/codex@latest
codex login
codex login status   # → "Logged in using ChatGPT"
```

The Imagine scripts never read or inspect `auth.json`; they only call `codex login status`
before a run and stop with a clear message if Codex is missing or logged out.

**When to re-run login:** first install, after switching ChatGPT accounts, or when
`codex login status` no longer reports a ChatGPT login.

---

## 3. How a run works

`generate.js` / `edit.js`:

1. Check `codex login status`.
2. Start `codex exec --json --skip-git-repo-check --sandbox read-only --color never -`
   with the instruction on stdin (and `--image <file>` for edits). The instruction asks for
   exactly one built-in `image_gen` call and forbids shell commands and file access.
3. Read `thread.started` from the JSON event stream to learn the session id.
4. Copy the result from `$CODEX_HOME/generated_images/<thread_id>/` (default
   `~/.codex/generated_images/…`) into the output directory without overwriting anything.
5. Verify the PNG structure and report the real pixel size.

`OPENAI_API_KEY` / `CODEX_API_KEY` are removed from the child environment so a run cannot
silently switch from the subscription to API billing. Set `IMAGINE_CODEX_BIN` to use a
specific Codex executable.

`--size` and `--quality` become aspect-ratio / quality instructions to the built-in tool;
the model picks the final pixel size (for example 1:1 → 1254×1254).

> **Upgrading from v1:** the `npx openai-oauth` proxy on port 10531 and the
> `IMAGINE_ENABLE_LEGACY_PROXY` switch are gone. Current Codex backends reject the v1 request
> (`400: Tool choice 'required' must be specified with 'tools' parameter`).

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
| `default_quality` | `low`, `medium`, `high` | Passed to the built-in tool as a quality instruction. |
| `default_size` | `1024x1024`, `1024x1536`, `1536x1024` | Square / portrait / landscape aspect ratio. |
| `default_format` | `png` | The runner writes and verifies PNG bytes. JPEG/WebP require a future real transcoding adapter; extensions are never relabeled. |
| `output_dir` | Any path | **Relative paths resolve against the current working directory.** The default `./images` means generated files land in `<project-root>/images/`. |

You can always override per-invocation with CLI flags:

```bash
node scripts/generate.js --prompt "..." --quality high --size 1536x1024 --n 4 --out-dir ./renders
```

---

## 5. Output directory conventions

- Default `output_dir` is `./images` (relative → resolved against `process.cwd()`).
- The directory is created on demand.
- Filenames are `imagine_<unix-ms>_<index>.png`; an existing file is never overwritten (a `-vN` suffix is added).
- Each `--n` image is a separate Codex session; at most two run at once.

---

## 6. History log

History is opt-in: set `IMAGINE_HISTORY=1` to append a redacted run receipt under
the active workspace's `.imagine/history.jsonl`. It is off by default and never
contains authentication data or image bytes.

---

## 7. Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `Codex CLI is not ready` | Codex is missing, outdated, or logged out. | `npm install -g @openai/codex@latest`, then `codex login`. |
| `Codex finished without producing an image` | The model answered without calling the tool, or refused. | Simplify the prompt and retry once. |
| `Codex did not finish within 300s` | Slow network or a usage-limit delay. | Wait and retry; reduce `--n`. |
| `Rate limit` in the Codex message | ChatGPT tier limit reached. | Wait a few minutes; reduce `--n`; use `--quality medium`. |
| Verification failures (`pngSignature`, `ihdrPresent`) | Corrupt copy. | Re-run the same prompt. |
| `ENOENT` on `config.json` | Config file deleted. | Scripts fall back to built-in defaults; recreate from §4 if you want persistent preferences. |

---

## 8. Uninstalling

Remove this skill folder through the host's normal plugin manager. Generated originals
stay under `~/.codex/generated_images/` until you delete them. Revoke a ChatGPT session
through the official Codex/ChatGPT account controls (`codex logout`).
