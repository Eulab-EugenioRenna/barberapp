a previous agent produced the plan below to accomplish the user's task. Implement the plan in a fresh context. Treat the plan as the source of user intent, re-read files as needed, and carry the work through implementation and verification.

# ALORA by EULAB — Piano di evoluzione della piattaforma

## 1. Obiettivo e decisioni fissate

Evolvere Barber preservando i dati e i flussi già utilizzati, lavorando su **un dominio completo alla volta**. Nessuna implementazione è stata avviata.

Le decisioni concordate sono:

- **SaaS condiviso:** ogni azienda ALORA corrisponde a un cliente Connect e dispone di una propria installazione logica.
- **Identità:** accesso locale durante la transizione; Connect obbligatorio dopo migrazione e collaudo dell’azienda. Sono ammesse le estensioni necessarie in entrambi i repository.
- **Sedi:** ogni sede ha indirizzo, uno o più settori, dashboard e magazzino propri. I clienti sono comuni all’azienda; la dashboard generale comprende tutte le sedi.
- **Prenotazione e conto:** rappresentano la stessa operazione, modificabile lungo il percorso fino all’incasso.
- **Prenotazione multipla:** il cliente sceglie più servizi e, facoltativamente, il professionista. Con “Nessuna preferenza” ALORA riserva internamente risorse disponibili.
- **Esecuzione:** il salone modifica l’assegnazione e indica chi ha eseguito ciascun servizio; può aggiungere servizi e prodotti prima dell’incasso.
- **Cassa gestionale:** comprende acconti, saldi e più metodi di pagamento. L’integrazione fiscale resta successiva.

Il primo step diventa la **messa in sicurezza**, seguito dal rebranding. Il cambiamento rispetto all’ordine iniziale di `evolve.md` è motivato dalle criticità concrete rilevate nell’autenticazione e nell’isolamento dei dati.

## 2. Audit tecnico iniziale e gap analysis

### Architettura attuale

Il repository contiene due applicazioni Angular 18, un backend NestJS 10, Prisma/PostgreSQL e Redis per cache e code BullMQ. Nginx espone admin, prenotazione pubblica e API.

Il codice implementa più funzionalità di quelle descritte da README e piano iniziale. Questi documenti devono essere riallineati.

| Area | Stato rilevato | Intervento necessario |
|---|---|---|
| Clienti, servizi, professionisti e orari | CRUD e flussi collegati presenti | Consolidare autorizzazioni, validazione e isolamento delle modifiche |
| Agenda e disponibilità | Motore operativo con turni, eccezioni e gestione dei fusi orari | Rendere atomica la prenotazione delle risorse; supportare servizi multipli |
| Booking pubblico | Flusso presente, modalità richiesta/conferma e limitazione delle richieste | Consentire più servizi e scelta automatica del professionista |
| Vendite e Quick Order | Ordini misti, attribuzione del professionista per servizio, modifica ed eliminazione | Unificare il percorso con la prenotazione |
| Dashboard | Aggregazioni, filtri, attività e aggiornamenti presenti | Separare venduto, incassato e residuo; aggiungere sedi e settori |
| Notifiche | Code, preferenze, template, inbox, SMTP e webhook presenti | Integrare Connect WhatsApp e rendere durevoli gli eventi applicativi |
| PWA | Installazione e aggiornamento differito durante i modali presenti | Preservare il comportamento durante rebranding e nuovi flussi |
| Audit | Schema ed endpoint di lettura presenti | Implementare registrazione sistematica delle operazioni sensibili |
| Pagamenti | Stati sulle vendite; endpoint provider simulati | Registro reale di acconti, saldi e storni gestionali |
| Magazzino | Catalogo prodotti, costi e aliquote parziali | Giacenze, movimenti, inventario e valorizzazione per sede |
| Sedi, settori e Connect | Assenti da Barber | Nuovi modelli e integrazioni |

### Criticità prioritarie

**Autenticazione.** In [request-session.ts](/Users/eugeniorenna/barber/apps/api/src/common/request-session.ts) il token è costruito dall’ID utente: non è firmato, non scade e non rappresenta una sessione revocabile. Refresh restituisce il valore ricevuto; logout non invalida l’accesso.

**Isolamento fra aziende.** Alcune modifiche cercano il record soltanto per ID e successivamente impostano `tenantId`. Il problema è presente, per esempio, nelle modifiche di servizi e professionisti. Anche i riferimenti a servizi, clienti e risorse devono essere verificati rispetto all’azienda.

**Permessi personali.** Diversi endpoint applicano il filtro aziendale senza verificare il diritto della persona o limitarne i dati. La presenza di `User.permissions` non costituisce oggi una protezione completa.

**Modello economico.** Le colonne monetarie sono Decimal, ma diversi calcoli passano attraverso `number`. Lo stato `partial` non conserva l’importo effettivamente pagato. I report combinano vendite e appuntamenti completati privi di vendita: questa compatibilità storica va riconciliata esplicitamente.

**Manutenibilità.** Il componente principale admin supera 3.200 righe; vari controller concentrano query, regole operative e integrazioni. Esistono duplicazioni fra tipi di dominio e componenti delle due applicazioni. Il refactoring seguirà i domini interessati, senza riscrittura generale.

### Problemi UI indicati in `evolve.md`

- Il filtro professionisti della dashboard usa il catalogo già caricato, inizialmente limitato alla prima pagina di 200 elementi. Non dispone di una propria ricerca completa. È un limite verificato nel codice; la riproduzione del caso concreto richiede il dataset interessato.
- Il calendario e la shell applicano comportamenti mobile sotto circa 1.024 px, coinvolgendo molti tablet. Servono comportamenti distinti basati sullo spazio operativo disponibile.

### Verifiche eseguite

- **51 test superati**, su 16 suite.
- Lint, build API, validazione Prisma e compilazione Angular senza emissione: superati.
- Build ottimizzate admin e pubblica: bloccate dal download dei font Google con errore DNS `ENOTFOUND`.
- Nessun container attivo nel progetto Compose Barber durante il controllo.
- Nessuna verifica eseguita sulla produzione, sulla migrazione del database reale o sui flussi browser/SSO/WhatsApp.

## 3. Architettura obiettivo e integrazione Connect

### Responsabilità

**Connect governa:** identità, sessioni SSO, licenze, catalogo delle funzioni, ruoli e assegnazioni centrali.

**ALORA governa:** aziende operative, sedi, settori, professionisti, clienti, prenotazioni, conti, pagamenti, magazzino e regole di visibilità sui propri dati.

Un utente accede a un’operazione soltanto se sono soddisfatte sia l’autorizzazione Connect sia le restrizioni operative ALORA.

### Contratti Connect verificati

È stato analizzato il checkout locale collegato al [repository Connect indicato](https://github.com/Eulab-EugenioRenna/connect), inclusi SDK, controller, modello autorizzativo e documentazione. L’allineamento del commit locale con il remoto resta da verificare: il controllo Git remoto ha incontrato un errore DNS.

Sono disponibili:

- SDK `@eulab/connect`, attualmente versione **0.8.0 nel checkout**, con ingressi browser/server e requisito Node 22.
- Login OIDC con PKCE, callback strutturato, rinnovo, logout e gestione delle proprie sessioni.
- `/v1/access`, `/v1/authorize`, collegamento esplicito all’utente locale e `mirrorUser`.
- Matrice GET `/.well-known/eulab-connect.json`, con `schemaVersion`, `appId`, versione crescente e funzioni dichiarate.
- API/SDK WhatsApp per connessioni, QR, messaggi, conversazioni, storico, outbox, webhook e aggiornamenti realtime.
- Funzioni personali per MFA, verifica email e dispositivi attendibili.

I collegamenti devono usare **installazione e ID locale**, senza unione automatica per email. Le nuove funzioni richiedono abilitazione esplicita. I contratti sono descritti nella [guida Connect alle funzioni e sessioni](</Users/eugeniorenna/eulab connect/docs/FUNZIONI-E-SESSIONI.md>).

### Estensioni Connect necessarie

1. **Amministrazione delegata al titolare.** I contratti attuali di modifica dei ruoli e delle appartenenze richiedono EULab Admin. Occorre un contratto delegato limitato al cliente e all’applicazione, che impedisca di concedere funzioni fuori licenza o fuori dalla propria delega.
2. **Automazioni senza sessione personale attiva.** L’invio WhatsApp ordinario ricontrolla il token utente nel runner. I promemoria futuri richiedono una delega revocabile dedicata all’automazione, verificata anche all’esecuzione.
3. **Provisioning del SaaS condiviso.** Collegare il cliente e l’installazione Connect al tenant ALORA tramite un processo ripetibile, senza distribuire credenziali amministrative al browser.

Queste capacità sono **da sviluppare**, non contratti già disponibili.

MFA e messaggi interattivi richiedono inoltre collaudi reali: le predisposizioni e le verifiche documentate di Connect non certificano automaticamente il nuovo percorso ALORA.

### Modello operativo unico

Il concetto centrale sarà il **conto operativo**, prenotabile oppure aperto direttamente in cassa.

Per preservare il sistema esistente:

- Si evolvono `Sale` e `SaleItem` come ordine e righe dell’operazione.
- `Appointment` rimane la rappresentazione compatibile dell’agenda, appartenente alla stessa operazione.
- I servizi prenotati diventano le righe modificabili del conto; non vengono ricopiati al momento dell’incasso.
- Assegnazione pianificata ed esecutore effettivo restano distinguibili.
- Stato della prenotazione, esecuzione e pagamento restano separati.
- Una vendita di soli prodotti può esistere senza occupare l’agenda.

Le tabelle e gli ID storici vengono conservati. Gli endpoint esistenti saranno adattatori allo stesso servizio applicativo, evitando due logiche di scrittura indipendenti.

### Sedi e settori

Per mantenere semplice il modello:

- Ogni settore appartiene a una sede; le denominazioni sono configurabili.
- Servizi e risorse operano nei rispettivi settori; i professionisti possono essere abilitati a più sedi e settori.
- I clienti sono aziendali.
- Il catalogo prodotti è aziendale; giacenze e movimenti appartengono alla sede.
- Ogni conto appartiene a una sede; ogni servizio mantiene il settore di attribuzione.
- I report aziendali riconciliano le sedi e i settori senza duplicare le righe.

## 4. Roadmap definitiva

Ogni milestone comprende analisi del dominio, progettazione esecutiva, implementazione, verifica e chiusura. Il passaggio alla successiva richiede l’autorizzazione prevista da `evolve.md`.

| Step | Obiettivo e interventi frontend/backend/database | Dipendenze e criterio di completamento |
|---|---|---|
| **0 — Baseline** | Congelare i contratti osservati, registrare rischi, verifiche e dati necessari al collaudo | Audit iniziale svolto; baseline di produzione ancora da acquisire |
| **1 — Sicurezza e protezione del legacy** | Sessioni revocabili, query isolate, validazione dei riferimenti, autorizzazioni minime e risposte prive di credenziali | Test negativi fra aziende e ruoli; login esistente utilizzabile con sessioni sicure |
| **2 — Rebranding ALORA** | Nome, identità visiva, metadati, PWA, icone, Swagger, notifiche e documentazione | Identità coerente; URL, database, volumi, ID e chiavi persistenti compatibili |
| **3 — Catalogo delle funzioni** | Registro unico delle capacità reali, matrice Connect versionata e associazione alle operazioni API/UI | Sincronizzazione reale; nuove funzioni negate finché non abilitate |
| **4 — SSO e attivazione azienda** | Configurazione per tenant, SDK, callback, collegamenti espliciti e passaggio graduale a SSO | Login, rinnovo, revoca e licenza verificati con Connect reale; migrazione utenti senza perdita dei profili |
| **5 — Ruoli e squadra** | Delega Connect, ruoli personalizzabili, account facoltativi dei professionisti e dashboard personale | Titolare autonomo entro licenza; collaboratore limitato ai propri dati anche via API |
| **6 — Profilo e sicurezza personale** | Profilo, cambio/recupero password tramite SSO, MFA, dispositivi e sessioni | Collaudo dei provider realmente attivati; nessun secondo sistema di credenziali |
| **7 — Sedi e settori** | Configurazione, selezione della sede, assegnazioni operative e filtri; migrazione verso sede/settore iniziali | Nessuna operazione priva di attribuzione; visibilità applicata nelle query |
| **8 — Conto operativo unico** | Evoluzione di ordini, righe e agenda; adattatori legacy e script di collegamento dei dati | Prenotazione e conto condividono le righe; nessun duplicato o cambiamento dei totali storici |
| **9 — Prezzi, IVA e magazzino** | Calcolo monetario centralizzato, aliquote acquisto/vendita indipendenti, prezzi storici, movimenti e giacenze per sede | Quadratura monetaria e di stock; resi, rettifiche e trasferimenti tracciabili |
| **10 — Prenotazione e incasso rapido** | Booking multiplo, assegnazione automatica, conferma, modifiche contestuali, prodotti aggiuntivi, acconti e saldo | Flusso completo sullo stesso conto; doppio incasso e sovraprenotazione impediti |
| **11 — WhatsApp Connect** | Pagina dedicata, QR, stato, connessioni, conversazioni e autorizzazioni | Pairing e operazioni reali verificati; nessuna infrastruttura WhatsApp parallela |
| **12 — Automazioni appuntamenti** | Eventi durevoli, promemoria, template, risposte e riconciliazione tramite Connect | Prove con duplicazioni, timeout, revoche e risposte tardive; nessun reinvio automatico degli esiti incerti |
| **13 — Dashboard e responsive** | Report azienda/sede/settore/persona, selettori completi, agenda e cassa per tablet | Totali riconciliati; collaudo desktop, tablet verticale/orizzontale e smartphone |
| **14 — Validazione commerciale** | Onboarding, deployment di produzione, aggiornamenti, backup, ripristino e collaudo finale | Azienda attivabile senza modifiche al codice; flussi reali e procedure operative verificati |

L’unificazione del conto precede magazzino e automazioni perché entrambi devono riferirsi a righe, importi e stati autorevoli. I pagamenti vengono registrati singolarmente; “incassato” deriva dai movimenti di pagamento, “venduto” dalle righe confermate e “residuo” dalla loro differenza.

Come default iniziali: arrotondamento monetario esplicito al centesimo per riga, costo medio ponderato per il magazzino e attribuzione degli sconti complessivi proporzionale alle righe con gestione deterministica dei centesimi residui. I dati storici incompleti restano riconoscibili e non vengono reinterpretati automaticamente.

## 5. Piano esecutivo dello Step 1

**Obiettivo:** eliminare le vulnerabilità verificate conservando utenti, password, dati e contratti utilizzati dall’interfaccia attuale.

### Attività ordinate

1. **Bloccare i comportamenti attesi con test di sicurezza.** Preparare due aziende, utenti con ruoli diversi e record collegati; verificare autenticazione, lettura e modifica senza utilizzare dati di produzione.

2. **Sostituire i token prevedibili.** Introdurre sessioni locali transitorie con token casuali di almeno 256 bit, conservati come hash, scadenza e revoca. Access token e refresh token saranno distinti; il rinnovo ruoterà il refresh e rileverà il riutilizzo.

3. **Preservare l’interfaccia di autenticazione.** Mantenere login, refresh, logout e `me` e i campi di risposta necessari alla UI. Aggiornare lo store e il client per il rinnovo condiviso della sessione, senza ripetizione automatica delle mutazioni. I vecchi token saranno invalidati: sarà necessario un nuovo accesso, senza modificare password o account.

4. **Isolare tutte le operazioni.** Vincolare letture, modifiche ed eliminazioni a `tenantId`; impedire la riassegnazione implicita dell’azienda; verificare l’appartenenza di ogni riferimento e delle relazioni annidate. Applicare le stesse regole a cache e flussi di aggiornamento.

5. **Applicare una policy locale transitoria.** Titolare limitato alla propria azienda; amministratore di piattaforma separato dalle operazioni ordinarie; professionista limitato agli appuntamenti e ai dati operativi di competenza; manager e reception vincolati alle autorizzazioni esplicite. La gestione configurabile completa resta nello step dedicato ai ruoli.

6. **Validare e ridurre le risposte.** Introdurre DTO effettivamente validati nei percorsi interessati, usare proiezioni esplicite degli utenti ed escludere hash delle password e token. Disabilitare gli endpoint di pagamento simulati come operazioni commerciali.

7. **Tracciare e verificare.** Registrare login, revoca e modifiche sensibili senza segreti; applicare la migrazione additiva delle sessioni su database di prova e verificare il ritorno alla release precedente compatibile.

### Componenti coinvolti

Il nucleo riguarda [request-session.ts](/Users/eugeniorenna/barber/apps/api/src/common/request-session.ts), il modulo API di autenticazione e lo store/client auth Angular. Seguono i controller CRUD interessati, le chiavi di cache, lo schema Prisma e i test delle autorizzazioni.

Non vengono introdotte nuove identità o procedure di password: si mette in sicurezza il login già esistente durante la transizione a Connect.

### Criteri di accettazione

- Un token costruito dall’ID utente viene rifiutato.
- Scadenza, logout e revoca impediscono le richieste successive.
- Nessun utente modifica o collega record appartenenti a un’altra azienda.
- Il professionista non riceve dashboard aziendale, incassi complessivi o appuntamenti altrui.
- Le risposte non contengono password hash, refresh token persistiti o altri segreti.
- Login, agenda, clienti e Quick Order continuano a funzionare con i dati esistenti.
- Suite automatica, build e collaudo API su PostgreSQL isolato passano prima del rilascio.

## 6. Migrazioni, rollback e accettazione finale

Ogni migrazione strutturale deve essere accompagnata da uno script con modalità **analisi, applicazione e verifica**, ripetibile e dotato di checkpoint e registrazione delle corrispondenze fra dati vecchi e nuovi.

La migrazione del conto unico dovrà gestire esplicitamente appuntamenti senza vendita, vendite autonome, collegamenti esistenti ed eventuali duplicati storici. Non verranno inventati importi di acconti, incassi o informazioni fiscali non registrati nel sistema attuale.

La procedura di rilascio prevede:

1. Prova completa su una copia recente della produzione.
2. Confronto prima/dopo di record, ID, relazioni, stati e totali monetari.
3. Backup verificato e prova di ripristino.
4. Finestra controllata con scritture, worker e invii sospesi durante la migrazione.
5. Verifiche concluse prima della riapertura.
6. Attivazione progressiva e controlli di riconciliazione.

Prima della riapertura, un errore consente il ripristino dello snapshot. Dopo nuove scritture, il rollback deve preservarle: non si ripristina semplicemente un vecchio database perdendo le operazioni intervenute. Le migrazioni additive e il rollback applicativo compatibile saranno quindi la scelta ordinaria.

Non è possibile garantire rischio zero al 100%; il criterio richiesto è **ripristino dimostrato e nessuna attivazione con riconciliazioni fallite**.

I collaudi finali comprenderanno: isolamento fra aziende e sedi, prenotazioni concorrenti, servizi aggiunti al conto, attribuzione degli esecutori, acconto più saldo, pagamenti misti, storni, movimenti di magazzino, quadratura dei report e ciclo completo WhatsApp.

Non restano decisioni di prodotto che impediscano lo Step 1. Prima del rilascio serviranno la copia verificabile della produzione e l’ambiente di collaudo; prima degli step Connect dovranno essere confermati runtime, SDK distribuito e contratti estesi. Ogni risultato distinguerà implementazione, test automatici, simulazioni e verifiche reali.
