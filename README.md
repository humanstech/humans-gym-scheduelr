# Gym

Gym è l’app di prenotazione dell’ecosistema **humans.tech**, con dominio
di produzione **https://gym.humans.tech**.

Prenotazione degli spazi aziendali: React, TypeScript e Vite; backend Supabase
self-hosted su EC2 (PostgreSQL, Auth, PostgREST, Realtime e pg_cron).

- **Sviluppo:** branch `develop`.
- **Produzione:** solo l'ultimo commit di `main` che supera la CI.
- **Procedura di produzione:** [docs/PRODUCTION.md](docs/PRODUCTION.md).
- **Configurazione locale:** [SETUP.md](SETUP.md).

## Controlli

```bash
npm ci
npm run lint
npm run build      # richiede le due variabili VITE_SUPABASE_*
npm run test:db    # PostgreSQL temporaneo in Docker; non usa dati reali
python3 -m unittest discover -s scripts/tests -v
```

La CI esegue un solo job Linux su push a `develop` e `main`, con cache npm e
cancellazione delle esecuzioni superate. Le immagini ARM64 vengono costruite
fuori dalla produzione e trasferite in un bundle verificato. Il timer EC2
controlla `main`, la sua CI e la presenza del bundle completo prima del deploy.
Nessuna compilazione sul server condiviso e nessuna chiave SSH su GitHub.

Gym usa un solo ingresso `127.0.0.1:18200`; l’edge condiviso gestisce HTTPS.
App e API condividono `https://gym.humans.tech`. I backup automatici sono
**disabilitati per scelta del proprietario**; resta il comando manuale.

Per completare login ed email: [docs/CREDENTIALS.md](docs/CREDENTIALS.md).
