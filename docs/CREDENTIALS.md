# Configurare l’accesso a Gym

Il dominio è `https://gym.humans.tech`. Il primo amministratore è
`marco.ciotoli@humans.tech`. Non occorre un account Supabase cloud.

Servono due configurazioni per le funzioni di login già presenti: Google OAuth
per l’accesso aziendale e un server SMTP per i link di accesso degli ospiti.
I backup automatici e S3 sono disabilitati su richiesta del proprietario.

## 1. Google OAuth

Con un account autorizzato dell’organizzazione, aprire [Google Cloud Console](https://console.cloud.google.com/).

1. Selezionare o creare un progetto per Gym.
2. Aprire **Google Auth Platform**, configurare il branding: nome `Gym`, email
   di assistenza `marco.ciotoli@humans.tech`, dominio autorizzato `humans.tech`.
3. Scegliere il pubblico **Internal** se il progetto appartiene alla Google
   Workspace di Humans e l’accesso Google è solo aziendale. Gli ospiti possono
   usare il link email. Se Internal non è disponibile, usare External e
   completare la pubblicazione richiesta dalla console; i test user da soli non
   aprono l’app a tutti gli utenti aziendali.
4. Creare un client OAuth di tipo **Web application**, nome `Gym production`.
5. Origine JavaScript autorizzata: `https://gym.humans.tech`.
6. URI di reindirizzamento autorizzato, esattamente:
   **`https://gym.humans.tech/auth/v1/callback`**.
7. Salvare **Client ID** e **Client secret** rispettivamente in `GOOGLE_CLIENT_ID`
   e `GOOGLE_CLIENT_SECRET` in `.env.production.local` sul tuo computer.

Bastano i permessi di identità `openid`, `email`, `profile`; non servono accessi
Drive, Calendar o Gmail. Il callback `/auth/callback` del frontend è diverso
ed è già gestito dalla configurazione applicativa.

[Documentazione Google OAuth](https://developers.google.com/identity/protocols/oauth2/web-server).

## 2. Email con Resend

La API key Resend esistente può essere usata come password SMTP. Non serve SES.

1. In Resend, **Domains**, verificare che `services.humans.tech` sia verificato e autorizzato per l’invio.
   Aggiungere soltanto i record DNS richiesti da Resend per quel dominio.
2. La chiave deve avere permesso di invio per il dominio scelto; per Gym basta
   una chiave con **Sending access**.
3. Compilare `.env.production.local` sul tuo computer:

```dotenv
SMTP_HOST=smtp.resend.com
SMTP_PORT=587
SMTP_USER=resend
SMTP_PASS=INSERIRE_LA_API_KEY_RESEND
SMTP_FROM=gym@services.humans.tech
```

La porta 587 usa STARTTLS. La chiave va inserita solo in `SMTP_PASS`, mai nelle
variabili `VITE_*`. `gym@services.humans.tech` è utilizzabile solo se `services.humans.tech` è
verificato e la chiave è autorizzata. Non occorre una casella per autenticarsi
al server SMTP.

[SMTP Resend](https://resend.com/docs/send-with-smtp),
[integrazione Supabase](https://resend.com/docs/send-with-supabase-smtp).

## Un solo file di produzione

Modificare **`.env.production.local` nella radice del progetto sul Mac**.
È escluso da Git e dal contesto Docker, con permessi 600. Vi sono già le chiavi
applicative generate: compilare solo `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
e `SMTP_PASS` (API key Resend). Il mittente è `gym@services.humans.tech`.

Non serve accedere al server: dopo il salvataggio l’agente sincronizza questo
stesso file via SSH in **`/opt/gym/.env`**, root, permessi 600. Non inviarlo in chat
né in GitHub. Non cambiare le chiavi database/JWT già generate.

Per le password con spazi o `#`, racchiudere il valore tra apici singoli nel
formato dotenv. Quando i campi sono compilati basta comunicare **“salvato”**.
Verificheremo poi un vero login Google e un vero magic link ricevuto via email.
