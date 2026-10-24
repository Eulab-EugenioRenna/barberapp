# Contratto storico — onboarding e delega della squadra

**Superato per il percorso di migrazione:** la decisione successiva richiede accesso Connect obbligatorio e pratica approvata da EULAB. Usare il [prompt aggiornato per Connect](connect-migration-agent-prompt.md) e lo [stato ALORA](sso-step-4.md). Le note seguenti conservano il contesto della verifica SDK precedente; non descrivono il percorso attuale.

Decisioni aggiornate nella conversazione: un solo form ALORA e un solo pulsante «Accedi». Primo accesso con verifica locale; il backend passa la password appena verificata al mirror per inizializzare una nuova identità Connect. Dopo il primo accesso Connect riuscito, gli accessi successivi usano Connect. Identità e profilo locale restano collegati esplicitamente tramite installazione e ID locale; nessuna unione automatica per email.

Le modifiche al repository Connect sono in carico all’utente. Questo documento non certifica che il contratto sia già distribuito o collaudato.

## Mirror e SDK

Estendere `POST /v1/users/mirror` e `ConnectServer.mirrorUser()` con `initialPassword?: string`, esclusivamente per richieste backend autenticate dell’installazione. Preservare chiamate senza password e il relativo percorso di attivazione.

Su una nuova identità, impostare la password durante la creazione nel provider identità, rispettando la policy del provider. Non copiare hash ALORA e non introdurre una seconda persistenza della password: nessun log, audit del contenuto, risposta, tabella applicativa, coda o retry durevole deve contenere il valore. Il browser non deve ricevere segreti di installazione.

Su un collegamento già esistente, non modificare credenziali, profilo, permessi o revoche. Su identità esistente non collegata, richiedere collegamento esplicito senza reset della password. Su timeout dopo la creazione, recuperare tramite la prova del mirror senza reimpostare credenziali. Distinguere la creazione/associazione riuscita dall’accesso SSO completato e da eventuali azioni obbligatorie del provider.

L’app conserva lo stato per utente `locale → attivazione in corso → Connect attivo`. Il solo mirror non deve disabilitare il percorso locale. Dopo il primo login Connect validato la password locale non deve più permettere l’accesso; un errore Connect non riattiva il login locale. MFA e altre azioni obbligatorie rimangono presso il provider tramite il percorso OIDC, senza aggirarle usando il form ALORA.

## Ruoli e collaboratori

Il mirror non copia o concede automaticamente permessi. Occorre un contratto delegato comune alle app che permetta al titolare di consultare le utenze della propria installazione, gestire ruoli applicativi e assegnare funzioni entro cliente/app/licenza/delega. Funzioni esistenti e successive provengono dal catalogo versionato esposto dall’app.

Cliente/app devono derivare dal contesto autenticato; assegnazioni fuori ambito, ampliamento della propria delega e privilegi EULab Admin sono negati. Revocare un collaboratore dall’app non deve disabilitarne l’identità globale o rimuovere accessi ad altre app. Le nuove funzioni importate rimangono negate finché esplicitamente abilitate.

ALORA governa la relazione utente-professionista e i limiti operativi: per esempio appuntamenti assegnati e dati della propria azienda. La decisione effettiva è l’intersezione tra autorizzazione Connect, appartenenza aziendale e restrizioni ALORA. ALORA non amplia una concessione Connect negata.

## Accettazione

Test negativi per identità occupate, appartenenze estranee, escalation, licenze insufficienti e revoche. Testare idempotenza, concorrenza, timeout, policy password e assenza di segreti nelle risposte/audit. Confermare SDK e versione API distribuita prima del collegamento ALORA. Separare simulazioni del provider dal login reale con la password inizializzata, MFA, rinnovo e revoca.

## Verifica del contratto locale — 21 ottobre 2026

Il checkout Connect aggiornato espone `initialPassword`, i metodi SDK della squadra e i guard di scrittura obbligatori su `team.manage`. Verificati 10 test mirati del checkout e ripetuti i due casi negativi originali in database in memoria: creazione di ruoli senza `team.manage` e sostituzione dei ruoli di un utente superiore restituiscono ora 403, preservando le assegnazioni. L’API usata dal test è quella compilata presente nel checkout; nessuna verifica su un’installazione operativa.

SDK locale `@eulab/connect` 0.8.1 compilato e impacchettato; import ESM browser/server e metodi della squadra verificati sul tarball. Artefatto: `../eulab connect/dist/releases/sdk/eulab-connect-0.8.1.tgz`, con checksum SHA256 affiancato. La pubblicazione npm richiesta è stata tentata ma è fallita per `ENOTFOUND registry.npmjs.org`: non dichiarare il pacchetto pubblicato. L’artefatto locale può essere usato per lo sviluppo ALORA senza dipendere dal registry.

Restano il collaudo Keycloak reale (policy password, MFA e azioni obbligatorie), il rilascio server con migrazione 010 nell’ambiente scelto e l’integrazione del percorso ALORA. La sola pubblicazione SDK non distribuisce le modifiche API o la migrazione. Il catalogo ALORA dovrà dichiarare `team.manage` nella milestone che implementa la gestione della squadra, incrementando la versione della matrice; nessun permesso amministrativo viene dedotto dal CRUD dei professionisti.
