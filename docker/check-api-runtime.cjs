const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const counts = { files: 0, typescript: 0, sourceMaps: 0 };
function scan(directory) {
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    if (item.isSymbolicLink()) continue;
    const file = path.join(directory, item.name);
    if (item.isDirectory()) scan(file);
    else {
      counts.files++;
      if (/\.(ts|tsx|mts|cts)$/.test(file)) counts.typescript++;
      if (file.endsWith(".map")) counts.sourceMaps++;
    }
  }
}
scan("/app");
assert.equal(counts.typescript, 0);
assert.equal(counts.sourceMaps, 0);
for (const entry of ["apps", "libs", "tests", "vendor", ".env", ".git"]) {
  assert(!fs.existsSync("/app/" + entry), entry);
}
for (const entry of ["npm", "npx", "yarn", "yarnpkg", "corepack"]) {
  assert(!fs.existsSync("/usr/local/bin/" + entry), entry);
}
for (const name of [
  "typescript",
  "ts-node",
  "jest",
  "@nestjs/cli",
  "@angular/core",
]) {
  assert.throws(() => require.resolve(name), name);
}
assert.equal(fs.readdirSync("/app/scripts").join(","), "prisma-bootstrap.js");
assert(fs.existsSync("/app/dist/scripts/create-demo-account.js"));
assert(fs.existsSync(require.resolve("prisma")));
const bcrypt = require("bcrypt");
assert(bcrypt.compareSync("runtime-only", bcrypt.hashSync("runtime-only", 4)));
assert(require("@prisma/client").Prisma.dmmf.datamodel.models.length > 0);
Promise.all([
  import("@eulab/connect/server"),
  import("@eulab/connect/application"),
])
  .then(() =>
    console.log(JSON.stringify({ ...counts, runtimeDependencies: "passed" })),
  )
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
