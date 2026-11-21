# Step 13 — Dashboard, quadrature e responsive

Avviato il 9 novembre 2026 nell'autorizzazione «procedi con il resto». Gli account Connect restano esclusi. Lo Step 12 resta aperto; i report possono avanzare indipendentemente dal contratto Connect per le automazioni, la cui estensione è assegnata al lato Connect dal piano.

## Diagnosi prima dell’intervento

`DashboardController.revenue` somma `Sale.total` dei conti con stato pagamento `paid` o `partial`, poi aggiunge appuntamenti completati senza una vendita non provvisoria. Un acconto è quindi mostrato come l'intero conto incassato; un conto confermato non pagato scompare dal venduto. `PaymentEntry.receivedAt`, incassi, rimborsi e saldo iniziale non sono la fonte del riepilogo. I riepiloghi professionisti/servizi/prodotti e `LocationsController.totals` ripetono calcoli simili. Il fallback al professionista primario può attribuire attività non dichiarata come eseguita.

Le dashboard leggono in più query non coordinate e conservano report in cache. Il filtro professionista usa le opzioni caricate dal contesto amministrativo: va verificata la completezza del caricamento e la stabilità durante cambi rapidi di filtro. L'attività unisce conti e appuntamenti sul vecchio `appointmentId`, invece di rappresentare le righe correlate del conto unico. Il calendario tablet e i flussi di cassa richiedono una verifica sui quattro formati previsti.

Lo stato implementato e i limiti di accettazione sono nel [resoconto corrente](dashboard-responsive-step-13.md).

## Contratto dei valori

- **Venduto:** totale dei conti confermati, nella data registrata `Sale.soldAt`, indipendente dallo stato del pagamento. Nessun appuntamento aggiunto come seconda vendita. Le date registrate non vengono riscritte dal report.
- **Movimenti del periodo:** solo `PaymentEntry.receipt/refund` per `receivedAt`, anche per conti venduti fuori periodo o annullati. Il saldo iniziale dichiarato non è un nuovo incasso.
- **Situazione conti del periodo:** sui conti aperti/confermati con `soldAt` nel periodo, totale, saldo iniziale, incassi meno rimborsi e residuo correnti. Sono valori correnti della coorte, distinti dai flussi di cassa del periodo. Gli storici `legacy_unknown` restano ignoti e contati separatamente.
- **Ambiti:** l'intero conto deve essere accessibile con tutte le sue righe. Il venduto filtrato per settore/professionista usa soltanto le righe pertinenti. Il registro non attribuisce i pagamenti a righe, settori o esecutori: i valori di cassa e residuo sono disponibili solo nella vista per conti completi; nessuna ripartizione proporzionale inventata. Una vista settoriale parziale o personale espone chiaramente l'assenza dell'attribuzione.
- **Quadratura:** tutte le somme sono decimali; differenze fra totale conto storico e somma righe restano visibili come non attribuite. Nessun fallback da stato pagamento, prezzo appuntamento o professionista pianificato.

## Sequenza e verifica

1. Servizio di lettura finanziaria con aggregazioni SQL in un'unica snapshot, DTO stretti e contratto di risposta esplicito; adattamento dell'endpoint esistente. Prove su conti non pagati, acconti, rimborsi, annullamenti, storico ignoto, saldi iniziali, IVA/sconti, date e ambiti.
2. Allineare riepiloghi per sede/settore/professionista e dashboard personale, attività del conto unico, opzioni complete e protezione dalle risposte frontend superate.
3. Completare imponibile e IVA registrata di acquisti/vendite, costi e margini tramite i movimenti di magazzino autorevoli, con importi ignoti distinti da zero e riconciliazione dei riepiloghi richiesta da `evolve.md` §7.4. Sono report gestionali, separati dagli adempimenti fiscali.
4. UI coerente con i valori: etichette, limiti dei pagamenti non attribuiti, filtri e sezioni accessibili; conservare il design ALORA esistente.
5. Browser desktop, tablet orizzontale/verticale e smartphone, verificando uso di select, calendario, prenotazioni, check-in e cassa. Correggere i breakpoint in base allo spazio utile.
6. Regressioni e artefatti candidati; aggiornamento locale soltanto dopo i gate pertinenti. Produzione e accettazione commerciale restano Step 14.

Questo è il piano; nessuno degli esiti ancora da eseguire è dichiarato superato.

## Aggiornamento del collaudo

I cinque percorsi operativi sono ora verificati in entrambe le viewport tablet, con 24 gruppi per formato e artefatti distinti. Corretti il selettore incompleto della cassa aperta direttamente dalle vendite e il collasso delle righe quando gli incassi erano espansi. Le immagini candidate e l'avvio isolato sono verificati; il rilascio sul runtime principale e l'accettazione fisica/provider rimangono separati. Il [resoconto](dashboard-responsive-step-13.md) e il relativo JSON sono la fonte dello stato corrente.
