#!/usr/bin/env node
'use strict';

const HELP = `image-to-code — convert a design image into HTML + Tailwind CSS

Usage:
  node run.js <image> [options]

Options:
  <image>               Path to the source image (screenshot / mockup / export).
  --out <dir>           Output directory. Default: ./pages/<slug>/
  --strict              Fail (exit 1) if diff score < 0.90.
  --explore             Generate 3 alternative layouts (opt-in).
  --tokens <path>       Force design tokens from a JSON file.
  --help, -h            Show this help and exit.

Defaults live in config.json (diff_threshold, tailwind_mode, output_dir, ...).
Results are written to ./pages/<slug>/ — the project-root index.html is never overwritten.
`;

function parseFlags(argv) {
  const flags = { input: null, out: null, strict: false, explore: false, tokens: null };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--help' || token === '-h') {
      flags.help = true;
    } else if (token === '--strict') {
      flags.strict = true;
    } else if (token === '--explore') {
      flags.explore = true;
    } else if (token === '--out') {
      flags.out = argv[++i];
    } else if (token === '--tokens') {
      flags.tokens = argv[++i];
    } else if (!token.startsWith('--') && flags.input === null) {
      flags.input = token;
    }
  }
  return flags;
}

function main(argv) {
  const flags = parseFlags(argv);

  if (flags.help || (argv.length === 0)) {
    process.stdout.write(HELP);
    return 0;
  }

  if (!flags.input) {
    process.stderr.write('Error: missing <image> argument. Use --help for usage.\n');
    return 1;
  }

  const { runPipeline } = require('./lib/orchestrator.js');
  return Promise.resolve(runPipeline(flags.input, flags))
    .then(() => 0)
    .catch((err) => {
      process.stderr.write(`Error: ${err && err.message ? err.message : err}\n`);
      return 1;
    });
}

Promise.resolve(main(process.argv.slice(2))).then((code) => {
  if (typeof code === 'number' && code !== 0) process.exit(code);
});
