'use strict';

const path = require('path');

function tryRequire(relPath) {
  try {
    return require(relPath);
  } catch {
    return null;
  }
}

function missing(name) {
  return () => {
    throw new Error(`image-to-code: agent "${name}" is not yet implemented`);
  };
}

function loadConfig() {
  try {
    return require(path.join(__dirname, '..', '..', 'config.json'));
  } catch {
    return {};
  }
}

function resolveAgents(deps) {
  const d = deps || {};
  const inputNormalizerMod = tryRequire('./input-normalizer.js');
  const requestPlannerMod = tryRequire('./request-planner.js');
  const visionMod = tryRequire('./agents/vision-analyst.js');
  const layoutMod = tryRequire('./agents/layout-architect.js');
  const tokensMod = tryRequire('./agents/design-token-extractor.js');
  const assetsMod = tryRequire('./agents/asset-extractor.js');
  const a11yMod = tryRequire('./agents/a11y-advisor.js');
  const codeMod = tryRequire('./agents/code-generator.js');
  const verifierMod = tryRequire('./agents/visual-verifier.js');

  return {
    inputNormalizer:
      d.inputNormalizer ||
      (inputNormalizerMod && inputNormalizerMod.normalize) ||
      missing('input-normalizer'),
    requestPlanner:
      d.requestPlanner ||
      (requestPlannerMod && requestPlannerMod.plan) ||
      missing('request-planner'),
    visionAnalyst:
      d.visionAnalyst ||
      (visionMod && visionMod.analyze) ||
      missing('vision-analyst'),
    layoutArchitect:
      d.layoutArchitect ||
      (layoutMod && layoutMod.architect) ||
      missing('layout-architect'),
    designTokenExtractor:
      d.designTokenExtractor ||
      (tokensMod && tokensMod.extract) ||
      missing('design-token-extractor'),
    assetExtractor:
      d.assetExtractor ||
      (assetsMod && assetsMod.extract) ||
      missing('asset-extractor'),
    a11yAdvisor:
      d.a11yAdvisor ||
      (a11yMod && a11yMod.advise) ||
      missing('a11y-advisor'),
    codeGenerator:
      d.codeGenerator ||
      (codeMod && codeMod.generate) ||
      missing('code-generator'),
    visualVerifier:
      d.visualVerifier ||
      (verifierMod && verifierMod.verify) ||
      missing('visual-verifier'),
    finalize: d.finalize || defaultFinalize,
  };
}

function defaultFinalize(draft, extra) {
  return Object.assign({ ok: true, draft }, extra || {});
}

// Implements docs/image-to-code-design.md §4.1.
// Contract: agents never call each other. They only receive inputs passed
// by the orchestrator. Parallel fan-out is strict Promise.all — if any
// extractor blocks on a peer's intermediate state, that is a bug.
async function runPipeline(input, flags, deps) {
  const agents = resolveAgents(deps);
  const config = loadConfig();

  const normalized = await agents.inputNormalizer(input, flags, config);
  const plan = agents.requestPlanner(flags, config);

  const vision = await agents.visionAnalyst(normalized, plan);

  const [layout, tokens, assets, a11y] = await Promise.all([
    agents.layoutArchitect(vision),
    agents.designTokenExtractor(normalized, vision),
    agents.assetExtractor(normalized, vision),
    agents.a11yAdvisor(vision),
  ]);

  const firstDraft = await agents.codeGenerator({
    vision,
    layout,
    tokens,
    assets,
    a11y,
    plan,
    config,
  });

  const verdict = await agents.visualVerifier(firstDraft, normalized, config);
  if (verdict && verdict.pass) {
    return agents.finalize(firstDraft, { verdict });
  }

  const correctionLimit =
    typeof config.correction_passes === 'number' ? config.correction_passes : 1;
  if (correctionLimit < 1) {
    return agents.finalize(firstDraft, { verdict, warning: verdict });
  }

  const corrected = await agents.codeGenerator({
    vision,
    layout,
    tokens,
    assets,
    a11y,
    plan,
    config,
    corrections: verdict ? verdict.hotspots : null,
    previous: firstDraft,
  });

  const verdict2 = await agents.visualVerifier(corrected, normalized, config);
  const chosen = verdict2 && verdict2.pass ? corrected : firstDraft;
  return agents.finalize(chosen, { verdict: verdict2, warning: verdict2 });
}

module.exports = {
  runPipeline,
  resolveAgents,
};
