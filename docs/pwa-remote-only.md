# PWA: installazione e rete ordinaria

Il comportamento richiesto è quello di una scheda normale: login, callback SSO,
pagine e API passano dalla rete del browser. Il worker non ha un handler `fetch`,
non salva risposte e non offre contenuti offline. Manifest, icone e installazione
sono conservati. Il worker resta registrato per push e clic sulle notifiche.

Prima del bootstrap Angular, `prepareRemoteOnly` elimina le Cache Storage storiche,
aggiorna il worker usando `updateViaCache: none` e attende l'attivazione della
versione nuova. L'attivazione elimina nuovamente le cache e prende il controllo
delle finestre aperte. Non vengono cancellati cookie, localStorage o sottoscrizioni
push. Il ripristino di una pagina dalla back/forward cache provoca un caricamento
nuovo. La verifica periodica degli aggiornamenti conserva il reload differito
finché sono aperte modali.

Nginx invia `Cache-Control: no-store` anche per risorse e API; gli ingressi HTML
inviano inoltre `Clear-Site-Data: "cache"` per eliminare la cache HTTP precedente.
La direttiva non include cookie o storage. Il nuovo worker può essere acquisito
solo quando il dispositivo è online: un'installazione rimasta aperta sulla vecchia
versione deve essere chiusa e riaperta con rete disponibile.

## Verifica locale del 26 ottobre 2026

Su Chromium isolato collegato al Compose ALORA effettivo:

- Riprodotto un worker precedente che restituisce una risposta dalla cache.
- Aperto ALORA: worker sostituito, una registrazione conservata, zero cache;
  marcatore localStorage conservato e API anonima raggiunta (401 dal server).
- Disattivata la rete: richiesta API e nuova navigazione falliscono senza fallback.
- Iniettato un evento push via CDP: notifica visualizzata, destinazione esterna
  rifiutata e cache ancora vuote. Non è una prova di consegna Web Push remota.
- Login reale del titolare tramite Connect riuscito; `/auth/me` e dashboard personale
  restituiscono 200. Il 403 di `/team` per delega mancante non invalida la sessione.
- Proxy WebSocket Vite verificato; lint, build API/admin e 183 test passati.

Prova ripetibile, senza login e in un contesto browser nuovo:

```sh
PLAYWRIGHT_PACKAGE_JSON=/percorso/consumer-con-playwright/package.json \
BROWSER_CDP_ENDPOINT=http://127.0.0.1:porta-cdp \
ALORA_ORIGIN=http://127.0.0.1:53020 \
node scripts/check-pwa-remote.cjs
```

Il consumer deve avere `@playwright/test`; il browser CDP deve essere temporaneo e
poter raggiungere ALORA allo stesso indirizzo. Lo script non modifica account,
ruoli o sessioni esistenti.

Non sono certificati installazione su dispositivo reale, browser iOS o consegna
Web Push end-to-end. Nel repository non è presente una pipeline server completa
di sottoscrizione/VAPID/invio Web Push: il worker ne gestisce gli eventi, ma questo
non dimostra che il server li invii. Inbox e aggiornamenti SSE restano distinti.
