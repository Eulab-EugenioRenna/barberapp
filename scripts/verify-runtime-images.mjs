/** Read-only image checks. Never starts the API entrypoint or mounts data volumes. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const docker = (args) =>
  execFileSync("docker", args, {
    encoding: "utf8",
    stdio: "pipe",
    maxBuffer: 8 * 1024 * 1024,
  }).trim();
const inspect = (name) => JSON.parse(docker(["inspect", name]))[0];
const api = inspect("barber-api-1");
const image = process.argv[2] || api.Image;
const apiResult = JSON.parse(
  docker([
    "run",
    "--rm",
    "--network",
    "none",
    "--entrypoint",
    "node",
    image,
    "-e",
    readFileSync("docker/check-api-runtime.cjs", "utf8"),
  ]),
);
for (const name of [
  "barber-api-1",
  "barber-web-admin-1",
  "barber-web-public-booking-1",
]) {
  for (const mount of inspect(name).Mounts) {
    assert(
      ![
        "/app",
        "/app/apps",
        "/app/libs",
        "/app/dist",
        "/app/node_modules",
      ].some(
          (root) =>
            mount.Destination === root ||
            (root !== "/app" && mount.Destination.startsWith(root + "/")),
      ),
      `Source/build dependency mount: ${name}:${mount.Destination}`,
    );
    assert(!/\.(ts|tsx|mts|cts|map)$/.test(mount.Destination));
  }
}
const frontends = [];
for (const name of ["barber-web-admin-1", "barber-web-public-booking-1"]) {
  const files = docker([
    "exec",
    name,
    "find",
    "/usr/share/nginx/html",
    "-type",
    "f",
  ]).split("\n");
  assert(files.every((file) => !/\.(ts|tsx|mts|cts|map)$/.test(file)));
  assert(
    files.every(
      (file) => !file.includes("/src/") && !file.includes("/node_modules/"),
    ),
  );
  frontends.push({
    container: name,
    files: files.length,
    typescript: 0,
    sourceMaps: 0,
  });
}
console.log(
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      apiImageId: image,
      api: apiResult,
      frontends,
      sourceCodeMounts: 0,
      readOnly: true,
    },
    null,
    2,
  ),
);
