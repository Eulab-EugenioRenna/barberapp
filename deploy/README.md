# Deploy di ALORA (profilo P1: Docker → Proxmox)

Regole generali nel modello EULAB, §14 (`~/eulab-brain/00-sistema/modello/modello-eulab-v0.1.md`).
In breve: GitHub costruisce le immagini su GHCR con tag = commit; un runner self-hosted su Proxmox le installa;
la produzione parte solo dopo l'approvazione di Eugenio. Le app Next.js vanno invece su Vercel.

## File

| File | A cosa serve |
|---|---|
| `compose.production.yml` | stack di produzione con immagini `ghcr.io/eulab-eugeniorenna/barberapp-*:<commit>`, senza MailHog né password fisse |
| `.env.production.example` | variabili da compilare sul server in `/srv/alora/.env.production` (permessi 600) |
| `scripts/backup.sh` | dump del database (verificato con `pg_restore --list`) e archivio dei file caricati |
| `scripts/deploy.sh <commit>` | controlli, download immagini, **backup obbligatorio**, avvio, controllo di salute; registra tag attuale e precedente |
| `scripts/import-legacy.sh` | import una tantum dei dati della vecchia VM `barber` in un database vuoto |
| `../.github/workflows/ci.yml` | test e build su ogni PR e su `master` |
| `../.github/workflows/deploy.yml` | immagini su GHCR a ogni push su `master`; deploy in produzione se `ALORA_DEPLOY_ENABLED=true` |

## Primo deploy (a mano, con Eugenio)

1. **Ricognizione Proxmox** in sola lettura con `pve` (`~/eulab-brain/strumenti/pve`, token nel portachiavi).
2. **Backup della VM `barber`**: backup completo da Proxmox (`vzdump`) e, dentro la VM, dump del database e archivio `uploads`. Verificare il ripristino del dump in uno stack isolato prima di proseguire.
3. **Nuova VM ALORA**: Docker Engine + plugin Compose, utente di servizio, `/srv/alora` (700), `.env.production` (600) compilato sul server.
4. **Import dei dati**: `deploy/scripts/import-legacy.sh barber-legacy.dump barber-legacy-uploads.tar.gz <commit>`. Il database di destinazione deve essere vuoto; confrontare i conteggi con la vecchia VM.
5. **Deploy**: `deploy/scripts/deploy.sh <commit>`, poi ingresso pubblico dal tunnel Cloudflare.
6. **Account**: gli utenti entrano con la vecchia password; ALORA apre la richiesta su Connect e Eugenio la approva (`docs/sso-step-4.md`). Nessuna fusione automatica per email.
7. La vecchia VM `barber` resta spenta ma intatta finché Eugenio non conferma il passaggio.

## Attivare il deploy automatico

1. VM runner su Proxmox, runner GitHub del repo con etichette `self-hosted, linux, alora-production`, utente nel gruppo `docker`, accesso a `/srv/alora`.
2. GitHub → Settings → Environments → `production`: *Required reviewers* = Eugenio.
3. GitHub → Settings → Variables: `ALORA_PUBLIC_URL` (es. `https://alora.eulab.cloud`) e `ALORA_DEPLOY_ENABLED=true`.
4. I pacchetti GHCR restano privati: il job di deploy li scarica con il `GITHUB_TOKEN` del run.

**Tornare indietro:** Actions → deploy → *Run workflow* con il tag precedente (`/srv/alora/previous-tag`).
Le migrazioni sono additive: se la versione nuova ha già scritto dati incompatibili, ripristinare il backup `pre-<commit>`.

## Prova locale degli script

Verificati il 22/11/2026 in uno stack isolato (progetto `alora-localtest`, volumi nuovi, porta 18090):
import di un dump in database vuoto con conteggi identici all'origine, deploy con backup e salute 200 su `/`, `/admin/`, `/api/health`,
secondo deploy sopra i dati esistenti ("No pending migrations"), arresto del deploy quando il backup fallisce.

```sh
export COMPOSE_PROJECT_NAME=alora-localtest ALORA_ENV_FILE=/percorso/env ALORA_BACKUP_DIR=/percorso/backups \
       ALORA_STATE_DIR=/percorso/state ALORA_SKIP_PULL=1
deploy/scripts/deploy.sh <tag-locale>
```
