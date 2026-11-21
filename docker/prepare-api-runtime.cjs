const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const originalLockPath = "/tmp/alora-original-package-lock.json";
if (process.argv.includes("--verify")) {
  const original = JSON.parse(fs.readFileSync(originalLockPath, "utf8"));
  const installed = JSON.parse(fs.readFileSync("package-lock.json", "utf8"));
  for (const [name, entry] of Object.entries(installed.packages)) {
    if (!name) continue;
    assert.equal(entry.version, original.packages[name]?.version, name);
  }
  console.log("Runtime dependencies retain the existing locked versions.");
} else {
  const manifest = JSON.parse(fs.readFileSync("package.json", "utf8"));
  const lock = JSON.parse(fs.readFileSync("package-lock.json", "utf8"));
  fs.writeFileSync(originalLockPath, JSON.stringify(lock));
  const dependencies = {};
  for (const name of [...Object.keys(manifest.dependencies), "prisma"]) {
    if (name.startsWith("@angular/") || name === "zone.js") continue;
    const version = lock.packages[`node_modules/${name}`]?.version;
    assert(version, `Missing locked runtime dependency: ${name}`);
    dependencies[name] = manifest.dependencies[name]?.startsWith("file:")
      ? manifest.dependencies[name]
      : version;
  }
  fs.writeFileSync(
    "package.json",
    JSON.stringify(
      {
        name: manifest.name,
        version: manifest.version,
        private: true,
        dependencies,
      },
      null,
      2,
    ) + "\n",
  );

  // Preserve the explicit demo command as an executable; never execute it here.
  const ts = require("typescript");
  const output = ts.transpileModule(
    fs.readFileSync("scripts/create-demo-account.ts", "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
        sourceMap: false,
      },
    },
  );
  fs.mkdirSync(path.join("dist", "scripts"), { recursive: true });
  fs.writeFileSync("dist/scripts/create-demo-account.js", output.outputText);
}
