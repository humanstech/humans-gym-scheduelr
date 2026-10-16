-- Local demo only: PT members, wallet top-ups, Tue/Thu 18:00 PT schedule on Palestra
-- and ~10 weekdays of reconciled PT history. Idempotent; run as postgres AFTER the
-- dev auth users exist (00_trainer_access.sql must run before they are created).
-- Optional psql variable: admin_email.
\if :{?admin_email}
SELECT set_config('pt_seed.admin_email', lower(:'admin_email'), false) \gset pt_seed_
\else
SELECT set_config('pt_seed.admin_email', '', false) \gset pt_seed_
\endif
DO $$
DECLARE
  gym constant uuid := '10000000-0000-4000-8000-000000000001';
  demo_reason constant text := 'Trainer malato (demo)';
  admin_id uuid; anna uuid; luca uuid; sara uuid;
  members uuid[];
  d date;
  pattern int;
  sess record;
  target uuid;
  next_slot uuid;
BEGIN
  IF to_regclass('public.pt_sessions') IS NULL OR NOT EXISTS (SELECT 1 FROM public.spaces WHERE id = gym) THEN
    RETURN;
  END IF;
  SELECT id INTO admin_id FROM auth.users WHERE lower(email) = nullif(current_setting('pt_seed.admin_email'), '');
  SELECT id INTO anna FROM auth.users WHERE lower(email) = 'anna.rossi@humans.tech';
  SELECT id INTO luca FROM auth.users WHERE lower(email) = 'luca.bianchi@humans.tech';
  SELECT id INTO sara FROM auth.users WHERE lower(email) = 'sara.verdi@humans.tech';
  members := array_remove(ARRAY[admin_id, anna, luca, sara], NULL);
  IF cardinality(members) = 0 THEN RETURN; END IF;
  INSERT INTO public.pt_trainers(email) VALUES ('trainer.pt@example.com') ON CONFLICT (email) DO NOTHING;
  INSERT INTO public.pt_trainer_rates(trainer_id, fee_cents)
  SELECT id, 4000 FROM public.pt_trainers WHERE email = 'trainer.pt@example.com'
  ON CONFLICT (trainer_id) DO NOTHING;
  UPDATE public.pt_trainer_settings SET default_trainer_id =
    (SELECT id FROM public.pt_trainers WHERE email = 'trainer.pt@example.com')
  WHERE default_trainer_id IS NULL;
  INSERT INTO public.pt_session_trainers(slot_id, trainer_id, fee_cents)
  SELECT p.slot_id, t.id, 4000 FROM public.pt_sessions p
  JOIN public.slots s ON s.id = p.slot_id
  CROSS JOIN public.pt_trainers t WHERE s.space_id = gym AND t.email = 'trainer.pt@example.com'
  ON CONFLICT (slot_id) DO NOTHING;

  -- Open-ended memberships from 30 days ago; 50€ top-up each.
  INSERT INTO public.pt_memberships(user_id, valid_from, note)
  SELECT u, current_date - 30, 'demo' FROM unnest(members) u
  WHERE NOT EXISTS (SELECT 1 FROM public.pt_memberships m WHERE m.user_id = u);
  INSERT INTO public.pt_wallet_entries(user_id, amount_cents, kind, description, details, created_by_name)
  SELECT u, 5000, 'topup', 'Ricarica · demo', '{"note": "demo", "seed": "dev-topup"}', 'Demo'
  FROM unnest(members) u
  WHERE NOT EXISTS (SELECT 1 FROM public.pt_wallet_entries w WHERE w.user_id = u AND w.details->>'seed' = 'dev-topup');

  -- Weekly schedule: Tue + Thu 18:00-19:00 are PT; convert future slots.
  UPDATE public.space_time_slots SET is_pt = true
  WHERE space_id = gym AND day_of_week IN (2, 4) AND start_time = '18:00' AND end_time = '19:00' AND NOT is_pt;
  PERFORM private.pt_sync_schedule(gym);

  -- Past history on the last 10 weekdays; the pattern depends on the date so reruns are stable.
  FOR d IN
    SELECT g::date FROM generate_series(current_date - 14, current_date - 1, interval '1 day') g
    WHERE extract(isodow FROM g) < 6 ORDER BY g DESC LIMIT 10
  LOOP
    pattern := (d - date '2000-01-03') % 5;
    FOR sess IN
      SELECT * FROM (VALUES
        (0, '18:00'::time, ARRAY[admin_id, anna, luca, sara]),  -- 4 people: pooled
        (1, '18:00'::time, ARRAY[anna, luca]),                   -- 2 people: shared quota
        (2, '18:00'::time, ARRAY[]::uuid[]),                     -- empty: shared quota
        (3, '12:00'::time, ARRAY[anna, luca]),                   -- two sessions on one day
        (3, '18:00'::time, ARRAY[sara]),
        (4, '18:00'::time, ARRAY[anna, luca, sara])              -- full session
      ) v(p, start_time, people) WHERE v.p = pattern
    LOOP
      INSERT INTO public.slots(space_id, date, start_time, end_time, max_capacity, min_capacity)
      VALUES (gym, d, sess.start_time, sess.start_time + interval '1 hour', 4, 1)
      ON CONFLICT (date, start_time, end_time, space_id) DO NOTHING;
      SELECT id INTO target FROM public.slots
      WHERE space_id = gym AND date = d AND start_time = sess.start_time
        AND end_time = sess.start_time + interval '1 hour';
      IF NOT EXISTS (SELECT 1 FROM public.pt_sessions WHERE slot_id = target) THEN
        UPDATE public.slots SET max_capacity = 4, min_capacity = 1, is_cancelled = false WHERE id = target;
        INSERT INTO public.pt_sessions(slot_id, source, price_cents)
        SELECT target, CASE WHEN extract(isodow FROM d) IN (2, 4) AND sess.start_time = '18:00' THEN 'schedule' ELSE 'manual' END,
          st.session_price_cents FROM public.pt_settings st;
        INSERT INTO public.bookings(slot_id, user_id, user_email, user_name, user_avatar_url, created_at)
        SELECT target, u.id, u.email, coalesce(nullif(u.raw_user_meta_data->>'full_name', ''), u.email),
          u.raw_user_meta_data->>'avatar_url', (d + sess.start_time - interval '1 day') AT TIME ZONE 'Europe/Rome'
        FROM unnest(sess.people) WITH ORDINALITY p(user_id, n) JOIN auth.users u ON u.id = p.user_id
        ORDER BY p.n
        ON CONFLICT (slot_id, user_id) DO NOTHING;
      END IF;
    END LOOP;
    PERFORM private.pt_reconcile_day(d, 'ricalcolo demo');
  END LOOP;

  -- Void one past session afterwards so an 'adjustment' shows up (once).
  IF NOT EXISTS (SELECT 1 FROM public.pt_sessions WHERE voided_reason = demo_reason) THEN
    SELECT s.id, s.date INTO target, d FROM public.pt_sessions p JOIN public.slots s ON s.id = p.slot_id
    WHERE s.space_id = gym AND p.status = 'active' AND s.date < current_date AND s.start_time = '18:00'
      AND EXISTS (SELECT 1 FROM public.slots o JOIN public.pt_sessions op ON op.slot_id = o.id
                  WHERE o.date = s.date AND o.id <> s.id AND op.status = 'active')
    ORDER BY s.date DESC LIMIT 1;
    IF target IS NOT NULL THEN
      UPDATE public.pt_sessions SET status = 'voided', voided_reason = demo_reason, voided_at = now() WHERE slot_id = target;
      PERFORM private.pt_reconcile_day(d, 'seduta delle 18:00 annullata dall''admin: ' || demo_reason);
    END IF;
  END IF;

  -- Two members already booked on the next PT session.
  SELECT s.id INTO next_slot FROM public.pt_sessions p JOIN public.slots s ON s.id = p.slot_id
  WHERE s.space_id = gym AND p.status = 'active' AND s.date > current_date ORDER BY s.date, s.start_time LIMIT 1;
  IF next_slot IS NOT NULL THEN
    INSERT INTO public.bookings(slot_id, user_id, user_email, user_name, user_avatar_url)
    SELECT next_slot, u.id, u.email, coalesce(nullif(u.raw_user_meta_data->>'full_name', ''), u.email),
      u.raw_user_meta_data->>'avatar_url'
    FROM auth.users u WHERE u.id IN (anna, luca)
    ON CONFLICT (slot_id, user_id) DO NOTHING;
  END IF;
END $$;
