# Prompt per l’agente Connect — attivazione assistita e migrazione obbligatoria

Lavora nel repository Connect. ALORA è nel repository adiacente `../barber`: consultalo in sola lettura per verificare il contratto consumer. Non modificare ALORA. Non pubblicare, non distribuire e non creare clienti/licenze operative senza istruzioni. Conserva le modifiche già presenti nel checkout.

## Obiettivo approvato

Realizzare un contratto generale riutilizzabile dalle applicazioni per richiedere l’attivazione di un’azienda o la migrazione di account locali. ALORA non consente più accesso operativo tramite credenziali locali. Il form ha un solo pulsante Accedi; la modale obbligatoria ha soltanto «Invia richiesta», senza «Non ora» né accesso alternativo. Un amministratore EULAB trova la pratica nel pannello Connect e preme «Esegui migrazione». I nuovi signup aprono una pratica; non creano una sessione o una licenza automaticamente.

La password verificata dell’utente locale viene trasmessa al backend Connect al momento dell’invio. Connect la conserva **cifrata, con scadenza e uso esclusivo del processo di migrazione**. Non deve essere visibile agli amministratori, esportabile, inserita in log/audit/telemetria/errori o presente nelle normali risposte della pratica. L’utente chiede che una nuova identità possa usare la stessa password dopo l’approvazione, senza doverla reinserire per inizializzarla. Non chiedere ad ALORA di memorizzarla in attesa. Non trasferire hash bcrypt come credenziale SSO.

Un’identità Connect esistente non va resettata, duplicata o unita per email: serve una prova esplicita di collegamento. OIDC non fornisce la password a un’app consumer. Per account solo Connect ALORA crea un profilo locale dopo SSO verificato, conservando l’accesso esclusivamente su Connect. Nessuna copia della password nel profilo locale. Eventuali collisioni con un account locale devono produrre conflitto e collegamento assistito, mai takeover.

## Modello autorevole

- Identità: `issuer + subject`; cliente = azienda, app = prodotto, installazione = cliente/app con ID locale dell’azienda.
- Ruoli Connect riferiti a persona/cliente/app, funzioni entro licenza e delega. ALORA applica ulteriori restrizioni e conserva gli ambiti operativi.
- Il richiedente non sceglie cliente, installazione o privilegi. Un collaboratore non diventa titolare perché apre una pratica.
- Più persone della stessa azienda confluiscono nella stessa pratica aziendale, con richieste personali distinguibili e credenziali separate. Una password ricevuta non può migrare automaticamente le altre persone.
- Nuovo utente in Connect con accesso ALORA: l’admin/invito approvato preassegna `localTenantId`, `localUserId` stabile e ruolo locale iniziale da una mappatura controllata; ALORA non li deduce dall’email. Il nuovo utente deve essere abilitato al prodotto prima di essere restituito come autorizzato.
- Una stessa persona può avere accessi distinti ad altre aziende/app; la revoca ALORA non disabilita globalmente l’identità.

## Bootstrap prima dell’installazione

Serve una credenziale backend di sorgente/deployment autorizzata da EULAB, precedente alla creazione dell’app/cliente/installazione. Non riutilizzare credenziali EULAB Admin né distribuire segreti al browser. La sorgente registra appId, ambiente, origini, catalogo, callback OIDC e identità del deployment. Non fidarsi dell’Host HTTP, dell’URL inviato dall’utente o di una registrazione pubblica arbitraria. Nessuna scansione/fetch di URL arbitrari: proteggere da SSRF e distinguere l’ambiente Docker dai domini pubblici non disponibili.

Il contratto HTTP seguente è **proposto e già predisposto dal consumer ALORA**, non è un’API dichiarata disponibile nell’SDK 0.8.1. Conferma o concorda le variazioni prima di cambiarne forma. Mantieni OIDC Authorization Code + PKCE e i controlli esistenti di `/v1/access`; non introdurre password grant per autenticare utenti SSO.

Ogni richiesta usa TLS (loopback HTTP solo sviluppo), `Authorization: Bearer <bootstrap-secret>`, `X-Connect-Source: <sourceId>` e body comune `{schemaVersion:1, appId, sourceId}`. La sorgente autenticata deve corrispondere ai dati del body. Risposte no-store, segreti sempre redatti; disabilitare body logging dei percorsi sensibili. Limitazione delle richieste e audit senza password obbligatori. Le risposte sensibili di risoluzione sono disponibili soltanto al backend della sorgente autorizzata.

### POST /v1/app-onboarding/login-context

Body aggiuntivo: `{email}` normalizzata. La lookup è una ricerca di instradamento backend, **non autentica l’utente**. Risposta possibile:

```json
{
  "status": "connect",
  "context": {
    "tenant": {"id":"local-tenant-id", "name":"Azienda", "slug":"azienda"},
    "binding": {"customerId":"connect-customer-id", "installationId":"connect-installation-id", "secret":"installation-server-secret"},
    "user": {"id":"local-user-id", "subject":"provider-subject", "email":"persona@example.test", "firstName":"Nome", "lastName":"Cognome", "role":"reception", "permissions":["appointments.read.all"]}
  }
}
```

Il contesto è fornito solo per associazioni esplicite autorizzate alla sorgente. Il segreto d’installazione deve essere recuperabile tramite cifratura protetta o credenziale server equivalente da concordare; non si può ricostruire dal solo hash attuale. L’SDK installazione esistente deve poter verificare quel bearer tramite `/v1/access`, che deve restituire lo stesso appId/installationId/localUserId/subject. La licenza, l’appartenenza e le revoche restano autorevoli a ogni verifica. Mai concedere un ruolo per rendere artificialmente positivo l’accesso.

Se non esiste un collegamento utilizzabile: `{status:"not_found", request?:{requestId,state}}`. Non significa «nessuna identità globale»: significa nessun accesso instradabile a questa app/deployment. Un timeout, un contratto assente o un errore di servizio **non** devono diventare `not_found`. Ambiguità/conflitti di collegamento: 409; account sospesi/revocati: risposta negata esplicita (403), senza aprire un percorso alternativo di migrazione che aggiri la revoca. Un account appartenente a più aziende richiede un contesto preventivamente assegnato o un flusso di scelta tra soli accessi autorizzati: niente selezione di clienti arbitrari.

ALORA rivalida il contesto dopo il callback OIDC, prima di creare il profilo locale. La risposta non deve essere condizionata all’esistenza fisica del record locale, altrimenti il provisioning dei nuovi utenti entrerebbe in un circolo.

### POST /v1/app-onboarding/requests

Header `Idempotency-Key` stabile per sorgente/azienda/utente, oppure per sorgente/email nel signup. Deve restituire la pratica esistente su ritentativo dopo timeout, senza reinizializzare una password o ripetere azioni esterne incerte. Non sostituire una credenziale già acquisita per una pratica solo perché arriva lo stesso identificativo con un body diverso.

Migrazione, con prova locale eseguita da ALORA:

```json
{
  "kind":"migration",
  "consentVersion":"2026-10-21-mandatory-v1",
  "localTenant":{"id":"local-tenant-id","name":"Azienda","slug":"azienda"},
  "localUser":{"id":"local-user-id","email":"persona@example.test","firstName":"Nome","lastName":"Cognome","role":"owner","permissions":[]},
  "initialPassword":"valore-transitorio-dal-form"
}
```

Attivazione/signup:

```json
{
  "kind":"activation",
  "companyName":"Azienda",
  "applicant":{"email":"persona@example.test","firstName":"Nome","lastName":"Cognome"},
  "initialPassword":"valore-transitorio-dal-form"
}
```

Risposta in entrambi i casi: `{requestId,state}`; stati `pending|approved|migrating|completed|rejected|expired|failed`. La pratica viene esposta all’utente locale solo dopo prova della password, oppure al richiedente tramite una ricevuta protetta; niente elenco pubblico di richiedenti. Il body non può ampliare la sorgente autenticata. Il ruolo locale è evidenza per il revisore e una mappatura controllata, non una concessione automatica.

## Pannello admin e processo di migrazione

Mostrare applicazione/deployment/origine verificata, azienda locale, richiedente, ruolo locale, richieste personali, date, prerequisiti, stato ed errori sicuri. Pulsante «Esegui migrazione» dopo che piano/licenza e corrispondenza dei ruoli sono stati determinati. Se mancano, indicare cosa completare; non concedere funzioni per default.

L’azione deve registrare o riutilizzare l’applicazione globale, creare/collegare cliente e installazione, sincronizzare il catalogo, applicare licenza e ruoli approvati, inizializzare solo le nuove identità con le password ricevute, registrare i collegamenti locali e rendere disponibile il contesto al backend ALORA. Conservare checkpoint e audit per ogni passo. Un fallimento non marca la pratica completata; il retry riprende senza duplicare app/clienti/utenti, senza assegnazioni e reset credenziali aggiuntivi. Concorrenza e timeout provider devono avere riconciliazione, non ripetizione cieca.

Le password hanno TTL esplicito e cancellazione effettiva alla riuscita, rifiuto, annullamento o scadenza, incluse code e copie tecniche. La chiave di decifratura è accessibile solo al servizio di migrazione, non al pannello admin. Definire policy password del provider e gestione di password scadute/non conformi: la pratica deve mostrare «azione richiesta», senza reset silenzioso. MFA, verifica email e azioni obbligatorie restano presso il provider.

## SDK e verifiche

Aggiungere client tipizzati backend per i due endpoint e documentare compatibilità/versione; non cambiare comportamento dei metodi esistenti senza migrazione. Collaudare: sorgenti/tenant estranei, spoofing URL, SSRF, assegnazione arbitraria di owner, conflitti email/subject, multi-app e revoche, richieste duplicate/concorrenza, ripresa dopo crash, cifratura/TTL/cancellazione e assenza password nelle risposte/log/audit, provider password policy/MFA, lookup Connect-only e provisioning locale, nessuna autenticazione basata sulla sola lookup.

Separare test simulati da Keycloak/PostgreSQL/browser reali. Il dominio pubblico Connect non è disponibile; usare il Docker locale per il collaudo. Nessuna pubblicazione automatica. Consegnare elenco preciso dei contratti disponibili, migrazioni e configurazioni necessarie al consumer ALORA, limiti e test eseguiti.
