# EUL-56 — API e DB barcode prodotti

Branch di consegna: `eulab/EUL-54`. Verifiche eseguite il 13 novembre 2026 nel workspace esistente, inizialmente su `eul-53-audit-uiux-barcode`, con modifiche pregresse non committate. Un'attività concorrente ha cambiato checkout in `eul-55-uiux-hardening`: il commit backend viene creato su un riferimento separato usando un indice isolato, senza cambiare checkout o indice condiviso. Nessun push, merge o deploy.

## Comportamento verificato

- `Product.barcode` opzionale, vincolo unico `(tenantId, barcode)`. Più NULL consentiti nello stesso tenant; lo stesso codice consentito in tenant diversi.
- Create/update normalizzano trim e spazi tramite la funzione condivisa con la UI. Stringa vuota, soli spazi o NULL cancellano l'associazione usando NULL; campo omesso in PATCH lascia il valore invariato. I codici interni restano supportati; il backend non impone il checksum EAN ai codici interni.
- `GET /products/by-barcode?barcode=...` usa esclusivamente il tenant della sessione; un parametro `tenantId` non cambia l'ambito. Risposte 400 per codice vuoto, 404 per prodotto assente o di altro tenant.
- P2002 sul barcode viene tradotto in 409: «Barcode già assegnato a un altro prodotto di questa attività», per create e update. Invalidazione delle liste prodotti dopo scritture riuscite.
- Il rollback è ora `prisma/migrations/20261113093210_product_barcode/rollback.sql`, da eseguire manualmente. La precedente directory `*_reverse/migration.sql` avrebbe annullato l'aggiunta durante `prisma migrate deploy`; non deve essere distribuita. Il rollback rimuove i barcode aggiunti, quindi non preserva queste nuove associazioni: richiede approvazione e backup prima di un uso operativo.

## Audit §3.6 backend

`LocalPolicyGuard` è già registrato come `APP_GUARD` in `apps/api/src/app.module.ts`. Autorizza ogni handler tramite `operation-catalog.ts`: `findAll`, `priceHistory`, `byBarcode` richiedono `products.read`; `create`, `update`, `remove` richiedono `products.manage`. Non serve aggiungere ProductsController all'elenco `scopedControllers`: questo elenco gestisce il filtro sede/settore e i prodotti appartengono all'intero tenant. Il controllo dei permessi viene eseguito prima di quell'elenco. I test HTTP eseguono il guard effettivo e verificano 403 senza permessi di lettura/scrittura.

`GET /inventory/balances` richiama `InventoryService.balances`, che esegue `requireLocations` prima di interrogare prodotti o giacenze. Le sedi ammesse sono ricavate dai settori selezionati con filtro `tenantId`; una sede di altro tenant, inesistente o fuori selezione restituisce 403 senza leggere giacenze. Anche la query StockBalance applica `tenantId` e `locationId`. Test di regressione aggiunti; nessuna modifica necessaria alla logica esistente.

## Verifica riproducibile

Prima della modifica: 5 test rossi su normalizzazione e azzeramento barcode, 13 verdi sui casi restanti.

```sh
OPENSSL_CONF=/dev/null node node_modules/jest/bin/jest.js --runInBand --cacheDirectory .local/eul56-jest
OPENSSL_CONF=/dev/null node node_modules/eslint/bin/eslint.js 'apps/api/**/*.ts'
OPENSSL_CONF=/dev/null node node_modules/@nestjs/cli/bin/nest.js build --config apps/api/nest-cli.json
OPENSSL_CONF=/dev/null DOCKER_BIN=/Applications/Docker.app/Contents/Resources/bin/docker node scripts/verify-product-barcode-migration.mjs
```

Suite completa: 67 suite, 434 test e 1 snapshot verdi (API e test web già presenti). Lint e build API: exit 0. Test HTTP con controller, ValidationPipe e LocalPolicyGuard reali, persistenza e sessioni simulate; vincoli DB verificati separatamente su PostgreSQL reale.

Lo script DB esegue `pg_dump -Fc` sul sorgente in sola lettura, `createdb eul56_barcode_<timestamp>` e `pg_restore --no-owner --exit-on-error` sulla nuova copia. Esegue forward, fixture transazionali, rollback e nuova forward esclusivamente sulla copia. Confronta conteggi e hash di tutti i campi originali in tutte le 55 tabelle. Copia e backup sono conservati localmente per ispezione, non cancellati.

Esito: restore riuscito; dati originali preservati; barcode preesistenti NULL; duplicato stesso tenant rifiutato; stesso codice tra tenant ammesso; NULL multipli ammessi; rollback e riapplicazione riusciti. Evidenza sanitizzata: `docs/verification/eul56-product-barcode.json`. Backup: `.local/eul56/migration-1794563734561/before.dump`; copia: `eul56_barcode_1794563734561`. Nessuna scrittura sul database sorgente.

Limitazione dell'ambiente: `~/eulab-brain/00-sistema/agenti/_comune.md` non leggibile (`Operation not permitted`); lette le istruzioni AGENTS del bundle autorizzato. `OPENSSL_CONF=/dev/null` evita l'accesso negato alla configurazione OpenSSL di sistema per i comandi Node.
