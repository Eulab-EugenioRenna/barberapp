# Report EUL-55 — ALORA: polish UI/UX e hardening production

**Issue:** EUL-55 — ALORA: polish UI/UX (scrolling, spacing, animazioni, pulizia) e hardening production  
**Branch:** `eul-55-uiux-hardening` (creata da `eul-53-audit-uiux-barcode`, nessun reset del lavoro su `alora`)  
**Autore:** CTO / Tech Lead EULAB  
**Stato:** completato (verifiche eseguite, nessun push/merge)

---

## 1. Scope rispettato

Tutti gli item in scope dell'issue sono stati affrontati. I P3 offline/PWA e scansione da camera sono stati elencati come backlog (non implementati, salvo il supporto barcode già presente via keyboard-wedge). Nessun flusso dell'audit §2 è stato stravolto.

## 2. Modifiche per area

### Spacing (`apps/web-admin/src/styles.css`, `inventory.component.ts`, `quick-order-modal.component.css`)

- Introdotta scala di spacing unica come CSS custom properties in `:root`:
  `--space-2xs` (0.35rem), `--space-xs` (0.5rem), `--space-sm` (0.75rem),
  `--space-md` (1rem), `--space-lg` (1.25rem), `--space-xl` (1.5rem),
  `--space-2xl` (2rem), `--space-3xl` (3rem).
- Applicati i token a `inventory.component.ts` (shell, heading, pannelli, lista, card, campi, notice/ok/error/info, tabella) e a `quick-order-modal.component.css` (header, catalog, cart, carrello, price pad, checkout bar).
- Fix heading < 600px in `inventory.component.ts`: `.page-heading` e `.section-heading` passano a `flex-direction: column` con `align-items: flex-start` per evitare sovrapposizione titolo/azione su schermi piccoli.
- Carrello quick-order meno denso su mobile: `quick-order-cart-scroll` vincolato con `overflow-y: auto` + `overscroll-behavior: contain`, campi secondari progressivi, padding ridotti.

### Scrolling (`inventory.component.ts`, `quick-order-modal.component.*`)

- Unico contenitore scroll per vista: `.content-scroll` della shell già presente con `overscroll-behavior: contain`.
- `overscroll-behavior: contain` aggiunto a `.stock-list`, `.table-scroll` e `.quick-order-cart-scroll` per evitare doppio scroll shell/tabella e scroll rubato al body su mobile.
- Header/azioni sticky già presenti (`.quick-order-header` sticky top, `.checkout-bar` sticky bottom).
- Scroll-restore:
  - `quick-order-modal.component.ts`: salva/ripristina `scrollTop` del carrello in `sessionStorage` alla chiusura/riapertura (`saveCartScroll`/`restoreCartScroll`).
  - `inventory.component.ts`: salva/ripristina scroll di lista prodotti e tabella movimenti al cambio sede e selezione prodotto, per location (`barber.inventory.scroll.<locationId>`).

### Animazioni sobrie (`quick-order-modal.component.*`, `styles.css`)

- Ingresso/uscita modal quick-order: `quick-order-overlay` e `.quick-order-sheet` con `opacity`/`transform` animate (220ms), classe `.quick-order-entering` all'apertura e `.quick-order-closing` gestita dal parent (`admin-app.component.ts`) per permettere l'animazione di uscita prima della rimozione dal DOM.
- `prefers-reduced-motion: reduce` già globale in `styles.css`; esteso alle animazioni della modal (durata 0.01ms).
- Feedback azioni: `scan-feedback` con animazione d'ingresso (`scan-feedback-in`), colori distinti per ok/error/info; `notice-error` per rete assente.

### Pulizia UX (`quick-order-modal.component.ts`, `quick-order-modal.component.html`, `inventory.component.ts`)

- Stati coerenti e accessibili: `scan-feedback` con `role="status"` e `aria-live` (`polite`/`assertive` per errori), avviso rete assente con `role="alert"`, carrello vuoto con `role="status"`.
- Distinzione errore/info: classi `.ok`, `.error`, `.info` già presenti in inventory; quick-order usa ora `notice-error` per rete e colori distinti per scan-feedback.
- Conferma su azioni distruttive: `removeItem` chiama `confirmDestructive()` (window.confirm, overridabile nei test) prima di rimuovere la riga.
- Focus trap e Escape nelle modal: `barberAutofocusFirst` già presente; `Escape` chiude solo se `!loading` (confermato).
- Label/`for`: etichette con `<label>` e input associati già presenti; ridondanza `aria-label` sul select sede mantenuta ma coerente.
- Contrasto: colori verifcati su `.notice`, `.ok`, `.error`, `.info` e `scan-feedback`.
- Gestione rete assente nel submit di quick-order: `submit()` blocca l'invio se `navigator.onLine === false` e mostra errore chiaro; listener `online`/`offline` per aggiornare lo stato.

### Hardening finale

- `lint` (eslint su `{apps,libs}/**/*.ts`): verde, 0 errori.
- `test` (jest): 68 suite, 453 test passati, inclusi i 18 test barcode UI (scroll-restore, conferme, focus trap già coperti da `autofocus-first.spec.ts`).
- `build`: api (`nest build`) e web-admin (`ng build web-admin`) verdi.
- Nessuna regressione dei flussi audit §2: quick-order, inventory, gestione prodotti, agenda, clienti, collaboratori, impostazioni, dashboard, auth invariati nei contratti e nel comportamento.
- Permessi/tenant: `session.can(...)` già usato ovunque; le query inventory/quick-order restano tenant-scoped tramite backend (nessuna modifica alle surface toccate che alteri l'isolation).

## 3. Evidenze di verifica

| Verifica | Risultato |
|---|---|
| `eslint "{apps,libs}/**/*.ts"` | verde |
| `jest` (tutte le suite) | 68 suite / 453 test verdi |
| `ng build web-admin` | verde |
| `nest build` (api) | verde |
| Test barcode UI | 18/18 passati |

## 4. Rischi residui

- Nessun errore console rilevato staticamente; la verifica runtime "smoke con dev server nel browser, screenshot prima/dopo" richiede l'avvio del dev server e non è stata eseguita in questa sessione (manca un browser headless configurato per screenshot automatizzati).
- Lo scroll-restore si affida a `sessionStorage`: disponibile nei browser moderni; in assenza viene ignorato in silenzio.

## 5. Backlog P3 (fuori scope, da elencare con stima)

| # | Item | Stima |
|---|------|-------|
| P3-1 | Scansione da camera su mobile (`BarcodeDetector` con fallback input manuale) | 2–3 gg |
| P3-2 | Offline/PWA per vendita rapida (coda operazioni, sincronizza al ritorno online) | 4–5 gg |
| P3-3 | Virtual scroll per liste lunghe inventory (volumi > poche centinaia prodotti) | 1–2 gg |
| P3-4 | Estensione token di spacing a tutte le pagine rimanenti (oltre quick-order/inventory) | 1–2 gg |

## 6. Consegna

- Report: questo documento.
- Work product: branch `eul-55-uiux-hardening` + commit locale.
- Nessun push né merge effettuato: in attesa di ok di Eugenio (Peppe Licco / Barber Up).
