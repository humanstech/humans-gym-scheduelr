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
cancellazione delle esecuzioni superate. Non esegue Playwright né pubblica
immagini/artifact ad ogni push. Il deploy è un servizio systemd su EC2 che
controlla `main` ogni due minuti, verifica la CI per lo stesso SHA e costruisce
l'immagine sulla macchina. Nessuna credenziale AWS viene salvata su GitHub.

Il repository è pubblico: i runner GitHub standard sono gratuiti secondo la
[documentazione GitHub](https://docs.github.com/en/actions/concepts/billing-and-usage).
L'architettura riduce comunque il tempo dei job e continua a funzionare se il
repository diventa privato, configurando allora l'accesso in lettura da EC2.
