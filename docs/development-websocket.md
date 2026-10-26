# WebSocket Vite dietro Nginx

26 ottobre 2026. La console segnalava mancata connessione a ws://127.0.0.1:53020/ e al fallback interno localhost:4200. Il client Angular/Vite usa il percorso root per il socket anche con base href /admin/. La location esatta / di Nginx rispondeva con un redirect 302 anche alla richiesta Upgrade, impedendo il passaggio a WebSocket.

Riproduzione senza login: `node scripts/check-dev-websocket.cjs`. Prima della correzione: `Development socket HTTP 302 instead of 101`. Lo script acquisisce il token dal client di sviluppo corrente, usa il subprotocollo vite-hmr e l’Origin pubblico, attende il messaggio connected e verifica anche il normale redirect HTTP. Non stampa il token, non accede a un utente e non modifica dati.

La location root ora inoltra soltanto gli Upgrade WebSocket con subprotocollo vite-hmr all’admin sulla rete Docker, con HTTP/1.1 e header Upgrade/Connection. Le normali richieste root continuano a redirigere ad /admin/. Nessuna porta interna 4200 viene pubblicata; la connessione passa dalla 53020. Il log della location root è disattivato per non registrare il token di sviluppo nella query string. Restano invariati il network-only del service worker e Cache-Control no-store.

Verificati nginx -t, reload e handshake reale tramite il proxy: PASS, root 302 conservato e API 200. Non è un collaudo grafico, SSO o di produzione. Dopo il reload di Nginx può occorrere ricaricare una volta la pagina già aperta perché il client Vite ricrei la connessione.
