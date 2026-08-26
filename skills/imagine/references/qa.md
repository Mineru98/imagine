# Imagine QA contract

## Deterministic checks

Before reporting success, verify every output:

1. The file exists in the active workspace and is non-empty.
2. Magic bytes and extension agree. A PNG must have a complete signature,
   IHDR, positive dimensions, and IEND. JPEG/WebP require real encoded bytes;
   renaming a PNG is not conversion.
3. The dimensions and aspect ratio are plausible for the requested use case.
4. Transparency is present only when it was requested and the output actually
   contains an alpha channel or transparency chunk.
5. A batch has unique output paths and no job reads another job's not-yet-created
   output.

## Visual acceptance

Inspect the actual rendered output, not only the model response. Check:

- requested subject, action, setting, composition, and style;
- each reference's intended role and identity continuity;
- exact text, numbers, labels, and safe zones;
- edit invariants and requested exclusions;
- clipping, overlap, malformed anatomy, seams, grid drift, and other obvious
  artifacts.

If a concrete requirement fails, make at most one targeted corrective edit. If
the result is merely a matter of taste, ask the user or use the opt-in
`visual-critic`; do not start an automatic regeneration loop.

