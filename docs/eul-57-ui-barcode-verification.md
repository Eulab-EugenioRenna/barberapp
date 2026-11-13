# EUL-57 — UI barcode quick-order e magazzino

Verifica del 13 novembre 2026, su workspace condiviso con EUL-55.
Branch preservato: `eul-55-uiux-hardening` (inizialmente `eul-53-audit-uiux-barcode`).

## Risultato

- Lettore keyboard-wedge riusabile: conserva primo carattere e zeri iniziali, verifica ogni intervallo fra tasti, richiede Enter e almeno tre caratteri rapidi. I campi di testo mantengono il focus e la digitazione ordinaria; un campo barcode esplicito permette anche l'inserimento manuale e codici brevi. Input nascosto persistente senza autofocus.
- Coda FIFO attende i callback asincroni, sopravvive a una ricerca fallita e assegna ogni scansione al consumer in primo piano. Il detach elimina le scansioni ancora in coda del consumer rimosso. Audio e vibrazione opzionali, disattivati per default.
- Quick-order: scansioni ripetute incrementano la riga prodotto e ricalcolano il preventivo; 404 apre quick-create con barcode precompilato. Si può creare un prodotto o associare il barcode a un prodotto attivo senza barcode del catalogo caricato. La coda attende creazione o annullamento. Associare un prodotto già in carrello incrementa la stessa riga.
- Errori 409, 404 e rete assente hanno messaggi espliciti; un errore di salvataggio conserva i dati nel dialog. Creazione limitata al permesso `products.manage`. Scansioni ignorate per conti annullati, invii pendenti, cambio sede o componente distrutto.
- Inventory: il barcode seleziona il prodotto nei bilanci della sede, carica i movimenti e porta il focus sulla quantità. Non sostituisce una richiesta movimento pendente; prodotti assenti dai bilanci non generano righe inventate.

## Verifiche riproducibili

I comandi sono eseguiti dalla root; nessuna modifica al DB vivo e nessun servizio esterno invocato dai test.

```sh
OPENSSL_CONF=/dev/null node node_modules/jest/bin/jest.js --runInBand --testPathPattern=apps/web-admin/src
OPENSSL_CONF=/dev/null node node_modules/eslint/bin/eslint.js 'apps/web-admin/**/*.ts'
OPENSSL_CONF=/dev/null node node_modules/@angular/compiler-cli/bundles/src/bin/ngc.js -p apps/web-admin/tsconfig.app.json --noEmit
```

Risultati: **114 test / 14 suite verdi**, lint admin verde, compilazione template Angular verde. Nuova copertura: 8 test scanner e 24 test UI/smoke (32 totali). I primi test scanner prima della correzione fallivano in 6 casi su 7.

La build completa è verde con impostazioni locali adatte alla sandbox:

```sh
mkdir -p .local/eul-57/xdg/angular
printf '%s\n' '{"version":1,"cli":{"analytics":false}}' > .local/eul-57/xdg/angular/config.json
CI=true OPENSSL_CONF=/dev/null \
  XDG_CONFIG_HOME="$PWD/.local/eul-57/xdg" TMPDIR="$PWD/.local/eul-57" \
  NG_CLI_ANALYTICS=false NG_BUILD_MAX_WORKERS=1 NG_BUILD_PARALLEL_TS=0 \
  BROWSERSLIST='last 2 Chrome versions,last 1 Firefox version,last 2 Edge major versions,last 2 Safari major versions,last 2 iOS major versions,last 2 Android major versions,Firefox ESR' \
  node node_modules/@angular/cli/bin/ng.js build web-admin --progress=false
```

`CI=true` disattiva la cache locale Angular; senza questo, la build nella sandbox terminava con exit 134. XDG/TMPDIR locali evitano accessi a configurazioni esterne non leggibili. BROWSERSLIST esplicito riproduce i default Angular 18 senza ricerca nelle directory superiori. Nessuna modifica alla configurazione di progetto necessaria. Bundle generato in `dist/apps/web-admin`, circa 1,14 MB raw / 231 kB trasferiti stimati.

Log locali: `.local/eul-57/admin-tests.log`, `scanner-before.log`, `scanner-after.log`, `lint.log`, `ngc.log`, `build.log`.

## Smoke di regressione — audit §2

Verifiche automatiche a livello di componente/logica, con dipendenze API simulate:

| Flusso | Esito e copertura |
| --- | --- |
| Quick-order touch + scansione | Verde: servizio con esecutore, prodotto scansionato due volte, quantità 2 sulla stessa riga, prezzo manuale conservato, sconti riga e conto conservati. |
| Checkout | Verde: payload cliente/sede/servizio/prodotto e metodi cash/card/bank/other, stato unpaid; controlli esistenti su quote e invii pendenti conservati. |
| Creazione/associazione | Verde: prefill, creazione con barcode, associazione senza cambiare nome/prezzo, annullamento, permessi, duplicato/offline e nessuna apertura dialog dopo inizio di un invio. |
| Inventory | Verde: selezione manuale e barcode, focus quantità, carico per riga inizializzata, paginazione movimenti e conservazione snapshot/idempotency key al retry dopo rete assente. |
| Clienti | Suite ricerca cliente e permessi API esistenti verdi. |
| Agenda | Suite timezone/prenotazioni esistente verde; nessun file agenda modificato da questo issue. |
| Collaboratori/team | Suite team, ruoli e permessi esistenti verdi. |
| Auth/login | Suite onboarding, session refresh e autorizzazioni esistenti verdi. |
| Dashboard, impostazioni, storico prezzi | Revisione del perimetro: nessuna modifica introdotta da EUL-57; non dichiarata esecuzione interattiva. |

**Limite della verifica:** non è stato eseguito uno smoke interattivo in browser né acquisito screenshot. Playwright non è installato nel workspace. Questi risultati verificano logica, contratti dei componenti e compilazione dei template; non attestano layout su dispositivi, hardware scanner reale o integrazione con DB/API reali. Le verifiche visive e di ambiente production restano al collaudo integrato EUL-55.

## Consegna e perimetro Git

Commit limitato a scanner, due file di test, quick-create, inventory, quick-order TS/HTML e questa nota. I ritocchi EUL-55 già presenti nei file condivisi sono preservati; CSS e gli altri file del workspace non sono inclusi. Il workspace contiene molte altre modifiche preesistenti: la build è stata verificata sul workspace integrato, non su una checkout isolata del solo commit. Nessun push, merge o deploy.
