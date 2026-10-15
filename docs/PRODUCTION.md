# Produzione su EC2

Destinazione: **https://gym.humans.tech**, API **https://gym-api.humans.tech**.
Primo amministratore: **marco.ciotoli@humans.tech**. Installazione su database
vuoto; nessun dato viene importato dal vecchio Supabase.

## 1. Branch e CI/CD

Il lavoro si pusha su `develop`. Per rilasciare si apre una PR `develop → main`.
La produzione segue solo `main`; non si fa mai deploy da `develop`.

```bash
git switch develop
git pull --ff-only origin develop
# modifiche e controlli locali
git add <file>
git commit -m "Descrizione della modifica"
git push origin develop
gh pr create --base main --head develop
```

La CI è `.github/workflows/ci.yml`: un solo job `verify`, runner Linux standard,
cache npm, timeout 10 minuti, esecuzioni obsolete cancellate. Parte sui push
ai due branch e manualmente. Non parte anche sulle PR, evitando la doppia
esecuzione per lo stesso push a `develop`. Il commit di merge su `main` viene
verificato di nuovo. I test browser completi si eseguono in locale prima di
promuovere modifiche a UI, Auth o database.

Configurare la protezione di `main` in GitHub:

- richiedere una PR e il controllo `verify`;
- richiedere che il branch sia aggiornato rispetto a `main`;
- bloccare force push e cancellazione;
- applicare le regole anche agli amministratori;
- usare **merge commit** e non eliminare `develop` dopo il merge.

Dopo il merge riallineare lo sviluppo:

```bash
git switch develop
git fetch origin
git merge --ff-only origin/main
git push origin develop
```

Il deploy su EC2 è un timer, non un runner GitHub: ogni due minuti legge `main`,
controlla la riuscita del workflow CI per **quello stesso SHA**, costruisce
l'immagine, salva un backup, applica le migrazioni e verifica il servizio pubblico.
Non richiede porte aperte per webhook, SSH da GitHub o credenziali AWS su GitHub.

Se `main` ha una CI in corso o fallita, resta online l'ultima release valida di
`main`. Un commit che fallisce il deploy non viene ritentato continuamente:
correggere `main` oppure eseguire `retry` dopo aver risolto la causa. Non viene
accettato uno SHA arbitrario o un branch diverso per un rilascio.

Il repository è pubblico e i runner standard sono gratuiti. Il deploy non usa
minuti GitHub. Il primo download Docker su EC2 è più lento dei successivi, che
riutilizzano la cache. Il polling senza token usa l'API pubblica soltanto quando
cambia lo SHA; un token in sola lettura è facoltativo per aumentare i limiti API.
Se il repository diventa privato, configurare anche l'autenticazione Git in sola
lettura sulla macchina: il token API da solo non abilita `git fetch`.

## 2. Creare EC2 e DNS

- Ubuntu Server **24.04 LTS**, x86_64; 4 vCPU e almeno 8 GB RAM consigliati.
- EBS gp3 cifrato, almeno 80 GB. I volumi Docker sono sotto `/var/lib/docker`:
  disabilitare la cancellazione del volume dati alla terminazione dell'istanza.
- Scegliere una regione UE e usare la stessa per SES e il bucket backup.
  `eu-west-1` nel generatore è un valore iniziale da confermare.
- Elastic IP e record DNS A `gym.humans.tech` e `gym-api.humans.tech` verso l'IP.
  Non creare record AAAA senza IPv6 funzionante sull'istanza.
- Security Group: TCP 80 e 443 pubblici. Non esporre 5432, 8000, 9999 o 4000.
- Accesso amministrativo preferibilmente via SSM Session Manager. Associare un
  instance profile con `AmazonSSMManagedInstanceCore`; verificare SSM Agent e
  connettività HTTPS in uscita. Se si usa temporaneamente SSH, limitare 22 al
  proprio IP.

Una EC2 singola non offre alta disponibilità. Un deploy può interrompere le
connessioni durante il riavvio dei container. Backup giornaliero: perdita dati
potenziale fino a 24 ore in caso di perdita totale dei volumi; ridurre l'intervallo
o introdurre backup continui se questo requisito non è sufficiente.

## 3. Bucket backup e ruolo IAM

Creare un bucket S3 privato, con blocco accesso pubblico, cifratura SSE-S3,
versioning e lifecycle (ad esempio 30 giorni per i dump, gestione esplicita anche
delle versioni non correnti). Associare al ruolo EC2 la policy
`deploy/backup-policy.json`, sostituendo `REPLACE_BACKUP_BUCKET` con il nome reale.
Il prefisso previsto è `gym/`. Non servono access key AWS salvate nei file.

Il backup comprende database e account Auth. Conservare separatamente una copia
cifrata di `/etc/slokta/production.env` in un secret manager/archivio aziendale:
contiene chiavi JWT e credenziali necessarie al ripristino. Non salvarla nel repo.

## 4. Preparare la macchina

Eseguire sulla EC2, dopo aver portato questa implementazione su `main`:

```bash
git clone --branch main https://github.com/humanstech/humans-gym-scheduelr.git
cd humans-gym-scheduelr
sudo bash scripts/bootstrap-ec2.sh
sudo python3 scripts/make-env.py --output /etc/slokta/production.env
sudoedit /etc/slokta/production.env
```

L'installer prepara Docker, Compose, AWS CLI e servizi systemd, ma non li abilita.
Il generatore crea segreti casuali, scrive il file con permessi 600 e rifiuta di
sovrascriverlo. Non rigenerare i segreti di un database già inizializzato: cambiare
solo il file non ruota le password già memorizzate nel database.

Completare almeno:

| Variabile | Valore |
| --- | --- |
| `APP_DOMAIN` / `SITE_URL` | `gym.humans.tech` / `https://gym.humans.tech` |
| `API_DOMAIN` / `SUPABASE_PUBLIC_URL` | `gym-api.humans.tech` / `https://gym-api.humans.tech` |
| `ADMIN_EMAIL` | `marco.ciotoli@humans.tech` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Credenziali del client OAuth web |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | Endpoint SES della regione, porta 587, credenziali SMTP SES |
| `SMTP_FROM` | Mittente verificato, ad esempio `gym@humans.tech` |
| `AWS_REGION` | Regione effettiva |
| `BACKUP_S3_URI` | `s3://NOME_BUCKET/gym` |

Valori con caratteri speciali o spazi vanno racchiusi tra apici singoli; non usare
interpolazioni shell nel file. I segreti generati sono già compatibili con le URL
PostgreSQL. Lasciare `HTTP_BIND=80:80`, `HTTPS_BIND=443:443` e `GOOGLE_ENABLED=true`.

## 5. Google e magic link

In Google Cloud configurare il client OAuth di tipo web:

- origine JavaScript autorizzata: `https://gym.humans.tech`;
- redirect URI: **`https://gym-api.humans.tech/auth/v1/callback`**.

Il callback Google è sul backend; `https://gym.humans.tech/auth/callback` è il
ritorno all'app ed è già incluso nell'allowlist Auth. Sono due URL diversi.

In SES verificare il dominio mittente e pubblicare i record DNS richiesti
(DKIM e configurazione SPF/MAIL FROM applicabile). Richiedere l'uscita dalla
sandbox nella regione scelta per inviare anche a destinatari non verificati.
Usare credenziali **SMTP SES**, non le access key IAM generiche. Verificare anche
che la configurazione del consenso Google consenta agli utenti previsti il login.

## 6. Primo avvio

Il commit corrente di `main` deve avere una CI verde. DNS, Google, SMTP e S3 devono
essere configurati prima di procedere.

```bash
sudo python3 /opt/slokta/tools/production.py bootstrap
sudo python3 /opt/slokta/tools/production.py status
sudo python3 /opt/slokta/tools/production.py backup
```

Il bootstrap installa lo schema vuoto, crea l'amministratore nella lista di
accesso, abilita `humans.tech`, crea Palestra con fasce lun–ven e genera 90 giorni
di slot. L'account Auth viene creato al primo login, senza password predefinita.
Caddy emette e rinnova i certificati automaticamente; 80/443 e DNS devono essere
raggiungibili. La pagina `/version.json` espone lo SHA effettivamente servito.

Se il comando stampa che sta aspettando la CI, il bootstrap non è ancora
avvenuto: attendere la CI e ripetere. Verificare che `status` riporti uno SHA e
che login, prenotazione e cancellazione funzionino prima di abilitare i timer:

```bash
sudo systemctl enable --now slokta-deploy.timer slokta-backup.timer
systemctl list-timers 'slokta-*'
```

## 7. Rilasci successivi e diagnostica

Push su `develop`, CI verde, PR e merge su `main`. Nessun comando sulla macchina
è necessario per i rilasci ordinari. Prima delle migrazioni viene salvato un dump
locale e caricato su S3; un errore nel backup interrompe il deploy.

```bash
sudo python3 /opt/slokta/tools/production.py status
sudo journalctl -u slokta-deploy.service -n 100 --no-pager
sudo journalctl -u slokta-backup.service -n 100 --no-pager
sudo python3 /opt/slokta/tools/production.py retry
```

Per usare Compose sulla release attiva, preservare lo SHA dell'immagine:

```bash
cd /opt/slokta/current
release_sha=$(basename "$(readlink -f /opt/slokta/current)")
sudo python3 scripts/stack.py compose --env-file /etc/slokta/production.env \
  --sha "$release_sha" -- ps
```

Verificare periodicamente spazio disco, memoria, stato container, errori dei
servizi systemd, presenza e data dei backup S3. Configurare allarmi CloudWatch per
EC2 StatusCheckFailed e, con CloudWatch Agent, memoria/disco e log systemd.
I log Docker ruotano automaticamente (3 file da 10 MB per servizio).

Controllare i job SQL via SSM/Compose:

```bash
sudo python3 scripts/stack.py compose --env-file /etc/slokta/production.env \
  --sha "$release_sha" -- exec -T db psql -U postgres -d postgres -c \
  "SELECT jobname,schedule,active FROM cron.job"
```

`slokta-generate-slots` gira alle 03:00 UTC; `slokta-cancel-underfilled` ogni minuto.
Date e soglia di 15 minuti sono calcolate in `Europe/Rome` nel database, inclusa
l'ora legale. Controllare gli errori recenti in `cron.job_run_details`.

## 8. Rollback

Il deploy conserva la release precedente e torna ad essa automaticamente se
l'avvio o i controlli HTTP falliscono. Le migrazioni del database già applicate
restano in vigore: scrivere migrazioni compatibili con la versione precedente
(aggiungere prima, rimuovere solo in un rilascio successivo). Gli aggiornamenti
major di PostgreSQL richiedono una procedura dedicata e non un normale merge.

Per un rollback applicativo duraturo, creare un **revert su develop**, verificarlo
e promuoverlo su main. In questo modo la produzione continua a seguire main.
Non resettare/forzare il branch e non modificare a mano i file nella release.

In emergenza fermare il timer prima di intervenire:

```bash
sudo systemctl stop slokta-deploy.timer
```

Per recuperare un deploy fermato da timeout, verificare i container e il journal,
poi usare `retry`: accetta comunque solo il main corrente con CI verde. Riabilitare
il timer quando lo stato è coerente. Lo stop del timer non ferma un deploy già in
corso: attendere che `slokta-deploy.service` termini prima di fare manutenzione.

## 9. Backup e ripristino

I dump sono in `/opt/slokta/backups/`, permessi privati, e sul prefisso S3.
Il backup giornaliero rimuove i dump locali più vecchi di 7 giorni; il lifecycle
S3 gestisce la retention remota. Conservare le ultime release/immagini per il
rollback e rimuovere periodicamente quelle obsolete, senza cancellare volumi.

Provare il restore su una **seconda EC2 isolata**, con la stessa versione dello
stack e i segreti salvati. Non ripristinare direttamente sul database in uso:

1. Fermare i timer sulla macchina di destinazione. Usare la stessa versione
   dello stack del backup e il file di segreti salvato.
2. Avviare `db auth rest realtime` con Compose e attendere lo stato healthy:
   questo inizializza anche i ruoli interni dei servizi. Non avviare `web`.
3. Fermare `auth rest realtime`; mantenere soltanto `db`. Scaricare il dump S3.
4. Ricreare il database di destinazione da `template0` e ripristinare il dump in
   una transazione, come sotto. È una procedura **distruttiva**, da eseguire
   esclusivamente sulla macchina isolata destinata al ripristino.
5. Verificare utenti, prenotazioni, policy, migrazioni e `cron.job`; riavviare i
   servizi e controllare login e prenotazioni prima di spostare il DNS.

Esempio sulla macchina di ripristino, dalla directory della release del backup:

```bash
# Definire il percorso del dump scaricato da S3.
backup_file=/opt/slokta/backups/backup-DA-RIPRISTINARE.dump
compose=(sudo docker compose --project-name slokta \
  --env-file /etc/slokta/production.env -f deploy/compose.yml)
"${compose[@]}" up -d --wait db auth rest realtime
"${compose[@]}" stop auth rest realtime
"${compose[@]}" exec -T db pg_restore --list < "$backup_file"
# ATTENZIONE: distrugge il database postgres della macchina di destinazione.
"${compose[@]}" exec -T db psql -X -U supabase_admin -d template1 \
  -v ON_ERROR_STOP=1 \
  -c 'DROP DATABASE postgres WITH (FORCE)' \
  -c 'CREATE DATABASE postgres OWNER postgres TEMPLATE template0'
"${compose[@]}" exec -T db pg_restore -U supabase_admin -d postgres \
  --single-transaction --exit-on-error < "$backup_file"
```

Usare `supabase_admin` per mantenere proprietari e privilegi degli oggetti Auth e
Realtime. Non usare `--no-owner` e non fare `--clean` su uno schema Supabase già
popolato: trigger di sistema e partizioni Realtime richiedono il ripristino su un
database vuoto. La transazione mantiene disabilitati gli effetti dei job
ripristinati fino al completamento del restore. Ricostruire quindi l'immagine
con lo SHA originale e usare lo stesso `RELEASE_SHA` per avviare `web`; verificare
`/version.json`. Il nuovo host deve avere il suo `deployed.json` coerente prima
di riabilitare il polling: il percorso ordinario è il bootstrap sul main
validato dopo il restore, con migrazioni e seed idempotenti.

Gli oggetti Auth sono inclusi nel dump. Per preservare la validità dei token
servono le stesse chiavi; in caso di rotazione pianificare un nuovo login degli
utenti. Lo stack non usa Supabase Storage: non ci sono file applicativi da migrare.
I certificati possono essere riemessi; i dati PostgreSQL non devono dipendere dal
ciclo di vita di una release Git.

## Riferimenti

- [Supabase self-hosting](https://supabase.com/docs/guides/self-hosting/docker)
- [Google OAuth self-hosted](https://supabase.com/docs/guides/self-hosting/self-hosted-oauth)
- [SES produzione](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html)
- [Session Manager](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager.html)
- [GitHub Actions billing](https://docs.github.com/en/actions/concepts/billing-and-usage)
