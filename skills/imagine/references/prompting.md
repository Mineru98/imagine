# Imagine prompting policy

## Three modes

### `faithful` (default)

Pass a direct image or edit request through unchanged. Preserve explicit
subject, composition, exact text, brand, ratio, quality, references, and
exclusions. Do not append generic quality boosters, negative prompts, or
creative details the user did not request.

### `assist` (opt-in)

For a vague or abstract request, use the existing `prompt-director` contract for
one pass only. Preserve user tokens and constraints, add only materially useful
structure (subject, action, setting, composition, lighting, mood), and show the
final prompt before generation. Do not recursively feed the result back to a
director or silently alter the user's brief.

### `concepts` (delegated creative work)

When the user explicitly requests different concepts, write one complete prompt
per output. Keep the shared subject, product/identity reference, exact copy,
brand requirements, ratio, quality, and exclusions in every prompt. Make the
composition and art direction genuinely different. Put ordering in job IDs and
filenames, never in prompt text such as “option 1 of 5”.

## Exact text and dense layouts

If exact copy, numbers, tables, charts, labels, grids, or dense UI structure
must be correct, generate the visual field and compose the discrete content in
HTML/CSS or an existing deterministic post-processor. Read the QA reference
after rendering and verify every word, number, and boundary. Do not rely on a
second image-model prompt to repair garbled text.

## Domain presets

Use a specialized `imagine-*` skill only when it changes a real output decision:

- hero/OG/thumbnail/poster/slide: safe zones and deterministic text placement;
- char: canonical character reference and continuity;
- pixel/sprite/pattern: integer grids and edge checks;
- logo/icon: generate visual directions, then vectorize or export through the
  existing local helper when exact geometry is required.

