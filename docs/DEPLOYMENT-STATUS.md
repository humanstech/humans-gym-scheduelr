# Stato verifiche Gym — 15 ottobre 2026

**Online: https://gym.humans.tech**

Release di produzione: `4cba831a2cdbd3980f5cda34162e5768bb981f00`, merge
della [PR #6](https://github.com/humanstech/humans-gym-scheduelr/pull/6) su
`main`: promozione degli utenti ad amministratore. La CI di `main` è riuscita.
`/version.json` e lo stato del deploy indicano lo stesso SHA. Release precedente,
disponibile per il rollback: `aad2cf45da19d2da4209b15f1d87237c6df99c0a`.

## Promozione ad amministratore (15 ottobre 2026, 23:43 CEST)

Verificato in produzione:

- Deploy completato dal servizio `gym-deploy` dopo CI e verifica del bundle ARM64.
- Sei container healthy; HTTPS `/healthz`, versione frontend, Auth e REST verificati.
- Migrazione `202610150006_admin_promote_user` applicata con checksum identico al sorgente.
- RPC disponibile: una chiamata anonima viene rifiutata con HTTP 401 e codice `42501`.
- Il numero di amministratori resta uno: nessun utente reale promosso durante il rilascio.
- Immagine frontend verificata: contiene «Rendi admin», punta al backend di
  produzione ed esclude il pannello di accesso rapido locale.
- Rimosso dal server il precedente archivio di trasferimento per rispettare la
  riserva di spazio del deploy. La copia sul Mac è stata verificata tramite SHA-256;
  release e immagini necessarie al rollback sono conservate sul server.

Verificato in locale: lint, build, 39 test SQL, 33 test degli script e 5 test
Playwright, inclusi setup e teardown. Il test browser verifica annullamento,
conferma, persistenza del ruolo e accesso amministrativo dell'utente promosso.
La promozione di un account reale in produzione non è stata eseguita.

## Aggiornamento Personal Trainer (15 ottobre 2026)

Verificato in produzione:

- Il bundle ARM64 è stato costruito sul Mac. L'immagine web non contiene il
  pannello di accesso rapido né i profili di prova, e punta a `gym.humans.tech`.
- Bundle trasferito con `upload-bundle.py`; il timer ha fatto il deploy in circa 3 minuti.
- Sei container healthy dopo l'aggiornamento.
- Migrazioni `202610150004_personal_trainer` e `202610150005_pt_jobs` applicate.
- Job `gym-pt-reconcile` registrato (ogni 5 minuti).
- `gym-cancel-underfilled`, modificato dalla migrazione, termina con successo.
- Slot e prenotazioni esistenti invariati.
- Nessun dato PT presente: la funzione resta invisibile finché un admin non
  marca le fasce PT e attiva gli iscritti.
- I dati demo di `supabase/dev/` non vengono eseguiti in produzione.

Verificato in locale prima del rilascio:

- Test SQL: 11 esistenti e 25 nuovi sul PT.
- Test degli script: 33.
- Playwright: 19/19.
- Flussi PT provati nel browser con tutti i profili.

Non eseguito:

- Nessun backup manuale prima della migrazione, per scelta del proprietario
  (backup disabilitati). La migrazione è additiva e transazionale.
- Il primo accesso reale del trainer via magic link non è ancora provato.

## Verificato realmente in produzione

- EC2 `63.178.93.191`, Ubuntu ARM64, Docker 29.9.0, Compose 5.6.0.
- Bundle costruito su ARM nativo fuori dalla EC2, trasferito via SSH e verificato
  dal server: checksum, corrispondenza con main, CI e identità delle sei immagini.
  L'importazione gestisce sia gli ID config Docker classici sia gli ID manifest
  del backend containerd di Docker 29.
- Primo avvio da database vuoto: migrazioni e seed riusciti; un amministratore
  configurato (`marco.ciotoli@humans.tech`), un ambiente Palestra, 25 fasce
  settimanali e 300 slot iniziali. Dominio utenti autorizzato: `humans.tech`.
- Tutti e sei i container Gym sono healthy, `linux/arm64`, con restart
  `unless-stopped`, limiti RAM e log JSON limitati a 3 × 10 MB.
- Unico ingresso pubblicato: `127.0.0.1:18200 → 8080`; gli altri servizi non
  pubblicano porte host. `/opt/gym` root 700 e `.env` root 600.
- `/healthz` risponde `ok` via HTTPS; Auth e REST rispondono correttamente.
- Certificato valido per `gym.humans.tech`, emesso da Let's Encrypt YE2,
  scadenza 13 gennaio 2027. Emissione riuscita confermata anche nei log edge.
- `/terms`, `/privacy` e `/cookies`: HTTP 200, contenuto leggibile nel browser
  anche con JavaScript disabilitato, navigazione tra le pagine presente.
- Login pubblico, form email e link legali verificati nel browser; nessun errore
  JavaScript rilevato e nessun overflow orizzontale alla larghezza mobile 390 px.
- Connessione e sottoscrizione Realtime WebSocket riuscite attraverso il dominio
  pubblico, senza creare prenotazioni o inviare messaggi.
- `docker restart` eseguito sui soli sei container Gym, seguito da Compose
  `up -d --wait` e smoke HTTPS riusciti. Conteggi del database invariati.
- Confrontati gli orari `StartedAt` prima/dopo: nessun riavvio di edge o
  CyberMafia. Nell'edge è stato aggiunto soltanto `conf/sites/gym.caddy`, seguito
  da reload; nessuna modifica ai file globali o agli altri siti.
- Autenticazione SMTP Resend riuscita dalla EC2. Mittente configurato:
  `gym@services.humans.tech`. Nessuna email di prova inviata dall'agente.
- `gym-deploy.timer` abilitato e attivo. Una nuova esecuzione di `poll` sullo
  stesso main termina senza cambiare la release. `gym-backup.timer` disabilitato.
- Circa 6,6 GiB liberi dopo la pulizia del solo archivio Gym già importato e dei
  tag Gym inutilizzati del primo tentativo. Immagini attive, volumi e release
  conservati; bundle originale conservato sul builder locale.
- Nessun pacchetto installato, nessuna modifica a firewall, Docker daemon,
  risorse o timer degli altri progetti; nessun prune globale.

## Verificato in locale

- Lint e build frontend riusciti; 21 test degli script riusciti, inclusi controlli
  del bundle, ID OCI/config, architettura, main/CI, rollback e backup facoltativo.
- 19 casi browser verificati tra esecuzione completa e riesecuzione dei tre
  selettori corretti: login magic link con SMTP locale, autorizzazioni,
  prenotazioni, cancellazioni, amministrazione, mobile, realtime e pagine legali.
- Primo avvio su database vuoto e riavvio dello stack locale riusciti.
- Il ripristino di backup era stato provato solo in locale prima della revisione
  del deploy per la macchina condivisa; non è una prova di ripristino in produzione.

## Da completare o non eseguito

- **Google OAuth**: credenziali ancora assenti nell'env al momento del deploy;
  `GOOGLE_ENABLED=false`. L'accesso email è abilitato. Dopo la configurazione
  Google, aggiornare il solo `.env.production.local`, sincronizzarlo in
  `/opt/gym/.env` e ricreare Auth seguendo [CREDENTIALS.md](CREDENTIALS.md).
- **Consegna email e login reale**: SMTP AUTH verificata, ma consegna tramite
  Resend e apertura del magic link da parte dell'utente non ancora provate.
  Non è stata verificata via API la configurazione del dominio mittente:
  la chiave disponibile ha permessi limitati all'invio.
- **Backup/ripristino su EC2**: non eseguiti; backup automatici e pre-deploy
  disabilitati per scelta esplicita del proprietario. Nessuna copia S3.
- Nessuna prova di carico o revisione legale professionale delle informative.

## Aggiornamenti successivi

Sviluppo su `develop`, PR e CI obbligatoria per `main`. Preparazione e upload del
bundle sul builder restano un passaggio dell'operatore; il timer sul server
pubblica solo il main approvato dalla CI quando il relativo bundle è disponibile.
GitHub non costruisce immagini Docker e la EC2 non esegue build o emulazione.
Procedura completa: [PRODUCTION.md](PRODUCTION.md).

URL per Google: homepage `https://gym.humans.tech/login`, privacy
`https://gym.humans.tech/privacy`, termini `https://gym.humans.tech/terms`.
Cookie policy aggiuntiva: `https://gym.humans.tech/cookies`.
