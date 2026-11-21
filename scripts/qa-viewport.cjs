/* Explicit viewport overrides for disposable browser acceptance, with separate artifacts. */
const fs = require("node:fs");
const path = require("node:path");
const name = process.env.ALORA_QA_VIEWPORT || "";
const choices = {
  "tablet-landscape": { width: 1180, height: 820 },
  "tablet-portrait": { width: 820, height: 1180 },
};
if (name && !choices[name])
  throw new Error(
    "ALORA_QA_VIEWPORT must be tablet-landscape or tablet-portrait",
  );
exports.qaViewportName = name || "desktop-and-mobile";
exports.qaViewport = (fallback) => (name ? choices[name] : fallback);
exports.qaChecks = (checks) =>
  name ? checks.map((check) => check.replace(/desktop|mobile/g, name)) : checks;
exports.qaArtifactPath = (original) => {
  if (!name) return original;
  const target = path.join(".local/step13", name, path.basename(original));
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  return target;
};
