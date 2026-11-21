# Step 12 — Ritiro dei comandi con SDK 0.12.0-rc.2

La consegna Connect del 10 novembre risolve la richiesta di ritiro puntuale: ALORA adotta `automations().withdraw(id, credential, originalInput, originalKey)`, senza token browser. Il candidato rc.1 e le sue evidenze restano conservati. [Checkpoint precedente](connect-automation-consumer-step-12.md) · [Evidenze rc.2](verification/connect-automation-withdrawal-step-12.json).

## Comando originale e recupero

`NotificationAutomationCommand` è il registro consumer del comando originale, non una seconda outbox WhatsApp. Identità di dominio, attività, delega e hash dell’input sono immutabili; il payload originale è cifrato con lo store server esistente. La chiave Connect continua a derivare da attività e ID del comando, senza cambiare quando viene sostituita una delega.

La prima chiamata di invio registra durevolmente l’inizio del tentativo. Un richiamo di quel comando legge la ricevuta Connect, senza un nuovo `send`. Un esito assente/ambiguo non viene interpretato come autorizzazione a reinviare. Modificare contenuto o delega mantenendo l’ID originale produce un conflitto locale.

Il ritiro registra lo stop locale **prima** della chiamata Connect e usa il payload cifrato originale. Se precede l’invio, il provider conserva una ricevuta preventiva `cancelled`. Se la chiamata fallisce o perde la risposta, il flag resta pendente. Un recupero limitato a 20 richieste per ciclo ripete soltanto lo stesso ritiro, con attesa dopo un errore; non invia messaggi e non revoca la delega condivisa. Un processo nuovo recupera direttamente dal database, senza sessione UI o copia in memoria del messaggio.

Il consumer valida l’unione di esiti anche a runtime:

| Esito | Stato ammesso | Interpretazione |
|---|---|---|
| `withdrawn` | `cancelled` | Ritiro riuscito, incluso il comando non ancora accodato |
| `already_terminal` | `cancelled`, `failed` | Tentativo già chiuso; nessuna nuova cancellazione dichiarata |
| `effect_started` | `sending`, `sent`, `uncertain` | Effetto acquisito o da verificare; nessun nuovo invio |

Risposte incoerenti non risolvono la richiesta locale. La ricevuta conserva lo stesso ID e uno stato terminale non viene sostituito da un acknowledgement `queued` tardivo. SQL impedisce sostituzione del payload, riavvio del tentativo, cancellazione isolata dello storico e riapertura del ritiro concluso. La cancellazione dell’intera attività nella copia elimina coerentemente i suoi record.

Ritiro e lettura restano operazioni di proprietà anche con delega revocata/scaduta o autorizzazione corrente negata. Non attribuiscono nuovi diritti di invio. Il controllo installazione/binding rimane obbligatorio e non vengono esposte credenziali al browser. Nessuna nuova route pubblica permette di ritirare o inviare arbitrariamente un comando.

## Migrazione e verifiche

Connect rc.2 non richiede nuove migrazioni del provider. ALORA aggiunge la propria migrazione `20261110160000_notification_automation_commands` per conservare input originale e richiesta di ritiro attraverso un crash; non genera comandi storici e non modifica account. È applicata soltanto alle copie di collaudo.

Otto nuovi gruppi HTTP usano SDK e PostgreSQL reali: ritiro in coda e prima dell’accodamento, tutti gli stati post-acquisizione, conflitti, revoca/scadenza, risposta persa e processo di recupero nuovo, corse con commit/ack tardivi, risposta positiva malformata, cifratura e vincoli SQL. Passano inoltre 9 gruppi delle deleghe, 6 dei webhook e 9 della compatibilità con l’invio manuale sullo SDK rc.2. Le corse del trasporto Connect sono sintetiche: non vengono presentate come verifica del lock del vero runner. I 187 test e 24/24 PostgreSQL del provider sono risultati riferiti dal proprietario Connect, non rieseguiti da ALORA.

Passano 61 suite/381 test, uno snapshot, lint e tre build host. Migrazione, riapplicazione e ripristino conservano 45 tabelle/504 colonne originarie, con sei gruppi SQL e registro comandi vuoto. Il candidato API `alora-step12-withdrawal-candidate-api:20261110` contiene rc.2 e il registro; gli artefatti sono confrontati con la build host. Le immagini statiche amministrazione/pubblico sono riutilizzate soltanto dopo confronto byte per byte con le rispettive build aggiornate. Avvio completo e ripristino sono verificati separatamente nelle evidenze.

## Prosecuzione dello stesso dominio

Il ritiro puntuale non è più una dipendenza contrattuale aperta. Restano lato ALORA la pianificazione durevole collegata ai piani autorevoli, recapiti autorizzati, deleghe dei singoli canali, template WhatsApp, correlazione e comandi cliente e attivazione della policy. Il registro di trasporto non sostituisce queste funzioni e non abilita i dati storici.

Il runtime principale resta Step 10; account, configurazioni reali, invii reali e produzione non sono modificati. Pairing, dispositivo, webhook pubblico e accettazione ALORA restano prove separate. Le automazioni non vengono dichiarate attive da questo checkpoint.
