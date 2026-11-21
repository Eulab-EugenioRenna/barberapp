/** Step 14 technical rehearsal, not commercial acceptance.
 * Reads the live database/uploads; restores only into owned, internal Docker resources.
 * No real login, external provider, source configuration change or main deployment.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const stamp = Date.now(),
  prefix = `alora-step14-restore-${stamp}`;
const directory = `.local/step14/restore-${stamp}`;
mkdirSync(directory, { recursive: true, mode: 0o700 });
const network = prefix + "-net",
  db = prefix + "-db",
  redis = prefix + "-redis";
const volumes = [],
  containers = [];
let networkCreated = false;
const checks = [];
const run = (args, input, binary = false) =>
  execFileSync("docker", args, {
    input,
    encoding: binary ? undefined : "utf8",
    stdio: "pipe",
    maxBuffer: 128 * 1024 * 1024,
  });
const docker = (args, input) => run(args, input).trim();
const privateWrite = (name, contents) =>
  writeFileSync(directory + "/" + name, contents, { mode: 0o600 });
const inspectMain = () =>
  Object.fromEntries(
    ["barber-api-1", "barber-web-admin-1", "barber-web-public-booking-1"].map(
      (name) => {
        const value = JSON.parse(docker(["inspect", name]))[0];
        assert.equal(value.State.Health.Status, "healthy");
        return [name, value.Image];
      },
    ),
  );
const mainImages = inspectMain();
const sourceSchemaQuery=`SELECT to_regclass('public."NotificationDomainEvent"') IS NULL, to_regclass('public."AppointmentAutomationPolicy"') IS NULL, (SELECT count(*) FROM _prisma_migrations WHERE migration_name LIKE '20261109%')`;
const originalSourceSchema=docker(["exec","barber-postgres-1","psql","-X","-U","barber","-d","barber","-Atqc",sourceSchemaQuery]);

const runtimeOnlyCandidate = process.env.ALORA_RUNTIME_ONLY_CANDIDATE === "1";
const eventNoticesCandidate = runtimeOnlyCandidate || process.env.ALORA_STEP12_EVENT_NOTICES_CANDIDATE === "1";
const workflowCandidate = eventNoticesCandidate || process.env.ALORA_STEP12_WORKFLOW_CANDIDATE === "1";
const withdrawalCandidate =
  workflowCandidate || process.env.ALORA_STEP12_WITHDRAWAL_CANDIDATE === "1";
const connectCandidate =
  withdrawalCandidate || process.env.ALORA_STEP12_CONNECT_CANDIDATE === "1";
const candidate = runtimeOnlyCandidate ? "alora-runtime-only-api:20261111" : eventNoticesCandidate ? "alora-step12-events-candidate-api:20261111" : workflowCandidate
  ? "alora-step12-workflow-candidate-api:20261111"
  : withdrawalCandidate
    ? "alora-step12-withdrawal-candidate-api:20261110"
    : connectCandidate
      ? "alora-step12-connect-candidate-api:20261110"
      : "alora-step12-policy-candidate-api:20261109";
const artifact = JSON.parse(
  readFileSync(
    runtimeOnlyCandidate ? ".local/runtime-only-20261111/artifact-result.json" : eventNoticesCandidate ? ".local/step12/events-docker/artifact-result.json" : workflowCandidate
      ? ".local/step12/workflow-docker/artifact-result.json"
      : withdrawalCandidate
        ? ".local/step12/withdrawal-docker/artifact-result.json"
        : connectCandidate
          ? ".local/step12/connect-docker/artifact-result.json"
          : ".local/step12/policy-docker/artifact-result.json",
    "utf8",
  ),
);
assert.equal(
  docker(["image", "inspect", "--format", "{{.Id}}", candidate]),
  artifact.checks.find((c) => c.name === "api").imageId,
);
const createContainer = (name, args) => {
  docker(["run", "-d", "--name", name, "--network", network, ...args]);
  containers.push(name);
  return name;
};
const removeContainer = (name) => {
  if (docker(["ps", "-aq", "--filter", `name=^/${name}$`]))
    docker(["rm", "-f", name]);
};
const newVolume = (suffix) => {
  const name = prefix + "-" + suffix;
  docker(["volume", "create", "--label", `alora.qa=${prefix}`, name]);
  volumes.push(name);
  return name;
};
const volumeCommand = (volume, command, input, binary = false) =>
  run(
    [
      "run",
      "--rm",
      "-i",
      "--network",
      "none",
      "-v",
      `${volume}:/restore`,
      "--entrypoint",
      command[0],
      candidate,
      ...command.slice(1),
    ],
    input,
    binary,
  );
const manifestScript = `const fs=require('fs'),p=require('path'),c=require('crypto');const base=process.argv[1],rows=[];function walk(dir){for(const name of fs.readdirSync(dir).sort()){const file=p.join(dir,name),s=fs.lstatSync(file),relative=p.relative(base,file);if(s.isSymbolicLink())rows.push({path:relative,type:'symlink',target:fs.readlinkSync(file),mode:s.mode&4095});else if(s.isDirectory()){rows.push({path:relative,type:'directory',mode:s.mode&4095});walk(file)}else if(s.isFile())rows.push({path:relative,type:'file',bytes:s.size,sha256:c.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),mode:s.mode&4095});else throw Error('Unsupported upload node')} }walk(base);console.log(JSON.stringify(rows));`;
const volumeManifest = (volume) =>
  JSON.parse(volumeCommand(volume, ["node", "-e", manifestScript, "/restore"]));
const sourceManifest = () =>
  JSON.parse(
    docker([
      "exec",
      "barber-api-1",
      "node",
      "-e",
      manifestScript,
      "/app/uploads",
    ]),
  );
const sql = (statement) =>
  docker(
    [
      "exec",
      "-i",
      db,
      "psql",
      "-X",
      "-U",
      "barber",
      "-d",
      "restore",
      "-At",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    statement,
  );
const identifier = (value) => '"' + value.replaceAll('"', '""') + '"';
const literal = (value) => "'" + value.replaceAll("'", "''") + "'";
async function ready(action) {
  let last;
  for (let n = 0; n < 60; n++) {
    try {
      return action();
    } catch (error) {
      last = error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw last;
}
const health = (name) =>
  docker([
    "exec",
    name,
    "node",
    "-e",
    "fetch('http://127.0.0.1:3000/health').then(r=>{if(!r.ok)throw Error('Health '+r.status);console.log('PASS')}).catch(e=>{console.error(e.message);process.exit(1)})",
  ]);
const boot = async (suffix, image, uploads) => {
  const name = prefix + "-" + suffix;
  createContainer(name, [
    "-e",
    `DATABASE_URL=postgresql://barber:isolated-restore-only@${db}:5432/restore?schema=public`,
    "-e",
    `DB_HOST=${db}`,
    "-e",
    "DB_PORT=5432",
    "-e",
    `REDIS_HOST=${redis}`,
    "-e",
    "REDIS_PORT=6379",
    "-e",
    "SMTP_HOST=127.0.0.1",
    "-e",
    "SMTP_PORT=9",
    "-e",
    "ADMIN_APP_URL=http://127.0.0.1:53020",
    "-e",
    "PUBLIC_APP_URL=http://127.0.0.1:53020",
    "-v",
    `${uploads}:/app/uploads`,
    image,
  ]);
  await ready(() => assert.equal(health(name), "PASS"));
  const state = JSON.parse(docker(["inspect", name]))[0];
  assert.deepEqual(Object.keys(state.NetworkSettings.Networks), [network]);
  assert(
    !state.HostConfig.PortBindings ||
      Object.keys(state.HostConfig.PortBindings).length === 0,
  );
  assert(state.Mounts.every((m) => m.Type === "volume" && m.Name === uploads));
  return name;
};
try {
  const dump = run(
    [
      "exec",
      "barber-postgres-1",
      "pg_dump",
      "-U",
      "barber",
      "-d",
      "barber",
      "-Fc",
    ],
    undefined,
    true,
  );
  privateWrite("before.dump", dump);
  privateWrite(
    "backup-list.txt",
    docker(["exec", "-i", "barber-postgres-1", "pg_restore", "--list"], dump),
  );
  const uploadBefore = sourceManifest();
  const sourceArchive = run(
    ["exec", "barber-api-1", "tar", "-C", "/app/uploads", "-cf", "-", "."],
    undefined,
    true,
  );
  privateWrite("source-uploads.tar", sourceArchive);
  checks.push(
    "fresh-database-and-upload-archives-read-without-stopping-or-changing-main-services",
  );

  docker(["network", "create", "--internal", network]);
  networkCreated = true;
  assert.equal(
    JSON.parse(docker(["network", "inspect", network]))[0].Internal,
    true,
  );
  createContainer(db, [
    "--tmpfs",
    "/var/lib/postgresql/data:rw,nosuid,size=256m",
    "-e",
    "POSTGRES_DB=restore",
    "-e",
    "POSTGRES_USER=barber",
    "-e",
    "POSTGRES_PASSWORD=isolated-restore-only",
    "postgres:16-alpine",
  ]);
  createContainer(redis, [
    "--tmpfs",
    "/data:rw,nosuid,size=64m",
    "redis:7-alpine",
    "redis-server",
    "--save",
    "",
    "--appendonly",
    "no",
  ]);
  await ready(() =>
    docker(["exec", db, "pg_isready", "-U", "barber", "-d", "restore"]),
  );
  await ready(() =>
    assert.equal(docker(["exec", redis, "redis-cli", "ping"]), "PONG"),
  );
  const restoreDatabase = () =>
    docker(
      [
        "exec",
        "-i",
        db,
        "pg_restore",
        "-U",
        "barber",
        "-d",
        "restore",
        "--no-owner",
        "--no-acl",
        "--exit-on-error",
      ],
      dump,
    );
  restoreDatabase();
  assert.equal(
    sql(
      `SELECT to_regclass('public."NotificationDomainEvent"') IS NULL, to_regclass('public."AppointmentAutomationPolicy"') IS NULL`,
    ),
    originalSourceSchema.split("|").slice(0,2).join("|"),
  );
  const columns = JSON.parse(
    sql(
      `SELECT json_object_agg(t,c) FROM (SELECT table_name t,json_agg(column_name ORDER BY ordinal_position)c FROM information_schema.columns WHERE table_schema='public' AND table_name<>'_prisma_migrations' GROUP BY table_name)x`,
    ),
  );
  const snapshot = () =>
    JSON.parse(
      sql(
        `SELECT json_object_agg(t,v) FROM (VALUES ${Object.entries(columns)
          .map(
            ([table, names]) =>
              `(${literal(table)},(SELECT count(*)||':'||md5(coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'[]')) FROM (SELECT ${names.map(identifier).join(",")} FROM ${identifier(table)})x))`,
          )
          .join(",")})q(t,v)`,
      ),
    );
  const original = snapshot();
  privateWrite(
    "original-private-snapshot.json",
    JSON.stringify({ columns, hashes: original }),
  );
  const stage = newVolume("media-stage");
  volumeCommand(stage, ["tar", "-C", "/restore", "-xf", "-"], sourceArchive);
  assert.deepEqual(volumeManifest(stage), uploadBefore);
  const fixtureFolder = `tenants/step14-synthetic-${stamp}`;
  volumeCommand(stage, [
    "node",
    "-e",
    `const fs=require('fs'),p=require('path'),root='/restore/'+process.argv[1];if(fs.existsSync(root))throw Error('Fixture collision');fs.mkdirSync(root,{recursive:true});fs.writeFileSync(p.join(root,'logo.png'),Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jQ1kAAAAASUVORK5CYII=','base64'));fs.writeFileSync(p.join(root,'campione à.txt'),'Solo collaudo isolato ALORA\\n');fs.writeFileSync(p.join(root,'vuoto.txt'),'');fs.chmodSync(p.join(root,'campione à.txt'),0o600);fs.symlinkSync('logo.png',p.join(root,'logo-link.png'));`,
    fixtureFolder,
  ]);
  const expectedMedia = volumeManifest(stage);
  assert(
    expectedMedia.some(
      (f) =>
        f.path === fixtureFolder + "/logo-link.png" &&
        f.type === "symlink" &&
        f.target === "logo.png",
    ),
  );
  assert(
    expectedMedia.some(
      (f) => f.path === fixtureFolder + "/campione à.txt" && f.mode === 0o600,
    ),
  );
  const mediaArchive = volumeCommand(
    stage,
    ["tar", "-C", "/restore", "-cf", "-", "."],
    undefined,
    true,
  );
  privateWrite("synthetic-media-restore.tar", mediaArchive);
  privateWrite("media-private-manifest.json", JSON.stringify(expectedMedia));
  const restoreMedia = (suffix) => {
    const volume = newVolume(suffix);
    volumeCommand(volume, ["tar", "-C", "/restore", "-xf", "-"], mediaArchive);
    assert.deepEqual(volumeManifest(volume), expectedMedia);
    return volume;
  };
  const uploads = restoreMedia("media-restore");
  checks.push(
    "database-restores-before-migration-and-upload-archive-restores-byte-identical-paths-types-modes-and-symlinks",
  );
  const probeFiles = (name) => {
    const files = expectedMedia.filter(
      (f) => f.type === "file" && f.path.startsWith(fixtureFolder + "/"),
    );
    assert.equal(files.length, 3);
    const code = `(async()=>{const c=require('crypto');for(const f of ${JSON.stringify(files)}){const r=await fetch('http://127.0.0.1:3000/uploads/'+f.path.split('/').map(encodeURIComponent).join('/'));if(r.status!==200)throw Error('Fixture HTTP '+r.status);const b=Buffer.from(await r.arrayBuffer());if(c.createHash('sha256').update(b).digest('hex')!==f.sha256)throw Error('Fixture bytes')}console.log('PASS')})().catch(e=>{console.error(e.message);process.exit(1)})`;
    assert.equal(docker(["exec", name, "node", "-e", code]), "PASS");
  };
  const candidateApi = await boot("candidate", candidate, uploads);
  probeFiles(candidateApi);
  await new Promise((resolve) => setTimeout(resolve, 11000));
  privateWrite("candidate-api.log", docker(["logs", candidateApi]));
  removeContainer(candidateApi);
  assert.deepEqual(snapshot(), original);
  assert.equal(
    sql(
      `SELECT count(*) FROM _prisma_migrations WHERE migration_name LIKE '20261109%' AND finished_at IS NOT NULL`,
    ),
    "3",
  );
  assert.equal(
    sql(
      'SELECT (SELECT count(*) FROM "NotificationDomainEvent")||\'|\'||(SELECT count(*) FROM "AppointmentAutomationPolicy")',
    ),
    "0|0",
  );
  assert.deepEqual(volumeManifest(uploads), expectedMedia);
  checks.push(
    eventNoticesCandidate ? "candidate-normal-entrypoint-applies-nine-automation-migrations-and-preserves-existing-workflow-data-and-media" : workflowCandidate
      ? "candidate-normal-entrypoint-applies-eight-migrations-and-boots-on-restored-data-with-consents-and-plans-dormant"
      : withdrawalCandidate
        ? "candidate-normal-entrypoint-applies-six-migrations-with-SDK-012-rc2-and-boots-on-restored-current-data-with-all-original-columns-and-media-preserved"
        : connectCandidate
          ? "candidate-normal-entrypoint-applies-five-migrations-with-SDK-012-and-boots-on-restored-current-data-with-all-original-columns-and-media-preserved"
          : "candidate-normal-entrypoint-applies-three-migrations-and-boots-on-restored-current-data-with-all-original-columns-and-media-preserved",
  );
  if (connectCandidate)
    assert.equal(
      sql(
        `SELECT (SELECT count(*) FROM _prisma_migrations WHERE migration_name LIKE '20261110%' AND finished_at IS NOT NULL), (SELECT count(*) FROM "NotificationAutomationGrant"), (SELECT count(*) FROM "NotificationAutomationWebhook"), (SELECT count(*) FROM "NotificationAutomationWebhookEvent");`,
      ),
      `${workflowCandidate ? 5 : withdrawalCandidate ? 3 : 2}|0|0|0`,
    );

  if (withdrawalCandidate)
    assert.equal(
      sql('SELECT count(*) FROM "NotificationAutomationCommand"'),
      "0",
    );
  if (workflowCandidate) {
    for (const table of [
      "AppointmentAutomationRun",
      "AppointmentAutomationAction",
      "AppointmentAutomationDelivery",
    ])
      assert.equal(sql(`SELECT count(*) FROM "${table}"`), "0");
    assert.equal(
      sql('SELECT count(*) FROM "Sale" WHERE "automationContact" IS NOT NULL'),
      "0",
    );
  }
  if(eventNoticesCandidate){
    assert.equal(sql(`SELECT count(*) FROM _prisma_migrations WHERE migration_name='20261111200000_appointment_event_notices' AND finished_at IS NOT NULL`),"1");
    assert.equal(sql('SELECT count(*) FROM "AppointmentAutomationDelivery" WHERE "noticeContext" IS NOT NULL'),"0");
  }
  const binaryRollback = await boot(
    "binary-rollback",
    mainImages["barber-api-1"],
    uploads,
  );
  probeFiles(binaryRollback);
  privateWrite("binary-rollback-api.log", docker(["logs", binaryRollback]));
  removeContainer(binaryRollback);
  assert.deepEqual(snapshot(), original);
  assert.deepEqual(volumeManifest(uploads), expectedMedia);
  checks.push(
    eventNoticesCandidate ? "previous-workflow-image-boots-on-event-notice-schema-before-new-writes-with-original-data-and-media" : "actual-Step-10-image-boots-on-additively-upgraded-copy-and-serves-restored-media-without-changing-original-data",
  );

  docker(["exec", db, "dropdb", "-U", "barber", "--force", "restore"]);
  docker(["exec", db, "createdb", "-U", "barber", "restore"]);
  restoreDatabase();
  assert.deepEqual(snapshot(), original);
  assert.equal(
    sql(
      `SELECT to_regclass('public."NotificationDomainEvent"') IS NULL, to_regclass('public."AppointmentAutomationPolicy"') IS NULL`,
    ),
    originalSourceSchema.split("|").slice(0,2).join("|"),
  );
  const coldUploads = restoreMedia("media-cold-restore");
  const coldRollback = await boot(
    "cold-rollback",
    mainImages["barber-api-1"],
    coldUploads,
  );
  probeFiles(coldRollback);
  privateWrite("cold-rollback-api.log", docker(["logs", coldRollback]));
  removeContainer(coldRollback);
  assert.deepEqual(snapshot(), original);
  assert.deepEqual(volumeManifest(coldUploads), expectedMedia);
  checks.push(
    eventNoticesCandidate ? "cold-restore-boots-retained-workflow-image-and-restores-original-data-and-media" : "cold-restore-from-retained-database-and-media-archives-boots-the-original-Step-10-image-with-unchanged-data",
  );
  assert.deepEqual(inspectMain(), mainImages);
  assert.equal(
    docker([
      "exec",
      "barber-postgres-1",
      "psql",
      "-X",
      "-U",
      "barber",
      "-d",
      "barber",
      "-Atqc",
      `SELECT to_regclass('public."NotificationDomainEvent"') IS NULL, to_regclass('public."AppointmentAutomationPolicy"') IS NULL, (SELECT count(*) FROM _prisma_migrations WHERE migration_name LIKE '20261109%')`,
    ]),
    originalSourceSchema,
  );
  assert.deepEqual(sourceManifest(), uploadBefore);
  checks.push(
    "main-image-identities-health-schema-and-source-uploads-remain-unchanged-and-no-source-write-was-issued",
  );
  const result = {
    checkedAt: new Date().toISOString(),
    checks,
    candidateImageId: artifact.checks.find((c) => c.name === "api").imageId,
    candidateTag: candidate,
    candidateMigrationCount: eventNoticesCandidate ? 9 : workflowCandidate
      ? 8
      : withdrawalCandidate
        ? 6
        : connectCandidate
          ? 5
          : 3,
    rollbackImageId: mainImages["barber-api-1"],
    originalTablesUnchanged: Object.keys(columns).length,
    originalColumnsUnchanged: Object.values(columns).reduce(
      (n, c) => n + c.length,
      0,
    ),
    sourceUploadFiles: uploadBefore.filter((f) => f.type === "file").length,
    syntheticUploadFixtures: 3,
    syntheticSymlinkFixtures: 1,
    originalMediaArchiveSha256: createHash("sha256")
      .update(sourceArchive)
      .digest("hex"),
    sourceOperationsReadOnly: true,
    mainRuntimeUpdated: false,
    sourceConfigurationChanged: false,
    realAccountSessionsCreated: false,
    copiedAccountRowsUnchanged: true,
    realProviderMessages: false,
    networkInternal: true,
    hostPortsPublished: false,
    productionDeployment: false,
    commercialAcceptance: false,
    limits: [
      "Live source was not quiesced; concurrent database/media point-in-time consistency is not certified",
      "Source uploads were empty; non-empty media recovery used synthetic files only in isolated volumes",
      "Binary rollback is verified before any post-upgrade user writes or provider effects",
      "Redis queues, external Connect configuration/keys, DNS/TLS and production infrastructure recovery are not covered",
      "No real login, provider delivery or customer acceptance was attempted",
    ],
    evidence: directory + "/result.json",
  };
  privateWrite("result.json", JSON.stringify(result, null, 2) + "\n");
  mkdirSync(".local/step14", { recursive: true, mode: 0o700 });
  writeFileSync(
    ".local/step14/restore-result.json",
    JSON.stringify(result, null, 2) + "\n",
    { mode: 0o600 },
  );
  console.log(JSON.stringify(result));
} catch (error) {
  for (const name of containers)
    try {
      privateWrite(name + ".log", docker(["logs", name]));
    } catch {}
  throw error;
} finally {
  for (const name of [...containers].reverse()) removeContainer(name);
  for (const name of [...volumes].reverse()) docker(["volume", "rm", name]);
  if (networkCreated) docker(["network", "rm", network]);
  privateWrite(
    "cleanup.json",
    JSON.stringify({
      checkedAt: new Date().toISOString(),
      ownedContainersRemoved: containers.every(
        (name) => !docker(["ps", "-aq", "--filter", `name=^/${name}$`]),
      ),
      ownedVolumesRemoved: volumes.every(
        (name) => !docker(["volume", "ls", "-q", "--filter", `name=^${name}$`]),
      ),
      networkRemoved: !docker([
        "network",
        "ls",
        "-q",
        "--filter",
        `name=^${network}$`,
      ]),
    }) + "\n",
  );
}
