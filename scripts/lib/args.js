'use strict';

function coerce(value, type, flagName) {
  if (type === 'string') return String(value);
  if (type === 'number') {
    const num = Number(value);
    if (Number.isNaN(num)) {
      console.error(`Error: --${flagName} must be a number (got "${value}")`);
      process.exit(1);
    }
    return num;
  }
  if (type === 'boolean') {
    if (value === true || value === 'true' || value === '1') return true;
    if (value === false || value === 'false' || value === '0') return false;
    console.error(`Error: --${flagName} must be a boolean (got "${value}")`);
    process.exit(1);
  }
  return value;
}

function parseArgs(argv, schema) {
  const result = {};
  const args = Array.isArray(argv) ? argv.slice() : [];
  const known = new Set(Object.keys(schema || {}));

  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (typeof token !== 'string' || !token.startsWith('--')) continue;

    let name;
    let rawValue;
    const eqIdx = token.indexOf('=');
    if (eqIdx !== -1) {
      name = token.slice(2, eqIdx);
      rawValue = token.slice(eqIdx + 1);
    } else {
      name = token.slice(2);
      const next = args[i + 1];
      const spec = schema[name];
      if (spec && spec.type === 'boolean' && (next === undefined || (typeof next === 'string' && next.startsWith('--')))) {
        rawValue = true;
      } else {
        rawValue = next;
        i++;
      }
    }

    if (!known.has(name)) {
      console.warn(`Warning: unknown flag --${name} ignored`);
      continue;
    }

    const spec = schema[name];
    const value = coerce(rawValue, spec.type, name);

    if (Array.isArray(spec.enum) && !spec.enum.includes(value)) {
      console.error(`Error: --${name} must be one of [${spec.enum.join(', ')}] (got "${value}")`);
      process.exit(1);
    }

    result[name] = value;
  }

  for (const [name, spec] of Object.entries(schema || {})) {
    if (result[name] === undefined) {
      if (spec.default !== undefined) {
        result[name] = spec.default;
      } else if (spec.required) {
        console.error(`Error: missing required flag --${name}`);
        process.exit(1);
      }
    }
  }

  return result;
}

module.exports = { parseArgs };
