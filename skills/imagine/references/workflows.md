# Imagine workflow contract

## Operation routing

| User intent | Operation | Primary input |
|---|---|---|
| Create from text | `generate` | no edit target |
| Create using a visual guide | `generate` + ordered references | reference files |
| Change an existing image | `edit` | exact edit target |
| Change the image just produced | `revision` | latest returned output |
| Keep an anchor while changing style or scene | `variation` | shared anchor |
| Produce multiple outputs | `batch` | ready jobs and dependency stages |

### Reference resolution

- Require a readable local PNG, JPEG, or WebP for every requested image input.
- The edit target is Image 1. Supporting references follow in the order the
  user supplied them. Add a role label only when the prompt does not already
  make the relationship clear.
- If the host exposes a conversation image but no readable path, ask the user
  to save it in the workspace. Never select the newest file from a cache and
  never replace a missing image with a prose description.
- Inspect a local edit target before generation when visual QA is required.

### Revision ancestry

Each native-tool or bridge call is ephemeral. On “change the result”, pass the
latest output as the edit target again and reattach all still-needed supporting
references. Reusing the original source is a new edit, not a revision.

## Batch scheduling

Classify a multi-output request once:

- A bare count or “repeat this prompt” repeats the exact prompt.
- “Different designs”, “concepts”, “directions”, “options”, or “alternatives”
  authorizes one standalone, materially different prompt per output while
  preserving the shared brief, references, copy, ratio, and exclusions.
- Same-design style variations share one read-only anchor. Identity-in-new-scene
  jobs use the same anchor as their first reference.
- Do not place an output-dependent revision in the same stage as its source.
  Generate the requested anchor first, then schedule dependent jobs.
- Default concurrency is 2 and the hard maximum is 4. A failed job is reported
  independently; never silently switch to an API route or create an extra
  hidden anchor.

For repeatable batches, keep one workspace-local manifest containing prompt,
input roles, output names, and requested constraints. Do not persist auth data,
image bytes, base64 payloads, or raw process stderr.

