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

Il comando genera `.env.stack.local` se manca, avvia il backend, applica le
migrazioni una sola volta, inserisce il seed e costruisce il frontend.

- App compilata: http://localhost:8080
- API: http://localhost:8000
- Email locali (Mailpit): http://localhost:8025

In locale Google è disabilitato. Per accedere, aprire **Sei un ospite?**, inserire
`marco.ciotoli@humans.tech` e aprire il magic link ricevuto in Mailpit. Questo
account è amministratore nel seed. Sono ammessi gli indirizzi `@humans.tech`.
Il provider Google va configurato esplicitamente in produzione.

La configurazione e i dati locali sono separati dalla produzione. `down` ferma
lo stack mantenendo i volumi:

```bash
bash scripts/local.sh down
```

Lo stack locale ora usa il progetto Compose `gym-local`. Eventuali volumi del
precedente progetto `slokta-local` restano separati e non vengono eliminati.
Fermare il vecchio stack prima di avviare il nuovo, per liberare le porte.

## Sviluppo con Vite

Copiare `.env.example` in `.env.local` e impostare `VITE_SUPABASE_URL` a
`http://localhost:8000`. Copiare **solo** il valore `ANON_KEY` da `.env.stack.local`
in `VITE_SUPABASE_ANON_KEY`. Non usare `SERVICE_ROLE_KEY`.

```bash
npm run dev
```

L'ambiente locale generato consente il callback sia su `localhost:8080` che su
`localhost:5173`. I test browser usano la build Docker sulla porta 8080.

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
