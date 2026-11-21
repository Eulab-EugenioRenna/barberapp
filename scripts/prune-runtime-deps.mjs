import { readdir, rm } from "node:fs/promises";
import { resolve, basename } from "node:path";

const root = process.argv[2];
if (!root || basename(resolve(root)) !== "node_modules") {
  throw new Error("Specify a node_modules directory");
}
const developmentDirectories = new Set([
  "test",
  "tests",
  "__tests__",
  "docs",
  "doc",
  "examples",
  "example",
  "coverage",
  ".github",
  ".vscode",
]);
let removed = 0;
async function prune(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const file = resolve(directory, entry.name);
    const legal =
      /^(licen[cs]e|notice|copying|authors)(\.|$)/i.test(entry.name) &&
      !/\.(?:map|ts|tsx|mts|cts)$/i.test(entry.name);
    const developmentFile =
      !legal &&
      (/\.(?:map|ts|tsx|mts|cts|md|markdown)$/i.test(entry.name) ||
        /^tsconfig(?:\..*)?\.json$/.test(entry.name));
    if (
      (entry.isDirectory() && developmentDirectories.has(entry.name)) ||
      (entry.isFile() && developmentFile)
    ) {
      await rm(file, { recursive: true, force: true });
      removed++;
    } else if (entry.isDirectory()) {
      await prune(file);
    }
  }
}
await prune(resolve(root));
console.log(
  `Removed ${removed} development files/directories; runtime assets and licenses retained.`,
);
