# Gym sulla macchina condivisa

Destinazione confermata: **https://gym.humans.tech**, EC2 ARM64
**63.178.93.191**, ingresso assegnato **127.0.0.1:18200 → 8080**.
Frontend e API usano lo stesso dominio. Il callback Google è
`https://gym.humans.tech/auth/v1/callback`. Mittente: `gym@services.humans.tech`.

## Architettura e limiti

L’edge condiviso termina TLS. Gym non pubblica 80/443, non emette certificati,
non usa reti di altri progetti e non risponde sull’IP pubblico senza il dominio.
Il suo Caddy HTTP instrada `/auth/v1/*`, `/rest/v1/*` e `/realtime/v1/*` al gateway
privato; serve la SPA sulle altre rotte e `/healthz` per il controllo pubblico.

I proxy accettano gli header di inoltro soltanto da reti private/loopback.
Il sito edge sostituisce X-Forwarded-For con l’IP del peer e imposta HTTPS;
il proxy Gym ricostruisce l’IP inoltrato e rimuove l’header Forwarded alternativo.
Configurazione basata sulle [opzioni Caddy](https://caddyserver.com/docs/caddyfile/options).

Ogni servizio ha piattaforma `linux/arm64`, healthcheck, restart unless-stopped,
log JSON limitati a 3 × 10 MB e limite RAM:

| Servizio | Limite |
| --- | --- |
| PostgreSQL | 768 MiB |
| Auth | 128 MiB |
| PostgREST | 192 MiB |
| Realtime | 512 MiB |
| Kong | 256 MiB |
| Web | 96 MiB |

Totale massimo configurato: 1.906 GiB, oltre alla memoria del daemon/host.
Questi limiti sono stati provati in locale, non costituiscono una prova di carico
sulla macchina condivisa. Dati persistenti: volumi `gym_db-data` e `gym_db-config`.
Non eliminare i volumi durante aggiornamenti o rollback.

## Directory e segreti

`/opt/gym` appartiene a root, modalità 700:

- `.env`: unica configurazione runtime, permessi 600;
- `releases/<SHA>/`: codice e riferimenti immagini di una release, non modificare;
- `current`: symlink aggiornato solo dopo lo smoke HTTPS;
- `incoming/<SHA>/`: bundle completo, pubblicato tramite rename atomico;
- `tools/`: script verificati usati dai servizi;
- `logs/`, `backups/`: solo dati Gym;
- `deploy.lock`: flock comune a deploy, backup ed aggiornamento del sito edge.

Il proprietario compila **`.env.production.local` sul Mac**. L’agente sincronizza
quel file via SSH in `/opt/gym/.env`, senza mostrarne il contenuto. Non occorre
un file per Resend o per Google. Vedere [CREDENTIALS.md](CREDENTIALS.md).
Non cambiare password DB/JWT dopo il primo avvio senza una procedura di rotazione.

## Flusso develop → main e CI minima

1. Sviluppo e push su `develop`; una sola CI per push.
2. PR verso `main`; check `verify` obbligatorio. Non fare push diretto su main.
3. Dopo il merge, attendere la CI del commit su `main`.
4. Sul Mac ARM o su un builder esterno, creare il bundle di quel main.
5. Trasferire il bundle completo. Il timer EC2 verifica main, la CI dello stesso
   SHA, checksum, codice, configurazione pubblica e immagini ARM64; poi effettua
   il deploy. Se manca il bundle, attende senza modificare il servizio.

GitHub esegue lint, build, test degli script e test SQL. Non esegue build Docker,
Playwright o upload di immagini. La preparazione/trasmissione del bundle è un
passaggio dell’operatore sul builder: il solo merge non produce un bundle.
Questa scelta evita build sulla EC2 condivisa e ulteriori minuti CI. Nessuna
chiave SSH di produzione viene installata su GitHub o su runner self-hosted.

## Preparare e trasferire il bundle

Sul Mac, dal repository aggiornato:

```bash
python3 scripts/bundle.py --env-file .env.production.local --output /tmp/gym-bundles
```

Lo script preleva `origin/main` in un checkout temporaneo, costruisce con
`buildx --platform linux/arm64 --load`, assegna a tutte le immagini tag
`gym-<servizio>:<SHA>` ed esporta `images.tar.gz`, `source.tar` e `bundle.json`.
Passa al build solo URL e chiave anon pubblica, non gli altri valori dell’env.
Verifica il bundle prima di dichiararlo pronto. `--development` serve solo per
prove locali: produce un bundle che la produzione rifiuta.

I checksum rilevano alterazioni e trasferimenti incompleti; non sono una firma
del builder. L’autenticità dipende dall’accesso SSH e dalla directory root-only.
Le immagini devono essere costruite da un operatore autorizzato. Il codice nel
bundle viene confrontato con l’archivio Git dell’esatto main approvato dalla CI.

Per trasferire il bundle (sostituire `<SHA>` con quello stampato dal builder):

```bash
python3 scripts/upload-bundle.py /tmp/gym-bundles/<SHA> \
  --ssh-key deploy/ext-backend.pem --env-file .env.production.local
```

Lo script trasferisce solo i tre file del bundle; non trasferisce l’env. La
sincronizzazione dell’env viene fatta separatamente dall’agente, via SSH e sotto
lo stesso lock, dopo che il proprietario ha salvato le credenziali.

Il trasferimento deve scrivere prima in una directory temporanea sotto
`/opt/gym/incoming`, proprietà root, e rinominarla in `<SHA>` solo al completamento.
Non scrivere mai in una release esistente né sovrascrivere un bundle pubblicato.
Non eseguire tar o Docker su file ricevuti da fonti non autorizzate.

## Primo avvio

Prerequisiti già presenti sul server: Ubuntu ARM64, Docker/Compose, Python 3.12+,
git, ss, flock. Lo script **non installa pacchetti**, non cambia firewall,
Docker daemon o sysctl. Eseguire da una copia del main verificato:

```bash
sudo bash scripts/bootstrap-ec2.sh
```

Crea solo directory Gym, file env se assente e unità `gym-*`. I timer restano
spenti. Completare/sincronizzare il file env, trasferire il bundle main, quindi:

```bash
sudo bash scripts/publish-edge.sh
sudo python3 /opt/gym/tools/production.py bootstrap
sudo python3 /opt/gym/tools/production.py status
```

`publish-edge.sh` scrive esclusivamente `/opt/edge/conf/sites/gym.caddy` (644),
esegue il reload indicato dal proprietario e ripristina/rimuove il proprio file
se il reload fallisce. Non ricrea il container edge. Il primo avvio può mostrare
502 per Gym tra l’inserimento della rotta e l’avvio dello stack.

Il deploy controlla porta libera (oppure proprietà del container Gym già attivo),
architettura nativa, permessi e spazio libero. Carica il bundle senza build o
pull, inizializza DB e Auth (che crea tabelle e funzioni di autenticazione), applica le migrazioni
applicative e avvia con `docker compose up -d --wait`.
Il seed iniziale abilita `humans.tech` e l’amministratore
`marco.ciotoli@humans.tech`. Lo smoke verifica HTTPS, `/healthz`, SHA del frontend,
Auth e REST. Solo dopo aggiorna `current` e lo stato della release.

Se lo smoke fallisce, ripristina i container della release precedente; le
migrazioni DB restano applicate. Usare solo migrazioni compatibili con la release
precedente. Sul primo bootstrap fallito non esiste una release precedente.
Un fallimento registra lo SHA e impedisce tentativi ripetuti dal timer.

Dopo avere verificato login, email e realtime:

```bash
sudo systemctl enable --now gym-deploy.timer
sudo journalctl -u gym-deploy.service -n 50 --no-pager
```

Per ritentare lo stesso main dopo aver risolto un errore:

```bash
sudo python3 /opt/gym/tools/production.py retry
```

## Backup: disabilitati per scelta del proprietario

La richiesta successiva del proprietario esclude i backup dai prerequisiti.
`BACKUP_BEFORE_DEPLOY=false`; **non abilitare `gym-backup.timer`**. Nessun bucket
S3 o credenziale AWS è necessario. Il rollback non ripristina dati persi o
modificati dalle migrazioni.

Resta disponibile, se richiesto, il backup manuale:

```bash
sudo python3 /opt/gym/tools/production.py backup
```

Produce un dump PostgreSQL in `/opt/gym/backups`, privato, verificato con
`pg_restore --list`. Il comando elimina i dump locali più vecchi di 7 giorni dopo
un nuovo backup riuscito. S3 resta opzionale e richiede AWS CLI e permessi, da
concordare prima di installare qualsiasi pacchetto. Impostare
`BACKUP_BEFORE_DEPLOY=true` riattiva il backup prima delle migrazioni successive;
la sua riuscita diventa allora obbligatoria.

Un vero ripristino richiede un database isolato con le stesse versioni e ruoli.
Non usare `pg_restore --clean` sul database attivo. La prova di ripristino
precedente alla revisione di questo deploy è avvenuta solo in locale; nessun
ripristino è stato eseguito sulla produzione condivisa.

## Verifiche da registrare dopo il deploy

```bash
curl -fsS https://gym.humans.tech/healthz
curl -fsS https://gym.humans.tech/version.json
sudo docker compose --project-name edge --project-directory /opt/edge \
  --env-file /opt/edge/.env -f /opt/edge/compose.yml logs --tail 50 caddy
```

Controllare nei log l’emissione del certificato per Gym. Per verificare la
persistenza al riavvio, in una finestra concordata riavviare **solo** i container
con label `com.docker.compose.project=gym` e ricontrollare HTTPS, login e dati.
Non riavviare edge o CyberMafia. Registrare l’esito effettivo in
[DEPLOYMENT-STATUS.md](DEPLOYMENT-STATUS.md), distinguendo prove locali e reali.

## Disco e manutenzione

Il deploy richiede spazio per importare il bundle più una riserva di 2 GiB;
non libera spazio automaticamente. Il controllo è prudenziale e può richiedere
pulizia anche quando alcuni layer sono già presenti. Dopo un rilascio riuscito,
eliminare solo bundle Gym trasferiti e immagini `gym-*:<SHA>` non più necessari,
conservando la release corrente e la precedente per il rollback. Rimuovere i tag
esatti con `docker image rm`, mai usare prune globale. I layer condivisi ancora
referenziati dagli altri progetti rimangono presenti.

Non modificare `/opt/cybermafia`, le reti, i volumi o i timer altrui, né i file
globali dell’edge. Non cambiare la porta assegnata senza il proprietario.
