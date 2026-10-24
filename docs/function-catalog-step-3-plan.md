# ALORA — Piano esecutivo dello Step 3

Stato: implementazione avviata dopo autorizzazione al proseguimento. Risultati locali e limiti aggiornati in [function-catalog-step-3.md](function-catalog-step-3.md). Questo file conserva l’analisi esecutiva iniziale; le decisioni successive sull’onboarding sono in [connect-onboarding-contract-request.md](connect-onboarding-contract-request.md). Nessuna installazione Connect operativa è stata modificata.

## Contratto verificato sul codice

Checkout Connect consultato: `/Users/eugeniorenna/eulab connect`, commit `60a4a30dfbdf4dfb95d8b04d6c1838f19432da05`. SDK locale `@eulab/connect` 0.8.0, ESM e Node >=22. Non è stata verificata in questo controllo la corrispondenza con il remoto o con il pacchetto npm distribuito.

Fonti lette: `docs/FUNZIONI-E-SESSIONI.md`, `packages/sdk/src/functions.ts`, `packages/sdk/src/server.ts`, `apps/api/src/function-matrix.ts`, `catalog.service.ts`, `catalog-source.service.ts` e `catalog-reader.ts`.

La matrice è un oggetto con soli `schemaVersion: 1`, `appId`, `version` e `functions`. Ogni elemento contiene `key`, `name` ed eventualmente `description`; campi aggiuntivi non sono ammessi dal validatore API. Limiti: 200 funzioni, chiavi uniche con regex `^[a-z][a-z0-9_.:-]{0,79}$`, nome massimo 200 caratteri e descrizione massimo 1000. La versione è un intero positivo; il SDK richiede anche che sia safe integer.

`appId` deve coincidere con l’ID applicazione Connect, condiviso da tutte le installazioni ALORA. La versione va incrementata per ogni modifica del documento: Connect rifiuta regressioni e modifiche a parità di versione. Rimozione e reintroduzione non ripristinano automaticamente i permessi ritirati. Il catalogo non contiene default di ruolo o assegnazioni: non sono campi del contratto.

Connect esegue il GET della fonte: `registerFunctions()` registra l’URL e non carica il JSON. Il reader richiede HTTP 200 JSON, massimo 1 MiB e 5 secondi, senza redirect. In produzione la fonte richiede HTTPS pubblico; il collaudo locale richiede un’origine esplicitamente mappata in `CATALOG_INTERNAL_ORIGINS_JSON`, in un’istanza di prova. L’URL deve appartenere al dominio/percorso di un’installazione abilitata.

## Cambiamenti da implementare dopo autorizzazione

1. **Registro tipizzato condiviso.** Separare metadati Connect (`key`, nome, descrizione) da metadati interni (operazioni, ambito dati, accesso locale transitorio e viste UI). La matrice pubblica deve proiettare solo i campi del contratto. Nessun import Angular nel backend e nessuna dipendenza da Prisma nel bundle browser.
2. **Copertura delle operazioni.** Ogni handler autenticato deve dichiarare una funzione o una classificazione esplicita di infrastruttura/piattaforma. Una nuova operazione senza classificazione è negata e fa fallire il controllo di copertura. Login, refresh, logout, health, documentazione e booking anonimo non devono acquisire un requisito di funzione personale per effetto di un fallback generico.
3. **Policy locale transitoria.** Riutilizzare lo stesso registro nel guard dello Step 1. Conservare i permessi persistiti, con alias espliciti dove il nome canonico differisce; non riscrivere `User.permissions`. Il titolare conserva le sole operazioni legacy censite: una nuova funzione o un nuovo handler non entra in un generico bypass per ruolo.
4. **Matrice GET.** Produrre versione 1 dal registro, con identità applicazione server coerente con quella registrata su Connect. Esporre il GET JSON senza credenziali e con header di rivalidazione. L’identità non viene scelta da query, host o ID cliente inviati dal browser.
5. **Nginx.** Instradare esplicitamente la fonte pubblica verso l’API. Oggi `/.well-known/eulab-connect.json` non è gestita dal proxy; sotto `/admin/` finirebbe al server Angular. Usare un endpoint autorevole e alias esatti per il percorso dell’installazione, senza duplicare il documento. Verificare il GET attraverso Nginx, non solo chiamando Nest direttamente.
6. **Viste e richieste UI.** Consumare le stesse chiavi per navigazione e azioni; il backend resta autorevole. Adeguare i loader affinché una vista autorizzata non dipenda da report o impostazioni negati. Questa attività riguarda l’allineamento ai permessi già effettivi e non introduce il configuratore dei ruoli dello Step 5.
7. **Prova Connect isolata.** Registrare un’applicazione/installazione esclusivamente di prova con la sua fonte mappata, far leggere la matrice a Connect e verificare importazione, stabilità della versione e nuove funzioni non concesse. La prova non deve usare o alterare installazioni, licenze o credenziali dell’istanza Connect corrente.

Il runtime Nest attuale è CommonJS; il SDK locale pubblica ingressi ESM. Il catalogo puro può essere condiviso senza portare il SDK nel processo Nest. Se si usa `defineFunctions` in verifiche o strumenti di sincronizzazione, l’ingresso va caricato in un modulo ESM compatibile. Non convertire l’intero backend solo per pubblicare il JSON. L’effettiva integrazione del SDK e dell’SSO rimane nello Step 4.

## Capacità reali e classificazione iniziale proposta

Le chiavi definitive saranno fissate nel registro all’implementazione. Le proposte qui sotto censiscono capacità già presenti; non costituiscono funzioni già pubblicate.

| Area | Operazioni reali da associare | Restrizione operativa |
| --- | --- | --- |
| Agenda | Elenco/dettaglio, creazione, modifica, stato e annullamento di `AppointmentsController`; disponibilità | Separare lettura propria e aziendale; l’esecutore legge/cambia lo stato dei soli appuntamenti assegnati |
| Clienti | CRUD e storico `CustomersController` | Azienda; nessuna anagrafica completa al professionista standard |
| Listino | CRUD servizi, associazione/rimozione prodotti | Azienda; associazioni validate per entrambi i cataloghi |
| Prodotti | CRUD `ProductsController` | Catalogo aziendale; non descrivere queste funzioni come gestione delle giacenze |
| Squadra | CRUD professionisti e relativi orari | Azienda; non descrivere questo CRUD come editor di ruoli o assegnazioni Connect |
| Vendite | Elenco/dettaglio, creazione/modifica/eliminazione e collegamento a un appuntamento | Azienda; mantenere l’attribuzione per riga e i controlli sui riferimenti |
| Report | Tutti gli handler `DashboardController` | Azienda e filtri attuali; non dichiarare sede/settore o dashboard personale completa |
| Impostazioni | Impostazioni tenant, logo e copertina | Lettura operativa minima distinta dalla gestione, senza concedere tutta la configurazione |
| Notifiche | Preferenze, inbox, provider, template, eventi, storico e stream | Distinguere dati personali, amministrazione e flusso dei conti da chiudere; nessuna capacità WhatsApp reale dedotta dal solo enum del canale |
| Utenze locali | Elenco e revoca sessioni `UsersController` | Permessi distinti, stessa azienda; nessun editor di identità/ruoli inesistente |
| Audit | Lettura aziendale dei log | Azienda; lettura globale solo piattaforma |
| Piattaforma | Handler `PlatformAdminController` e viste correlate | Ambito amministratore di piattaforma, separato dalle licenze delle aziende |
| Pubblico/infrastruttura | Booking anonimo, autenticazione locale, health, radice API e documentazione | Classificazione esplicita, senza pretendere una sessione Connect dal cliente anonimo |
| Pagamenti provider | `payment-settings` disabilitato, mutazioni 501 | Esclusi dalla matrice delle capacità commerciali operative |

Nessuna funzione di magazzino, sedi/settori, delega ruoli, MFA locale, provider fiscale, WhatsApp interattivo o automazione va anticipata nel catalogo.

I nomi transitori già persistiti includono `clients.read.full`, `appointments.read.all`, `appointments.create`, `appointments.update.all`, `services.*`, `products.*`, `collaborators.*`, `sales.*`, `dashboard.revenue.read`, `settings.manage`, `users.manage` e `audit.read`. Se il registro adotta nomi come `customers.read` o `booking.read`, gli alias legacy devono restare espliciti e verificati; la presenza di una nuova chiave nella matrice non assegna quel permesso a persone o aziende.

## Dipendenze UI emerse dalla verifica

`loadAdminCoreData()` e `loadAppointmentsViewData()` caricano insieme tenant, agenda, servizi, squadra e clienti. `loadShellData()` richiede tutto `/tenant/settings`, che oggi è protetto da `settings.manage`. Anche `refreshShell()` usa quel loader. Un manager autorizzato alla sola agenda potrebbe quindi ricevere un errore per un’impostazione che non deve amministrare. La vista personale introdotta nello Step 1 evita il problema per il professionista, ma la navigazione generale non è ancora derivata dalle autorizzazioni.

Il piano dello Step 3 deve includere proiezioni operative minime e caricamenti condizionati: non risolvere concedendo implicitamente `settings.manage`, cassa o report a chi deve consultare l’agenda. Servizi, professionisti e clienti richiesti dalla creazione devono essere richiesti solo con le funzioni e le proiezioni ammesse. Un’autorizzazione positiva non elimina i filtri aziendali/personali già presenti.

## Prove richieste per la chiusura

- Il JSON pubblico è valido secondo il validatore Connect reale e privo di metadati interni/segreti.
- Tutte le route API sono censite; un nuovo handler senza funzione/classificazione fallisce e non diventa accessibile al titolare per fallback.
- Stato iniziale delle funzioni future e sconosciute: negato; nessuna concessione derivata dal solo ruolo o dal catalogo.
- Le autorizzazioni persistite mantengono esattamente i flussi legacy previsti; professionista e aziende diverse restano isolati.
- Le viste consentite non dipendono da richieste non consentite; le azioni proibite restano negate invocando direttamente l’API.
- GET reale della fonte tramite Nginx, senza autenticazione, HTML o redirect; `appId` e percorso corrispondono alla registrazione di prova.
- Connect importa la versione iniziale; accetta la stessa matrice senza nuove concessioni; rifiuta versioni inferiori o JSON cambiato a parità di versione; una nuova funzione resta negata finché abilitata esplicitamente.
- Lint, test, build API e Angular standard superati; collaudo browser separato dalle verifiche dei bundle. Nessuna sincronizzazione di produzione prima dell’accettazione dell’ambiente.

Nessuna migrazione di utenti, password, tenant o dati operativi è prevista per questo catalogo. La configurazione Connect per tenant e l’attivazione obbligatoria dell’SSO richiedono il modello e il provisioning dello Step 4.
