# ALORA EUL-53 — Audit UI/UX e inserimento rapido prodotti con barcode

**Issue:** EUL-53
**Repo:** `/Users/eugeniorenna/barber` (branch `alora`, ~340 file modificati non committati — non toccati da questo documento)
**Autore:** CTO / Tech Lead EULAB
**Stato:** primo rilascio (fase 1 dello issue)

---

## 1. Contexto e metodo

L’issue chiede di portare ALORA a livello production con una revisione UI/UX **evolutiva** (non un redesign) e l’inserimento rapido prodotti con lettore barcode.

Il metodo seguito per l’audit (fase 1, **prima di toccare codice**) è:

1. Mappatura delle pagine di `apps/web-admin/src/app` e dei flussi già stabiliti.
2. Lettura del modulo `products` API (`apps/api/src/modules/products`) e schema Prisma (`prisma/schema.prisma`).
3. Lettura di `quick-order` e `inventory` (pagine chiave per l’inserimento rapido prodotti).
4. Verifica con `grep` di assenza di supporto barcode/EAN nel repo (nessun campo `barcode`, `ean`, `gtin`, `BarcodeDetector`, `keyboard.wedge`).
5. Lettura `PRD.md`, `IMPLEMENTATION_PLAN.md`, `docs/evolution-roadmap.md`, `README.md`, `evolve.md`.

Il documento non modifica codice, DB o file altrui. Consegna solo evidenze e backlog prioritario.

---

## 2. Flussi già stabiliti (da preservare)

I flussi seguenti sono già attivi e devono restare invariati dall’UI/UX polish e dall’aggiunta barcode:

| Flusso | Pagina / componente | Note di preservazione |
|--------|---------------------|-----------------------|
| Vendita veloce / quick-order | `apps/web-admin/src/app/quick-order/quick-order-modal.component.*` | Modal overlay, ricerca cliente, catalogo servizi/prodotti touch, riepilogo riga, prezzo pad, checkout (contanti/carta/bonifico/altro), stato aperto/confirmed, recupero invio precedente, storico prezzi. |
| Magazzino / inventory | `apps/web-admin/src/app/pages/inventory.component.ts` | Scelta sede, lista bilanci prodotto cercabile per nome/SKU, selezione prodotto, form movimento (apertura, carico, scarico, rettifica, trasferimento, reso), registro movimenti paginato, idempotency key. |
| Gestione prodotti (listino) | `apps/web-admin/src/app/pages/admin-services-page.component.ts` (servizi) + API `/products` | CRUD prodotto tramite `apps/api/src/modules/products/products.controller.ts` (findAll, priceHistory, create, update, soft-delete isActive=false). |
| Agenda / appuntamenti | `shellRoute("appointments")` + `PersonalAgendaComponent` | Non toccati da EUL-53. |
| Clienti | `shellRoute("customers")` | Non toccati. |
| Collaboratori / team | `shellRoute("collaborators")` + `admin-team-page.component.*` | Non toccati. |
| Impostazioni | `shellRoute("settings")` | Non toccati. |
| Dashboard | `shellRoute("dashboard")` | Non toccati. |
| Auth / login | `AdminAuthPageComponent` | Non toccati. |

Contratti API da non rompere:
- `GET /products` (paginato, tenant-scoped, cached)
- `GET /products/:id/prices`
- `POST /products` (LegacyWriteDto, `canUseLocalFunction` per stockTracked)
- `PATCH /products/:id`
- `DELETE /products/:id` (soft delete)
- `GET /inventory/balances?locationId=`
- `GET /inventory/movements?locationId=&productId=&page=`
- `POST /inventory/operations` (idempotent snapshot)
- `POST /sales/quote` (consumato da quick-order)
- `POST /sales` (submitOrder da quick-order)

---

## 3. Attriti UX trovati (fase 1)

### 3.1 Scrolling / contenitori
- `inventory.component.ts`: `.stock-list` ha `max-height: 40rem; overflow: auto;` (ok), ma `.table-scroll` su `.movements` ha solo `overflow: auto` senza limite max-height — su schermi piccoli può spingere il footer fuori vista (rischio doppio scroll tra shell e tabella).
- `quick-order-modal.component.html`: `.quick-order-cart-scroll` non ha dimensione vincolata né `overscroll-behavior`; su mobile il cart interno può rubare scroll al body (rischio doppio scroll / scroll bloccato).
- Nessun meccanismo di scroll-restore visibile alla riapertura della modal quick-order o cambio sede inventory.

### 3.2 Spazio e ritmo verticale
- Non c’è un sistema token di spacing unico esposto; i componenti usano valori hard-coded (`clamp(1rem, 3vw, 3rem)`, `gap: 1rem`, `padding: 1.25rem`, `margin: 0.3rem 0 0.5rem`, ecc.) — ritmo verticale non coerente tra pagine.
- `inventory.component.ts`: intestazioni `.page-heading` e `.section-heading` usano `display: flex; justify-content: space-between` con `gap: 1rem`; sui piccoli schermo i due lati si sovrappongono (rischio layout rotto < 600px).
- `quick-order-modal.component.html`: header titolo `text-4xl` + eyebrow; cart con molti campi per riga (quantità, prezzo, IVA, sconto, motivo, settore, collaboratore) — troppo denso su mobile/tablet.

### 3.3 Animazioni e feedback
- Nessuna transizione di entrata/uscita della modal quick-order (appare istantanea).
- Nessuno skeleton nei caricamenti (`loading` mostra solo testo "Caricamento magazzino…" / "Calcolo del conto…").
- Nessun feedback tattile/sonoro/flash sulle scansioni barcode (non ancora implementato).
- Nessun rispetto esplicito di `prefers-reduced-motion`.

### 3.4 Stati vuoti / errore / loading / conferme
- `inventory.component.ts`: `feedback` mostra errori in un notice `#fff8e7` (stile warning usato anche per errori) — non distingue errore da informazione.
- `quick-order-modal.component.ts`: `quoteError` mostrato come testo semplice `role="status"` — non annunciato bene da screen reader.
- Nessuna conferma su azioni distruttive (rimuovi riga, delete prodotto) se non il tasto "Rimuovi" senza dialog.
- Focus/tastiera: `barberAutofocusFirst` presente sulla modal, ma nessun trap focus esplicito; `Escape` chiude solo se `!loading` (ok).

### 3.5 Gerarchia / label / a11y
- `inventory.component.ts`: label usano `<label>` con `<select>`/`<input>` annidati (ok), ma alcuni `span` usati come label senza `for`/`aria-labelledby`.
- `quick-order-modal.component.html`: alcuni `<label class="field"><span>...</span><input .../></label>` ok; il select "Sede del conto" ha `aria-label` ma il label visibile è fuori (ridondanza).
- Colori: `var(--ink)`, `var(--muted)`, `var(--line)`, `var(--surface)`, `var(--page)`, `var(--accent)` — usati, ma il contrasto su `.notice` (#fff8e7) va verificato.
- Nessuna indicazione di "campo obbligatorio" visiva oltre a `required` nativo.

### 3.6 Permessi / tenant isolation
- `session.can(...)` usato ovunque (ok).
- `products.controller.ts`: tutte le query filtrano per `tenantId` (ok). `create`/`update` usano `pricing.write(tenantId, userId, ...)` (ok).
- `inventory.component.ts`: chiama `/inventory/balances?locationId=` senza validazione che la location appartenga al tenant (delega al backend — da verificare).
- Nessun `local-policy.guard` visibile sulle rotte products (da verificare se applicato a livello module).

### 3.7 Offline / PWA
- `pwa-remote-only.md` indica PWA gestita da remoto; nessun service worker locale per quick-order offline.
- Nessun handling di rete assente in quick-order (se cade la rete durante submit, l’utente non riceve fallback).

### 3.8 Performance
- `findAll` products cacheato con `cacheKeys.productsList(tenantId)` (ok).
- `inventory.component.ts` ricarica tutto al cambio sede (ok per volumi piccoli, ma nessun virtual scroll per liste lunghe).
- `quick-order-modal.component.ts`: `quoteTimer` debounce 200ms su ogni modifica (ok).

---

## 4. Rischi production (P1 = blocca production)

| ID | Rischio | Area | Severità |
|----|---------|------|----------|
| R1 | Nessun campo barcode/EAN su Product → impossibile ricerca per scansione | API/DB/products | P1 |
| R2 | Nessuna API di ricerca prodotto per barcode | API/products | P1 |
| R3 | Nessun handler barcode keyboard-wedge in quick-order e inventory | UI/quick-order, inventory | P1 |
| R4 | Nessun flusso creazione/associazione barcode per prodotto sconosciuto | UI/quick-order, inventory | P1 |
| R5 | Migrazione Prisma non verificata su copia → rischio DB | DB/migration | P1 |
| R6 | Tenant isolation sulle nuove API barcode non verificata | API/security | P1 |
| R7 | Doppio scroll / scroll bloccato su mobile in quick-order e inventory | UI/UX | P2 |
| R8 | Stati vuoto/errore/loading non coerenti (a11y, screen reader) | UI/a11y | P2 |
| R9 | Nessuna conferma su azioni distruttive | UI/UX | P2 |
| R10 | Spazi/ritmo verticale non coerenti (no token unico) | UI/UX | P3 |
| R11 | Animazioni assenti / nessun `prefers-reduced-motion` | UI/a11y | P3 |
| R12 | Offline/PWA non gestito per vendita rapida | PWA | P3 |

---

## 5. Backlog prioritario (P1 = blocca production)

### P1 — bloccanti production (da risolvere prima del rilascio)

1. **Schema Prisma + migrazione**: aggiungere `barcode String?` su `Product` con `@@unique([tenantId, barcode])` (sparse/unico per tenant, nullable). Migrazione additiva e reversibile, verificata su copia.
2. **DTO prodotto**: aggiungere `barcode` a `LegacyWriteDto` (o DTO dedicato) e mappatura in `products.controller.ts` create/update.
3. **API ricerca per barcode**: `GET /products/by-barcode?barcode=...&tenantId=` (o query param su `GET /products?barcode=`) restituente prodotto del tenant. Controller + service + test.
4. **Handler barcode keyboard-wedge** in quick-order e inventory: input nascosto persistente, rilevamento velocità digitazione, Enter finale come invio scansione, focus persistente, nessuna perdita di scansioni.
5. **Scansione ripetuta = incremento quantità** nel carrello quick-order.
6. **Prodotto sconosciuto = flusso rapido creazione/associazione barcode** (quick-create dialog esteso a prodotto con barcode).
7. **Feedback chiaro** su scansione (stato visivo, opzionale suono/vibrazione/flash) e gestione errori (barcode duplicato, prodotto non trovato, rete assente).
8. **Test automatici**: unit test parsing/scansione barcode; test API ricerca per barcode; test tenant isolation.
9. **Verifica migrazione su copia** + nessun dato distrutto.

### P2 — da risolvere prima del rilascio (alta priorità UX)

10. Doppio scroll / contenitori scroll corretti in quick-order e inventory (mobile + tablet).
11. Stati vuoto/errore/loading coerenti e accessibili (role, annunci screen reader).
12. Conferma su azioni distruttive (rimuovi riga, delete prodotto).
13. Focus/tastiera e trap focus nelle modal.

### P3 — post-rilascio (stima)

14. Token/scala di spacing unica e ritmo verticale coerente.
15. Animazioni sobrie (transizioni, skeleton, feedback azioni) con `prefers-reduced-motion`.
16. Scansione da camera su mobile (BarcodeDetector con fallback) — opzionale, se semplice.
17. Offline/PWA per vendita rapida.

---

## 6. Dove consegnare

- Documento `audit`: questo file (`docs/eul-53-audit-uiux-barcode.md`), branch `eul-53-audit-uiux-barcode`.
- Documento `report`: da produrre dopo l’implementazione (fase 4).
- Codice: branch dedicato, **non pushare né mergiare senza ok di Eugenio**.
- Work product: `branch` + `commit` (file specifici, mai reset/clean del lavoro in corso su `alora`).

---

## 7. Stima (da proporre dopo l’audit)

Da definire dopo l’audit e confronto con Eugenio. Le fasi P1 sono stimabili in circa 1–2 settimane di sviluppo (API + migrazione + UI quick-order/inventory + test), P2 in ulteriori 3–5 giorni, P3 su richiesta.

---

## Note

- Nessuna modifica distruttiva su DB o file altrui prevista da questo documento.
- Il lavoro in corso su branch `alora` (~340 file non committati) non viene toccato né sovrascritto.
- Le decisioni finali su P2/P3 e stima restano da concordare con Eugenio (Peppe Licco / Barber Up, contesto EUL-3).
