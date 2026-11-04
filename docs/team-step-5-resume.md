> Accettazione operativa — 4 novembre 2026: l’utente conferma il collaudo di Squadra e La mia agenda sui dispositivi del salone («Confermo anche il collaudo operativo»). Superate le note storiche di accettazione utente pendente. Resta la sola prova di ricezione e utilizzo del link password su un account/casella di collaudo autorizzati. Step 6 non avviato.

> Ripresa runtime — 4 novembre 2026: riavviati i container ALORA/Connect esistenti, senza ricreare volumi. API avviata, 14 migrazioni rilevate e nessuna pendente; bootstrap demo senza modifiche. Admin e pannello Connect HTTP 200, API anonime team/auth-me 401. Connessione/autenticazione SMTP Connect verificate senza inviare email; Keycloak configurato STARTTLS con autenticazione. Consegna email/link e accettazione utente ancora pendenti. CUA indisponibile in questa sessione; nessun nuovo login autenticato provato. [Evidenza](verification/team-runtime-resume-2026-11-04.json). Questo aggiornamento supera la nota sui servizi spenti sotto.

> Verifica di ripresa — 4 novembre 2026: `apps/web-admin` era assente dal percorso richiesto da Angular, Docker e Jest. Recuperata prima la versione Git, poi individuata e copiata la versione più recente conservata in `.local/web-admin` (sorgente conservato), con Squadra unificata, preset e recupero password. Verifica finale: `npm run build:api` e `npm run build:admin` passati; `npm test -- --runInBand`: 40 suite e 226 test passati, uno snapshot passato. I fallimenti iniziali dipendevano dai file frontend assenti e sono risolti. Docker mostra solo il database di un altro progetto: nessun servizio ALORA/Connect attivo. Nessun dato applicativo modificato, nessun collaudo email o operativo eseguito. Step 5 aperto, Step 6 non avviato. Prossimo passo: ripristinare il runtime locale esistente senza ricreare i dati, poi verificare i flussi ancora pendenti. Le evidenze del 26 ottobre sotto sono storiche e non attestano il runtime corrente.

> Aggiornamento precedente: recupero password abilitato esplicitamente per il titolare locale; nuovo login e API 200, pulsante attivo su collaboratore temporaneo, conferma annullata e zero richieste inviate. Fixture rimosse e assenza verificata nei due sistemi. Rimangono consegna email e accettazione dell’utente su Squadra/La mia agenda dai dispositivi del salone. L’accesso tecnico tramite user è un lavoro separato già sviluppato dall’utente. Evidenze correnti in [team-presets-passwords.json](verification/team-presets-passwords.json). Step 6 non avviato.

> Aggiornamento dopo il feedback dell’utente: la UI precedente non è stata accettata. Implementata la revisione descritta in [team-presets-passwords.md](team-presets-passwords.md), con evidenze in [team-presets-passwords.json](verification/team-presets-passwords.json). Unica Squadra, due preset e custom creato esplicitamente; password iniziale temporanea e recupero delegato tramite link. La nuova funzione team.password.reset richiede abilitazione esplicita; nessuna concessione automatica agli utenti originali. Cambio della propria password dalle impostazioni nello Step 6, non ancora avviato. La parte seguente è il punto di ripresa storico.

# Step 5 — Punto di ripresa, 26 ottobre 2026

L’utente ha chiesto: «ancora no stop a un punto da riprendere devo riavviare il pc».
Ripresa effettuata dopo il riavvio: Docker e servizi esistenti avviati senza ricreare i volumi. Checklist e documento Step 5 aggiornati con l’ultimo ciclo. Controllo finale post-riavvio passato; evidenza in [team-post-restart.json](verification/team-post-restart.json). Non avviare Step 6. L’accettazione sui dispositivi del salone non è ancora eseguita.

## Ultimo ciclo terminato

Evidenza corrente: [team-final-consumer.json](verification/team-final-consumer.json).
Si aggiunge ai cicli team-real-consumer.json e team-extended-consumer.json.

- Password rifiutata dalla vera UI ALORA/Keycloak, campo svuotato, profilo mantenuto in Creazioni da completare, sessione del titolare conservata, ripresa UI sullo stesso ID. Login con la password recuperata riuscito anche dopo ripetizione della creazione.
- Policy temporanea length(64) del SOLO Keycloak locale ripristinata alla policy originale vuota e verificata. Nessuna password esistente cambiata.
- Lo stesso utente SSO conserva accesso e funzione qa.read nella seconda applicazione durante cambio ruolo, revoca e ripristino ALORA. Catalogo della seconda app predisposto come fixture SQL; controlli effettuati tramite SDK e API reali.
- Due aziende con SSO reale: dieci mutazioni incrociate su ruoli/utenti negate 404, policy esterne negate 403, associazioni e creazioni con professionista esterno negate 404. Nessun residuo delle creazioni rifiutate.
- Manager con professionista proprio: agenda/scrittura propria consentite; altri incarichi, altra azienda e dati aziendali negati.
- Mapping sospeso, provider disabilitato e accesso revocato: replay della vera facciata SDK negato 409. La ripresa ALORA di una creazione già completata restituisce il risultato storico senza riattivare mapping/identità/ruoli; ripristini solo espliciti.
- Eliminazione di un ruolo dalla UI con conferma positiva, altri ruoli conservati.

## Pulizia e stato dei dati

Fixture eliminate: 3 identità/provider, 4 ruoli (uno dalla UI), 2 installazioni, 2 licenze, applicazione secondaria e cliente esterno Connect; 3 utenti, 3 professionisti, 3 appuntamenti, 2 clienti, 2 servizi e tenant esterno ALORA. Audit conservato.
Backup ripristinati in database isolati poi eliminati: 14/14 tabelle ALORA e 19/19 Connect riconciliate, con le sole esclusioni di timestamp già documentate nei cicli precedenti.
Confronto aggiuntivo: ConnectTenantBinding e SEGRETO DECIFRATO dell’installazione originale coincidono con il backup, senza stampa del segreto.
La preassegnazione di prova aveva normalizzato il solo local_slug del source_tenant_bindings originale: ripristinato dal backup con guardia sul valore corrente. Ora anche l’intera tabella coincide.
Chromium temporaneo rimosso. Esito del logout della sessione QA nel campo pause-cleanup dell’evidenza.
Il controllo precedente al riavvio aveva dato TypeError nel harness. Alla ripresa sono state aggiunte asserzioni sugli stati HTTP e il controllo è passato: team/contesto 200, dati originali presenti, logout 201 e sessione disconnessa negata 401. Un 503 iniziale non si è riprodotto sotto diagnostica; causa puntuale non stabilita. Logging temporaneo e browser QA rimossi, nessun processo di verifica lasciato in esecuzione.

## Stato di ripresa e unica attività operativa restante

1. Stato repository e Docker verificati. Non ricreare le fixture già eliminate.
2. team-step-5-acceptance.md e team-step-5.md aggiornati con R4, P6 manager, I1 e recupero UI C1.
3. Controllo finale minimo ripetuto con nuovo login QA, passato e sessione disconnessa. I vecchi file di sessione non vanno riutilizzati.
4. Resta il collaudo dell’utente sui dispositivi reali e l’accettazione operativa. L’ultima risposta dell’utente è «ancora no»; la ripresa del goal non equivale al superamento di questo collaudo. Step 6 non avviato.

Il worktree contiene modifiche non committate, inclusi tarball SDK corretto, lockfile e Dockerfile. Non è stato eseguito commit/push/pubblicazione npm/deploy di produzione. Nel checkout Connect sono presenti anche modifiche preesistenti: non attribuirle tutte a questo ciclo e non sovrascriverle.
Script, credenziali temporanee e backup privati dell’ultimo ciclo: .local/team-final-qa/ (ignorato da Git); non pubblicarne i contenuti privati. Per ripartire, usare i risultati pubblici e ricontrollare lo stato corrente.
