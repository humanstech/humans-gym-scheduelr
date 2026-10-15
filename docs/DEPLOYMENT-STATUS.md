# Stato verifiche Gym — 15 ottobre 2026

## Verificato sulla macchina condivisa

- SSH autorizzato come `ubuntu` su `63.178.93.191`.
- Architettura `aarch64`, Docker 29.9.0, Compose 5.6.0.
- RAM totale circa 3,8 GiB, spazio libero circa 12 GiB al sopralluogo.
- Porta assegnata 18200 libera al sopralluogo.
- Create soltanto directory Gym sotto `/opt/gym`, root, modalità 700.
- Generato `/opt/gym/.env`, root, modalità 600; nessun segreto nei log.
- SMTP predisposto per Resend, mittente `gym@services.humans.tech`.
- Nessun pacchetto installato, nessuna modifica a firewall o Docker daemon.
- Nessuna modifica ai container, file, volumi o timer di CyberMafia o dell’edge.

## Verificato in locale ARM64

- Le sei immagini runtime sono `linux/arm64`.
- Stack completo sano con limiti RAM, ingresso HTTP unico su loopback e rete privata.
- Lint e build frontend riusciti.
- 16 test degli script riusciti: integrità bundle, architettura reale delle
  immagini, rifiuto tag estranei, main/CI, rollback e backup facoltativo.
- 14 test browser riusciti: login tramite magic link SMTP locale, autorizzazioni,
  prenotazioni, cancellazioni, navigazione, mobile e realtime WebSocket.
- Riavvio esplicito dei sei container Gym locali e ritorno allo stato healthy.
- Preparazione di un bundle completo: in corso di verifica; non trasferito in produzione.

## Non ancora verificato in produzione

- Deploy di un bundle di `main`, health via `https://gym.humans.tech` e certificato Gym.
- Login Google reale e consegna email tramite Resend.
- Riavvio dei container Gym sulla EC2 e persistenza dei dati.
- Backup/ripristino su EC2: **non eseguiti; backup automatici esclusi dal proprietario**.

La configurazione Google e la API key Resend devono essere completate nel solo
file `.env.production.local` sul computer del proprietario e poi sincronizzate
in `/opt/gym/.env`. La rotta edge di Gym e i timer non sono stati attivati.
La PR verso main resta da completare prima del bundle di produzione.
