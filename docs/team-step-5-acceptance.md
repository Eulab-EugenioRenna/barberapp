# Collaudo operativo Step 5 — Ruoli e squadra

Stato: **collaudo tecnico del consumer eseguito in parte sul Docker reale**, dopo
l’autorizzazione dell’utente al collaudo ALORA con Connect schema 014. Non equivale
a chiusura dello Step 5 o accettazione di produzione.
[Evidenze e perimetro](verification/team-real-consumer.json).

## Esiti correnti — 26 ottobre 2026

| Caso | Evidenza reale acquisita | Parte ancora da completare |
| --- | --- | --- |
| R1 | Squadra 200/canManage dopo abilitazione dell’utente in Connect | Accettazione finale utente |
| R2 | Creazione ruolo dalla UI entro delega | Modifica positiva dalla UI |
| R3 | Manager ristretto: creazione/modifica/eliminazione ruolo e assegnazione/revoca/restore del target fuori delega: sei 403, sessione valida, nessuna modifica al target | — |
| R4 | Assegnazioni esplicite sull’account di prova | Destinatario con accesso anche a una seconda applicazione |
| R5 | Revoca elimina i ruoli; ripristino con assegnazione esplicita | Deselezione manuale di tutti i ruoli e conferma UI |
| R6–R7 | Revoca dalla UI nega la sessione già aperta; riassegnazione dalla UI e nuovo login riusciti, identità conservata | — |
| L1–L2 | Profilo personale limitato; zero permessi locali nega API e indirizza ad Accesso da configurare | — |
| L3 | Professionista di altra azienda rifiutato, associazione precedente conservata | Collisione con professionista già occupato |
| L4 | Associazione corrente del titolare conservata | Comando UI di associazione/rimozione; non si è modificato il titolare esistente |
| P1–P2 | Una sola assegnazione personale e solo turno proprio nella settimana di prova | Navigazione giorno/mese, paginazione e altre eccezioni nell’ambiente effettivo |
| P3 | Senza consenso locale valori null anche con concessione Connect; con consenso locale 123,45 €, esclusi prodotto e servizio altrui; ricavi aziendali 403 | — |
| P4 | Dopo concessione locale esplicita solo transizione propria; altri incarichi e transizione inversa vietati | Conferma della transizione dalla UI |
| P5 | Caso concorrente coperto dalle fixture PostgreSQL documentate | Riassegnazione concorrente sul consumer effettivo |
| P6 | Manager limitato dalla policy locale anche con concessione centrale | Manager/reception con propria assegnazione personale |
| I1 | Altra azienda: lettura/modifica appuntamento e associazione professionista negate | Altri percorsi della checklist multi-azienda |
| U1 | Agenda personale a 375×812, 768×1024, 1024×768, 1366×900: nessun overflow orizzontale, sezione orari visibile; screenshot telefono ispezionato | Interazione completa con form squadra/agenda e dispositivi reali |
| C1 | Creazione UI → SDK → provider/mapping → login personale; nessuna password provider nel suo hash locale; connectAcceptedAt valorizzato al primo login. Risposta browser persa recuperata con stesso ID e password originale, nessun retry automatico o duplicato | Senza password iniziale, rifiuto password provider e altri conflitti/recuperi remoti elencati sotto |

I test usano tre nuove identità di prova, un ruolo personale, uno per i valori e
uno per il manager ristretto. Nessun privilegio di un account preesistente è
alterato. Tutte le fixture sono state rimosse tramite API amministrativa Connect
per provider/mapping/ruoli e transazione locale per i dati ALORA; cache coinvolte
invalidate. I backup di entrambi i database sono ripristinati in database isolati,
poi eliminati. Riconciliazione: 14 tabelle ALORA e 15 Connect; le sole differenze
ammesse sono i timestamp di login User.updatedAt e di controllo/sync catalogo.
Audit e record runtime di sessione sono fuori dal confronto; l’audit è conservato.
Il test della risposta persa riguarda il tratto ALORA→browser, non simula un
COMMIT remoto perso. Gli appuntamenti/conti sono fixture SQL, non prenotazioni
passate dal motore operativo. Nessun collaudo di produzione o PWA nativa.

## Ambiente e prerequisiti

- ALORA sviluppo: [login](http://127.0.0.1:53020/admin/#/login), [Accessi squadra](http://127.0.0.1:53020/admin/#/team), [agenda personale](http://127.0.0.1:53020/admin/#/my-agenda).
- Connect sviluppo: [pannello](http://localhost:8088). Identità, licenza, assegnazioni e delega dell’installazione devono essere attive. Sincronizzare il catalogo ALORA versione 3 (24 funzioni), poi abilitare esplicitamente le funzioni richieste. La sincronizzazione da sola non concede permessi.
- Per amministrare la squadra servono `users.manage` in ALORA e `team.manage` effettivo in Connect e ALORA. Responsabile/reception richiedono anche la concessione locale esplicita. L’amministratore di piattaforma ALORA non è un titolare aziendale.
- Usare account e dati di collaudo. Servono un titolare e, per i casi personali, un account già mappato a questa installazione e presente in ALORA, con un professionista attivo associabile. Per il caso fra aziende serve una seconda azienda di prova. Il seed demo non garantisce account SSO per ogni professionista: la presenza nell’anagrafica non costituisce credenziale o mapping.
- Le prove modificano assegnazioni, policy e stati: annotare le impostazioni iniziali e usare appuntamenti di prova. Non azzerare il database o il seed per predisporle. Non pubblicare token, password o URL callback completi nelle evidenze.

Se un prerequisito manca, segnare il caso «bloccato» e indicare quale. Non creare collegamenti per coincidenza di email e non sostituire una prova utente con il risultato delle fixture.

## Casi disponibili su account esistenti

| ID | Azione manuale | Risultato da verificare |
| --- | --- | --- |
| R1 | Il titolare apre Accessi squadra | Elenco della propria installazione; nessun hash, token o segreto nelle risposte di rete. |
| R2 | Crea e modifica un ruolo con sole funzioni concedibili | Il ruolo resta entro licenza/delega; una funzione fuori delega non è assegnabile. Le impostazioni degli altri ruoli restano conservate. |
| R3 | Prova a modificare un ruolo o utente con privilegi fuori delega | Controlli UI non modificabili; un tentativo API diretto è rifiutato. Nessun aumento della delega e nessuna invalidazione della sessione per il solo errore di business. |
| R4 | Assegna un ruolo a un account di prova | Le sole assegnazioni dell’applicazione cambiano; gli accessi alle altre applicazioni restano conservati. |
| R5 | Deseleziona tutti i ruoli | Il salvataggio resta disabilitato fino alla conferma della perdita di accesso; dopo il salvataggio il destinatario non accede all’app. |
| R6 | Revoca l’accesso a un account di prova | La conferma è esplicita; account e identità restano presenti. La revoca elimina i ruoli di questa app. Nel browser separato del destinatario, una nuova richiesta protetta viene negata. |
| R7 | Sul revocato sceglie «Assegna ruoli per riattivare» e salva un ruolo | L’accesso viene riabilitato entro i permessi del ruolo e della policy locale. Il ripristino diretto è proposto solo quando esistono già assegnazioni. |
| L1 | In «Visibilità in ALORA» configura un collaboratore con sola agenda personale e professionista attivo | Nel suo browser separato vede soltanto la propria agenda; dashboard aziendale, vendite, altri appuntamenti e clienti completi restano inaccessibili anche via API. |
| L2 | Salva esplicitamente zero permessi locali | Alla navigazione successiva il collaboratore è indirizzato ad Accesso da configurare. Le richieste operative dirette vengono negate; profilo e dati non vengono eliminati. |
| L3 | Seleziona un professionista già occupato o di un’altra azienda | Operazione rifiutata; l’associazione precedente e la policy restano coerenti. Nessun collegamento viene sottratto all’altro account. |
| L4 | Il titolare usa «Il mio profilo professionista» | Associa/rimuove il proprio profilo con conferma; ruolo, permessi e credenziali del titolare restano invariati. La propria agenda è raggiungibile solo con il relativo diritto. |
| P1 | L’operatore apre La mia agenda e cambia giorno/settimana/mese | Appuntamenti e indicatori si riferiscono al professionista autenticato e al periodo nella zona aziendale; paginazione coerente. Nessun prezzo, nota interna o storico cliente nelle proiezioni personali. |
| P2 | Consulta I miei orari | Solo settimana tipo ed eccezioni personali; chiusure della propria azienda nel periodo. Nessuna nota interna o turno altrui. Gli orari configurati non sono presentati come slot certamente liberi. |
| P3 | Senza `dashboard.personal.values.read` consulta la pagina | Nessun importo personale; `values` è null. Con concessione Connect e locale esplicite vede le sole righe servizio attribuite, senza prodotti o totali aziendali. Il collaboratore richiede policy locale configurata. |
| P4 | Aggiorna un appuntamento personale confermato | Chiede conferma; ammette solo le transizioni operative indicate. Non permette annullamento aziendale, riapertura di terminali o modifica del prezzo. |
| P5 | Il titolare riassegna un appuntamento prima del salvataggio nel browser del precedente professionista | Il precedente assegnatario non riesce ad aggiornare lo stato. Dopo Aggiorna l’appuntamento non appare fra i suoi. |
| P6 | Come responsabile/reception concede soltanto lettura/scrittura own e collega il professionista | Le API restano limitate alla sua assegnazione anche se il tipo operativo non è collaborator. |
| I1 | Con utenti di due aziende prova letture/modifiche usando ID dell’altra azienda | Nessun dato o modifica estranea è consentito; ruolo/associazione originali conservati. |
| U1 | Usa form squadra e agenda da desktop, tablet verticale/orizzontale e telefono | Controlli leggibili e raggiungibili; nessun salvataggio involontario, nessun reinvio automatico dopo errore di rete. |

Per le prove API usare esclusivamente sessioni di collaudo e ID noti delle fixture. Non confondere un link nascosto con una protezione backend: annotare lo stato HTTP delle richieste negate. Gli stati terminali degli appuntamenti non vanno ripristinati artificialmente; usare un altro appuntamento di prova.

## C1 — Nuovo account collaboratore (percorso centrale verificato, sottocasi aperti)

L’utente ha approvato la candidata locale SDK 0.11.0 per lo sviluppo e il collaudo
consumer. Il Docker Connect è ora verificato a schema 014; il caso centrale è
passato come indicato nella tabella. I sottocasi seguenti restano requisiti
separati: quelli non coperti non sono dichiarati superati.
[Consegna produttore](../../eulab%20connect/docs/DELEGATED-ACCOUNTS-STEP-5.md).
1. In Accessi squadra scegliere Crea account, compilare nome/cognome/email e ambito operativo, scegliere ruoli Connect concedibili e selezionare i permessi locali. Per l’agenda personale associare un professionista libero e attivo. Nessuna unione con un account esistente per email.
2. Confermare con password iniziale di collaudo facoltativa. Verificare che la UI svuoti il campo. Se omessa, verificare l’indicazione di configurazione dell’accesso provider ancora necessaria; non è inviata un’email da questo form.
3. Se rifiutata per policy, verificare sessione operatore conservata, profilo inattivo salvato e possibilità di riprendere lo stesso ID da Creazioni da completare. Non cambiare anagrafica/ruoli di una creazione già inviata; errori di binding o identità richiedono riconciliazione esplicita.
4. Su un esito incerto, rileggere la lista e usare Riprendi creazione sul medesimo profilo. Verificare assenza di duplicati e conservazione della password dell’identità eventualmente già creata. Non premere ripetutamente o predisporre retry automatici.
5. Dopo conferma, verificare utente e associazione in ALORA, mapping sorgente/installazione/azienda e ruoli in Connect; accedere come nuovo collaboratore in un browser separato ed eseguire L1/P1/P2/P3. Il campo connectAcceptedAt sarà valorizzato dal vero accesso, non dal titolare.
6. Verificare i rifiuti per email/ID occupati, professionista già associato, ruoli fuori delega, altre aziende e identità/mapping sospesi o revocati. Nessuna riattivazione è consentita dalla ripetizione di una creazione.

La preassegnazione EULAB Admin o un login locale non sostituiscono questo caso. Le fixture ALORA attestano PostgreSQL e l’adattatore con SDK simulato, non l’accettazione C1 del provider/browser.

## Registrazione e chiusura

Per ogni ID registrare esito (non eseguito / passato / fallito / bloccato), ruolo e azienda di prova, browser/formato, comportamento osservato e sola evidenza priva di segreti. Data e versione devono identificare il collaudo; eventuali concessioni manuali vanno esplicitate. In caso di errore di rete dopo una scrittura, rileggere lo stato prima di un nuovo invio.

Lo Step 5 si chiude solo dopo C1 e i casi applicabili superati, senza sostituire l’accettazione reale con le 190 prove automatiche del sorgente corrente. Step 6 e successivi restano nel piano; il passaggio di fase segue evolve.md e richiede autorizzazione. Nessuna distribuzione in produzione è implicita nel collaudo locale.
