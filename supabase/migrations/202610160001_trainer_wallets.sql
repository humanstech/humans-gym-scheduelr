-- The cash desk owes trainers independently of participant wallet charges.
-- Trainer compensation and payments are visible only to administrators.
CREATE TABLE public.pt_trainer_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  default_trainer_id uuid REFERENCES public.pt_trainers ON DELETE SET NULL
);
INSERT INTO public.pt_trainer_settings DEFAULT VALUES;
CREATE TABLE public.pt_trainer_rates (
  trainer_id uuid PRIMARY KEY REFERENCES public.pt_trainers ON DELETE CASCADE,
  fee_cents integer NOT NULL CHECK (fee_cents >= 0)
);

CREATE TABLE public.pt_session_trainers (
  slot_id uuid PRIMARY KEY REFERENCES public.slots ON DELETE CASCADE,
  trainer_id uuid NOT NULL REFERENCES public.pt_trainers ON DELETE RESTRICT,
  fee_cents integer NOT NULL CHECK (fee_cents >= 0)
);
CREATE INDEX pt_session_trainers_trainer_idx ON public.pt_session_trainers(trainer_id);

CREATE TABLE public.pt_trainer_wallet_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id uuid NOT NULL REFERENCES public.pt_trainers ON DELETE RESTRICT,
  amount_cents integer NOT NULL CHECK (amount_cents <> 0),
  kind text NOT NULL CHECK (kind IN ('earning', 'adjustment', 'payment', 'payment_reversal')),
  slot_id uuid REFERENCES public.slots ON DELETE SET NULL,
  session_date date,
  session_start time,
  space_name text,
  occurred_on date NOT NULL,
  payment_method text CHECK (payment_method IN ('bank_transfer', 'cash', 'other')),
  description text NOT NULL CHECK (length(trim(description)) > 0),
  request_id uuid UNIQUE,
  reverses_entry_id uuid UNIQUE REFERENCES public.pt_trainer_wallet_entries ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_name text,
  CHECK (kind <> 'earning' OR amount_cents > 0),
  CHECK (kind <> 'payment' OR (amount_cents < 0 AND request_id IS NOT NULL AND payment_method IS NOT NULL)),
  CHECK (kind <> 'payment_reversal' OR (amount_cents > 0 AND reverses_entry_id IS NOT NULL))
);
CREATE INDEX pt_trainer_wallet_trainer_idx ON public.pt_trainer_wallet_entries(trainer_id, created_at);
CREATE INDEX pt_trainer_wallet_slot_idx ON public.pt_trainer_wallet_entries(slot_id);

CREATE FUNCTION public.pt_save_trainer_rate(trainer_id uuid, fee_cents integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.pt_require_admin();
  IF $1 IS NULL OR NOT EXISTS (SELECT 1 FROM public.pt_trainers t WHERE t.id = $1) THEN RAISE EXCEPTION 'Trainer required'; END IF;
  IF $2 IS NULL OR $2 < 0 THEN RAISE EXCEPTION 'Invalid amount'; END IF;
  INSERT INTO public.pt_trainer_rates (trainer_id, fee_cents) VALUES ($1, $2)
  ON CONFLICT ON CONSTRAINT pt_trainer_rates_pkey DO UPDATE SET fee_cents = $2;
END;
$$;

CREATE FUNCTION public.pt_add_trainer(email text, fee_cents integer) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE created uuid;
BEGIN
  PERFORM private.pt_require_admin();
  IF $1 IS NULL OR trim($1) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN RAISE EXCEPTION 'Invalid email'; END IF;
  IF $2 IS NULL OR $2 < 0 THEN RAISE EXCEPTION 'Invalid amount'; END IF;
  INSERT INTO public.pt_trainers (email) VALUES (lower(trim($1))) RETURNING id INTO created;
  PERFORM public.pt_save_trainer_rate(created, $2);
  RETURN created;
END;
$$;

-- Lock order is the existing space -> slot order. A trainer change transfers
-- the debt by adding adjustments, preserving the full history of both accounts.
CREATE FUNCTION private.pt_reconcile_trainer_session(target uuid, reason text, removing boolean DEFAULT false)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s public.slots; inserted integer;
BEGIN
  s := private.pt_lock_slot(target);
  IF s.id IS NULL THEN RETURN 0; END IF;
  WITH expected AS (
    SELECT a.trainer_id, a.fee_cents AS cents
    FROM public.pt_session_trainers a JOIN public.pt_sessions p ON p.slot_id = a.slot_id
    WHERE a.slot_id = target AND p.status = 'active' AND NOT s.is_cancelled AND NOT removing
      AND (s.date + s.end_time) AT TIME ZONE 'Europe/Rome' <= clock_timestamp()
  ), posted AS (
    SELECT w.trainer_id, sum(w.amount_cents)::integer AS cents
    FROM public.pt_trainer_wallet_entries w
    WHERE w.slot_id = target AND w.kind IN ('earning', 'adjustment') GROUP BY w.trainer_id
  ), delta AS (
    SELECT coalesce(e.trainer_id, p.trainer_id) AS trainer_id,
      coalesce(e.cents, 0) - coalesce(p.cents, 0) AS cents, p.trainer_id IS NULL AS first_entry
    FROM expected e FULL JOIN posted p USING (trainer_id)
  ), ins AS (
    INSERT INTO public.pt_trainer_wallet_entries
      (trainer_id, amount_cents, kind, slot_id, session_date, session_start, space_name,
       occurred_on, description, created_by_name)
    SELECT d.trainer_id, d.cents, CASE WHEN d.first_entry THEN 'earning' ELSE 'adjustment' END,
      s.id, s.date, s.start_time, sp.name, private.pt_today(),
      format('%s %s %s · %s', CASE WHEN d.first_entry THEN 'Compenso seduta' ELSE 'Rettifica seduta' END,
        to_char(s.date, 'DD/MM/YYYY'), to_char(s.start_time, 'HH24:MI'), reason), private.pt_actor_name()
    FROM delta d JOIN public.spaces sp ON sp.id = s.space_id WHERE d.cents <> 0
    RETURNING 1
  ) SELECT count(*) INTO inserted FROM ins;
  RETURN inserted;
END;
$$;

CREATE FUNCTION private.pt_reconcile_trainers() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE target uuid; total integer := 0;
BEGIN
  PERFORM private.pt_lock_all_spaces();
  -- No lookback cutoff: a delayed job must also recover older unpaid sessions.
  FOR target IN
    SELECT a.slot_id FROM public.pt_session_trainers a JOIN public.slots s ON s.id = a.slot_id
    WHERE (s.date + s.end_time) AT TIME ZONE 'Europe/Rome' <= clock_timestamp()
    ORDER BY s.space_id, s.id
  LOOP
    total := total + private.pt_reconcile_trainer_session(target, 'compenso maturato');
  END LOOP;
  RETURN total;
END;
$$;

-- Every NEW PT session must have a trainer. Existing sessions are left for
-- explicit setup, so introducing this feature cannot invent historical debts.
CREATE FUNCTION private.pt_session_trainer_lifecycle() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM public.pt_session_trainers a WHERE a.slot_id = NEW.slot_id) THEN
      INSERT INTO public.pt_session_trainers (slot_id, trainer_id, fee_cents)
      SELECT NEW.slot_id, st.default_trainer_id, r.fee_cents
      FROM public.pt_trainer_settings st JOIN public.pt_trainer_rates r ON r.trainer_id = st.default_trainer_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Trainer required'; END IF;
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM private.pt_reconcile_trainer_session(OLD.slot_id, 'seduta rimossa', true);
    DELETE FROM public.pt_session_trainers WHERE slot_id = OLD.slot_id;
    RETURN OLD;
  END IF;
  PERFORM private.pt_reconcile_trainer_session(NEW.slot_id,
    CASE WHEN NEW.status = 'voided' THEN 'seduta annullata' ELSE 'seduta aggiornata' END);
  RETURN NEW;
END;
$$;
CREATE TRIGGER pt_session_trainer_created AFTER INSERT ON public.pt_sessions
FOR EACH ROW EXECUTE FUNCTION private.pt_session_trainer_lifecycle();
CREATE TRIGGER pt_session_trainer_changed AFTER UPDATE OF status ON public.pt_sessions
FOR EACH ROW EXECUTE FUNCTION private.pt_session_trainer_lifecycle();
CREATE TRIGGER pt_session_trainer_deleted BEFORE DELETE ON public.pt_sessions
FOR EACH ROW EXECUTE FUNCTION private.pt_session_trainer_lifecycle();

CREATE FUNCTION private.pt_trainer_slot_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.pt_session_trainers WHERE slot_id = NEW.id) THEN
    PERFORM private.pt_reconcile_trainer_session(NEW.id, 'orario o stato della seduta modificato');
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER pt_trainer_slot_changed AFTER UPDATE OF is_cancelled, date, start_time, end_time ON public.slots
FOR EACH ROW EXECUTE FUNCTION private.pt_trainer_slot_changed();

CREATE FUNCTION public.pt_set_session_trainer(slot_id uuid, trainer_id uuid, fee_cents integer, reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s public.slots;
BEGIN
  PERFORM private.pt_require_admin();
  IF $2 IS NULL OR NOT EXISTS (SELECT 1 FROM public.pt_trainers t WHERE t.id = $2) THEN
    RAISE EXCEPTION 'Trainer required';
  END IF;
  IF $3 IS NULL OR $3 < 0 THEN RAISE EXCEPTION 'Invalid amount'; END IF;
  IF nullif(trim($4), '') IS NULL THEN RAISE EXCEPTION 'Reason required'; END IF;
  s := private.pt_lock_slot($1);
  IF NOT EXISTS (SELECT 1 FROM public.pt_sessions p WHERE p.slot_id = $1) THEN RAISE EXCEPTION 'Session not found'; END IF;
  INSERT INTO public.pt_session_trainers AS a (slot_id, trainer_id, fee_cents) VALUES ($1, $2, $3)
  ON CONFLICT ON CONSTRAINT pt_session_trainers_pkey DO UPDATE SET trainer_id = $2, fee_cents = $3;
  PERFORM private.pt_reconcile_trainer_session($1, trim($4));
END;
$$;

CREATE FUNCTION public.pt_create_assigned_session(slot_id uuid, trainer_id uuid, fee_cents integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s public.slots;
BEGIN
  PERFORM private.pt_require_admin();
  IF $2 IS NULL OR NOT EXISTS (SELECT 1 FROM public.pt_trainers t WHERE t.id = $2) THEN RAISE EXCEPTION 'Trainer required'; END IF;
  IF $3 IS NULL OR $3 < 0 THEN RAISE EXCEPTION 'Invalid amount'; END IF;
  s := private.pt_lock_slot($1);
  IF s.id IS NULL OR s.is_cancelled THEN RAISE EXCEPTION 'Slot unavailable'; END IF;
  IF private.pt_slot_started(s) THEN RAISE EXCEPTION 'Slot already started'; END IF;
  IF EXISTS (SELECT 1 FROM public.pt_sessions p WHERE p.slot_id = $1 AND p.status = 'active') THEN
    RAISE EXCEPTION 'Session already exists';
  END IF;
  INSERT INTO public.pt_session_trainers (slot_id, trainer_id, fee_cents) VALUES ($1, $2, $3)
  ON CONFLICT ON CONSTRAINT pt_session_trainers_pkey DO UPDATE SET trainer_id = $2, fee_cents = $3;
  PERFORM public.pt_create_session($1);
END;
$$;

CREATE FUNCTION public.pt_set_trainer_defaults(trainer_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE space_id uuid;
BEGIN
  PERFORM private.pt_require_admin();
  IF $1 IS NULL OR NOT EXISTS (SELECT 1 FROM public.pt_trainers t WHERE t.id = $1) THEN RAISE EXCEPTION 'Trainer required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pt_trainer_rates r WHERE r.trainer_id = $1) THEN RAISE EXCEPTION 'Trainer rate required'; END IF;
  PERFORM private.pt_lock_all_spaces();
  UPDATE public.pt_trainer_settings SET default_trainer_id = $1;
  -- Only future sessions without an assignment inherit the defaults.
  INSERT INTO public.pt_session_trainers (slot_id, trainer_id, fee_cents)
  SELECT p.slot_id, $1, r.fee_cents FROM public.pt_sessions p JOIN public.slots s ON s.id = p.slot_id
  JOIN public.pt_trainer_rates r ON r.trainer_id = $1
  WHERE NOT private.pt_slot_started(s)
  ON CONFLICT (slot_id) DO NOTHING;
  PERFORM private.generate_slots(90);
  FOR space_id IN SELECT sp.id FROM public.spaces sp WHERE sp.is_active ORDER BY sp.id LOOP
    PERFORM private.pt_sync_schedule(space_id);
  END LOOP;
END;
$$;

CREATE FUNCTION public.pt_record_trainer_payment(trainer_id uuid, amount_cents integer, paid_on date,
  payment_method text, note text, request_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE existing public.pt_trainer_wallet_entries; created uuid;
BEGIN
  PERFORM private.pt_require_admin();
  IF $2 IS NULL OR $2 <= 0 THEN RAISE EXCEPTION 'Invalid amount'; END IF;
  IF $3 IS NULL OR $3 > private.pt_today() THEN RAISE EXCEPTION 'Invalid payment date'; END IF;
  IF $4 IS NULL OR $4 NOT IN ('bank_transfer', 'cash', 'other') THEN RAISE EXCEPTION 'Invalid payment method'; END IF;
  IF nullif(trim($5), '') IS NULL THEN RAISE EXCEPTION 'Reason required'; END IF;
  IF $6 IS NULL THEN RAISE EXCEPTION 'Request id required'; END IF;
  PERFORM pg_advisory_xact_lock(715021103, hashtext($6::text));
  SELECT * INTO existing FROM public.pt_trainer_wallet_entries w WHERE w.request_id = $6;
  IF FOUND THEN
    IF existing.trainer_id IS DISTINCT FROM $1 OR existing.amount_cents <> -$2 OR existing.occurred_on <> $3
       OR existing.payment_method <> $4 OR existing.description <> trim($5) THEN
      RAISE EXCEPTION 'Request already used';
    END IF;
    RETURN existing.id;
  END IF;
  IF $1 IS NULL OR NOT EXISTS (SELECT 1 FROM public.pt_trainers t WHERE t.id = $1) THEN RAISE EXCEPTION 'Trainer required'; END IF;
  INSERT INTO public.pt_trainer_wallet_entries
    (trainer_id, amount_cents, kind, occurred_on, payment_method, description, request_id, created_by_name)
  VALUES ($1, -$2, 'payment', $3, $4, trim($5), $6, private.pt_actor_name()) RETURNING id INTO created;
  RETURN created;
END;
$$;

CREATE FUNCTION public.pt_reverse_trainer_payment(entry_id uuid, reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE payment public.pt_trainer_wallet_entries;
BEGIN
  PERFORM private.pt_require_admin();
  IF nullif(trim($2), '') IS NULL THEN RAISE EXCEPTION 'Reason required'; END IF;
  SELECT * INTO payment FROM public.pt_trainer_wallet_entries w WHERE w.id = $1 FOR UPDATE;
  IF payment.id IS NULL OR payment.kind <> 'payment' THEN RAISE EXCEPTION 'Payment not found'; END IF;
  INSERT INTO public.pt_trainer_wallet_entries
    (trainer_id, amount_cents, kind, occurred_on, description, reverses_entry_id, created_by_name)
  VALUES (payment.trainer_id, -payment.amount_cents, 'payment_reversal', private.pt_today(),
    'Storno pagamento: ' || trim($2), payment.id, private.pt_actor_name())
  ON CONFLICT (reverses_entry_id) DO NOTHING;
END;
$$;

CREATE FUNCTION public.pt_trainer_accounts()
RETURNS TABLE (trainer_id uuid, email text, default_fee_cents integer, earned_cents bigint, paid_cents bigint, balance_cents bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.pt_require_admin();
  PERFORM private.pt_reconcile_trainers();
  RETURN QUERY SELECT t.id, t.email, r.fee_cents,
    coalesce(sum(w.amount_cents) FILTER (WHERE w.kind IN ('earning', 'adjustment')), 0),
    -coalesce(sum(w.amount_cents) FILTER (WHERE w.kind IN ('payment', 'payment_reversal')), 0),
    coalesce(sum(w.amount_cents), 0)
  FROM public.pt_trainers t LEFT JOIN public.pt_trainer_rates r ON r.trainer_id = t.id
  LEFT JOIN public.pt_trainer_wallet_entries w ON w.trainer_id = t.id
  GROUP BY t.id, r.fee_cents ORDER BY t.email;
END;
$$;

CREATE FUNCTION public.pt_trainer_session_details(from_date date, to_date date)
RETURNS TABLE (slot_id uuid, trainer_id uuid, trainer_email text, fee_cents integer, earned_cents bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.pt_require_admin();
  PERFORM private.pt_check_range($1, $2);
  PERFORM private.pt_reconcile_trainers();
  RETURN QUERY SELECT a.slot_id, a.trainer_id, t.email, a.fee_cents,
    coalesce((SELECT sum(w.amount_cents) FROM public.pt_trainer_wallet_entries w
      WHERE w.slot_id = a.slot_id AND w.kind IN ('earning', 'adjustment')), 0)
  FROM public.pt_session_trainers a JOIN public.pt_trainers t ON t.id = a.trainer_id
  JOIN public.slots s ON s.id = a.slot_id WHERE s.date BETWEEN $1 AND $2;
END;
$$;

ALTER TABLE public.pt_trainer_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY trainer_rates_admin_read ON public.pt_trainer_rates FOR SELECT TO authenticated USING (public.is_admin());
ALTER TABLE public.pt_trainer_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pt_session_trainers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pt_trainer_wallet_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY trainer_settings_admin_read ON public.pt_trainer_settings FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY session_trainers_admin_read ON public.pt_session_trainers FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY trainer_wallet_admin_read ON public.pt_trainer_wallet_entries FOR SELECT TO authenticated USING (public.is_admin());
REVOKE ALL ON public.pt_trainer_rates, public.pt_trainer_settings, public.pt_session_trainers, public.pt_trainer_wallet_entries FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.pt_trainer_rates, public.pt_trainer_settings, public.pt_session_trainers, public.pt_trainer_wallet_entries TO authenticated;
GRANT ALL ON public.pt_trainer_rates, public.pt_trainer_settings, public.pt_session_trainers TO service_role;
GRANT SELECT, INSERT ON public.pt_trainer_wallet_entries TO service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pt_set_session_trainer(uuid, uuid, integer, text),
  public.pt_save_trainer_rate(uuid, integer), public.pt_add_trainer(text, integer),
  public.pt_create_assigned_session(uuid, uuid, integer), public.pt_set_trainer_defaults(uuid),
  public.pt_record_trainer_payment(uuid, integer, date, text, text, uuid), public.pt_reverse_trainer_payment(uuid, text),
  public.pt_trainer_accounts(), public.pt_trainer_session_details(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pt_set_session_trainer(uuid, uuid, integer, text),
  public.pt_save_trainer_rate(uuid, integer), public.pt_add_trainer(text, integer),
  public.pt_create_assigned_session(uuid, uuid, integer), public.pt_set_trainer_defaults(uuid),
  public.pt_record_trainer_payment(uuid, integer, date, text, text, uuid), public.pt_reverse_trainer_payment(uuid, text),
  public.pt_trainer_accounts(), public.pt_trainer_session_details(date, date) TO authenticated;

-- Reuse the existing cron and keep ordinary slot generation available before PT setup.
CREATE OR REPLACE FUNCTION private.generate_slots(days_ahead integer DEFAULT 90) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF days_ahead NOT BETWEEN 1 AND 180 THEN RAISE EXCEPTION 'days_ahead must be 1..180'; END IF;
  WITH created AS (
    INSERT INTO public.slots (space_id, date, start_time, end_time, max_capacity, min_capacity)
    SELECT sp.id, d.day, t.start_time, t.end_time,
      CASE WHEN t.is_pt THEN st.max_participants ELSE sp.max_capacity END,
      CASE WHEN t.is_pt THEN 1 ELSE sp.min_capacity END
    FROM public.spaces sp JOIN public.space_time_slots t ON t.space_id = sp.id
    CROSS JOIN public.pt_settings st
    CROSS JOIN LATERAL (
      SELECT (now() AT TIME ZONE 'Europe/Rome')::date + n AS day FROM generate_series(0, days_ahead - 1) n
    ) d
    WHERE (NOT t.is_pt OR EXISTS (
      SELECT 1 FROM public.pt_trainer_settings cfg JOIN public.pt_trainer_rates r ON r.trainer_id = cfg.default_trainer_id
    )) AND sp.is_active AND extract(isodow FROM d.day)::int = t.day_of_week
      AND t.day_of_week = ANY(sp.available_days) AND NOT public.is_italian_holiday(d.day)
    ON CONFLICT (date, start_time, end_time, space_id) DO NOTHING
    RETURNING id, space_id, date, start_time, end_time
  )
  INSERT INTO public.pt_sessions (slot_id, source, price_cents)
  SELECT c.id, 'schedule', st.session_price_cents FROM created c CROSS JOIN public.pt_settings st
  WHERE EXISTS (
    SELECT 1 FROM public.space_time_slots t
    WHERE t.space_id = c.space_id AND t.is_pt AND t.day_of_week = extract(isodow FROM c.date)::int
      AND t.start_time = c.start_time AND t.end_time = c.end_time
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.pt_trainer_sessions(from_date date, to_date date)
RETURNS TABLE (slot_id uuid, date date, start_time time, end_time time, space_name text, status text, participants jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
#variable_conflict use_column
BEGIN
  IF NOT (public.is_trainer() OR public.is_admin()) THEN RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501'; END IF;
  PERFORM private.pt_check_range($1, $2);
  RETURN QUERY
  SELECT s.id, s.date, s.start_time, s.end_time, sp.name,
    CASE WHEN s.is_cancelled THEN 'voided' ELSE p.status END,
    coalesce((SELECT jsonb_agg(jsonb_build_object('name', b.user_name, 'avatar_url', b.user_avatar_url) ORDER BY b.created_at)
      FROM public.bookings b WHERE b.slot_id = s.id), '[]'::jsonb)
  FROM public.pt_sessions p JOIN public.slots s ON s.id = p.slot_id JOIN public.spaces sp ON sp.id = s.space_id
  WHERE s.date BETWEEN $1 AND $2 AND (public.is_admin() OR EXISTS (
    SELECT 1 FROM public.pt_session_trainers a JOIN public.pt_trainers t ON t.id = a.trainer_id
    WHERE a.slot_id = p.slot_id AND t.email = lower(auth.jwt()->>'email')
  ))
  ORDER BY s.date, s.start_time, sp.sort_order, sp.name;
END;
$$;

CREATE OR REPLACE FUNCTION private.pt_reconcile_recent() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE d date; total integer := 0;
BEGIN
  PERFORM private.pt_lock_all_spaces();
  FOR d IN SELECT g::date FROM generate_series(private.pt_today() - 13, private.pt_today(), interval '1 day') g LOOP
    total := total + private.pt_reconcile_day(d, 'ricalcolo automatico');
  END LOOP;
  RETURN total + private.pt_reconcile_trainers();
END;
$$;
