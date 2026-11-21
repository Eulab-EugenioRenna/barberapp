// A runtime image has no npm. Compare executable SDK files with the pinned tarball.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { tmpdir } = require("node:os");
const { execFileSync } = require("node:child_process");

if (process.env.ALORA_WHATSAPP_TEST_ONLY !== "1") {
  throw new Error("Disposable WhatsApp QA runtime required");
}
const temporary = fs.mkdtempSync(path.join(tmpdir(), "alora-sdk-check-"));
try {
  execFileSync("tar", ["-xzf", "/qa-sdk.tgz", "-C", temporary], {
    stdio: "pipe",
  });
  const expected = path.join(temporary, "package");
  const installed = "/app/node_modules/@eulab/connect";
  const metadata = (root) =>
    JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(metadata(installed).version, metadata(expected).version);
  let files = 0;
  function compare(directory) {
    for (const entry of fs.readdirSync(path.join(expected, directory), {
      withFileTypes: true,
    })) {
      const relative = path.join(directory, entry.name);
      if (entry.isDirectory()) compare(relative);
      else if (/\.(js|mjs|cjs|json)$/.test(entry.name)) {
        assert(
          fs
            .readFileSync(path.join(expected, relative))
            .equals(fs.readFileSync(path.join(installed, relative))),
          `SDK differs: ${relative}; rebuild the API image before QA`,
        );
        files++;
      }
    }
  }
  compare("dist");
  assert(files > 0);
  console.log(
    `Installed SDK executable files match the pinned archive: ${files}`,
  );
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
