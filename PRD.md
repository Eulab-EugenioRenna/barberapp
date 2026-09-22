# PRD — Sistema SaaS White Label per Gestione Prenotazioni, Servizi, Collaboratori e Vendite

## 1. Sintesi prodotto

Il prodotto è una piattaforma web fullstack SaaS white label per aziende che gestiscono prenotazioni, servizi, collaboratori, postazioni, sale, clienti, vendite di prodotti e dashboard economiche. Il sistema deve poter funzionare in due modalità principali:

1. **Modalità pubblica aperta ai clienti**: i clienti possono prenotare online tramite pagina pubblica brandizzata, scegliendo servizio, data, orario, collaboratore/postazione/sala se consentito, e lasciando dati di contatto.
2. **Modalità aziendale chiusa**: nessuna prenotazione pubblica; il titolare o il personale autorizzato gestiscono manualmente appuntamenti, clienti, vendite, calendario e storico.

Il sistema deve essere progettato come SaaS multi-tenant, con isolamento dati per azienda, configurazione white label, gestione ruoli e policy per titolare, collaboratori e personale amministrativo.

---

## 2. Obiettivi

### 2.1 Obiettivi business

* Offrire a piccole e medie attività un gestionale moderno per prenotazioni e vendite.
* Consentire personalizzazione white label per brand, colori, logo, dominio e pagina pubblica.
* Gestire sia attività con prenotazione pubblica sia attività che lavorano solo internamente.
* Abilitare modelli futuri di abbonamento SaaS, piani, limiti e moduli opzionali.
* Centralizzare calendario, clienti, servizi, collaboratori, vendite e fatturato.

### 2.2 Obiettivi prodotto

* Creare un’interfaccia veloce, moderna, responsive e touch-friendly.
* Ridurre i tempi di creazione e modifica appuntamenti.
* Dare al titolare visibilità su fatturato, servizi più venduti, collaboratori più performanti e clienti ricorrenti.
* Permettere ai collaboratori di accedere solo alle aree consentite.
* Conservare uno storico completo per cliente, collaboratore e servizio.
* Supportare auditing e logging per debug, sicurezza e tracciabilità.

### 2.3 Obiettivi tecnici

* Frontend Angular con Tailwind CSS.
* Backend NestJS modulare.
* Database PostgreSQL.
* NX monorepo per app e librerie condivise.
* Docker per sviluppo, test e deploy.
* Architettura multi-tenant predisposta per scalabilità.
* Logging strutturato, audit trail e strumenti dev-friendly.

---

## 3. Non-obiettivi della prima release

* Marketplace pubblico multi-azienda.
* Pagamenti online completamente operativi nella prima versione. La piattaforma deve però essere predisposta tecnicamente per l’integrazione futura di provider di pagamento.
* Fatturazione elettronica completa.
* App mobile native iOS/Android.
* Intelligenza artificiale per ottimizzazione automatica calendario.
* Integrazione contabilità esterna.
* Gestione magazzino avanzata con lotti, fornitori e riordino automatico.

Questi elementi possono diventare moduli successivi.

---

## 4. Target utenti

### 4.1 Titolare azienda

È l’utente principale. Configura azienda, servizi, collaboratori, sale, postazioni, prodotti, listini, calendario e policy. Ha accesso completo a dashboard, fatturato, storico e audit.

### 4.2 Collaboratore

Gestisce il proprio calendario, vede gli appuntamenti assegnati, può aggiornare stato appuntamento, consultare informazioni cliente se autorizzato, registrare servizi svolti e vendite se permesso.

### 4.3 Operatore/reception

Ruolo opzionale per gestione prenotazioni, clienti e agenda aziendale. Può prenotare per conto dei clienti e consultare disponibilità di sale, servizi e collaboratori.

### 4.4 Cliente finale

Accede alla pagina pubblica, visualizza servizi prenotabili, seleziona slot disponibili e invia una richiesta o conferma prenotazione, in base alla configurazione aziendale.

### 4.5 Admin piattaforma SaaS

Gestisce tenant, piani, blocchi, configurazioni globali, log applicativi e assistenza tecnica. Non deve accedere ai dati sensibili dei tenant salvo policy esplicita e auditata.

---

## 5. Modalità operative

## 5.1 Modalità pubblica aperta

La pagina pubblica consente ai clienti di prenotare senza accesso interno.

Funzionalità richieste:

* URL pubblico per azienda.
* Supporto white label: logo, nome, colori, cover, descrizione.
* Lista servizi pubblicabili.
* Disponibilità calcolata da calendario aziendale, collaboratori, sale, postazioni e durata servizio.
* Opzione scelta collaboratore: obbligatoria, opzionale o nascosta.
* Opzione scelta sala/postazione: configurabile.
* Form cliente configurabile.
* Conferma immediata o richiesta da approvare.
* Stato prenotazione: richiesta, confermata, annullata, completata, no-show.
* Email o notifica futura predisposta.
* Possibilità di disdetta prenotazione secondo policy configurabile.
* Registrazione cliente opzionale o prenotazione come guest, in base alla configurazione del tenant.
* Protezione anti-spam e rate limit.
* Predisposizione pagamento online: il flusso deve poter includere in futuro caparra, saldo anticipato o pagamento completo.

## 5.2 Modalità aziendale chiusa

La prenotazione pubblica è disattivata. Solo utenti interni possono creare appuntamenti.

Funzionalità richieste:

* Calendario titolare globale.
* Calendari per collaboratore.
* Creazione appuntamento da backend gestionale.
* Assegnazione cliente, servizio, collaboratore, sala, postazione.
* Blocco orari non disponibili.
* Storico attività e appuntamenti.
* Dashboard interna.

## 5.3 Modalità ibrida

Il tenant può pubblicare solo alcuni servizi, collaboratori o sedi, mantenendo altri elementi solo interni.

Esempi:

* Servizio A prenotabile online.
* Servizio B solo da reception.
* Collaboratore X visibile online.
* Collaboratore Y assegnabile solo internamente.

---

## 6. Requisiti funzionali

## 6.1 Multi-tenancy e white label

### Requisiti

* Ogni azienda è un tenant isolato.
* Ogni record business deve appartenere a un tenant.
* Il tenant può configurare:

  * nome azienda;
  * logo;
  * colori principali;
  * immagine cover;
  * dominio o slug pubblico;
  * timezone;
  * valuta;
  * lingua;
  * modalità prenotazione pubblica o chiusa;
  * policy di conferma prenotazione.

### Acceptance criteria

* Un utente di un tenant non può vedere dati di altri tenant.
* La pagina pubblica usa configurazioni del tenant.
* La disattivazione della prenotazione pubblica rende irraggiungibili i flussi cliente, salvo pagina informativa opzionale.

---

## 6.2 Autenticazione e ruoli

### Ruoli base

* **Platform Admin**: gestisce il SaaS.
* **Owner/Titolare**: accesso completo al tenant.
* **Manager**: gestione operativa con limitazioni configurabili.
* **Collaborator**: accesso limitato al proprio calendario e attività consentite.
* **Reception/Staff**: gestione appuntamenti e clienti.
* **Client**: opzionale, per area cliente futura.

### Policy principali

* Il titolare vede tutto.
* Il collaboratore vede di default solo:

  * propri appuntamenti;
  * dati cliente minimi necessari;
  * storico relativo ai propri servizi, se abilitato;
  * vendite proprie, se abilitato.
* Il collaboratore non può modificare prezzi, configurazioni aziendali, servizi globali o altri collaboratori.
* Il manager può gestire calendari e report secondo permessi.
* Ogni azione sensibile deve generare audit log.

### Permessi granulari

* `appointments.read.all`
* `appointments.read.own`
* `appointments.create`
* `appointments.update.all`
* `appointments.update.own`
* `clients.read.full`
* `clients.read.limited`
* `services.manage`
* `collaborators.manage`
* `rooms.manage`
* `stations.manage`
* `products.manage`
* `sales.create`
* `dashboard.revenue.read`
* `settings.manage`
* `audit.read`

---

## 6.3 Gestione collaboratori e postazioni

### Collaboratori

Ogni collaboratore ha:

* anagrafica;
* email di accesso;
* ruolo;
* servizi abilitati;
* calendario personale;
* orari di lavoro;
* ferie/assenze/blocchi;
* sale o postazioni assegnabili;
* colore calendario;
* stato attivo/non attivo.

### Postazioni

Le postazioni sono risorse configurabili associate a servizi o sale.

Esempi:

* poltrona 1;
* cabina 2;
* scrivania consulenza;
* macchinario specifico;
* postazione trattamento.

Ogni postazione ha:

* nome;
* codice opzionale;
* sala associata opzionale;
* servizi compatibili;
* disponibilità;
* stato attivo/non attivo.

### Regole

* Un appuntamento può richiedere uno o più vincoli: collaboratore, sala, postazione.
* Il sistema deve evitare overbooking della stessa risorsa.
* Se un servizio richiede una specifica postazione, la disponibilità deve considerarla.

---

## 6.4 Gestione sale

Ogni sala ha:

* nome;
* capacità;
* servizi compatibili;
* postazioni contenute;
* disponibilità;
* note interne;
* stato attivo/non attivo.

Regole:

* Una sala non può essere prenotata contemporaneamente per appuntamenti incompatibili.
* Un servizio può richiedere sala obbligatoria, opzionale o nessuna sala.
* Le sale possono essere visibili o nascoste nel booking pubblico.

---

## 6.5 Gestione servizi

Ogni servizio ha:

* nome;
* descrizione interna;
* descrizione pubblica;
* durata;
* tempo buffer prima/dopo;
* prezzo base;
* IVA opzionale;
* categoria;
* servizi compatibili con collaboratori;
* risorse richieste: sala, postazione, collaboratore;
* visibilità pubblica;
* prenotabile online sì/no;
* colore calendario;
* stato attivo/non attivo.

Regole:

* Il servizio determina durata e prezzo suggerito dell’appuntamento.
* Il prezzo può essere modificato in vendita finale se permesso.
* Il servizio può essere assegnato a uno o più collaboratori.
* Un servizio non prenotabile online può essere usato solo internamente.

---

## 6.6 Calendario titolare

Il calendario titolare è la vista globale dell’azienda.

Funzionalità:

* vista giorno, settimana, mese, agenda;
* filtro per collaboratore;
* filtro per servizio;
* filtro per sala/postazione;
* drag & drop appuntamenti;
* resize appuntamento;
* creazione rapida slot;
* blocchi aziendali;
* assenze collaboratori;
* indicatori stato pagamento/vendita;
* touch mode full screen.

Acceptance criteria:

* Il titolare vede tutti gli appuntamenti.
* Lo spostamento di un appuntamento ricalcola conflitti.
* Ogni modifica viene tracciata in audit log.

---

## 6.7 Calendario collaboratore

Il calendario collaboratore mostra solo ciò che il collaboratore è autorizzato a vedere.

Funzionalità:

* vista giornaliera e settimanale;
* appuntamenti propri;
* dettagli cliente secondo policy;
* stato appuntamento;
* note operative;
* possibilità di completare appuntamento;
* registrazione prodotti venduti se permesso;
* blocco disponibilità personale se abilitato.

Policy esempi:

* Collaboratore base: vede nome cliente e servizio.
* Collaboratore avanzato: vede storico cliente relativo ai propri servizi.
* Collaboratore manager: vede calendari di più collaboratori.

---

## 6.8 Prenotazioni

### Campi appuntamento

* tenant;
* cliente;
* servizio;
* collaboratore;
* sala;
* postazione;
* data/ora inizio;
* data/ora fine;
* stato;
* prezzo stimato;
* prezzo finale;
* note interne;
* note cliente;
* origine: pubblico, interno, import, API;
* creato da;
* aggiornato da.

### Stati

* `draft`
* `requested`
* `confirmed`
* `checked_in`
* `completed`
* `cancelled`
* `no_show`
* `rescheduled`

### Regole disponibilità

Il sistema deve verificare:

* orari azienda;
* orari collaboratore;
* disponibilità sala;
* disponibilità postazione;
* assenze e blocchi;
* buffer servizio;
* appuntamenti già esistenti;
* policy di anticipo minimo/massimo prenotazione.

---

## 6.9 Registrazione clienti, clienti e storico

### Registrazione cliente

Il sistema deve supportare due modalità:

1. **Cliente guest**: il cliente prenota inserendo solo i dati richiesti dal form pubblico.
2. **Cliente registrato**: il cliente crea un account per consultare prenotazioni, storico, eventuali notifiche e azioni disponibili.

Campi registrazione cliente:

* nome;
* cognome;
* email;
* telefono opzionale o obbligatorio secondo configurazione;
* password se account cliente attivo;
* consenso privacy;
* consenso marketing opzionale;
* tenant di appartenenza;
* stato account.

Funzionalità area cliente predisposte:

* visualizzazione prossime prenotazioni;
* visualizzazione storico prenotazioni;
* richiesta disdetta;
* aggiornamento dati personali;
* preferenze notifiche;
* storico notifiche ricevute.

### Anagrafica cliente

* nome;
* cognome;
* telefono;
* email;
* data nascita opzionale;
* note;
* tag;
* consenso privacy/marketing;
* stato attivo.

### History cliente

La scheda cliente deve mostrare:

* prenotazioni passate;
* servizi ricevuti;
* collaboratori associati;
* prodotti acquistati;
* fatturato generato;
* note storiche;
* no-show/cancellazioni;
* allegati futuri opzionali.

### History collaboratore

* appuntamenti svolti;
* servizi erogati;
* vendite associate;
* fatturato generato;
* tasso completamento;
* no-show assegnati;
* produttività per periodo.

### History servizio

* numero prenotazioni;
* ricavi;
* durata media reale;
* collaboratori che lo erogano;
* clienti ricorrenti;
* trend periodo.

---

## 6.10 Gestione prodotti e vendita prodotti configurabili

### Prodotti

Ogni prodotto ha:

* nome;
* descrizione;
* immagine opzionale;
* prezzo;
* SKU opzionale;
* categoria opzionale;
* IVA opzionale;
* costo opzionale;
* attributi configurabili;
* stato attivo/non attivo.

Il prodotto deve poter essere:

* venduto singolarmente;
* collegato a una vendita;
* inserito in uno o più servizi;
* suggerito durante il completamento di un appuntamento;
* mostrato come componente o prodotto consigliato nella scheda servizio.

### Attributi configurabili

Esempi:

* colore;
* formato;
* taglia;
* variante;
* durata;
* pacchetto;
* quantità.

### Prodotti inseribili in un servizio

Un servizio può includere o suggerire prodotti.

Esempi:

* servizio trattamento con prodotto incluso;
* servizio consulenza con kit acquistabile;
* servizio premium con prodotto omaggio;
* servizio con prodotti consigliati in fase di checkout.

Configurazioni possibili:

* prodotto incluso nel prezzo del servizio;
* prodotto suggerito ma opzionale;
* prodotto obbligatorio come voce separata;
* quantità predefinita;
* prezzo prodotto modificabile o bloccato.

### Vendita

La vendita può essere:

* collegata a un appuntamento;
* collegata a un cliente;
* collegata a un collaboratore;
* autonoma, senza appuntamento.

### Campi vendita

* cliente;
* collaboratore;
* prodotti;
* quantità;
* sconti;
* imposte;
* totale;
* metodo pagamento;
* stato pagamento;
* data vendita;
* note.

### Stati pagamento

* `unpaid`
* `paid`
* `partial`
* `refunded`
* `cancelled`

---

## 6.11 Dashboard fatturato con filtri

### Vista titolare

Metriche principali:

* fatturato totale;
* fatturato servizi;
* fatturato prodotti;
* numero prenotazioni;
* ticket medio;
* clienti nuovi;
* clienti ricorrenti;
* no-show rate;
* cancellazioni;
* servizi più venduti;
* collaboratori più performanti;
* prodotti più venduti.

Filtri dashboard:

* periodo;
* range date personalizzato;
* collaboratore;
* servizio;
* prodotto;
* categoria prodotto;
* cliente;
* stato appuntamento;
* stato pagamento;
* metodo pagamento;
* sede futura;
* sala;
* postazione;
* origine prenotazione;
* canale di vendita;
* confronto periodo precedente.

### Vista collaboratore

Se abilitata:

* appuntamenti propri;
* fatturato generato;
* prodotti venduti;
* servizi svolti;
* performance periodo.

---

## 6.12 Notifiche, history notifiche, integrazioni e preferenze

Il sistema deve prevedere un modulo notifiche configurabile per tenant e per utente.

### Canali notifica predisposti

* Email.
* Telegram.
* WhatsApp.
* Notifiche interne in-app.
* Webhook futuri.

### Preferenze per utente

Ogni utente interno e cliente registrato può avere preferenze di notifica configurabili, se abilitate dal tenant.

Preferenze:

* canale preferito;
* notifiche appuntamenti;
* notifiche disdette;
* notifiche modifiche calendario;
* notifiche vendite;
* notifiche promemoria;
* notifiche amministrative;
* opt-in/opt-out dove consentito.

### Configurazione tenant

Il titolare può configurare:

* canali attivi;
* template messaggi;
* mittente email;
* token o credenziali integrazioni;
* eventi che generano notifiche;
* anticipo promemoria;
* regole per cliente e collaboratore;
* fallback canale, per esempio email se WhatsApp non disponibile.

### History notifiche

Ogni notifica generata deve essere storicizzata.

Campi history notifica:

* tenant_id;
* recipient_user_id nullable;
* customer_id nullable;
* channel;
* event_type;
* template_id;
* payload sintetico;
* stato: pending, sent, failed, skipped;
* errore eventuale;
* provider_message_id opzionale;
* created_at;
* sent_at.

### Eventi notifica principali

* nuova prenotazione;
* richiesta prenotazione pubblica;
* conferma prenotazione;
* modifica appuntamento;
* disdetta appuntamento;
* promemoria appuntamento;
* completamento servizio;
* vendita completata;
* cambio stato pagamento;
* invito collaboratore;
* reset password.

## 6.13 Disdette e cancellazioni

Il sistema deve supportare la disdetta degli appuntamenti sia da parte degli utenti interni sia, se abilitato, da parte del cliente.

### Policy configurabili

* disdetta sempre permessa;
* disdetta permessa entro un certo limite orario;
* disdetta solo con richiesta di approvazione;
* disdetta non permessa dal cliente;
* motivo disdetta obbligatorio/opzionale;
* notifica automatica a titolare/collaboratore/cliente.

### Campi disdetta

* appointment_id;
* cancelled_by_type: owner, staff, collaborator, customer, system;
* cancelled_by_id nullable;
* reason;
* cancelled_at;
* policy_result;
* refund_status futuro;
* audit log collegato.

### Regole

* Una disdetta libera lo slot calendario.
* La disdetta deve restare nello storico cliente, collaboratore e servizio.
* La disdetta deve aggiornare dashboard e metriche.
* Se il pagamento futuro è attivo, il sistema deve predisporre stato rimborso o trattenuta.

## 6.14 Audit log e logging dev

### Audit log business

Devono essere tracciate azioni come:

* login/logout;
* creazione/modifica/cancellazione appuntamento;
* cambio stato appuntamento;
* modifica prezzi;
* creazione/modifica cliente;
* creazione/modifica vendita;
* modifica permessi;
* accesso a dati sensibili;
* modifica configurazioni tenant.

Campi audit:

* tenant_id;
* actor_user_id;
* actor_role;
* action;
* entity_type;
* entity_id;
* before JSON;
* after JSON;
* ip;
* user agent;
* timestamp;
* correlation_id.

### Logging tecnico

* log strutturati JSON;
* correlation ID per request;
* request/response metadata senza dati sensibili;
* error log con stack trace in ambiente dev;
* masking dati personali;
* livelli: debug, info, warn, error;
* log separati per API, job, auth, audit.

---

## 7. Requisiti UX/UI

## 7.1 Stile visivo

Direzione: moderno, chiaro, leggero, SaaS premium.

Caratteristiche:

* layout pulito;
* ampio uso di spaziature;
* card con bordi arrotondati;
* ombre leggere;
* palette configurabile per white label;
* tipografia leggibile;
* icone lineari;
* microinterazioni fluide;
* animazioni card discrete.

## 7.2 Sidebar a scomparsa

La sidebar deve supportare:

* stato espanso;
* stato compatto con sole icone;
* stato nascosto su mobile;
* overlay su tablet;
* shortcut per touch mode;
* persistenza preferenza utente.

Voci principali:

* Dashboard;
* Calendario;
* Prenotazioni;
* Clienti;
* Collaboratori;
* Sale;
* Postazioni;
* Servizi;
* Prodotti;
* Vendite;
* Report;
* Impostazioni;
* Audit log.

## 7.3 Full screen touch mode

Modalità pensata per tablet, reception, totem o uso rapido.

Caratteristiche:

* pulsanti grandi;
* calendario full screen;
* creazione rapida appuntamento;
* drawer laterali;
* riduzione elementi non necessari;
* gesture-friendly;
* modali a tutto schermo su mobile;
* supporto dark overlay opzionale per focus.

## 7.4 Performance percepita

* skeleton loading;
* optimistic UI dove sicuro;
* cache lato client per liste frequenti;
* debounce ricerca;
* virtual scroll per liste lunghe;
* lazy loading moduli;
* animazioni massimo 150–250 ms;
* nessun blocco UI durante operazioni API.

---

## 8. Architettura tecnica

## 8.1 Stack

* **Frontend**: Angular.
* **UI styling**: Tailwind CSS.
* **Backend**: NestJS.
* **Database**: PostgreSQL.
* **Monorepo**: NX.
* **Containerizzazione**: Docker + Docker Compose.
* **ORM definitivo**: Prisma, scelto per type-safety, produttività, migrazioni gestibili e buona integrazione con PostgreSQL e NestJS.
* **Auth**: JWT access token + refresh token, predisposizione OAuth futura.
* **API**: REST prima release, OpenAPI/Swagger.
* **Testing**: Jest, Playwright/Cypress, Supertest.

## 8.2 NX monorepo proposto

```txt
apps/
  web-admin/              Angular dashboard gestionale
  web-public-booking/     Angular pagina pubblica prenotazioni
  api/                    NestJS backend

libs/
  shared/types/           DTO, enum, tipi condivisi
  shared/utils/           utility comuni
  shared/validation/      schema e validazioni
  ui/                     componenti UI Angular riusabili
  feature-calendar/       logica calendario frontend
  feature-booking/        logica prenotazione frontend
  data-access/            client API frontend
  api-domain/             domain logic backend condivisa
  api-auth/               modulo auth
  api-audit/              modulo audit
```

## 8.3 Moduli backend NestJS

* AuthModule
* TenantModule
* UserModule
* RolePermissionModule
* CollaboratorModule
* ServiceModule
* RoomModule
* StationModule
* CustomerModule
* AppointmentModule
* AvailabilityModule
* ProductModule
* SalesModule
* DashboardModule
* AuditModule
* NotificationModule
* NotificationIntegrationModule
* PaymentPreparationModule
* PublicBookingModule

## 8.4 Database PostgreSQL — entità principali

### Tabelle principali

* tenants
* tenant_settings
* users
* roles
* permissions
* user_roles
* collaborators
* customers
* services
* rooms
* stations
* appointments
* appointment_status_history
* availability_rules
* blocked_times
* products
* product_variants
* service_products
* sales
* sale_items
* payments
* payment_provider_configs
* appointment_cancellations
* notification_templates
* notification_preferences
* notification_history
* audit_logs
* refresh_tokens

### Principio multi-tenant

Tutte le tabelle business devono includere `tenant_id` e indici composti.

Esempi indici:

* `(tenant_id, created_at)`
* `(tenant_id, status)`
* `(tenant_id, collaborator_id, starts_at)`
* `(tenant_id, customer_id)`
* `(tenant_id, service_id)`

---

## 9. Modello dati semplificato

## 9.1 Appointment

```txt
Appointment
- id
- tenant_id
- customer_id
- service_id
- collaborator_id nullable
- room_id nullable
- station_id nullable
- starts_at
- ends_at
- status
- source
- estimated_price
- final_price
- customer_notes
- internal_notes
- created_by
- updated_by
- created_at
- updated_at
```

## 9.2 Service

```txt
Service
- id
- tenant_id
- name
- public_description
- internal_description
- duration_minutes
- buffer_before_minutes
- buffer_after_minutes
- base_price
- category_id
- requires_collaborator
- requires_room
- requires_station
- is_public
- is_bookable_online
- color
- is_active
```

## 9.3 Sale

```txt
Sale
- id
- tenant_id
- customer_id
- collaborator_id nullable
- appointment_id nullable
- subtotal
- discount_total
- tax_total
- total
- payment_status
- payment_method
- sold_at
- created_by
```

## 9.4 AuditLog

```txt
AuditLog
- id
- tenant_id
- actor_user_id
- actor_role
- action
- entity_type
- entity_id
- before
- after
- ip_address
- user_agent
- correlation_id
- created_at
```

---

## 10. API principali

## 10.1 Auth

* `POST /auth/login`
* `POST /auth/refresh`
* `POST /auth/logout`
* `GET /auth/me`

## 10.2 Tenant/settings

* `GET /tenant/settings`
* `PATCH /tenant/settings`
* `GET /public/:tenantSlug/settings`

## 10.3 Calendario e prenotazioni

* `GET /appointments`
* `POST /appointments`
* `GET /appointments/:id`
* `PATCH /appointments/:id`
* `DELETE /appointments/:id`
* `POST /appointments/:id/status`
* `GET /availability`
* `POST /public/:tenantSlug/bookings`
* `GET /public/:tenantSlug/availability`

## 10.4 Collaboratori, sale, postazioni

* `GET /collaborators`
* `POST /collaborators`
* `PATCH /collaborators/:id`
* `GET /rooms`
* `POST /rooms`
* `PATCH /rooms/:id`
* `GET /stations`
* `POST /stations`
* `PATCH /stations/:id`

## 10.5 Clienti e storico

* `GET /customers`
* `POST /customers`
* `GET /customers/:id`
* `PATCH /customers/:id`
* `GET /customers/:id/history`

## 10.6 Prodotti e vendite

* `GET /products`
* `POST /products`
* `PATCH /products/:id`
* `POST /services/:id/products`
* `DELETE /services/:id/products/:productId`
* `GET /sales`
* `POST /sales`
* `GET /sales/:id`

## 10.7 Dashboard

* `GET /dashboard/revenue`
* `GET /dashboard/appointments`
* `GET /dashboard/collaborators`
* `GET /dashboard/services`
* `GET /dashboard/products`

## 10.8 Notifiche

* `GET /notification-preferences`
* `PATCH /notification-preferences`
* `GET /notification-history`
* `GET /notification-templates`
* `PATCH /notification-templates/:id`
* `POST /notification-integrations/test`

## 10.9 Disdette

* `POST /appointments/:id/cancel`
* `GET /appointments/:id/cancellation-policy`

## 10.10 Pagamenti predisposti

* `GET /payment-settings`
* `PATCH /payment-settings`
* `POST /payments/prepare-intent`

## 10.11 Audit

* `GET /audit-logs`

---

## 11. Regole di autorizzazione

### Esempi

* `GET /appointments`:

  * owner: tutti;
  * manager: secondo policy;
  * collaborator: solo propri;
  * reception: tutti se abilitato.

* `PATCH /services/:id`:

  * solo owner o manager con `services.manage`.

* `GET /dashboard/revenue`:

  * owner sempre;
  * collaboratore solo se `dashboard.revenue.read.own`.

* `GET /customers/:id/history`:

  * owner: completo;
  * collaborator: limitato ai propri appuntamenti se policy attiva.

---

## 12. Requisiti non funzionali

## 12.1 Performance

* Primo caricamento dashboard sotto 2,5 secondi su connessione standard.
* Navigazione interna reattiva sotto 200 ms percepiti quando dati già cacheati.
* Query calendario ottimizzate per intervallo date.
* Paginazione server-side per liste lunghe.
* Indici database obbligatori su tenant, date e relazioni principali.

## 12.2 Sicurezza

* Hash password con algoritmo moderno.
* JWT a breve durata e refresh token ruotabili.
* Rate limiting su login e booking pubblico.
* Validazione input lato backend.
* Sanitizzazione output dove necessario.
* Audit per azioni sensibili.
* Protezione CSRF se si usano cookie.
* CORS configurato per ambienti.
* Mascheramento dati sensibili nei log.

## 12.3 Privacy

* Gestione consensi cliente.
* Diritto cancellazione/anonymizzazione predisposto.
* Esportazione dati cliente futura.
* Minimizzazione dati visibili al collaboratore.

## 12.4 Accessibilità

* Contrasti adeguati.
* Navigazione da tastiera.
* Stati focus visibili.
* Componenti touch con target minimo adeguato.
* Etichette e aria-label per azioni icon-only.

## 12.5 Scalabilità

* Multi-tenant con isolamento logico.
* Job queue futura per notifiche e report.
* Cache Redis futura per disponibilità e sessioni.
* Read model futuro per dashboard pesanti.

---

## 13. UX flows principali

## 13.1 Flusso landing SaaS e registrazione tenant

1. Visitatore apre la landing SaaS.
2. Visualizza proposta valore, funzionalità, piani e call to action.
3. Avvia registrazione azienda.
4. Inserisce dati titolare e azienda.
5. Il sistema crea tenant, owner e configurazione iniziale.
6. Il titolare accede all’onboarding guidato.
7. Configura servizi, collaboratori, calendario e pagina pubblica.
8. La piattaforma è pronta per uso interno o prenotazione pubblica.

## 13.2 Flusso prenotazione pubblica

1. Cliente apre pagina pubblica.
2. Visualizza branding azienda e servizi prenotabili.
3. Seleziona servizio.
4. Se configurato, seleziona collaboratore.
5. Il sistema mostra slot disponibili.
6. Cliente seleziona data e ora.
7. Cliente compila dati richiesti.
8. Sistema crea prenotazione richiesta o confermata.
9. Cliente vede schermata conferma.
10. Titolare/collaboratore vede appuntamento in calendario.

## 13.3 Flusso registrazione cliente

1. Cliente apre pagina pubblica o link area cliente.
2. Sceglie registrazione o continua come guest, se consentito.
3. Inserisce dati personali e consensi.
4. Conferma email se configurato.
5. Accede alla propria area cliente.
6. Visualizza prenotazioni, storico e preferenze notifiche.

## 13.4 Flusso disdetta cliente

1. Cliente apre prenotazione da area cliente o link notifica.
2. Il sistema verifica policy di disdetta.
3. Se consentito, il cliente inserisce eventuale motivo.
4. Il sistema annulla o invia richiesta di annullamento.
5. Calendario, storico, dashboard e notifiche vengono aggiornati.
6. L’evento viene registrato in audit log.

## 13.5 Flusso creazione appuntamento interno

1. Utente interno apre calendario.
2. Clicca slot o pulsante nuova prenotazione.
3. Cerca o crea cliente.
4. Seleziona servizio.
5. Seleziona collaboratore/sala/postazione.
6. Sistema valida conflitti.
7. Utente conferma.
8. Appuntamento appare in calendario.
9. Audit log registra creazione.

## 13.6 Flusso vendita prodotto

1. Utente apre vendita da appuntamento o POS leggero.
2. Seleziona cliente e collaboratore.
3. Aggiunge prodotti/varianti.
4. Applica eventuale sconto.
5. Seleziona metodo pagamento.
6. Conferma vendita.
7. Dashboard aggiorna fatturato.
8. Storico cliente e collaboratore vengono aggiornati.

---

## 14. Componenti UI principali

* AppShell con sidebar collassabile.
* Topbar con search, tenant switch futuro, profilo.
* CalendarView.
* AppointmentDrawer.
* QuickBookingModal.
* CustomerProfilePanel.
* CollaboratorCard.
* ServiceCard.
* RoomCard.
* StationCard.
* ProductConfigurator.
* SalesCheckoutPanel.
* RevenueDashboardCards.
* AuditLogTable.
* PublicBookingStepper.
* SaaSLandingPage.
* TenantRegistrationWizard.
* CustomerRegistrationForm.
* CancellationPolicyPanel.
* NotificationPreferencesPanel.
* NotificationHistoryTimeline.
* PaymentPreparationSettings.
* FullScreenTouchModeLayout.

## 14.1 Animazioni card

Le card devono supportare:

* hover lift leggero;
* focus ring accessibile;
* transizione opacity/scale;
* loading skeleton;
* stato selected;
* stato disabled;
* feedback success/error.

---

## 15. Setup sviluppo

## 15.1 Docker Compose locale

Servizi consigliati:

* `postgres`
* `api`
* `web-admin`
* `web-public-booking`
* `redis` opzionale/futuro
* `mailhog` opzionale per email dev

## 15.2 Ambiente dev

Variabili principali:

```txt
DATABASE_URL=
JWT_ACCESS_SECRET=
JWT_REFRESH_SECRET=
APP_ENV=development
PUBLIC_APP_URL=
ADMIN_APP_URL=
LOG_LEVEL=debug
```

## 15.3 Comandi indicativi

```bash
npm install
nx serve api
nx serve web-admin
nx serve web-public-booking
nx test
nx lint
nx affected:test
nx affected:lint
```

---

## 16. Testing strategy

### Unit test

* availability rules;
* permission rules;
* pricing calculations;
* booking status transitions;
* product variant calculation.

### Integration test

* creazione appuntamento;
* conflitti calendario;
* vendita prodotto;
* dashboard aggregazioni;
* audit log.

### E2E test

* login owner;
* creazione servizio;
* creazione collaboratore;
* prenotazione pubblica;
* completamento appuntamento;
* vendita prodotto;
* accesso collaboratore limitato.

---

## 17. Roadmap MVP

## Fase 1 — Fondamenta

* NX monorepo.
* Angular admin app.
* NestJS API.
* PostgreSQL.
* Docker Compose.
* Auth base.
* Tenant e settings.
* Ruoli owner/collaborator.
* Audit log base.

## Fase 2 — Prenotazioni core

* Servizi.
* Collaboratori.
* Calendario titolare.
* Calendario collaboratore.
* Clienti.
* Appuntamenti interni.
* Availability engine.

## Fase 3 — Booking pubblico

* Pagina pubblica white label.
* Servizi pubblici.
* Slot disponibili.
* Form cliente.
* Conferma/richiesta prenotazione.
* Modalità pubblica/chiusa/ibrida.

## Fase 4 — Risorse e vendite

* Sale.
* Postazioni.
* Prodotti configurabili.
* Vendite.
* Storico cliente/collaboratore/servizio.

## Fase 5 — Dashboard e rifinitura UX

* Dashboard fatturato.
* Report collaboratori.
* Report servizi.
* Sidebar avanzata.
* Full screen touch mode.
* Animazioni e performance.

---

## 18. Metriche di successo

* Tempo medio creazione appuntamento interno inferiore a 30 secondi.
* Prenotazione pubblica completabile in meno di 4 step principali.
* Zero overbooking in test automatici di conflitto risorse.
* Dashboard principale caricata sotto 2,5 secondi in ambiente target.
* Almeno 95% delle azioni sensibili registrate in audit log.
* Collaboratore impossibilitato ad accedere a dati fuori policy nei test E2E.

---

## 19. Rischi e mitigazioni

### Rischio: availability engine complesso

Mitigazione: sviluppare regole incrementali, test unitari estesi e casi limite documentati.

### Rischio: permessi collaboratore troppo rigidi o troppo permissivi

Mitigazione: RBAC più policy per risorsa, test E2E per ogni ruolo.

### Rischio: dashboard lenta con molti dati

Mitigazione: query aggregate ottimizzate, indici, cache e pre-aggregazioni future.

### Rischio: white label difficile da mantenere

Mitigazione: design tokens e CSS variables generate da tenant settings.

### Rischio: UX calendario poco fluida

Mitigazione: lazy loading, virtualizzazione dove utile, API per range date, skeleton loading.

---

## 20. Decisioni aperte

1. Definire il provider pagamento prioritario per la predisposizione: Stripe, Nexi, PayPal o altro.
2. Stabilire se la registrazione cliente è obbligatoria, opzionale o disattivata per default.
3. Definire quali canali notifica abilitare nel primo rilascio effettivo: email, Telegram, WhatsApp o solo predisposizione tecnica.
4. Supportare una sola sede o predisporre subito multi-sede.
5. Stabilire se la prenotazione pubblica conferma automaticamente o sempre su approvazione per default.
6. Definire profondità della gestione prodotti: catalogo semplice, prodotti associati a servizi o magazzino base.
7. Definire se dashboard fatturato usa prezzi finali vendita, appuntamenti completati o entrambi.
8. Definire policy default di disdetta e relativi limiti temporali.

---

## 21. Raccomandazione MVP

Per una prima versione solida, conviene costruire un MVP con:

* landing SaaS;
* registrazione azienda/tenant;
* multi-tenant base;
* white label essenziale;
* auth owner/collaborator;
* servizi;
* collaboratori;
* clienti;
* calendario titolare;
* calendario collaboratore con policy;
* appuntamenti interni;
* booking pubblico configurabile;
* storico cliente;
* prodotti e vendite semplici;
* prodotti associabili ai servizi;
* registrazione cliente opzionale;
* disdetta appuntamenti;
* notifiche configurabili con history;
* predisposizione pagamenti;
* dashboard fatturato base con filtri;
* audit log completo sulle azioni principali.

Sale, postazioni, prodotti configurabili avanzati e dashboard dettagliate possono essere implementati subito nella struttura dati, ma rilasciati progressivamente nell’interfaccia.
