---
name: imagine
description: Create or edit workspace-bound raster images, including reference-guided generation, precise revisions, variations, and bounded batches. Use when a user asks for an AI-generated bitmap asset or invokes imagine. Do not use for SVG/HTML/code-native graphics, ordinary crop/resize/compression, image-to-code reconstruction, or visual analysis that does not generate an image.
metadata:
  short-description: "Reference-safe image generation and editing for Imagine"
---

# Imagine

`imagine` is the friendly, domain-aware image workflow for this plugin. Keep the
user's creative intent and the project's assets safe while using the host's
native image tool whenever it is available.

Read the focused references only when they apply:

- [workflows.md](references/workflows.md) for operation routing, real image
  references, latest-result revisions, and multi-image batches.
- [prompting.md](references/prompting.md) for faithful, assisted, and delegated
  concept prompts plus domain presets.
- [qa.md](references/qa.md) for deterministic and visual acceptance checks.
- [installation.md](reference/installation.md) only for the legacy local CLI
  setup or a user-requested troubleshooting session.

## Operating contract

1. **Route the intent before generating.** Choose `generate`, `edit`,
   `revision`, `variation`, or `batch`. A request to turn an image into HTML,
   CSS, or a component belongs to `image-to-code`, not this skill. Ask one
   concise A/B question only when the requested operation is genuinely
   ambiguous.
2. **Prefer the host-native image tool.** Use the actual `image_gen`/`image_edit`
   input mechanism and pass every requested local image as an image input. If a
   supported subscription bridge is already installed by the host, use it
   instead of an ad-hoc API endpoint or third-party proxy.
3. **Treat references as files, never as prose substitutes.** Resolve every
   path, inspect edit targets when needed, and label inputs by role (edit
   target, identity/content, style, or compositing insert). Never guess from a
   cache or silently omit an unresolved image.
4. **Preserve direct prompts.** Keep explicit subject, exact copy, brand names,
   exclusions, ratio, quality, and invariants. Do not add “masterpiece”,
   “8K”, negative prompts, or invented brand details. If the user opts into
   assistance, make one transparent rewrite and show the final prompt before
   generation; do not recursively rewrite it.
5. **Keep revision ancestry.** “Change the result” means edit the latest output,
   not the original source. Reattach the latest target and every still-needed
   reference on each new invocation.
6. **Batch deliberately.** A bare count repeats the same prompt. Words such as
   “different concepts”, “directions”, “options”, or “alternatives” delegate
   creative variation: make one complete, materially distinct prompt per
   output and keep orchestration metadata out of the prompt. Run independent
   jobs with concurrency 2 by default and never above 4; keep output-dependent
   revisions sequential and never create a hidden anchor.
7. **Save safely.** Keep outputs inside the active workspace by default, use a
   descriptive non-conflicting filename, and refuse overwrite unless the user
   explicitly asks for it. Stage output before committing it. Do not claim
   JPEG/WebP when the bytes are PNG; either perform a real conversion or use
   PNG-only output.
8. **Validate before reporting success.** Confirm each output exists, decodes,
   matches its extension, has plausible dimensions, and satisfies requested
   alpha/transparency. Inspect the rendered result for subject, layout, exact
   text, reference roles, preservation constraints, and obvious artifacts.
   Permit at most one targeted corrective generation for an observable failure;
   never run an automatic taste loop.
9. **Disclose the transport honestly.** Model-backed edits transmit the image
   to the configured generation service. Never expose or request API keys,
   never read authentication files, and never describe subscription usage as
   free or unlimited. Keep prompt history opt-in and workspace-scoped; do not
   write credentials, image bytes, or raw downstream stderr to a log.

## Domain-aware finishing

Keep the plugin's domain strengths when they change a real decision:

- Hero, OG, thumbnail, poster, and slide assets: generate the visual field,
  then put exact copy and dense layout in deterministic composition code when
  typography must be exact.
- Character or product series: establish one canonical reference, then derive
  later scenes or styles from that anchor.
- Pixel, sprite, and seamless-pattern assets: use the existing deterministic
  post-processors and run their grid/edge checks; do not ask the image model to
  draw exact grids or labels.
- `visual-critic` stays opt-in. It may report bounded suggestions, but it must
  not silently trigger regeneration.

## Delivery

For every successful output, show the inline image and report its absolute
workspace path. For a batch, report each path and any failed job separately.
Include the final prompt only when it was assisted or delegated; direct prompts
remain unchanged. If a required constraint could not be met, say so instead of
claiming success.
