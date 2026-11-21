# ALORA — Chiusura tecnica degli step 5 e 6

Data: 6 novembre 2026. Richiesta corrente dell’utente: «procedi con la chiusura degli step lascia perdere gli account».

Gli step 5 e 6 sono **chiusi tecnicamente per l’implementazione ALORA consegnata e verificata**. Le verifiche sugli account sono rinviate per indicazione dell’utente e non bloccano questa consegna. Non sono registrate come superate. Questa chiusura non costituisce accettazione di produzione o attestazione del funzionamento corrente degli account Connect.

## Risultati consegnati

| Step | Funzionalità | Stato di chiusura |
| --- | --- | --- |
| 5 — Ruoli e squadra | Squadra unificata; preset e ruoli personalizzati; delega Connect; creazione/ripresa per ID; collegamento facoltativo al professionista; restrizioni locali; agenda personale, orari e valori autorizzati | Chiusura tecnica. Creazione collaboratori e apertura agenda confermate dall’utente. Collaudi account non confermati rinviati. |
| 6 — Profilo e sicurezza personale | Pagina Il mio account; collegamento alla console SSO per profilo/password/TOTP; sicurezza, sessioni, dispositivi e notifiche personali; disconnessioni con conferma e gestione degli esiti incerti | Chiusura tecnica del consumer ALORA. Collegate le capacità esistenti del provider; funzionalità Connect estese non attivate dichiarate separatamente. |

Il catalogo corrente è schema 1, versione 4, con 25 funzioni. Le operazioni personali dipendono dalla sessione autenticata e non concedono permessi aziendali. Le nuove capacità commerciali continuano a richiedere concessioni esplicite.

## Moduli e file principali

- Step 5: moduli `team`, `dashboard` personale e relative pagine Squadra/agenda; contratti, migrazioni additive e prove precedenti sono descritti in [team-step-5.md](team-step-5.md) e [team-step-5-acceptance.md](team-step-5-acceptance.md).
- Step 6: `apps/api/src/modules/auth/personal-account.controller.ts`, `personal-account.service.ts` e test; contratto pubblico `apps/api/src/common/personal-account.ts`.
- Autorizzazione e sessione: registro delle operazioni, `connect-runtime.ts`, `connect-http.ts` e relative regressioni. Sessione revocata 401, permesso negato 403 e indisponibilità temporanea 503 rimangono distinti.
- Frontend: `personal-account.component.ts`, route e guard, client auth e collegamenti da shell, agenda e pagina di accesso da configurare.
- Packaging: alias del contratto condiviso e Dockerfile aggiornati; la build API controlla l’esistenza dell’entrypoint `dist/apps/api/main.js`.

I dettagli di progetto e gli esiti precedenti rimangono in [personal-account-step-6.md](personal-account-step-6.md). Le modifiche preesistenti nei checkout sono conservate. Nessun commit, push o rilascio di produzione è implicito in questo verbale.

## Verifica finale eseguita

| Controllo | Esito corrente |
| --- | --- |
| `npm test -- --runInBand` | 44 suite, 275 test e uno snapshot passati |
| `npm run lint` | Passato sull’intero perimetro apps/libs |
| `npm run build` | API, admin e prenotazione pubblica compilati |
| Entrypoint API | `dist/apps/api/main.js` presente |
| Runtime Docker | API, admin e prenotazione pubblica running/healthy |
| Frontend admin e pubblico | HTTP 200 |
| Catalogo tramite Nginx | HTTP 200; versione 4, 25 funzioni |
| `git diff --check` | Passato |

In questa chiusura non sono stati eseguiti login reali, invii email, ripristini di credenziali o cambi di ruoli/associazioni. I test usano i rispettivi mock e fixture isolati. Le prove provider e browser reali già eseguite sono conservate con le loro date e non vengono presentate come nuove verifiche degli account attuali.

Il [riepilogo verificabile della chiusura](verification/chiusura-step-5-6.json) registra comandi, risultati, perimetro escluso e revisione di base; le modifiche correnti rimangono nel worktree.

Le verifiche precedenti distinguono: provider reale per profilo/password/TOTP e sessioni; quattro viewport Chromium per la pagina; HTTP simulato per i casi di revoca dispositivo. Quest’ultima simulazione non dimostra la revoca di un dispositivo reale.

## Migrazioni e conservazione dati

Lo Step 6 non introduce migrazioni database. Le migrazioni dello Step 5 restano quelle additive già documentate; nessuna nuova migrazione, reset o seed è stato applicato per questa chiusura. I confronti storici con backup ripristinati rimangono nelle evidenze, con le esclusioni e le modifiche autorizzate dichiarate.

## Esclusioni e attività rinviate

- Verifica corrente degli account, del ruolo amministrativo e del login successivo al recupero: rinviata su richiesta dell’utente. Le osservazioni dell’incidente rimangono storiche; non si attestano come risolte o accettate.
- Collaudo fisico della nuova pagina personale e accettazione di produzione: non eseguiti in questa chiusura.
- Flusso MFA esteso Connect, OTP email, dispositivi attendibili estesi e generazione delle notifiche di sicurezza: predisposti nel producer ma non attivati/collaudati nel runtime osservato. Nessuna modifica globale della politica SSO viene effettuata.
- Pubblicazione SDK, configurazioni pubbliche e distribuzione di produzione: fuori da questa consegna locale.

## Dipendenza successiva

Il prossimo dominio è lo **Step 7 — Sedi e settori**. Il [piano esecutivo](locations-sectors-step-7-plan.md) è pronto; modello dati, migrazione iniziale, query per ambito, appartenenze operative e interfacce sono ancora da implementare. Gli step 7–14 non vengono dichiarati completati da questa chiusura degli step 5 e 6.

## Aggiornamento successivo

Su autorizzazione «procedi», lo Step 7 è stato implementato e collaudato separatamente: [sedi e settori](locations-sectors-step-7.md). I risultati di questo verbale restano quelli della chiusura degli step 5 e 6; lo stato corrente complessivo è nella [roadmap](evolution-roadmap.md).
