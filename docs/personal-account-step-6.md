# Step 6 — Profilo e sicurezza personale

Stato corrente — 6 novembre 2026: **chiusura tecnica del consumer ALORA**, con verifiche account rinviate su richiesta dell’utente («procedi con la chiusura degli step lascia perdere gli account»). Il [verbale degli step 5 e 6](chiusura-step-5-6.md) raccoglie consegna, verifiche finali ed esclusioni. Nessuna accettazione di produzione o conferma degli account correnti è implicita.

## Analisi e contratti riutilizzati

La numerazione è quella della roadmap definitiva conservata in `docs/a previous agent produced the plan below.md`: Step 6 = profilo e sicurezza; Step 7 = sedi e settori. La tabella preliminare di `evolve.md` usa una numerazione precedente.

Connect è proprietario delle identità e delle credenziali. Il consumer usa `ConnectApplication.services()` e gli endpoint già esistenti:

- `ConnectOnboardingSource.configuration()` per l’issuer e il client approvati.
- `GET /v1/security/me` per autenticatore, email verificata, azioni richieste e dispositivi attendibili.
- `GET /v1/sessions?subject=...`, `POST /v1/sessions/:id/logout`, `POST /v1/sessions/logout-all` per gli accessi personali.
- `DELETE /v1/security/devices/:id` per la revoca del proprio dispositivo.
- `GET /v1/notifications?limit=10` per le notifiche personali Connect.
- Console account nativa del realm Keycloak per i dati SSO modificabili, password e configurazione TOTP.

Non vengono introdotti credenziali, OTP o recuperi password alternativi in ALORA. Non cambia lo schema del database. Non cambia il catalogo delle funzioni: l’accesso alla propria sicurezza dipende dalla sessione personale e non concede funzioni aziendali.

## Intervento

Pagina autonoma `/admin/#/account`, raggiungibile dall’area aziendale, dall’agenda personale e dalla pagina di accesso da configurare. Anche un collaboratore senza permessi operativi può aprirla. Accessi tecnici come altro profilo e amministrazione locale di piattaforma sono esclusi dal servizio personale.

Il profilo operativo ALORA è mostrato separatamente dal profilo SSO. La modifica nella console del provider non modifica implicitamente nomi, email, ruoli, permessi o associazioni operative ALORA. Il link alla console deriva solo dalla configurazione approvata e verificata; nessun token o segreto entra nel collegamento.

Le nuove API `/account`, `/account/security`, `/account/sessions`, `/account/notifications`, `/account/sessions/:id/logout`, `/account/sessions/logout-all` e `/account/devices/:id` sono censite nel registro delle operazioni. Gli identificativi provider delle mutazioni sono UUID, l’origine browser deve corrispondere alla configurazione e le letture personali sono `no-store`.

Il soggetto e il tenant derivano dalla sessione server. L’elenco delle sessioni specifica sempre il soggetto autenticato, anche per un’identità con privilegi amministrativi centrali, e rifiuta una risposta contenente sessioni altrui. Prima della disconnessione singola viene verificata l’appartenenza della sessione all’elenco personale. I campi delle risposte vengono proiettati esplicitamente.

Disconnessioni e revoche richiedono conferma, bloccano i click ripetuti e non vengono ritentate automaticamente. In caso di chiusura della sessione corrente, di tutte le sessioni o di revoca di un dispositivo proprio effettivamente richiesta, gli accessi locali interessati sono revocati anche se l’esito remoto è incerto. La revoca locale usa il medesimo lock utente del rinnovo per evitare che una rotazione concorrente ricrei la famiglia. La UI conserva distinti esiti parziali e sconosciuti.

Prima di una revoca dispositivo ALORA legge l’elenco personale. Un ID assente non genera una mutazione provider né un logout locale. Anche un rifiuto definitivo 403/404 del provider conserva l’accesso locale. Se la verifica preliminare non è disponibile, la risposta 503 usa il codice `account_operation_not_started`: l’interfaccia può conservare la sessione sapendo che la mutazione non è partita. Un timeout dopo il tentativo di revoca rimane invece incerto e chiude l’accesso locale. Nessun errore viene trasformato in un reinvio automatico.

Una revoca provider viene tradotta in 401 ALORA nel punto di risoluzione della sessione SDK invalidata. Il dettaglio HTTP dell’SDK può essere perso nella sua ricostruzione dell’errore: perciò il controllo non dipende solo da quel dettaglio. Un permesso operativo negato dopo la risoluzione rimane 403; indisponibilità temporanee rimangono 503 e non invalidano la sessione per una semplice lettura fallita.

## Provider attivo e funzionalità predisposte

Nel realm locale è attivo `browser`, con TOTP nativo disponibile. La console account, modifica dei dati consentiti, cambio password e TOTP sono stati provati con un’identità temporanea. La password del titolare preesistente non è stata cambiata.

Il repository Connect contiene il flusso aggiuntivo `eulab-connect-mfa`, con preferenza email/app, OTP email e dispositivi attendibili, ma non è il flusso attivo di questo runtime. Manca anche l’attributo di profilo `eulab.mfa.preferredMethod`; il tentativo controllato di modificarne la preferenza non ha prodotto un salvataggio verificato. La UI ALORA mostra il valore registrato in sola lettura e non offre una selezione che il flusso attuale non applicherebbe.

L’event listener del realm osservato è `jboss-logging`. Leggere le notifiche personali con 200 e un elenco vuoto non prova la generazione delle notifiche di sicurezza. Non è stato attivato un nuovo flusso globale, non sono state cambiate impostazioni SMTP e non sono stati creati dispositivi attendibili artificiali per dichiararne verificata la revoca reale.

L’eventuale attivazione estesa appartiene alla configurazione Connect già documentata in `docs/SICUREZZA-MFA-NOTIFICHE.md` del checkout Connect. Prima dell’attivazione servono: provider installato, controllo di password grant/override e identity provider esterni, SMTP verificato, predisposizione del flusso ufficiale, piano di ritorno al flusso precedente e collaudo reale di email OTP, preferenza, dispositivo attendibile e notifiche. Questo cambia la politica SSO del realm, non è una preferenza del singolo salone.

## Verifica e rilascio

La suite copre isolamento personale, assenza di privilegi aziendali, esclusione degli accessi tecnici, origine browser, identificativi non validi, mancata cache, risposte pubbliche, lock delle revoche locali, errori temporanei, esiti incerti, conferma e click ripetuti. Le prove sono raccolte in [personal-account-step-6.json](verification/personal-account-step-6.json): 275 test su 44 suite e uno snapshot passati, lint mirato, build Docker API/admin e salute runtime. Chromium ha verificato quattro viewport senza overflow e conferme con focus iniziale su Annulla, ciclo Tab ed Escape.

Il successivo controllo della gestione dispositivi comprende anche quattro casi sul bundle compilato con HTTP simulato: ID estraneo 404, rifiuto 403, verifica preliminare indisponibile e revoca dall’esito incerto. I primi tre conservano la sessione; l’ultimo la chiude. Ogni conferma produce una sola richiesta. Queste sono prove di interfaccia con risposte simulate e non dimostrano una revoca sul provider reale.

Provate con il provider reale anche disconnessione di un’altra sessione propria, replay negato 401, conservazione della sessione chiamante con 200, ID di sessione estraneo negato 404 e disconnessione completa dalla UI con una sola richiesta. La revoca reale di un dispositivo attendibile non è attestata: il runtime ne ha restituiti zero.

## Segnalazione accesso admin Connect

Dopo il link, l’utente conferma ricezione e cambio password ma segnala che usava quella mail come admin Connect e non accede più. La prima verifica trovava l’admin locale `admin` con indirizzo `admin@eulab.local`, abilitato e con ruolo centrale admin; il login con la credenziale configurata preesistente e la lettura amministrativa riuscivano. L’identità del collaudo aveva invece il solo ruolo applicativo del collaboratore. Il destinatario era risultato libero al controllo eseguito prima della creazione nel realm `eulab`.

Riprodotto un difetto reale del pannello Connect: dopo un login applicativo non-admin, il login al pannello restituisce «Ruolo EULab Admin richiesto» e un nuovo tentativo riusa lo stesso SSO. Aggiunto `Esci e cambia account`, usando il logout SDK esistente e dichiarando l’effetto sulle app collegate. La regressione browser è passata: medesimo browser prima non-admin, uscita esplicita, username modificabile, credenziale admin precedente e `/v1/overview` 200. Build TypeScript/Vite e immagine Docker web passate; aggiornato soltanto il container web locale Connect. Le altre modifiche preesistenti nel checkout Connect sono conservate.

L’utente ha poi indicato `localhost:8088` e chiarito esplicitamente che l’indirizzo doveva essere il superadmin Connect. Su questa indicazione è stato eseguito il ripristino del tipo Admin tramite l’API amministrativa esistente, sul subject esatto verificato. Conservati ID dell’identità e password corrente: confronto delle righe credenziale prima/dopo passato, senza pubblicare dati di password. Rimosso il solo profilo collaboratore temporaneo ALORA, la sua appartenenza applicativa, i mapping e il ruolo di prova. L’identità centrale rimane permanentemente Admin, separata dall’azienda ALORA; il bootstrap admin precedente rimane disponibile. Il cambio di tipo ha invalidato le vecchie sessioni, quindi serve un nuovo accesso con la password appena scelta dall’utente. Nessuna nuova email di reset è stata inviata. [Evidenza del ripristino](verification/connect-admin-access-restored-2026-11-06.json).

Ultima osservazione prima dell’interruzione richiesta dall’utente: il 6 novembre alle 18:06 UTC il ruolo Admin non risultava più assegnato e la lettura della definizione del ruolo restituiva 404. La causa non è stata accertata. L’evidenza del ripristino precedente descrive l’esito osservato al momento dell’intervento, non garantisce lo stato corrente. La diagnosi account è rinviata e non viene ripresa nella chiusura tecnica.

Nel ciclo precedente sono stati rimossi l’operatore temporaneo e i dati applicativi del destinatario del recupero; l’identità centrale è stata mantenuta durante il tentativo di ripristino del ruolo Admin. I cleanup locali escludono esplicitamente tale identità dalla rimozione. In quel ciclo sono stati ripristinati e poi rimossi database isolati: 14/14 tabelle ALORA e 19/19 Connect risultavano riconciliate per i dati originali, registrando separatamente l’identità mantenuta e i timestamp dichiarati. Registrata inoltre la variazione di stato attesa `applications.catalog_sync_error`, da precedente HTTP 404 a null; il catalogo corrente attraverso Nginx risponde 200, versione 4, 25 funzioni. Non è stato ripristinato artificialmente un errore non più attuale.

Confrontate anche sei tabelle dello schema Keycloak del backup iniziale: utenti, credenziali, ruoli assegnati, attributi, azioni richieste e appartenenze ai gruppi. Alla data del confronto i dati preesistenti coincidevano, registrando separatamente l’identità interessata dal ripristino autorizzato. Il confronto delle credenziali non ne pubblica contenuti o hash; il database isolato di ripristino è stato rimosso. Questa riconciliazione prova la conservazione dei dati, non sostituisce il nuovo login dell’utente dopo il ripristino.

Le immagini API e admin vengono costruite dal Dockerfile corrente, con controllo esplicito di `dist/apps/api/main.js`. Il contratto condiviso segue la struttura già usata per agenda e permessi, sotto `apps/api/src/common`, per non spostare il percorso di compilazione Nest. Il primo avvio locale aveva rilevato questo errore e l’ha corretto; una build riuscita da sola non attestava un runtime avviabile.

Rilascio locale senza ricreazione dei volumi: `docker compose -f docker-compose.yml -f docker-compose.connect-local.yml build api web-admin`, quindi `up -d --no-deps api web-admin`, controllo di salute e reload Nginx. Nessun deploy di produzione o pubblicazione SDK.

Per il rollback applicativo usare le immagini precedenti: non servono rollback dati o migrazioni. Le credenziali e le sessioni appartengono al provider; una disconnessione già richiesta non viene annullata dal ritorno al codice precedente.

## Esclusioni dalla chiusura tecnica

- Ricezione e cambio password confermati; login e stato corrente del ruolo amministrativo non verificati conclusivamente e rinviati su richiesta dell’utente.
- L’identità centrale interessata dall’incidente non deve essere riutilizzata per fixture o eliminata dai cleanup. Nessun ulteriore cambio di ruoli, password o associazioni è eseguito.
- Accettazione dell’utente della nuova pagina sui dispositivi del salone e accettazione di produzione separate.
- MFA estesa e notifiche di sicurezza generate dal provider: predisposte in Connect, non attivate/collaudate in questo runtime.
