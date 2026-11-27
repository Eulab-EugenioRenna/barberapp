# @alora/ui — design system ALORA

Componenti Angular standalone che dipendono solo da Angular e dai token del
brand (`libs/shared/brand/src/theme.css`). Non importano servizi, store o API
dell'app: per questo si possono estrarre in un pacchetto e riusare (admin,
booking pubblico, app future).

## Breakpoint (mobile first)

| Vista   | Larghezza   | Media query                     |
|---------|-------------|---------------------------------|
| mobile  | < 48rem     | nessuna: è lo stile di base     |
| tablet  | ≥ 48rem     | `@media (min-width: 48rem)`     |
| desktop | ≥ 64rem     | `@media (min-width: 64rem)`     |

Si scrive sempre lo stile mobile e lo si arricchisce verso l'alto. Niente
`max-width` nelle media query dei componenti nuovi. In TypeScript:
`UiBreakpointService` (`viewport()`, `isMobile()`, `isTablet()`, `isDesktop()`).

## Componenti

| Componente        | Ruolo                                                                 |
|-------------------|-----------------------------------------------------------------------|
| `ui-app-shell`    | Cornice: menu (cassetto su mobile, colonna o rail da tablet), barra di contesto, contenuto, barra in basso su mobile. |
| `ui-side-nav`     | Menu a gruppi su superficie scura; `collapsed` = solo icone.          |
| `ui-bottom-nav`   | Barra del pollice su mobile: max 4 destinazioni + "Altro".            |
| `ui-page`         | Corpo pagina: pila verticale con il ritmo del sistema.                |
| `ui-page-header`  | Unico titolo della pagina: gruppo › titolo › cosa si fa qui › azioni. |
| `ui-tabs`         | Divide una pagina lunga in sezioni mostrate una alla volta.          |
| `ui-icon`         | Icone 24px a tratto; nuova icona = nuova voce nella mappa `ICONS`.    |
| `ui-sheet`        | Foglio unico per editor e moduli, modellato sulla cassa (vedi sotto). |
| `ui-confirm`      | Unica finestrella rimasta: conferma di azioni distruttive. `UiConfirmService.ask()` sostituisce `window.confirm`. |
| `ui-more-menu`    | Pulsante «…» con le azioni secondarie di una riga.                    |

Le classi interne hanno prefisso `ui-` per non collidere con il CSS globale
legacy (`.sidebar`, `.topbar`, `.eyebrow`, ...).

## Fogli (`ui-sheet`)

Modello: la cassa (`apps/web-admin/src/app/quick-order`). Sfondo sfocato,
transizione 220ms (ridotta con `prefers-reduced-motion`), titolo grande con
sottotitolo, barra scura fissa in basso con **una** azione principale. Sotto
820px una colonna sola, intestazione e barra appiccicate, safe-area.

- `size`: `lg` (fino a 1180×780, come la cassa), `md` (moduli, fino a 880),
  `sm` (aggiunte veloci). `split` = due colonne `ui-sheet-col` con scroll
  proprio. `layer` alza lo z-index per un foglio aperto sopra un altro.
- Slot: contenuto, `[uiSheetHead]` (azioni accanto a «Chiudi»),
  `[uiSheetBar]` (barra; un `type="submit"` usa `form="id-del-form"`).
- Utilità globali (`sheet/ui-sheet.css`, caricato da `angular.json`):
  `ui-step` («1 · Persona»), `ui-steps` (avanzamento di una procedura),
  `ui-section`, `touch-grid`/`touch-card` (schede grandi, `aria-pressed` per
  la scelta), `ui-advanced` (`<details>` chiuso per i campi avanzati),
  `ui-warn`/`ui-error` (avvisi in linea che non bloccano), `ui-bar-start`,
  `ui-bar-info`.

## Come si progetta una pagina

1. **Prima le funzioni.** Elenca cosa fa l'utente nella pagina e quanto spesso.
2. **Raggruppa.** Funzioni con lo stesso oggetto stanno insieme; gruppi
   indipendenti e lunghi diventano schede (`ui-tabs`), il più usato per primo.
3. **Un'azione principale.** Al massimo un `primary-btn` per pagina, nelle
   azioni di `ui-page-header`; le altre sono `secondary-btn` o `icon-btn`.
4. **Struttura fissa:** `ui-page` › `ui-page-header` › (schede) › sezioni.
   Niente titoli H1 propri, niente "Torna a …": la navigazione è della shell.
5. **Mobile first:** verifica a 390, 820 e 1440 px; il contenuto non deve mai
   allargare la pagina (`ui-page` usa `minmax(0, 1fr)`).

Nell'admin i nomi, le icone, le descrizioni e i permessi delle sezioni vivono
solo in `apps/web-admin/src/app/core/admin-navigation.ts`; le pagine usano
`<alora-page-header navKey="...">`, che li legge da lì.
