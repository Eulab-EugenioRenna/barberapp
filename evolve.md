# ALORA by EULAB — Evoluzione della piattaforma, integrazione Connect e refactoring funzionale

## 1. Ruolo e obiettivo

Agisci come **Software Architect, Senior Full-Stack Engineer e Product Designer**, con responsabilità sull'analisi, sulla progettazione e sull'evoluzione della piattaforma esistente.

Il progetto attualmente denominato **Barber** deve evolvere in **ALORA by EULAB**, una piattaforma SaaS multi-tenant dedicata alla prenotazione, gestione operativa, commerciale e amministrativa delle attività nel settore Beauty & Wellness, con possibilità di configurare ulteriori settori.

Non vogliamo riscrivere inutilmente il software, né aggiungere funzionalità isolate. Vogliamo consolidare il prodotto esistente, integrarlo nell'ecosistema EULAB e renderlo commercialmente pronto, affidabile, intuitivo e scalabile.

**Principio fondamentale: procedere per domini funzionali verticali, completando un argomento prima di iniziare il successivo.**

Non avviare lo sviluppo di tutti i moduli contemporaneamente.

---

## 2. Analisi preliminare obbligatoria

Prima di proporre modifiche o scrivere codice:

1. Analizza completamente la repository corrente di Barber/Alora.
2. Ricostruisci l'architettura frontend, backend, database, autenticazione, servizi e integrazioni.
3. Identifica le funzioni già operative, parzialmente implementate, incomplete o difettose.
4. Individua dipendenze tra moduli e duplicazioni di logica.
5. Verifica le eventuali criticità di sicurezza, multi-tenancy e autorizzazione.
6. Analizza la repository EULAB Connect: https://github.com/Eulab-EugenioRenna/connect
7. Leggi README, CONTEXT, documentazione di integrazione, SDK, API, modelli di autorizzazione, matrici delle funzioni e WhatsApp.
8. Identifica i contratti esistenti prima di definire nuove API.
9. Valuta le migrazioni necessarie per preservare i clienti e i dati già presenti.

Non inventare interfacce o endpoint senza prima verificare quelli disponibili.

L'analisi deve distinguere chiaramente:

- **Esistente e funzionante**
- **Esistente ma da correggere**
- **Da modificare o rifattorizzare**
- **Da sviluppare**
- **Da verificare nella documentazione o nel codice**

### Deliverable iniziale

Produci una roadmap tecnica ordinata per dipendenze, priorità e impatto sul prodotto.

Ogni fase deve prevedere obiettivo, componenti coinvolti, dipendenze, interventi frontend/backend/database, eventuali migrazioni, test e criteri di completamento.

**Non implementare ancora le nuove funzionalità. Prima presentami il piano completo e approfondisci soltanto il primo step.**

---

# 3. Architettura EULAB Connect e identità

EULAB Connect deve diventare il sistema centrale per identità, autenticazione, autorizzazione e abilitazione delle funzionalità.

ALORA rimane il sistema responsabile dei propri dati operativi e della propria logica di business.

L'architettura deve rispettare le distinzioni già stabilite da Connect:

- **Applicazione:** ALORA, con il proprio catalogo di funzioni.
- **Installazione:** istanza configurata e collegata al cliente.
- **Cliente:** azienda titolare della licenza.
- **Utente:** persona fisica dotata di identità centrale SSO.
- **Funzione:** capacità dichiarata da ALORA.
- **Licenza:** abilita commercialmente le funzioni disponibili per il cliente.
- **Ruolo:** raggruppa le funzioni assegnabili agli utenti.
- **Permesso effettivo:** risultato delle verifiche di licenza, utente, appartenenza, installazione e assegnazioni.

## 3.1 Single Sign-On

Implementare l'accesso tramite Connect, riutilizzando SDK e flussi già previsti.

Il flusso atteso è:

1. EULAB Admin registra l'azienda cliente.
2. L'azienda viene associata all'applicazione ALORA e alla relativa installazione.
3. Viene configurata la licenza con le funzionalità abilitate.
4. Gli utenti vengono collegati all'azienda con identità SSO individuali.
5. ALORA permette l'accesso tramite Connect.
6. Connect autentica l'utente e determina le autorizzazioni effettive.
7. ALORA applica tali autorizzazioni alle proprie operazioni, alle API e all'interfaccia.

Prevedere gestione sessione, scadenza, logout, revoca, errori di autorizzazione e collegamento esplicito con gli utenti locali.

Non collegare automaticamente identità tramite semplice corrispondenza dell'email.

## 3.2 Matrice delle funzioni

ALORA deve esporre il proprio catalogo delle funzionalità secondo il contratto e il formato versionato previsti da Connect.

Esempi indicativi:

- `booking.read`
- `booking.create`
- `booking.update`
- `booking.manage`
- `calendar.read`
- `calendar.manage`
- `customers.read`
- `customers.manage`
- `cashier.read`
- `cashier.operate`
- `inventory.read`
- `inventory.manage`
- `dashboard.read`
- `dashboard.sector.read`
- `collaborators.manage`
- `whatsapp.read`
- `whatsapp.send`
- `whatsapp.manage`
- `settings.manage`

Questi identificativi sono proposte iniziali: confrontali con le convenzioni reali della repository Connect prima di adottarli.

La matrice deve essere generata a partire dalle capacità realmente supportate dall'applicazione, mantenuta coerente e versionata.

Quando ALORA introduce una nuova funzionalità, deve poterla dichiarare a Connect senza dover ricostruire manualmente l'intero sistema di autorizzazioni.

Le nuove funzioni devono richiedere abilitazione esplicita e non diventare automaticamente accessibili.

---

# 4. Ruoli, collaboratori e permessi granulari

È necessario distinguere tra funzionalità acquistate dall'azienda e funzionalità assegnate alle singole persone.

**Regola principale: Connect stabilisce quali funzionalità sono disponibili e autorizzabili; il titolare decide quali concedere ai propri collaboratori, entro i limiti della licenza e delle autorizzazioni effettive.**

## 4.1 Ruoli

Prevedere un sistema configurabile con eventuali ruoli predefiniti:

- Titolare
- Responsabile
- Collaboratore
- Receptionist
- Cassiere
- Ruolo personalizzato

I ruoli costituiscono modelli iniziali e non devono imporre vincoli rigidi a tutte le aziende.

Il titolare deve poter concedere, revocare e personalizzare i permessi dei collaboratori secondo il modello consentito da Connect.

La UI deve rendere semplice capire cosa può fare ogni persona.

## 4.2 Account collaboratore

Ogni collaboratore deve poter avere:

- Un'identità personale SSO.
- Un profilo operativo in ALORA.
- Appartenenza a una o più aree operative, dove previsto.
- Servizi assegnati.
- Agenda personale.
- Orari di disponibilità.
- Ruoli e permessi.
- Statistiche personali.
- Gestione del profilo e sicurezza dell'account.

Non tutti i collaboratori devono necessariamente avere credenziali di accesso: il sistema deve supportare anche collaboratori anagrafici privi di account attivo.

## 4.3 Restrizioni predefinite

Per il collaboratore standard:

- Non deve vedere la dashboard amministrativa generale.
- Non deve vedere i fatturati complessivi aziendali.
- Non deve vedere i dati degli altri collaboratori.
- Non deve amministrare utenti, ruoli o permessi.
- Non deve accedere a impostazioni riservate.
- Deve vedere esclusivamente gli appuntamenti e i dati operativi di propria competenza.
- Deve avere una dashboard personale con attività, servizi eseguiti e relativi valori economici consentiti.

I valori economici visualizzati devono essere configurabili: prezzo del servizio, valore prodotto, compenso o provvigione non sono necessariamente la stessa cosa.

Le restrizioni devono essere implementate anche nel backend e nelle query al database, non soltanto attraverso la visibilità dei componenti frontend.

Progettare autorizzazioni che distinguano almeno:

- Lettura
- Creazione
- Modifica
- Eliminazione
- Gestione
- Ambito dei dati: propri, assegnati, settore o intera azienda

---

# 5. Profilo utente, password, OTP e sicurezza

La gestione delle identità deve sfruttare Connect e il sistema SSO già esistente.

Prevedere:

- Profilo personale.
- Modifica dati consentiti.
- Cambio password.
- Recupero password.
- OTP e autenticazione multifattore, secondo i provider effettivamente supportati.
- Gestione sessioni.
- Disconnessione.
- Eventuali dispositivi attendibili.
- Notifiche relative alla sicurezza.
- Revoca dell'accesso a utenti e collaboratori.

**Non implementare un secondo sistema di credenziali indipendente dentro ALORA se la funzione è già gestita da Connect.**

Verificare la documentazione Connect, distinguendo ciò che è implementato da ciò che è soltanto predisposto e necessita ancora di attivazione o collaudo.

---

# 6. Gestione multi-settore

ALORA deve superare il concetto di gestionale esclusivo per barber shop.

Un'unica attività può operare in più settori contemporaneamente.

Esempi:

- Uomo
- Donna
- Estetica
- Benessere
- Pet grooming
- Altri settori personalizzati

Questi sono esempi e non devono diventare categorie codificate rigidamente nel software.

## 6.1 Configurazione settori

Il titolare deve poter:

- Creare e modificare settori.
- Attivare e disattivare settori.
- Associare servizi, collaboratori e risorse.
- Stabilire disponibilità e orari.
- Assegnare prezzi e configurazioni.
- Definire autorizzazioni e ambiti di visibilità.

## 6.2 Ordini multi-settore

Un cliente può acquistare servizi appartenenti a settori differenti in un unico appuntamento, ordine o percorso operativo.

Ogni riga del servizio deve mantenere la propria attribuzione al settore.

Esempio:

Un cliente prenota un servizio capelli e un trattamento estetico. I due servizi appartengono a settori differenti, ma possono confluire nello stesso ordine e nello stesso pagamento.

Il sistema deve conservare correttamente:

- Settore di appartenenza.
- Collaboratore che esegue il servizio.
- Prezzo applicato.
- Sconti.
- Eventuali imposte.
- Stato operativo.
- Ricavi attribuiti.

## 6.3 Dashboard

Prevedere:

**Dashboard generale:** panoramica completa dell'azienda e dei settori autorizzati.

**Dashboard settoriale:** indicatori filtrati per settore.

**Dashboard personale:** dati limitati al collaboratore autenticato e al relativo ambito autorizzato.

I dati devono rimanere coerenti fra le viste: la somma dei settori deve riconciliarsi con il totale aziendale senza duplicazioni o omissioni.

---

# 7. Magazzino, prodotti, prezzi e IVA

Revisionare la gestione del magazzino rendendola coerente, flessibile e utilizzabile sia da attività che ragionano con prezzi IVA inclusa sia da attività che gestiscono imponibile e imposta separatamente.

## 7.1 Gestione prezzi

Supportare almeno:

- Prezzo imponibile.
- Aliquota IVA.
- Importo IVA.
- Prezzo IVA inclusa.
- Prezzo di acquisto.
- Prezzo di vendita.
- Costo medio o altro criterio di valorizzazione da definire.
- Storico delle variazioni dei prezzi.

Il sistema deve consentire l'inserimento del prezzo in modalità IVA inclusa o esclusa, mantenendo valori e calcoli coerenti.

La preferenza di inserimento e visualizzazione deve essere configurabile senza perdere le informazioni fiscali necessarie.

Non confondere una modalità di visualizzazione semplificata con l'esenzione da obblighi fiscali.

## 7.2 Carico e scarico

Le aliquote applicate in acquisto e vendita devono poter essere diverse quando previsto.

Esempio: acquisto registrato con IVA al 22% e successiva vendita con IVA al 4%, qualora la classificazione fiscale dell'operazione lo consenta.

Non derivare automaticamente l'IVA di vendita da quella di acquisto.

Gestire separatamente le regole fiscali applicabili e consentire eventuali override controllati con tracciamento della motivazione.

## 7.3 Movimentazioni

Revisionare:

- Anagrafica prodotti.
- Carichi.
- Scarichi.
- Rettifiche.
- Inventario.
- Giacenze.
- Movimenti legati a vendite e consumi interni.
- Eventuali resi.
- Valorizzazione economica.

Ogni movimento deve essere tracciabile e attribuibile correttamente a prodotto, installazione/azienda, utente e, quando applicabile, settore.

## 7.4 Calcoli e dashboard

Verificare coerenza fra:

- Ricavi imponibili.
- Ricavi IVA inclusa.
- IVA sugli acquisti.
- IVA sulle vendite.
- Costi e margini.
- Magazzino.
- Vendite.
- Cassa.
- Dashboard generale e settoriali.

Usare calcoli monetari precisi e politiche esplicite di arrotondamento. Evitare errori derivanti da operazioni floating-point sui prezzi.

Separare i report gestionali dal calcolo degli adempimenti fiscali.

---

# 8. Integrazione WhatsApp tramite EULAB Connect

ALORA deve utilizzare le funzionalità WhatsApp già esposte da Connect, evitando di implementare una seconda infrastruttura di gestione delle sessioni.

## 8.1 Pagina WhatsApp dedicata

Realizzare una sezione autonoma, utilizzabile direttamente dal titolare o da utenti esplicitamente autorizzati.

La pagina deve consentire:

- Visualizzazione dello stato della connessione.
- Collegamento del numero tramite QR Code.
- Gestione connessione e disconnessione.
- Visualizzazione degli eventuali errori.
- Impostazione delle notifiche.
- Configurazione dei template di messaggio.
- Configurazione delle risposte interattive.
- Visualizzazione dello storico e delle conversazioni, se abilitate.
- Gestione dei permessi per lettura, invio e amministrazione.

Utilizzare SDK, API e modelli di stato già supportati da Connect.

## 8.2 Notifiche appuntamenti

Implementare notifiche WhatsApp per:

- Conferma iniziale della prenotazione.
- Promemoria prima dell'appuntamento.
- Richiesta di conferma.
- Conferma da parte del cliente.
- Annullamento.
- Riprogrammazione.

Il cliente deve poter rispondere anche tramite messaggi interattivi, se il canale e il formato risultano supportati.

Esempio:

"Confermi il tuo appuntamento di domani alle 15:30?"

Azioni:

- Conferma
- Richiedi modifica
- Annulla

Le risposte devono produrre transizioni di stato coerenti nel sistema di prenotazione.

## 8.3 Automazioni

Consentire al titolare di configurare:

- Attivazione delle notifiche.
- Anticipo dei promemoria.
- Testo dei messaggi.
- Tipologie di eventi.
- Eventuali promemoria ripetuti.
- Comportamento in assenza di risposta.

Prevedere code, idempotenza, deduplicazione, gestione errori e riconciliazione degli stati.

Non assumere che un messaggio inviato sia automaticamente ricevuto o che un'operazione esterna sia eseguita esattamente una volta.

L'invio di messaggi deve rispettare le autorizzazioni, il consenso e le regole applicabili al canale.

---

# 9. Refactoring delle prenotazioni e della cassa

Questo è uno degli interventi più importanti per rendere ALORA vendibile.

Occorre esaminare i flussi reali dell'applicazione e ridurre il numero di passaggi, la complessità visiva e la fatica mentale necessaria per svolgere le operazioni quotidiane.

## 9.1 Prenotazioni

Analizzare e migliorare:

- Prenotazione online.
- Prenotazione inserita manualmente.
- Cliente esistente o nuovo cliente.
- Servizi singoli e multipli.
- Servizi appartenenti a settori differenti.
- Assegnazione collaboratori.
- Durata e disponibilità.
- Conflitti di calendario.
- Spostamento e annullamento.
- Conferma.
- Check-in.
- Servizio in corso.
- Servizio completato.
- Collegamento all'ordine e alla cassa.

Garantire coerenza tra agenda pubblica, gestionale interno e stato effettivo delle risorse.

## 9.2 Cassa

Analizzare il passaggio dall'appuntamento al pagamento.

Il flusso dovrebbe permettere di:

1. Selezionare un appuntamento oppure iniziare una vendita diretta.
2. Recuperare automaticamente servizi, prodotti e prezzi.
3. Modificare le voci quando autorizzato.
4. Applicare sconti.
5. Gestire importi e imposte.
6. Registrare pagamenti e metodi di pagamento.
7. Chiudere l'ordine.
8. Aggiornare il magazzino, quando necessario.
9. Aggiornare dashboard e report.

Prevedere annullamenti, storni, pagamenti parziali e stati intermedi se coerenti con l'attuale architettura.

Non sovrapporre la registrazione gestionale di un pagamento all'emissione di documenti fiscali: verificare separatamente le integrazioni eventualmente necessarie.

## 9.3 Riduzione della complessità

Evitare schermate che obbligano l'utente a comprendere prima l'architettura interna del software.

Le operazioni frequenti devono essere immediatamente riconoscibili.

Il prodotto deve privilegiare:

- Azioni contestuali.
- Flussi brevi.
- Terminologia coerente.
- Riduzione dei campi inutili.
- Feedback immediato.
- Prevenzione degli errori.
- Percorsi prevedibili.
- Stati ben distinguibili.
- Nessuna duplicazione concettuale.

---

# 10. Dashboard, calendario e UI responsive

Effettuare un audit dell'interfaccia esistente, preservando le parti efficaci e correggendo i problemi reali.

## 10.1 Problemi noti

**Filtro collaboratori della dashboard**

Il componente select non visualizza tutti gli utenti/collaboratori attesi.

Analizzare caricamento dati, paginazione, filtri, autorizzazioni e stato frontend, individuando la causa effettiva.

**Calendario su tablet**

La visualizzazione tablet utilizza un layout assimilabile a quello mobile, rendendo difficoltosa la gestione dell'agenda.

Ripensare i breakpoint sulla base dello spazio disponibile e delle operazioni da eseguire, non soltanto delle dimensioni nominali del dispositivo.

## 10.2 Esperienza responsive

Definire comportamenti adeguati per:

- Desktop.
- Tablet orizzontale.
- Tablet verticale.
- Smartphone.

Il tablet deve essere considerato una postazione operativa primaria per il salone, specialmente per agenda, prenotazioni, check-in e cassa.

Utilizzare componenti responsive adeguati, senza limitarsi a ridimensionare quelli desktop o riutilizzare indiscriminatamente quelli mobile.

## 10.3 Design del prodotto

L'interfaccia deve essere:

- Moderna.
- Professionale.
- Pulita.
- Veloce.
- Coerente.
- Semplice da apprendere.
- Ottimizzata per touch e mouse.

Ridurre gli elementi superflui, migliorare spaziature, gerarchie, filtri, tabelle, dialog, form e stati delle operazioni.

L'obiettivo non è semplicemente ottenere una UI più bella, ma **rendere l'utilizzo quotidiano immediato anche per personale non tecnico**.

---

# 11. Roadmap tecnica proposta

Organizza il lavoro in milestone verticali, nel seguente ordine iniziale. Modifica l'ordine soltanto se dall'analisi emergono dipendenze tecniche documentabili.

| Step | Area | Obiettivo |
|---|---|---|
| 0 | Audit iniziale | Ricostruire lo stato reale e pianificare gli interventi |
| 1 | Rebranding ALORA | Aggiornare identità e riferimenti senza rompere il sistema |
| 2 | SSO Connect | Integrare autenticazione, sessioni e collegamento utenti |
| 3 | Matrice delle funzioni | Pubblicare il catalogo versionato compatibile con Connect |
| 4 | Ruoli e collaboratori | Implementare autorizzazioni e dashboard personali |
| 5 | Profilo, password, OTP | Integrare la gestione della sicurezza tramite Connect |
| 6 | Settori | Introdurre struttura configurabile e attribuzione delle operazioni |
| 7 | Magazzino e IVA | Correggere modello economico, movimenti e calcoli |
| 8 | WhatsApp Connect | Integrare QR, connessioni e pagina gestionale |
| 9 | Notifiche appuntamenti | Integrare promemoria, conferme e messaggi interattivi |
| 10 | Prenotazioni e cassa | Rifattorizzare l'intero percorso operativo |
| 11 | Dashboard e responsive | Ottimizzare report, calendario, tablet e mobile |
| 12 | Validazione commerciale | Collaudo end-to-end e verifica di prontezza alla vendita |

La roadmap è una sequenza preliminare, non un ordine da eseguire ciecamente. In particolare, il dominio prenotazioni/cassa dovrà essere analizzato già nella fase iniziale per evitare che le nuove strutture di settori, IVA e autorizzazioni entrino in conflitto con quelle esistenti.

---

# 12. Metodo di sviluppo obbligatorio

Per ogni singolo step applica questo procedimento.

### Fase A — Analisi

Studia il codice coinvolto, identifica i problemi reali e individua le dipendenze.

### Fase B — Progettazione

Descrivi:

- Cosa cambia.
- Cosa rimane invariato.
- Quali componenti vengono modificati.
- Quali API e modelli dati sono coinvolti.
- Quali migrazioni servono.
- Quali rischi esistono.

### Fase C — Piano esecutivo

Suddividi lo step in attività piccole, verificabili e ordinate.

Ogni attività deve avere un risultato osservabile.

### Fase D — Implementazione

Implementa esclusivamente il perimetro approvato per lo step corrente.

Non introdurre sistemi paralleli se esistono già soluzioni condivise.

Non creare nuove funzionalità non richieste soltanto perché possono risultare utili in futuro.

### Fase E — Verifica

Esegui test pertinenti:

- Unit test.
- Integration test.
- Verifica API.
- Verifica permessi backend.
- Test dei flussi utente.
- Test responsive, se applicabili.
- Test di regressione.

Distingui test automatici, verifiche simulate e collaudi reali.

### Fase F — Chiusura

Fornisci:

- Funzionalità completate.
- File e moduli modificati.
- Migrazioni applicate o predisposte.
- Test eseguiti e risultati.
- Problemi ancora aperti.
- Eventuali dipendenze dello step successivo.

Non dichiarare completato uno step che presenta funzionalità fondamentali non funzionanti.

**Non procedere automaticamente allo step successivo: presenta il risultato e attendi l'autorizzazione.**

---

# 13. Vincoli architetturali

Durante l'intero progetto rispetta queste regole:

1. **Single source of truth:** Connect governa identità, licenze e autorizzazioni centrali; ALORA governa i propri dati e processi operativi.
2. **Multi-tenancy:** nessun accesso ai dati di aziende diverse.
3. **Autorizzazione lato server:** nascondere un elemento UI non equivale a negare una permission.
4. **Compatibilità:** preservare dati, prenotazioni, clienti e operazioni esistenti.
5. **Migrazioni sicure:** prevedere procedure di aggiornamento, verifica e rollback quando applicabili.
6. **Modularità:** evitare dipendenze circolari e logiche duplicate.
7. **API contract-first:** rispettare le convenzioni effettive di Connect.
8. **Configurabilità:** non codificare rigidamente settori, ruoli, aliquote o modelli commerciali.
9. **Tracciabilità:** registrare modifiche e operazioni sensibili.
10. **Pragmatismo:** non introdurre microservizi, astrazioni, framework o complessità aggiuntiva senza una necessità concreta.
11. **Qualità:** nessuna funzione importante deve restare simulata, collegata a dati mock o presente soltanto visivamente.
12. **Coerenza:** la stessa operazione deve avere un risultato uniforme in calendario, ordini, cassa, magazzino e report.

---

# 14. Criteri di qualità commerciale

ALORA deve diventare un prodotto realmente vendibile, non una somma di funzionalità tecnicamente esistenti.

Considera il lavoro riuscito quando:

- Il titolare riesce a configurare la propria attività senza assistenza tecnica per le operazioni ordinarie.
- Può gestire autonomamente collaboratori, ruoli, settori e servizi.
- Ogni collaboratore vede soltanto ciò che gli è consentito.
- Le prenotazioni funzionano coerentemente online e in sede.
- La cassa riconcilia ordini, servizi, pagamenti e magazzino.
- I calcoli economici sono corretti e verificabili.
- Le dashboard mostrano informazioni coerenti con gli ambiti autorizzati.
- Le funzionalità WhatsApp configurate funzionano attraverso Connect.
- Desktop, tablet e smartphone sono utilizzabili nei rispettivi contesti.
- Un'azienda può essere attivata tramite Connect senza interventi manuali sul codice.
- Il sistema può essere aggiornato senza compromettere l'operatività dei clienti esistenti.

---

# 15. Prima risposta richiesta

In questa prima interazione non voglio che tu inizi a sviluppare tutti i moduli.

Voglio che tu produca:

**1. Audit tecnico iniziale**

Architettura attuale, funzionalità esistenti, criticità e componenti coinvolti.

**2. Analisi dell'integrazione EULAB Connect**

Contratti API/SDK effettivi, gestione dell'identità, catalogo delle funzioni, autorizzazioni e WhatsApp.

**3. Gap analysis**

Confronto fra stato attuale di ALORA e stato obiettivo.

**4. Roadmap definitiva**

Step ordinati per dipendenze, con indicazione delle priorità e dei rischi.

**5. Piano esecutivo dello Step 1**

Interventi puntuali, file interessati, criteri di accettazione e test.

**6. Problemi bloccanti**

Segnala soltanto le decisioni architetturali o di prodotto che impediscono concretamente di procedere.

Non chiedere conferma per dettagli minori risolvibili analizzando il codice o seguendo le convenzioni esistenti.

## Regola conclusiva

**Un dominio funzionale alla volta. Un flusso completo alla volta. Nessuna implementazione trasversale non controllata.**

L'obiettivo non è scrivere più codice, ma consegnare progressivamente un prodotto coerente, affidabile, semplice e commercializzabile.

Inizia dall'audit tecnico e dalla roadmap, senza avviare implementazioni premature.
