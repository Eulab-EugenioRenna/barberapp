# Historical Connect SDK artifacts

ALORA now installs **[@eulab/connect@0.10.0 from npm](https://www.npmjs.com/package/@eulab/connect/v/0.10.0)**. The root package pins the exact version; the lockfile contains the public registry URL and SHA-512 integrity. Docker dependency stages use npm ci and do not copy vendor/ before installing.

The tarballs here preserve the earlier integration snapshots only. They are not the active dependency. The local 0.10.0 snapshot SHA-256 is `2e07f936a8d52b9ff47862dcd674e0afa39fe0a4c9919ffa37d4cd9380cc294d`; the public registry artifact was verified byte-for-byte identical to this accepted local snapshot.

Earlier artifact SHA-256 values:

- 0.9.0: `b8b82f04190c8ec89a56fb53e8ffb2458ac9f2b06990afcda06bde5e361a79bf`
- 0.8.1: `089e065b2cf7f94da43b31a5fe7408b4852b4bb2603839760b9784178dae2321`

Source and integration guide: [Connect SDK](https://github.com/Eulab-EugenioRenna/connect/tree/main/packages/sdk). Server entries require Node >=22 and are loaded through native dynamic import by the CommonJS API. Provider credentials remain backend-only.
