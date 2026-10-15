-- ============================================================
-- Phase 3 — Auto-regenerate booking slots via pg_cron
-- Mantiene la tabella `slots` popolata senza intervento manuale.
-- Idempotente: rieseguibile in sicurezza.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Abilita estensione pg_cron (gestita da Supabase)
-- ------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ------------------------------------------------------------
-- 2. Rimuovi eventuale schedulazione precedente con lo stesso nome
--    (consente di rieseguire lo script senza errori)
-- ------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'regen-slots-daily') THEN
    PERFORM cron.unschedule('regen-slots-daily');
  END IF;
END
$$;

-- ------------------------------------------------------------
-- 3. Schedula generate_slots(30) ogni giorno alle 03:00 UTC
--    (~05:00 Europe/Rome estate, ~04:00 inverno).
--    Finestra 30gg: buffer di 16gg oltre la finestra storica
--    di 14gg, così una run mancata non lascia utenti senza slot.
-- ------------------------------------------------------------
SELECT cron.schedule(
  'regen-slots-daily',
  '0 3 * * *',
  $$SELECT public.generate_slots(30);$$
);

-- ------------------------------------------------------------
-- 4. Backfill immediato: popola subito da oggi a +29 giorni
-- ------------------------------------------------------------
SELECT public.generate_slots(30);
