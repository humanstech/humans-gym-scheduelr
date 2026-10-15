# Personal trainer (PT)

Specifica funzionale e contratto tra database e frontend. Il database è la
fonte di verità per accessi e calcoli; il frontend non calcola importi.

## Concetti

- **Iscritto PT**: utente con un periodo di iscrizione attivo
  (`pt_memberships`, `valid_from` ≤ giorno ≤ `valid_to` o `valid_to` nullo).
  Le iscrizioni sono a periodi non sovrapposti: chiudere un periodo non
  cancella lo storico e si può riaprirne uno nuovo in futuro.
- **Trainer**: ruolo esterno (`pt_trainers`, per email come `admins`). Ha accesso
  all'app (anche fuori dai domini ammessi) ma vede solo le sedute PT e chi è
  prenotato. Non prenota e non vede importi.
- **Seduta PT**: uno slot di uno spazio esistente (es. Palestra) riservato al PT
  (`pt_sessions.status = 'active'`). Capienza = `pt_settings.max_participants`
  (4); prenotabile solo dagli iscritti PT attivi in quella data. Non viene mai
  annullata automaticamente per mancato minimo.
  - Le fasce settimanali marcate `space_time_slots.is_pt` generano sedute PT
    (`source = 'schedule'`); l'admin può convertire un singolo slot futuro
    (`source = 'manual'`).
  - Le prenotazioni PT sono indipendenti dalla regola "una prenotazione al
    giorno per spazio": non la consumano e non ne sono bloccate.
- **Annullare una seduta** (`status = 'voided'`): la seduta esce dal calcolo.
  Se lo slot non è ancora iniziato torna una fascia normale: capienza dello
  spazio, prenotabile da tutti; le prenotazioni esistenti restano.

## Regola di calcolo (per giornata, l'ordine delle sedute non conta)

Si considerano le sedute `active` della giornata. Prezzo `P` = `price_cents`
della seduta (snapshot di `pt_settings.session_price_cents` alla creazione;
un cambio prezzo vale solo per giornate non ancora chiuse).

1. **Presenze** di una seduta: prenotazioni di utenti iscritti PT attivi in quel
   giorno, meno gli esclusi dalla seduta (`pt_session_exclusions`).
2. Seduta **piena**: presenze ≥ `full_session_min` (3). **Svolta**: ≥ 1. **Vuota**: 0.
3. Sedute `billing_mode = 'custom'` ("ce la accolliamo noi"): `P` diviso tra i
   paganti scelti (`pt_session_payers`); escono dal resto del calcolo e contano
   come seduta pagata.
4. Sedute `auto`:
   - **Caso A** — esiste una seduta piena **oppure** una seduta custom:
     somma dei `P` delle sedute svolte, divisa per il totale delle presenze delle
     sedute svolte (chi è presente a due sedute paga due quote). Vuote gratis.
   - **Caso B** — nessuna seduta piena né custom, almeno una seduta `auto`:
     - **quota condivisa**: il `P` di una seduta (la prima svolta per orario, o
       la prima in assoluto se sono tutte vuote) diviso tra tutti gli iscritti PT
       attivi quel giorno, tranne chi è escluso da almeno una seduta del giorno;
     - le altre sedute svolte: somma dei loro `P` divisa per le presenze di
       **tutte** le sedute svolte del giorno;
     - le altre sedute vuote sono gratis.
5. **Centesimi**: ogni divisione distribuisce il resto 1 centesimo alla volta in
   ordine deterministico (`user_id`, poi orario), così il totale è esatto e il
   ricalcolo è stabile.

Esempi (8 iscritti, 40€): 10:00 A,B,C,D + 13:00 E,F → 13,33€ a presenza.
10:00 A,B + 13:00 vuota → 5€ a tutti. 10:00 A,B + 13:00 C → 5€ a tutti +
13,33€ ad A, B, C. Tutte vuote → 5€ a tutti.

## Wallet (registro a sola aggiunta)

`pt_wallet_entries`: saldo = somma di `amount_cents` (positivo = credito). Mai
UPDATE/DELETE. Tipi: `topup` (ricarica admin), `manual` (rettifica admin con
segno), `charge` (primo addebito di una seduta), `adjustment` (differenza dopo
un ricalcolo, con motivo).

- **Chiusura giornata**: quando è terminata l'ultima seduta `active` del giorno
  (Europe/Rome). Solo allora vengono scritti gli addebiti (cron ogni 5 minuti,
  idempotente, ultimi 14 giorni).
- **Riconciliazione** `private.pt_reconcile_day(d, reason)`: calcola l'importo
  atteso per (giorno, seduta, utente), lo confronta con quanto già registrato e
  scrive solo la differenza. Eseguita subito, nella stessa transazione, da ogni
  azione admin che tocca una giornata chiusa (annullo, ripristino, esclusione,
  paganti, iscrizioni). Le giornate non chiuse mostrano solo una stima.
- `description` è testo italiano leggibile dall'utente, es.
  `Seduta 14/10 13:00 · 40€ divisi su 3 presenze`,
  `Quota condivisa 14/10 · seduta con 2 presenze, 40€ divisi tra 8 iscritti`,
  `Rettifica 14/10 13:00 · seduta annullata dall'admin: <motivo>`.
- `details` (jsonb): `{mode: 'pooled'|'shared'|'custom', price_cents, pool_cents,
  units, presences}` per addebiti; `{reason}` per rettifiche.
- **Saldo basso**: sotto `pt_settings.low_balance_threshold_cents` (15€). Il
  saldo può essere negativo; nessun blocco delle prenotazioni.

## Contratto dati

Tabelle (lettura via PostgREST con RLS; scritture solo tramite RPC salvo dove indicato):

| Tabella | Lettura | Scrittura |
|---|---|---|
| `pt_settings` (singleton) | utenti ammessi | RPC `pt_update_settings` |
| `pt_trainers(id, email, created_at)` | admin | admin (come `allowed_emails`) |
| `pt_memberships(id, user_id, valid_from, valid_to, note, created_at)` | proprietario, admin | RPC |
| `pt_sessions(slot_id PK, status, source, price_cents, billing_mode, voided_reason, voided_at, created_at)` | utenti ammessi | RPC |
| `pt_session_exclusions(slot_id, user_id, reason, created_at)` | proprietario, admin | RPC |
| `pt_session_payers(slot_id, user_id, created_at)` | proprietario, admin | RPC |
| `pt_wallet_entries(id, user_id, amount_cents, kind, session_date, slot_id, session_start, description, details, created_at, created_by_name)` | proprietario, admin | RPC |
| `space_time_slots.is_pt boolean` | come oggi | admin (come oggi) |

Embed: `slots.select('…, pt_sessions(status)')` (FK `pt_sessions.slot_id → slots.id`, uno a uno).

RPC (tutte `SECURITY DEFINER`, `search_path = ''`, EXECUTE solo `authenticated`):

Utente / ruoli
- `is_trainer() → boolean`
- `pt_my_status() → table(is_member boolean, valid_from date, valid_to date, ever_member boolean, balance_cents int, low_balance_threshold_cents int, session_price_cents int, max_participants int)` — una riga.
- `pt_day_preview(d date) → table(slot_id uuid, status text, presences int, mode text, unit_cents int, my_cents int, members int, next_unit_cents int, day_closed boolean)` — stima corrente per le sedute del giorno (iscritti e admin). `mode`: `pooled` | `shared` | `custom` | `free` | `voided`. `unit_cents`: costo per presenza (pooled/custom) o per iscritto (shared). `my_cents`: quanto pagherebbe il chiamante per quella seduta. `next_unit_cents`: costo per presenza se si aggiungesse una persona a quella seduta (null se piena/annullata).

Trainer (anche admin)
- `pt_trainer_sessions(from_date date, to_date date) → table(slot_id uuid, date date, start_time time, end_time time, space_name text, status text, participants jsonb)` — `participants`: `[{name, avatar_url}]` ordinati per prenotazione. Intervallo massimo 120 giorni.

Admin
- `admin_list_users() → table(user_id uuid, email text, full_name text, avatar_url text, last_sign_in_at timestamptz, is_admin boolean, is_trainer boolean, pt_active boolean, pt_valid_from date, pt_valid_to date, balance_cents int)` — periodo corrente o più recente.
- `pt_save_membership(membership_id uuid, user_id uuid, valid_from date, valid_to date) → uuid` — `membership_id` nullo = nuovo periodo. Rifiuta sovrapposizioni. Ricalcola le giornate chiuse coinvolte; annulla le prenotazioni PT future fuori periodo.
- `pt_delete_membership(membership_id uuid) → void`
- `pt_add_wallet_entry(user_id uuid, amount_cents int, kind text, note text) → uuid` — `kind`: `topup` (>0) | `manual` (≠0).
- `pt_void_session(slot_id uuid, reason text) → void`
- `pt_restore_session(slot_id uuid) → void`
- `pt_create_session(slot_id uuid) → void` — converte uno slot futuro; rifiuta se ha prenotazioni di non iscritti o oltre la capienza PT.
- `pt_set_exclusion(slot_id uuid, user_id uuid, excluded boolean, reason text) → void` — l'utente può essere qualunque iscritto attivo quel giorno, anche non prenotato.
- `pt_set_payers(slot_id uuid, user_ids uuid[], reason text) → void` — array vuoto = torna `auto`.
- `pt_update_settings(session_price_cents int, low_balance_threshold_cents int, max_participants int) → void`
- `pt_sync_schedule(space_id uuid) → int` — allinea le sedute future di uno spazio alle fasce `is_pt` (crea quelle mancanti, rimuove quelle `schedule` senza più fascia; non tocca `manual` né `voided`). Da chiamare dopo il salvataggio dello spazio.
- `pt_admin_sessions(from_date date, to_date date) → table(slot_id uuid, space_id uuid, space_name text, date date, start_time time, end_time time, status text, source text, billing_mode text, price_cents int, voided_reason text, day_closed boolean, mode text, participants jsonb, exclusions jsonb, payers jsonb, charges jsonb, total_cents int)` — `participants`: `[{user_id, name, email, avatar_url, excluded, counted}]`; `exclusions`: `[{user_id, name, reason}]`; `payers`: `[{user_id, name}]`; `charges`: `[{user_id, name, amount_cents}]` (atteso; registrato se la giornata è chiusa). Intervallo massimo 120 giorni.
- `pt_low_balances() → table(user_id uuid, email text, full_name text, avatar_url text, balance_cents int, pt_active boolean)` — sotto soglia, ordinati dal saldo più basso.

Errori (messaggi `RAISE EXCEPTION` usati dal frontend per i toast):
`PT membership required`, `Slot full`, `Membership overlap`, `Session not found`,
`Admin required`, `Invalid amount`, `Slot has incompatible bookings`.

## Accesso locale rapido

Solo nella build locale (`VITE_DEV_LOGIN=true`, iniettato da `deploy/local.yml`;
la build fallisce se il flag è attivo con un URL non localhost). La pagina di
login mostra profili pronti (Admin, iscritti PT, utente, trainer) che entrano
con password locale, senza inviare email. Gli utenti di prova sono creati da
`scripts/local.sh up`.
