# Connect SDK artifacts

The active development dependency is `eulab-connect-0.11.0-team-security.tgz`, a local 0.11.0 candidate built from the Connect checkout. SHA-256: `d84f5290c27fd877c4874c836af321e3add9df832817daa9b1c9b8f0dd3b3574`.

This candidate adds optional temporary initial passwords for new delegated identities and a delegated password-recovery API. Existing credentials are never rewritten by provisioning replay. It also preserves sessions on transient authorization-read failures while denying the request. Revocation and ambiguous rotating grants still invalidate the session. It is not published to npm or accepted for production. The package lock pins its integrity and all Docker dependency stages copy this exact artifact.

# Historical artifacts

The previous approved distribution installed **[@eulab/connect@0.10.0 from npm](https://www.npmjs.com/package/@eulab/connect/v/0.10.0)**.

The tarballs here preserve the earlier integration snapshots only. They are not the active dependency. The local 0.10.0 snapshot SHA-256 is `2e07f936a8d52b9ff47862dcd674e0afa39fe0a4c9919ffa37d4cd9380cc294d`; the public registry artifact was verified byte-for-byte identical to this accepted local snapshot.

Earlier artifact SHA-256 values:

- 0.9.0: `b8b82f04190c8ec89a56fb53e8ffb2458ac9f2b06990afcda06bde5e361a79bf`
- 0.8.1: `089e065b2cf7f94da43b31a5fe7408b4852b4bb2603839760b9784178dae2321`

Source and integration guide: [Connect SDK](https://github.com/Eulab-EugenioRenna/connect/tree/main/packages/sdk). Server entries require Node >=22 and are loaded through native dynamic import by the CommonJS API. Provider credentials remain backend-only.
