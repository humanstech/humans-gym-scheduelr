# Ambiente locale

Prerequisiti: Docker con Compose v2, Python 3.10+ e Node indicato in `.nvmrc`.
Le credenziali locali sono generate casualmente; non si usano più il progetto
Supabase remoto e la password che erano fissati nei vecchi test.

## Avvio completo

```bash
git switch develop
npm ci
bash scripts/local.sh up
```

Il comando genera `.env.stack.local` se manca (a un file esistente aggiunge solo
le chiavi mancanti `DEV_LOGIN_PASSWORD` e `ADDITIONAL_REDIRECT_URLS`, senza
rigenerare i segreti), avvia il backend, applica le migrazioni una sola volta,
inserisce il seed, costruisce il frontend e crea gli utenti di prova.

- App compilata: http://localhost:8080
- API: http://localhost:8080
- Email locali (Mailpit): http://localhost:8025

### Accesso rapido (nessuna email)

La build locale mostra sotto il login il riquadro **Accesso rapido · solo
ambiente locale**: un clic entra con uno dei profili, con la password casuale
`DEV_LOGIN_PASSWORD` di `.env.stack.local`. Per cambiare profilo, uscire e
sceglierne un altro.

| Profilo | Email | Ruolo |
|---|---|---|
| Marco Ciotoli | `ADMIN_EMAIL` (`marco.ciotoli@humans.tech`) | Admin + PT |
| Anna Rossi | `anna.rossi@humans.tech` | Iscritta PT |
| Luca Bianchi | `luca.bianchi@humans.tech` | Iscritto PT |
| Sara Verdi | `sara.verdi@humans.tech` | Iscritta PT |
| Giulia Neri | `giulia.neri@humans.tech` | Utente senza PT |
| Paolo Trainer | `trainer.pt@example.com` | Trainer |

Per ricreare utenti e dati di prova (idempotente, anche su un DB già avviato):

```bash
bash scripts/local.sh dev-users
```

Esegue `supabase/dev/00_*.sql`, crea o aggiorna gli utenti tramite l'API admin
di GoTrue (email già confermata) e poi esegue gli altri `supabase/dev/*.sql` in
ordine. Uno script che fallisce, ad esempio perché le tabelle PT non esistono
ancora, viene segnalato e saltato; lo stesso vale per l'utente trainer. Rifiuta
di girare se `SUPABASE_PUBLIC_URL`/`SITE_URL` non sono localhost.

Il riquadro esiste solo con `VITE_DEV_LOGIN=true`, impostato esclusivamente da
`deploy/local.yml`: la build fallisce se il flag è attivo con un URL Supabase
non localhost, e nelle altre build il codice viene eliminato. `deploy/local.yml`
fissa inoltre l'SMTP su Mailpit, quindi lo stack locale non può usare Resend.

In alternativa (fallback) resta il magic link: inserire l'email nel form e
aprire il messaggio in Mailpit. In locale Google è disabilitato; il provider va
configurato esplicitamente in produzione. Sono ammessi gli indirizzi
`@humans.tech`.

La configurazione e i dati locali sono separati dalla produzione. `down` ferma
lo stack mantenendo i volumi:

```bash
bash scripts/local.sh down
```

Lo stack locale ora usa il progetto Compose `gym-local`. Eventuali volumi del
precedente progetto `slokta-local` restano separati e non vengono eliminati.
Fermare il vecchio stack prima di avviare il nuovo, per liberare le porte.

## Sviluppo con Vite

Con lo stack avviato:

```bash
bash scripts/local.sh dev-env   # scrive .env.local (ignorato da git)
npm run dev                     # http://localhost:5173
```

`.env.local` contiene solo URL locale, `ANON_KEY`, `VITE_DEV_LOGIN=true` e la
password locale; le altre righe già presenti vengono mantenute. Non contiene mai
`SERVICE_ROLE_KEY`. L'ambiente locale consente il callback sia su
`localhost:8080` che su `localhost:5173`. I test browser usano la build Docker
sulla porta 8080.

`scripts/bundle.py --development` usa `.env.stack.local` e rifiuta backend non
localhost: un'immagine di sviluppo non può puntare alla produzione.

## Test

```bash
npm run check
npm run test:db
python3 -m unittest discover -s scripts/tests -v
npx playwright install chromium
npm run test:e2e
```

`test:db` crea e distrugge un container PostgreSQL isolato. Verifica RLS, accessi,
revoca, autorizzazioni admin, privacy delle prenotazioni, capienza concorrente,
limite giornaliero concorrente, cancellazione e festività. Usa il contratto Auth
minimo in `supabase/tests/bootstrap.sql`; l'integrazione con i servizi Supabase
reali e il gateway è verificata separatamente dallo stack locale e da Playwright.

Playwright legge `.env.stack.local`, crea account e uno spazio temporanei e li
rimuove al termine. Rifiuta host diversi da localhost/127.0.0.1. Gli account non
richiedono password fisse. Verifica login obbligatorio, admin, prenotazione,
cancellazione, ricaricamento delle rotte e uso da mobile.

## Database

`supabase/migrations/` è l'unica sequenza di migrazioni eseguibile. Il runner
registra checksum e versione, serializza le migrazioni e le applica in una
transazione. Non modificare file già applicati: aggiungere un nuovo file SQL.

`supabase/legacy/` conserva gli script storici incompleti solo come riferimento.
Non eseguirli sul nuovo database. Il seed non viene rieseguito dai deploy di
produzione dopo il bootstrap.

Le prenotazioni passano dalle RPC `create_booking` e `cancel_booking`; l'identità
viene ricavata dalla sessione sul server. `get_slot_bookers` restituisce soltanto
nome, avatar e slot, mentre le righe private sono visibili al proprietario e agli
admin. Il realtime segue gli aggiornamenti degli slot, senza rendere pubbliche
le email delle prenotazioni.
