# alora — Landing page

Landing statica (HTML/CSS/JS, nessuna build) per la vendita di ALORA con licenza a pagamento unico.

## Dove è servita

Nello stack Docker è il servizio `landing` (target `landing-runtime` di `docker/app.Dockerfile`,
config `docker/landing.conf`). Il proxy serve la pagina sulla **radice `/`** (es. http://127.0.0.1:53020/)
e i file statici sotto `/landing/` (`/landing` e `/landing/` reindirizzano a `/`). L'app resta su `/admin/`.

Le CTA "Richiedi la licenza" portano a `/admin/#/signup`, "Accedi" a `/admin/#/login`;
"Contattaci per info" apre un'email a eulabconsult@gmail.com.

- Produzione: dopo una modifica `docker compose ... build landing && docker compose ... up -d --no-deps landing`.
- Sviluppo (`npm run docker:dev`): `apps/landing` è montata nel container, le modifiche si vedono al reload.
- I percorsi nella pagina sono assoluti (`/landing/...`): va servita tramite il proxy, non aprendo il file.

## Struttura

- `index.html`: contenuti (hero, settori, funzioni, flusso, sicurezza, prezzo, FAQ, CTA)
- `styles.css`: stile, palette brand (lime `#88bd39`, foresta `#1e3425`, avorio `#f4f8ec`), Inter locale
- `main.js`: animazioni GSAP + ScrollTrigger, con fallback IntersectionObserver se GSAP non c'è; rispetta `prefers-reduced-motion`
- `assets/vendor/`: GSAP 3.13 e ScrollTrigger in locale (nessun CDN)
- `assets/covers/`: cover dei settori

## Da completare prima della pubblicazione

- Nessun prezzo pubblicato: la sezione prezzo mostra "Contattaci" (offerta su misura).

## Crediti foto (Unsplash License)

Foto da [Unsplash](https://unsplash.com), uso gratuito anche commerciale:
`photo-1585747860715-2ba37e788b70` (barber), `photo-1600948836101-f9ffda59d250` (parrucchieri),
`photo-1570172619644-dfd03ed5d881` (estetica), `photo-1540555700478-4be289fbecef` (spa),
`photo-1544161515-4ab6ce6db874` (massaggi), `photo-1604654894610-df63bc536371` (nail).
