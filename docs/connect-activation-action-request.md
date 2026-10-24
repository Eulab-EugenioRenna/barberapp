# Connect — azione dopo rifiuto password di una nuova attivazione

Richiesta successiva all’adozione ALORA di SDK 0.10.0. Non pubblicare una nuova versione a ogni correzione: consolidare la candidata locale e ripetere il collaudo prima della pubblicazione finale. ALORA non ha modificato il repository Connect.

## Stato: risolto e ricollaudato dal consumer

Il 22 ottobre 2026 ALORA ha installato il tarball aggiornato 0.10.0, SHA-256 `752575ccb8970e380fe9767ecf201e26cab083b4e6de6a9282be0f5e0acb63db`. La regressione ora passa: `contact_admin`, esito SDK `pending` con e senza password, zero verifiche legacy, scritture store o provisioning; nessun challenge o sessione. Il report collegato sotto contiene il risultato corrente. Le sezioni seguenti conservano il problema e la richiesta originari.

## Problema riprodotto (storico)

Una pratica `kind: activation` fallisce con `password_change_required`. `requestStatus` espone `nextAction: choose_connect_password` anche per questo tipo di richiesta. La facciata cerca allora una prova legacy, ma il nuovo iscritto non ha un account locale: `auth.signIn` termina con `invalid_credentials`. Inoltre `recoverPassword` rifiuta ogni richiesta diversa da `migration` con 409. Il blocco di accesso è sicuro, ma l’azione proposta non è eseguibile.

Evidenza: `apps/api/src/onboarding.service.ts` nel checkout Connect, metodi `requestStatus` e `recoverPassword`; [report ALORA](verification/connect-activation-action.json).

## Intervento richiesto

1. Rendere `nextAction` coerente con tipo e recuperabilità della richiesta. Nel contratto attuale una nuova attivazione senza prova legacy deve restituire **contact_admin**, non choose_connect_password. Non inventare identità locali o associare account per email per superare il blocco.
2. Conservare il recupero `choose_connect_password` delle migrazioni legacy già verificato, con nuova prova, consenso, chiave idempotente nuova e password distinta.
3. Verificare anche che pratiche terminali, in esecuzione o con collegamento amministrativo esplicito non pubblicizzino azioni di recupero vietate dal server. Lo stato personale non basta a determinare l’azione.
4. Aggiungere regressioni server e facciata. Con `contact_admin`, signIn deve restituire pending/assistenza senza invocare verifyLegacy, creare challenge o rilasciare sessioni.

Non è richiesto un nuovo recupero pubblico per le attivazioni: la pratica resta a gestione amministrativa nel contratto attuale. Se si vuole un recupero dedicato, va progettata una prova appropriata per un nuovo iscritto, distinta dall’autenticazione legacy; non è autorizzata un’eccezione alla verifica locale esistente.

## Riproduzione senza modificare Connect

Dal repository ALORA con SDK 0.10.0 installato e API Connect compilata:

```sh
node scripts/check-connect-activation-action.mjs
```

Usa il vero harness/API Connect con PGlite temporaneo. Crea una richiesta di attivazione, inietta soltanto lo stato del rifiuto provider e interroga gli handler effettivi di discovery/recupero. Verifica anche il comportamento della facciata quando manca l’account legacy. Non usa il database operativo, non crea identità provider e non simula un collaudo Keycloak. Prima della correzione terminava con exit 1: choose_connect_password invece di contact_admin; recupero 409. Ora termina con exit 0 e verifica anche che la facciata non richieda prove legacy.

Consegnare correzione e risultati e confermare il server di sviluppo aggiornato. Nel Docker Connect locale sono ora verificati la tabella schema 012 e la route di recupero (400 su richiesta incompleta); non è richiesta una seconda applicazione della migrazione già presente. Rimane da collaudare il percorso autorizzato sull’installazione effettiva. Il tarball finale può restare 0.10.0 finché non pubblicato; se il contenuto cambia, fornire checksum aggiornato. Nessuna pubblicazione o distribuzione automatica.
