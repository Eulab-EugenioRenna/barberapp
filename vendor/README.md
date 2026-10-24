# Connect SDK artifacts

ALORA currently pins `eulab-connect-0.10.0.tgz`, copied unchanged from the adjacent Connect release directory. Its SHA-256 matches the delivery manifest: `2e07f936a8d52b9ff47862dcd674e0afa39fe0a4c9919ffa37d4cd9380cc294d`. It includes the schema-013 presenter capability, approved configuration sync, application facade and PostgreSQL store. The local SDK candidate now includes the server-only OIDC transport origin for Docker. No npm publication was performed. The previous artifacts remain for reproducibility.

SDK 0.9.0 SHA-256: `b8b82f04190c8ec89a56fb53e8ffb2458ac9f2b06990afcda06bde5e361a79bf`.

The root package and lockfile reference the 0.10.0 repository artifact. Docker dependency stages copy `vendor/` before installing. The tarballs contain compiled SDK code, declarations and package documentation, without deployment environment files or credentials. Node >=22 is required. The CommonJS API loads the ESM server/application entries through native dynamic import. Integration changes stay local until ALORA acceptance; npm publication is a later explicit release action.

Historical SDK 0.8.1 SHA-256: `089e065b2cf7f94da43b31a5fe7408b4852b4bb2603839760b9784178dae2321`. The user confirmed its earlier npm publication; publication of 0.9.0 is not claimed by this artifact update.

## SDK Connect: riferimenti online

Pacchetto ufficiale: [@eulab/connect su npm](https://www.npmjs.com/package/@eulab/connect). Codice e guida: [SDK nel repository Connect](https://github.com/Eulab-EugenioRenna/connect/tree/main/packages/sdk). Gli ingressi usati dal backend sono `@eulab/connect/application` e `@eulab/connect/server`.

Questa integrazione usa la candidata locale **0.10.0** tramite tarball versionato in `vendor/`, come specificato nel lockfile. Il collegamento npm identifica il pacchetto ufficiale; non attesta che la candidata sia pubblicata. Prima del passaggio alla distribuzione npm verificare la versione con `npm view @eulab/connect version`, pubblicare la candidata approvata e aggiornare dipendenza e lockfile alla versione esatta. La verifica del registry del 24 ottobre è stata impedita da DNS ENOTFOUND; la dipendenza locale funzionante resta invariata.
