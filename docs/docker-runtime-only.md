# Docker — Immagini con build ed eseguibili

Verifica e aggiornamento dell’11 novembre 2026, su richiesta dell’utente. Le immagini applicative finali di **ALORA e Connect** contengono build, eseguibili, dipendenze e asset necessari al funzionamento. I sorgenti del progetto e gli strumenti di compilazione rimangono negli stage di build. [Evidenze](verification/runtime-only-images.json).

## ALORA

L’immagine API precedente includeva dipendenze di sviluppo, source map, seed e script TypeScript. Il nuovo target `api-runtime` parte da Alpine e riceve soltanto Node, dipendenze backend ripulite, API compilata, comando demo compilato, avvio e migrazioni. La versione di Node rimane quella già in esecuzione: `22.23.4`.

Il manifest di installazione runtime deriva dal lockfile esistente: esclude Angular e `zone.js`, aggiunge esplicitamente il CLI Prisma necessario alle migrazioni e conserva le versioni bloccate. La preparazione controlla che nessuna dipendenza cambi versione. Le dichiarazioni TypeScript, i sorgenti TS delle dipendenze, i test, la documentazione di sviluppo e le source map sono rimossi conservando asset eseguibili e documenti legali.

Nel filesystem finale risultano **zero file TypeScript e zero source map**. TypeScript, ts-node, Jest, Angular, Nest CLI, npm, npx e Yarn sono assenti. Il bootstrap richiama il CLI Prisma installato tramite Node, senza installazioni o compilazioni all’avvio. Schema Prisma, client generato e SQL delle migrazioni sono asset operativi necessari; non viene copiato `prisma/seed.ts`.

Il comando demo esplicito rimane disponibile come eseguibile:

```sh
docker compose exec api node dist/scripts/create-demo-account.js --help
```

È stata verificata soltanto la guida, senza creazione o modifica di account. Il comando non viene eseguito dall’entrypoint. Gli eseguibili JavaScript dell’API coincidono con la build precedente dopo la sola rimozione dei commenti relativi alle source map.

Le due immagini Nginx di amministrazione e booking pubblico contengono già gli asset compilati e rimangono invariate. Nessun repository o albero delle dipendenze è montato dai sorgenti host nei container. Upload, certificato di fiducia e configurazione runtime restano disponibili nei mount previsti.

La dimensione API riportata da Docker passa da circa **214 MB a 97 MB**. L’immagine precedente è conservata come `alora-before-runtime-only-api:20261111t171055z`.

## Connect

Le immagini API e runner già aggiornate allo schema 015 rispettano la stessa regola: bundle `.mjs`, dipendenze di produzione ripulite e, nel runner, Chromium e asset del provider. Sono stati verificati anche bootstrap e migratore, avviando esclusivamente la sonda di ispezione senza eseguire bootstrap o migrazioni. La web contiene asset compilati, senza file TypeScript, source map o cartelle dei sorgenti.

Gli import dei pacchetti provider, gli asset necessari e Chromium su pagina vuota senza rete passano. Le immagini e i container Connect in esecuzione sono stati preservati, poiché già conformi. I template, SQL, file di configurazione, certificati e archivi installabili distribuiti sono asset di runtime.

## Controlli ripetibili

Da ALORA, per le immagini effettivamente installate:

```sh
node scripts/verify-runtime-images.mjs
```

La sonda API viene eseguita in un container temporaneo senza rete o volumi dati. Controlla contenuto, assenza di strumenti di sviluppo e import effettivi di SDK, Prisma e bcrypt. Le due web sono ispezionate in sola lettura. Un eventuale mount dei sorgenti o delle dipendenze host nei percorsi applicativi fa fallire il controllo.

Da Connect:

```sh
node scripts/verify-runtime-images.mjs eulab-connect
```

Gli harness HTTP usano il CLI Prisma nei propri container temporanei, senza copiare sorgenti nell’API principale. Il collaudo WhatsApp confronta gli eseguibili SDK installati con il tarball bloccato invece di reinstallarli tramite npm. Sono passati anche i nove gruppi HTTP WhatsApp e i sette gruppi sedi con il nuovo runtime; i database e i container sintetici sono rimossi.

## Verifica e passaggio locale

Sono passati 62 suite, 391 test, uno snapshot e lint. L’avvio completo candidato passa 11 gruppi; il ripristino passa sei gruppi su un backup corrente, con tre file media sintetici e un link simbolico. Sono conservati i valori originari di **54 tabelle e 633 colonne**, con ritorno all’immagine precedente prima di nuove scritture e ripristino a freddo.

Prima del cambio è stata fermata soltanto l’API ALORA e acquisito un backup coordinato di database, upload e configurazione privata. Dopo il cambio l’API è sana, tutti i valori delle 54 tabelle coincidono e la cronologia delle migrazioni è invariata. Frontend, database, volumi, servizi Connect, account e sessioni sono preservati. Nessun messaggio reale, pubblicazione o deployment di produzione è eseguito.

La regola riguarda le immagini finali avviate. Cache di compilazione e immagini precedenti conservate per ripristino possono contenere materiale dei checkpoint precedenti; non sono state eliminate implicitamente. Il collaudo WhatsApp reale e l’origine webhook pubblica restano verifiche separate dal contenuto delle immagini.
