-- Personal trainer: memberships, PT sessions on existing slots, append-only wallet.
-- Spec and API contract: docs/PERSONAL-TRAINER.md. Amounts in cents; costs are
-- positive inside the billing engine and negative in pt_wallet_entries.

CREATE TABLE public.pt_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  session_price_cents integer NOT NULL DEFAULT 4000 CHECK (session_price_cents > 0),
  low_balance_threshold_cents integer NOT NULL DEFAULT 1500 CHECK (low_balance_threshold_cents >= 0),
  max_participants integer NOT NULL DEFAULT 4 CHECK (max_participants > 0),
  full_session_min integer NOT NULL DEFAULT 3 CHECK (full_session_min > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.pt_settings DEFAULT VALUES;
CREATE TABLE public.pt_trainers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL CHECK (email = lower(trim(email))),
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Non-overlap is enforced by pt_save_membership under a per-user lock.
CREATE TABLE public.pt_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  valid_from date NOT NULL,
  valid_to date CHECK (valid_to >= valid_from),
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pt_memberships_user_idx ON public.pt_memberships(user_id, valid_from);
CREATE TABLE public.pt_sessions (
  slot_id uuid PRIMARY KEY REFERENCES public.slots ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'voided')),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('schedule', 'manual')),
  price_cents integer NOT NULL CHECK (price_cents > 0),
  billing_mode text NOT NULL DEFAULT 'auto' CHECK (billing_mode IN ('auto', 'custom')),
  voided_reason text,
  voided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.pt_session_exclusions (
  slot_id uuid NOT NULL REFERENCES public.slots ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (slot_id, user_id)
);
CREATE TABLE public.pt_session_payers (
  slot_id uuid NOT NULL REFERENCES public.slots ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (slot_id, user_id)
);
-- Append-only ledger: no UPDATE/DELETE grants. Session entries keep date/time
-- even if the slot is deleted (slot_id becomes NULL and is then frozen history).
CREATE TABLE public.pt_wallet_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  amount_cents integer NOT NULL CHECK (amount_cents <> 0),
  kind text NOT NULL CHECK (kind IN ('topup', 'manual', 'charge', 'adjustment')),
  session_date date,
  slot_id uuid REFERENCES public.slots ON DELETE SET NULL,
  session_start time,
  description text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_name text,
  CHECK (kind <> 'topup' OR amount_cents > 0),
  CHECK ((kind IN ('charge', 'adjustment')) = (session_date IS NOT NULL AND details ? 'mode'))
);
CREATE INDEX pt_wallet_user_idx ON public.pt_wallet_entries(user_id, created_at);
CREATE INDEX pt_wallet_session_date_idx ON public.pt_wallet_entries(session_date);
ALTER TABLE public.space_time_slots ADD COLUMN is_pt boolean NOT NULL DEFAULT false;

-- Roles: trainers are external accounts allowed by email.
CREATE FUNCTION public.is_trainer() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.pt_trainers WHERE email = lower(auth.jwt()->>'email')
  );
$$;
CREATE OR REPLACE FUNCTION public.is_allowed() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT auth.uid() IS NOT NULL AND (
    public.is_admin() OR
    EXISTS (SELECT 1 FROM public.allowed_emails WHERE email = lower(auth.jwt()->>'email')) OR
    EXISTS (SELECT 1 FROM public.pt_trainers WHERE email = lower(auth.jwt()->>'email')) OR
    EXISTS (SELECT 1 FROM public.allowed_domains WHERE domain = split_part(lower(auth.jwt()->>'email'), '@', 2))
  );
$$;
CREATE OR REPLACE FUNCTION private.check_email_access() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT (
    EXISTS (SELECT 1 FROM public.admins WHERE email = lower(NEW.email)) OR
    EXISTS (SELECT 1 FROM public.allowed_emails WHERE email = lower(NEW.email)) OR
    EXISTS (SELECT 1 FROM public.pt_trainers WHERE email = lower(NEW.email)) OR
    EXISTS (SELECT 1 FROM public.allowed_domains WHERE domain = split_part(lower(NEW.email), '@', 2))
  ) THEN
    RAISE EXCEPTION 'Email not authorized' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

-- Helpers.
CREATE FUNCTION private.pt_require_admin() RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin required' USING ERRCODE = '42501'; END IF;
END;
$$;
CREATE FUNCTION private.pt_check_range(from_date date, to_date date) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  IF from_date IS NULL OR to_date IS NULL OR to_date < from_date OR to_date - from_date > 120 THEN
    RAISE EXCEPTION 'Invalid date range';
  END IF;
END;
$$;
CREATE FUNCTION private.pt_today() RETURNS date
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT (clock_timestamp() AT TIME ZONE 'Europe/Rome')::date;
$$;
CREATE FUNCTION private.pt_slot_started(target public.slots) RETURNS boolean
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT (($1).date + ($1).start_time) AT TIME ZONE 'Europe/Rome' <= clock_timestamp();
$$;
CREATE FUNCTION private.pt_is_member(uid uuid, d date) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.pt_memberships m
    WHERE m.user_id = uid AND m.valid_from <= d AND (m.valid_to IS NULL OR m.valid_to >= d)
  );
$$;
CREATE FUNCTION private.pt_user_name(uid uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(nullif(u.raw_user_meta_data->>'full_name', ''), u.email) FROM auth.users u WHERE u.id = uid;
$$;
-- "13,33€", "40€", "-5€"
CREATE FUNCTION private.pt_eur(cents integer) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN cents < 0 THEN '-' ELSE '' END || (abs(cents) / 100)::text
    || CASE WHEN abs(cents) % 100 = 0 THEN '' ELSE ',' || lpad((abs(cents) % 100)::text, 2, '0') END || '€';
$$;
CREATE FUNCTION private.pt_count(n integer, singular text, plural text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT n || ' ' || CASE WHEN n = 1 THEN singular ELSE plural END;
$$;
-- Same lock order as booking RPCs: space, then slot.
CREATE FUNCTION private.pt_lock_slot(target uuid) RETURNS public.slots
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE locked public.slots;
BEGIN
  PERFORM sp.id FROM public.spaces sp JOIN public.slots s ON s.space_id = sp.id WHERE s.id = target FOR UPDATE OF sp;
  SELECT * INTO locked FROM public.slots WHERE id = target FOR UPDATE;
  RETURN locked;
END;
$$;
-- Membership changes affect PT slots of every space: take all space locks in id order
-- (as cancel_underfilled_slots does) so no booking can race the change.
CREATE FUNCTION private.pt_lock_all_spaces() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM id FROM public.spaces ORDER BY id FOR UPDATE;
END;
$$;
CREATE FUNCTION private.pt_actor_name() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.pt_user_name(auth.uid());
$$;

-- Any session change bumps slots.updated_at so realtime clients refresh.
CREATE TRIGGER pt_session_slot_change AFTER INSERT OR UPDATE OR DELETE ON public.pt_sessions
FOR EACH ROW EXECUTE FUNCTION private.notify_slot_change();
CREATE TRIGGER pt_exclusion_slot_change AFTER INSERT OR UPDATE OR DELETE ON public.pt_session_exclusions
FOR EACH ROW EXECUTE FUNCTION private.notify_slot_change();
CREATE TRIGGER pt_payer_slot_change AFTER INSERT OR UPDATE OR DELETE ON public.pt_session_payers
FOR EACH ROW EXECUTE FUNCTION private.notify_slot_change();

-- Session lifecycle. Callers hold the slot lock.
CREATE FUNCTION private.pt_compatible(target uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT (SELECT count(*) FROM public.bookings b WHERE b.slot_id = target)
      <= (SELECT st.max_participants FROM public.pt_settings st)
    AND NOT EXISTS (
      SELECT 1 FROM public.bookings b JOIN public.slots s ON s.id = b.slot_id
      WHERE b.slot_id = target AND NOT private.pt_is_member(b.user_id, s.date)
    );
$$;
CREATE FUNCTION private.pt_activate(target uuid, src text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.slots s SET max_capacity = st.max_participants, min_capacity = 1, updated_at = clock_timestamp()
  FROM public.pt_settings st WHERE s.id = target AND NOT private.pt_slot_started(s);
  INSERT INTO public.pt_sessions AS p (slot_id, source, price_cents)
  SELECT target, src, st.session_price_cents FROM public.pt_settings st
  ON CONFLICT ON CONSTRAINT pt_sessions_pkey DO UPDATE SET status = 'active', voided_reason = NULL, voided_at = NULL;
END;
$$;
CREATE FUNCTION private.pt_restore_space_capacity(target uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE public.slots s SET max_capacity = sp.max_capacity, min_capacity = sp.min_capacity, updated_at = clock_timestamp()
  FROM public.spaces sp WHERE sp.id = s.space_id AND s.id = target AND NOT private.pt_slot_started(s);
$$;

-- New slots of is_pt time ranges become PT sessions with PT capacity.
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
    WHERE sp.is_active AND extract(isodow FROM d.day)::int = t.day_of_week
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

-- Booking: PT slots need an active membership and ignore the one-per-day rule.
CREATE OR REPLACE FUNCTION public.create_booking(slot_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  target public.slots;
  space public.spaces;
  account auth.users;
  booking_id uuid;
  pt_slot boolean;
BEGIN
  IF NOT public.is_allowed() OR (public.is_trainer() AND NOT public.is_admin()) THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;
  SELECT sp.* INTO space FROM public.spaces sp
    JOIN public.slots s ON s.space_id = sp.id WHERE s.id = $1 FOR UPDATE OF sp;
  SELECT * INTO target FROM public.slots WHERE id = $1 FOR UPDATE;
  IF target.id IS NULL OR NOT space.is_active OR target.is_cancelled THEN
    RAISE EXCEPTION 'Slot unavailable';
  END IF;
  IF (target.date + target.start_time) AT TIME ZONE 'Europe/Rome' <= clock_timestamp() + interval '15 minutes' THEN
    RAISE EXCEPTION 'Bookings close 15 minutes before start';
  END IF;
  pt_slot := EXISTS (SELECT 1 FROM public.pt_sessions p WHERE p.slot_id = $1 AND p.status = 'active');
  IF pt_slot AND NOT private.pt_is_member(auth.uid(), target.date) THEN
    RAISE EXCEPTION 'PT membership required';
  END IF;
  IF (SELECT count(*) FROM public.bookings b WHERE b.slot_id = $1) >= target.max_capacity THEN
    RAISE EXCEPTION 'Slot full';
  END IF;
  IF NOT pt_slot AND NOT space.allow_multiple_bookings AND EXISTS (
    SELECT 1 FROM public.bookings b JOIN public.slots s ON s.id = b.slot_id
    WHERE b.user_id = auth.uid() AND s.space_id = target.space_id AND s.date = target.date AND NOT s.is_cancelled
      AND NOT EXISTS (SELECT 1 FROM public.pt_sessions p WHERE p.slot_id = s.id AND p.status = 'active')
  ) THEN RAISE EXCEPTION 'Already booked for this space and date'; END IF;
  SELECT * INTO account FROM auth.users WHERE id = auth.uid();
  INSERT INTO public.bookings (slot_id, user_id, user_email, user_name, user_avatar_url)
  VALUES ($1, account.id, account.email,
    coalesce(nullif(account.raw_user_meta_data->>'full_name', ''), account.email),
    account.raw_user_meta_data->>'avatar_url') RETURNING id INTO booking_id;
  RETURN booking_id;
END;
$$;
CREATE OR REPLACE FUNCTION private.cancel_underfilled_slots() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE locked_space_id uuid;
BEGIN
  -- Same lock order as booking RPCs. Fresh count after acquiring the lock.
  -- PT sessions are never cancelled for missing the minimum.
  FOR locked_space_id IN SELECT id FROM public.spaces ORDER BY id LOOP
    PERFORM id FROM public.spaces WHERE id = locked_space_id FOR UPDATE;
    UPDATE public.slots s SET is_cancelled = true, updated_at = clock_timestamp()
    WHERE s.space_id = locked_space_id AND NOT s.is_cancelled
      AND (s.date + s.start_time) AT TIME ZONE 'Europe/Rome' <= clock_timestamp() + interval '15 minutes'
      AND (s.date + s.end_time) AT TIME ZONE 'Europe/Rome' > clock_timestamp()
      AND (SELECT count(*) FROM public.bookings b WHERE b.slot_id = s.id) < s.min_capacity
      AND NOT EXISTS (SELECT 1 FROM public.pt_sessions p WHERE p.slot_id = s.id AND p.status = 'active');
  END LOOP;
END;
$$;

-- Billing engine (docs/PERSONAL-TRAINER.md "Regola di calcolo"), shared by
-- reconcile and preview. Rows with user_id NULL are per-session summaries
-- (amount 0, details: mode/unit_cents/presences/members). extra_slot simulates
-- one more presence there (sentinel user ffffffff-…, already a member).
-- Charge rows: one per (slot, user, mode); amount_cents > 0 is a cost.
CREATE FUNCTION private.pt_compute_day(d date, extra_slot uuid DEFAULT NULL)
RETURNS TABLE (slot_id uuid, user_id uuid, amount_cents integer, details jsonb, description text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH sess AS (
    SELECT s.id, s.start_time, s.end_time, p.price_cents AS price, p.billing_mode AS billing
    FROM public.pt_sessions p JOIN public.slots s ON s.id = p.slot_id
    WHERE s.date = d AND p.status = 'active' AND NOT s.is_cancelled
  ), members AS (
    SELECT DISTINCT m.user_id FROM public.pt_memberships m
    WHERE m.valid_from <= d AND (m.valid_to IS NULL OR m.valid_to >= d)
  ), pres AS (
    SELECT b.slot_id, b.user_id, se.start_time FROM public.bookings b
    JOIN sess se ON se.id = b.slot_id JOIN members mb ON mb.user_id = b.user_id
    WHERE NOT EXISTS (
      SELECT 1 FROM public.pt_session_exclusions e WHERE e.slot_id = b.slot_id AND e.user_id = b.user_id
    )
    UNION ALL
    SELECT se.id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid, se.start_time FROM sess se WHERE se.id = extra_slot
  ), counted AS (
    SELECT se.*, (SELECT count(*) FROM pres p WHERE p.slot_id = se.id)::int AS n,
      (SELECT count(*) FROM public.pt_session_payers py WHERE py.slot_id = se.id)::int AS payers
    FROM sess se
  ), dayinfo AS (
    -- Case A: a full auto session or any custom session. Otherwise case B.
    SELECT EXISTS (
      SELECT 1 FROM counted c WHERE c.billing = 'custom' OR c.n >= st.full_session_min
    ) AS pooled_day FROM public.pt_settings st
  ), shared AS (
    SELECT c.* FROM counted c CROSS JOIN dayinfo i WHERE NOT i.pooled_day AND c.billing = 'auto'
    ORDER BY c.n = 0, c.start_time, c.end_time, c.id LIMIT 1
  ), eligible AS (
    SELECT mb.user_id, row_number() OVER (ORDER BY mb.user_id) AS rn FROM members mb
    WHERE NOT EXISTS (
      SELECT 1 FROM public.pt_session_exclusions e JOIN sess se ON se.id = e.slot_id WHERE e.user_id = mb.user_id
    )
  ), eligible_count AS (
    SELECT count(*)::int AS cnt FROM eligible
  ), pool AS (
    -- Case A: all done auto sessions. Case B: done sessions other than the shared one,
    -- divided by the presences of all done sessions.
    SELECT coalesce(sum(c.price) FILTER (WHERE c.id IS DISTINCT FROM (SELECT sh.id FROM shared sh)), 0)::int AS cents,
      coalesce(sum(c.n), 0)::int AS units
    FROM counted c WHERE c.billing = 'auto' AND c.n > 0
  ), pooled AS (
    SELECT p.slot_id, p.user_id, row_number() OVER (ORDER BY p.user_id, p.start_time, p.slot_id) AS rn
    FROM pres p JOIN counted c ON c.id = p.slot_id WHERE c.billing = 'auto'
  ), payers AS (
    SELECT py.slot_id, py.user_id, row_number() OVER (PARTITION BY py.slot_id ORDER BY py.user_id) AS rn
    FROM public.pt_session_payers py JOIN counted c ON c.id = py.slot_id WHERE c.billing = 'custom'
  ), charges AS (
    SELECT r.slot_id, r.user_id, pool.cents / pool.units + (r.rn <= pool.cents % pool.units)::int AS amount,
      jsonb_build_object('mode', 'pooled', 'price_cents', c.price, 'pool_cents', pool.cents,
        'units', pool.units, 'presences', c.n) AS details,
      format('Seduta %s %s · %s divisi su %s', to_char(d, 'DD/MM'), to_char(c.start_time, 'HH24:MI'),
        private.pt_eur(pool.cents), private.pt_count(pool.units, 'presenza', 'presenze')) AS description
    FROM pooled r JOIN counted c ON c.id = r.slot_id CROSS JOIN pool WHERE pool.cents > 0
    UNION ALL
    SELECT sh.id, e.user_id, sh.price / ec.cnt + (e.rn <= sh.price % ec.cnt)::int,
      jsonb_build_object('mode', 'shared', 'price_cents', sh.price, 'pool_cents', sh.price,
        'units', ec.cnt, 'presences', sh.n),
      format('Quota condivisa %s · %s, %s divisi tra %s', to_char(d, 'DD/MM'),
        CASE WHEN sh.n = 0 THEN 'seduta senza presenze' ELSE 'seduta con ' || private.pt_count(sh.n, 'presenza', 'presenze') END,
        private.pt_eur(sh.price), private.pt_count(ec.cnt, 'iscritto', 'iscritti'))
    FROM shared sh CROSS JOIN eligible e CROSS JOIN eligible_count ec
    UNION ALL
    SELECT c.id, py.user_id, c.price / c.payers + (py.rn <= c.price % c.payers)::int,
      jsonb_build_object('mode', 'custom', 'price_cents', c.price, 'pool_cents', c.price,
        'units', c.payers, 'presences', c.n),
      format('Seduta %s %s · %s divisi tra %s', to_char(d, 'DD/MM'), to_char(c.start_time, 'HH24:MI'),
        private.pt_eur(c.price), private.pt_count(c.payers, 'pagante', 'paganti'))
    FROM payers py JOIN counted c ON c.id = py.slot_id
  ), summary AS (
    SELECT c.id, m.mode, jsonb_build_object('mode', m.mode, 'price_cents', c.price, 'presences', c.n,
        'members', ec.cnt, 'pool_cents', pool.cents, 'units', pool.units,
        'unit_cents', CASE m.mode
          WHEN 'custom' THEN round(c.price::numeric / nullif(c.payers, 0))
          WHEN 'shared' THEN round(c.price::numeric / nullif(ec.cnt, 0))
          WHEN 'pooled' THEN round(pool.cents::numeric / nullif(pool.units, 0))
        END) AS details
    FROM counted c CROSS JOIN pool CROSS JOIN eligible_count ec
    CROSS JOIN LATERAL (SELECT CASE
      WHEN c.billing = 'custom' THEN 'custom'
      WHEN c.id = (SELECT sh.id FROM shared sh) THEN 'shared'
      WHEN c.n > 0 THEN 'pooled'
      ELSE 'free' END AS mode) m
  )
  SELECT r.slot_id, r.user_id, r.amount, r.details, r.description FROM charges r WHERE r.amount > 0
  UNION ALL
  SELECT s.id, NULL, 0, s.details, NULL FROM summary s;
$$;

-- Last active session of the day has ended (Europe/Rome). Days with only voided
-- sessions close when their last slot ends.
CREATE FUNCTION private.pt_day_closed(d date) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(clock_timestamp() >= coalesce(
    max((s.date + s.end_time) AT TIME ZONE 'Europe/Rome') FILTER (WHERE p.status = 'active' AND NOT s.is_cancelled),
    max((s.date + s.end_time) AT TIME ZONE 'Europe/Rome')), false)
  FROM public.pt_sessions p JOIN public.slots s ON s.id = p.slot_id WHERE s.date = d;
$$;

-- Writes only the difference between expected and posted per (day, slot, user, mode).
-- Days with active sessions are reconciled only once closed; days without active
-- sessions are always reconciled (their posted charges are reversed).
CREATE FUNCTION private.pt_reconcile_day(d date, reason text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE inserted integer; motive text := coalesce(nullif(trim(reason), ''), 'ricalcolo');
BEGIN
  PERFORM pg_advisory_xact_lock(715021100, d - date '2000-01-01');
  IF EXISTS (
    SELECT 1 FROM public.pt_sessions p JOIN public.slots s ON s.id = p.slot_id
    WHERE s.date = d AND p.status = 'active' AND NOT s.is_cancelled
  ) AND NOT private.pt_day_closed(d) THEN
    RETURN 0;
  END IF;
  WITH expected AS (
    SELECT c.slot_id, c.user_id, c.details->>'mode' AS mode, c.amount_cents AS cents, c.details, c.description
    FROM private.pt_compute_day(d) c WHERE c.user_id IS NOT NULL
  ), posted AS (
    SELECT w.slot_id, w.user_id, w.details->>'mode' AS mode, -sum(w.amount_cents)::int AS cents
    FROM public.pt_wallet_entries w
    WHERE w.session_date = d AND w.kind IN ('charge', 'adjustment') AND w.slot_id IS NOT NULL
    GROUP BY 1, 2, 3
  ), delta AS (
    SELECT coalesce(e.slot_id, p.slot_id) AS slot_id, coalesce(e.user_id, p.user_id) AS user_id,
      coalesce(e.mode, p.mode) AS mode, coalesce(e.cents, 0) AS expected_cents, coalesce(p.cents, 0) AS posted_cents,
      p.slot_id IS NULL AS first_charge, e.details, e.description
    FROM expected e FULL JOIN posted p ON p.slot_id = e.slot_id AND p.user_id = e.user_id AND p.mode = e.mode
  ), ins AS (
    INSERT INTO public.pt_wallet_entries
      (user_id, amount_cents, kind, session_date, slot_id, session_start, description, details, created_by_name)
    SELECT x.user_id, x.posted_cents - x.expected_cents,
      CASE WHEN x.first_charge THEN 'charge' ELSE 'adjustment' END, d, x.slot_id, s.start_time,
      CASE WHEN x.first_charge THEN x.description
        ELSE format('Rettifica %s %s · %s', to_char(d, 'DD/MM'), to_char(s.start_time, 'HH24:MI'), motive) END,
      CASE WHEN x.first_charge THEN x.details
        ELSE jsonb_build_object('reason', motive, 'mode', x.mode,
          'previous_cents', x.posted_cents, 'expected_cents', x.expected_cents) END,
      private.pt_actor_name()
    FROM delta x JOIN public.slots s ON s.id = x.slot_id
    WHERE x.expected_cents <> x.posted_cents
    ORDER BY s.start_time, x.user_id
    RETURNING 1
  )
  SELECT count(*) INTO inserted FROM ins;
  RETURN inserted;
END;
$$;
CREATE FUNCTION private.pt_reconcile_recent() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE d date; total integer := 0;
BEGIN
  FOR d IN SELECT g::date FROM generate_series(private.pt_today() - 13, private.pt_today(), interval '1 day') g LOOP
    total := total + private.pt_reconcile_day(d, 'ricalcolo automatico');
  END LOOP;
  RETURN total;
END;
$$;
-- Closed days with PT sessions or posted charges inside any of the given ranges.
CREATE FUNCTION private.pt_reconcile_ranges(ranges daterange[], reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE d date;
BEGIN
  FOR d IN
    SELECT s.date FROM public.pt_sessions p JOIN public.slots s ON s.id = p.slot_id
    WHERE s.date <= private.pt_today() AND s.date <@ ANY(ranges)
    UNION
    SELECT w.session_date FROM public.pt_wallet_entries w
    WHERE w.session_date <= private.pt_today() AND w.session_date <@ ANY(ranges)
    ORDER BY 1
  LOOP
    PERFORM private.pt_reconcile_day(d, reason);
  END LOOP;
END;
$$;

-- Schedule sync for one space (caller checks admin). Creates sessions for future
-- slots of is_pt ranges (skipping slots with incompatible bookings) and removes
-- 'schedule' sessions whose range is no longer is_pt. Never touches manual/voided.
CREATE FUNCTION private.pt_sync_schedule(target_space uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE changed integer := 0; slot record;
BEGIN
  PERFORM id FROM public.spaces WHERE id = target_space FOR UPDATE;
  FOR slot IN
    SELECT s.id, p.slot_id IS NOT NULL AS has_session,
      EXISTS (
        SELECT 1 FROM public.space_time_slots t
        WHERE t.space_id = s.space_id AND t.is_pt AND t.day_of_week = extract(isodow FROM s.date)::int
          AND t.start_time = s.start_time AND t.end_time = s.end_time
      ) AS wanted
    FROM public.slots s LEFT JOIN public.pt_sessions p ON p.slot_id = s.id
    WHERE s.space_id = target_space AND NOT s.is_cancelled AND NOT private.pt_slot_started(s)
      AND (p.slot_id IS NULL OR (p.source = 'schedule' AND p.status = 'active'))
    ORDER BY s.date, s.start_time
    FOR UPDATE OF s
  LOOP
    IF slot.wanted AND NOT slot.has_session AND private.pt_compatible(slot.id) THEN
      PERFORM private.pt_activate(slot.id, 'schedule');
      changed := changed + 1;
    ELSIF NOT slot.wanted AND slot.has_session THEN
      DELETE FROM public.pt_sessions WHERE pt_sessions.slot_id = slot.id;
      DELETE FROM public.pt_session_exclusions WHERE pt_session_exclusions.slot_id = slot.id;
      DELETE FROM public.pt_session_payers WHERE pt_session_payers.slot_id = slot.id;
      PERFORM private.pt_restore_space_capacity(slot.id);
      changed := changed + 1;
    END IF;
  END LOOP;
  RETURN changed;
END;
$$;

-- User RPCs.
CREATE FUNCTION public.pt_my_status()
RETURNS TABLE (is_member boolean, valid_from date, valid_to date, ever_member boolean, balance_cents integer,
  low_balance_threshold_cents integer, session_price_cents integer, max_participants integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
#variable_conflict use_column
DECLARE today date := private.pt_today();
BEGIN
  IF NOT public.is_allowed() THEN RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  SELECT private.pt_is_member(auth.uid(), today), m.valid_from, m.valid_to,
    EXISTS (SELECT 1 FROM public.pt_memberships x WHERE x.user_id = auth.uid()),
    (SELECT coalesce(sum(w.amount_cents), 0)::int FROM public.pt_wallet_entries w WHERE w.user_id = auth.uid()),
    st.low_balance_threshold_cents, st.session_price_cents, st.max_participants
  FROM public.pt_settings st
  LEFT JOIN LATERAL (
    -- Current period, else the next upcoming one, else the most recent.
    SELECT x.valid_from, x.valid_to FROM public.pt_memberships x WHERE x.user_id = auth.uid()
    ORDER BY CASE WHEN x.valid_from <= today AND (x.valid_to IS NULL OR x.valid_to >= today) THEN 0
        WHEN x.valid_from > today THEN 1 ELSE 2 END,
      CASE WHEN x.valid_from > today THEN x.valid_from END, x.valid_from DESC
    LIMIT 1
  ) m ON true;
END;
$$;
-- Members, admins and any allowed user except trainers (no amounts for trainers).
-- my_cents is NULL for callers who are not members on that day.
CREATE FUNCTION public.pt_day_preview(d date)
RETURNS TABLE (slot_id uuid, status text, presences integer, mode text, unit_cents integer, my_cents integer,
  members integer, next_unit_cents integer, day_closed boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
#variable_conflict use_column
DECLARE caller_member boolean; closed boolean; member_count integer;
BEGIN
  IF NOT public.is_allowed() OR (public.is_trainer() AND NOT public.is_admin()) THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;
  caller_member := private.pt_is_member(auth.uid(), $1);
  closed := private.pt_day_closed($1);
  SELECT count(*) INTO member_count FROM public.pt_memberships m
  WHERE m.valid_from <= $1 AND (m.valid_to IS NULL OR m.valid_to >= $1)
    AND NOT EXISTS (
      SELECT 1 FROM public.pt_session_exclusions e JOIN public.pt_sessions p ON p.slot_id = e.slot_id
      JOIN public.slots s ON s.id = e.slot_id
      WHERE e.user_id = m.user_id AND s.date = $1 AND p.status = 'active' AND NOT s.is_cancelled
    );
  RETURN QUERY
  WITH calc AS (SELECT * FROM private.pt_compute_day($1))
  SELECT p.slot_id, p.status,
    CASE WHEN sm.details IS NOT NULL THEN (sm.details->>'presences')::int ELSE 0 END,
    coalesce(sm.details->>'mode', 'voided'),
    (sm.details->>'unit_cents')::int,
    CASE WHEN caller_member THEN coalesce((
      SELECT sum(c.amount_cents) FROM calc c WHERE c.slot_id = p.slot_id AND c.user_id = auth.uid()
    ), 0)::int END,
    member_count,
    CASE WHEN sm.details IS NOT NULL AND (SELECT count(*) FROM public.bookings b WHERE b.slot_id = s.id) < s.max_capacity
      THEN (SELECT (x.details->>'unit_cents')::int FROM private.pt_compute_day($1, s.id) x
            WHERE x.slot_id = s.id AND x.user_id IS NULL) END,
    closed
  FROM public.pt_sessions p JOIN public.slots s ON s.id = p.slot_id
  LEFT JOIN calc sm ON sm.slot_id = p.slot_id AND sm.user_id IS NULL
  WHERE s.date = $1
  ORDER BY s.start_time, s.end_time, s.id;
END;
$$;

-- Trainer RPC (also admins): sessions and who is booked, no amounts.
CREATE FUNCTION public.pt_trainer_sessions(from_date date, to_date date)
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
  WHERE s.date BETWEEN $1 AND $2
  ORDER BY s.date, s.start_time, sp.sort_order, sp.name;
END;
$$;

-- Admin RPCs.
CREATE FUNCTION public.admin_list_users()
RETURNS TABLE (user_id uuid, email text, full_name text, avatar_url text, last_sign_in_at timestamptz,
  is_admin boolean, is_trainer boolean, pt_active boolean, pt_valid_from date, pt_valid_to date, balance_cents integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
#variable_conflict use_column
DECLARE today date := private.pt_today();
BEGIN
  PERFORM private.pt_require_admin();
  RETURN QUERY
  SELECT u.id, u.email::text, nullif(u.raw_user_meta_data->>'full_name', ''), nullif(u.raw_user_meta_data->>'avatar_url', ''),
    u.last_sign_in_at,
    EXISTS (SELECT 1 FROM public.admins a WHERE a.email = lower(u.email)),
    EXISTS (SELECT 1 FROM public.pt_trainers t WHERE t.email = lower(u.email)),
    private.pt_is_member(u.id, today), m.valid_from, m.valid_to,
    (SELECT coalesce(sum(w.amount_cents), 0)::int FROM public.pt_wallet_entries w WHERE w.user_id = u.id)
  FROM auth.users u
  LEFT JOIN LATERAL (
    -- Current period, else the latest one (possibly in the future).
    SELECT x.valid_from, x.valid_to FROM public.pt_memberships x WHERE x.user_id = u.id
    ORDER BY (x.valid_from <= today AND (x.valid_to IS NULL OR x.valid_to >= today)) DESC, x.valid_from DESC
    LIMIT 1
  ) m ON true
  ORDER BY lower(coalesce(nullif(u.raw_user_meta_data->>'full_name', ''), u.email));
END;
$$;
CREATE FUNCTION public.pt_save_membership(membership_id uuid, user_id uuid, valid_from date, valid_to date) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
#variable_conflict use_column
DECLARE prev public.pt_memberships; saved uuid;
BEGIN
  PERFORM private.pt_require_admin();
  IF $3 IS NULL OR $4 < $3 THEN RAISE EXCEPTION 'Invalid period'; END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = $2) THEN RAISE EXCEPTION 'User not found'; END IF;
  PERFORM private.pt_lock_all_spaces();
  PERFORM pg_advisory_xact_lock(715021101, hashtext($2::text));
  IF $1 IS NOT NULL THEN
    SELECT * INTO prev FROM public.pt_memberships m WHERE m.id = $1 FOR UPDATE;
    IF prev.id IS NULL OR prev.user_id <> $2 THEN RAISE EXCEPTION 'Membership not found'; END IF;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.pt_memberships m
    WHERE m.user_id = $2 AND m.id IS DISTINCT FROM $1
      AND daterange(m.valid_from, m.valid_to, '[]') && daterange($3, $4, '[]')
  ) THEN RAISE EXCEPTION 'Membership overlap'; END IF;
  IF $1 IS NULL THEN
    INSERT INTO public.pt_memberships (user_id, valid_from, valid_to) VALUES ($2, $3, $4) RETURNING id INTO saved;
  ELSE
    UPDATE public.pt_memberships m SET valid_from = $3, valid_to = $4 WHERE m.id = $1 RETURNING m.id INTO saved;
  END IF;
  -- Future PT bookings no longer covered by any period are cancelled.
  DELETE FROM public.bookings b USING public.slots s, public.pt_sessions p
  WHERE b.user_id = $2 AND s.id = b.slot_id AND p.slot_id = s.id AND p.status = 'active'
    AND NOT private.pt_slot_started(s) AND NOT private.pt_is_member(b.user_id, s.date);
  PERFORM private.pt_reconcile_ranges(
    array_remove(ARRAY[CASE WHEN prev.id IS NOT NULL THEN daterange(prev.valid_from, prev.valid_to, '[]') END,
      daterange($3, $4, '[]')], NULL),
    'iscrizione modificata dall''admin');
  RETURN saved;
END;
$$;
CREATE FUNCTION public.pt_delete_membership(membership_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
#variable_conflict use_column
DECLARE prev public.pt_memberships;
BEGIN
  PERFORM private.pt_require_admin();
  PERFORM private.pt_lock_all_spaces();
  SELECT * INTO prev FROM public.pt_memberships m WHERE m.id = $1;
  IF prev.id IS NULL THEN RAISE EXCEPTION 'Membership not found'; END IF;
  PERFORM pg_advisory_xact_lock(715021101, hashtext(prev.user_id::text));
  DELETE FROM public.pt_memberships m WHERE m.id = $1;
  DELETE FROM public.bookings b USING public.slots s, public.pt_sessions p
  WHERE b.user_id = prev.user_id AND s.id = b.slot_id AND p.slot_id = s.id AND p.status = 'active'
    AND NOT private.pt_slot_started(s) AND NOT private.pt_is_member(b.user_id, s.date);
  PERFORM private.pt_reconcile_ranges(ARRAY[daterange(prev.valid_from, prev.valid_to, '[]')],
    'iscrizione eliminata dall''admin');
END;
$$;
CREATE FUNCTION public.pt_add_wallet_entry(user_id uuid, amount_cents integer, kind text, note text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
#variable_conflict use_column
DECLARE created uuid; clean_note text := nullif(trim($4), '');
BEGIN
  PERFORM private.pt_require_admin();
  IF $3 IS NULL OR $3 NOT IN ('topup', 'manual') THEN RAISE EXCEPTION 'Invalid kind'; END IF;
  IF $2 IS NULL OR $2 = 0 OR ($3 = 'topup' AND $2 < 0) THEN RAISE EXCEPTION 'Invalid amount'; END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = $1) THEN RAISE EXCEPTION 'User not found'; END IF;
  INSERT INTO public.pt_wallet_entries (user_id, amount_cents, kind, description, details, created_by_name)
  VALUES ($1, $2, $3,
    CASE WHEN $3 = 'topup' THEN 'Ricarica' ELSE 'Rettifica manuale' END || coalesce(' · ' || clean_note, ''),
    jsonb_build_object('note', clean_note), private.pt_actor_name())
  RETURNING id INTO created;
  RETURN created;
END;
$$;
CREATE FUNCTION public.pt_void_session(slot_id uuid, reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
#variable_conflict use_column
DECLARE target public.slots; sess public.pt_sessions; motive text := nullif(trim($2), '');
BEGIN
  PERFORM private.pt_require_admin();
  target := private.pt_lock_slot($1);
  SELECT * INTO sess FROM public.pt_sessions p WHERE p.slot_id = $1 FOR UPDATE;
  IF sess.slot_id IS NULL THEN RAISE EXCEPTION 'Session not found'; END IF;
  IF sess.status = 'voided' THEN RETURN; END IF;
  UPDATE public.pt_sessions p SET status = 'voided', voided_reason = motive, voided_at = clock_timestamp()
  WHERE p.slot_id = $1;
  -- Not started yet: back to a normal slot of the space; bookings stay.
  PERFORM private.pt_restore_space_capacity($1);
  PERFORM private.pt_reconcile_day(target.date,
    format('seduta delle %s annullata dall''admin', to_char(target.start_time, 'HH24:MI')) || coalesce(': ' || motive, ''));
END;
$$;
CREATE FUNCTION public.pt_restore_session(slot_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
#variable_conflict use_column
DECLARE target public.slots; sess public.pt_sessions;
BEGIN
  PERFORM private.pt_require_admin();
  target := private.pt_lock_slot($1);
  SELECT * INTO sess FROM public.pt_sessions p WHERE p.slot_id = $1 FOR UPDATE;
  IF sess.slot_id IS NULL THEN RAISE EXCEPTION 'Session not found'; END IF;
  IF sess.status = 'active' THEN RETURN; END IF;
  IF NOT private.pt_slot_started(target) AND NOT private.pt_compatible($1) THEN
    RAISE EXCEPTION 'Slot has incompatible bookings';
  END IF;
  PERFORM private.pt_activate($1, sess.source);
  PERFORM private.pt_reconcile_day(target.date, format('seduta delle %s ripristinata dall''admin', to_char(target.start_time, 'HH24:MI')));
END;
$$;
CREATE FUNCTION public.pt_create_session(slot_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
#variable_conflict use_column
DECLARE target public.slots; sess public.pt_sessions;
BEGIN
  PERFORM private.pt_require_admin();
  target := private.pt_lock_slot($1);
  IF target.id IS NULL OR target.is_cancelled THEN RAISE EXCEPTION 'Slot unavailable'; END IF;
  IF private.pt_slot_started(target) THEN RAISE EXCEPTION 'Slot already started'; END IF;
  SELECT * INTO sess FROM public.pt_sessions p WHERE p.slot_id = $1 FOR UPDATE;
  IF sess.status = 'active' THEN RETURN; END IF;
  IF NOT private.pt_compatible($1) THEN RAISE EXCEPTION 'Slot has incompatible bookings'; END IF;
  PERFORM private.pt_activate($1, coalesce(sess.source, 'manual'));
  PERFORM private.pt_reconcile_day(target.date, format('seduta delle %s aggiunta dall''admin', to_char(target.start_time, 'HH24:MI')));
END;
$$;
CREATE FUNCTION public.pt_set_exclusion(slot_id uuid, user_id uuid, excluded boolean, reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
#variable_conflict use_column
DECLARE target public.slots; motive text := nullif(trim($4), '');
BEGIN
  PERFORM private.pt_require_admin();
  target := private.pt_lock_slot($1);
  IF NOT EXISTS (SELECT 1 FROM public.pt_sessions p WHERE p.slot_id = $1) THEN RAISE EXCEPTION 'Session not found'; END IF;
  IF $3 THEN
    IF NOT private.pt_is_member($2, target.date) THEN RAISE EXCEPTION 'PT membership required'; END IF;
    INSERT INTO public.pt_session_exclusions AS e (slot_id, user_id, reason) VALUES ($1, $2, motive)
    ON CONFLICT ON CONSTRAINT pt_session_exclusions_pkey DO UPDATE SET reason = EXCLUDED.reason;
  ELSE
    DELETE FROM public.pt_session_exclusions e WHERE e.slot_id = $1 AND e.user_id = $2;
  END IF;
  PERFORM private.pt_reconcile_day(target.date,
    format(CASE WHEN $3 THEN 'esclusione dalla seduta delle %s' ELSE 'esclusione dalla seduta delle %s rimossa dall''admin' END,
      to_char(target.start_time, 'HH24:MI')) || CASE WHEN $3 THEN coalesce(': ' || motive, '') ELSE '' END);
END;
$$;
CREATE FUNCTION public.pt_set_payers(slot_id uuid, user_ids uuid[], reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
#variable_conflict use_column
DECLARE target public.slots; motive text := nullif(trim($3), ''); ids uuid[];
BEGIN
  PERFORM private.pt_require_admin();
  target := private.pt_lock_slot($1);
  IF NOT EXISTS (SELECT 1 FROM public.pt_sessions p WHERE p.slot_id = $1) THEN RAISE EXCEPTION 'Session not found'; END IF;
  SELECT coalesce(array_agg(DISTINCT t.u), '{}') INTO ids FROM unnest(coalesce($2, '{}')) AS t(u) WHERE t.u IS NOT NULL;
  IF EXISTS (SELECT 1 FROM unnest(ids) AS t(u) WHERE NOT private.pt_is_member(t.u, target.date)) THEN
    RAISE EXCEPTION 'PT membership required';
  END IF;
  DELETE FROM public.pt_session_payers py WHERE py.slot_id = $1;
  INSERT INTO public.pt_session_payers (slot_id, user_id) SELECT $1, t.u FROM unnest(ids) AS t(u);
  UPDATE public.pt_sessions p SET billing_mode = CASE WHEN cardinality(ids) > 0 THEN 'custom' ELSE 'auto' END
  WHERE p.slot_id = $1;
  PERFORM private.pt_reconcile_day(target.date,
    format('paganti della seduta delle %s modificati dall''admin', to_char(target.start_time, 'HH24:MI')) || coalesce(': ' || motive, ''));
END;
$$;
-- New price/capacity apply to days not closed yet; closed days keep their snapshot.
CREATE FUNCTION public.pt_update_settings(session_price_cents integer, low_balance_threshold_cents integer,
  max_participants integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
#variable_conflict use_column
BEGIN
  PERFORM private.pt_require_admin();
  IF $1 IS NULL OR $1 <= 0 OR $2 IS NULL OR $2 < 0 THEN RAISE EXCEPTION 'Invalid amount'; END IF;
  IF $3 IS NULL OR $3 NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid capacity'; END IF;
  PERFORM private.pt_lock_all_spaces();
  UPDATE public.pt_settings st
  SET session_price_cents = $1, low_balance_threshold_cents = $2, max_participants = $3, updated_at = clock_timestamp();
  UPDATE public.pt_sessions p SET price_cents = $1
  FROM public.slots s
  WHERE s.id = p.slot_id AND p.price_cents <> $1 AND s.date >= private.pt_today() - 1 AND NOT private.pt_day_closed(s.date);
  UPDATE public.slots s
  SET max_capacity = greatest($3, (SELECT count(*) FROM public.bookings b WHERE b.slot_id = s.id)::int),
    updated_at = clock_timestamp()
  FROM public.pt_sessions p
  WHERE p.slot_id = s.id AND p.status = 'active' AND NOT private.pt_slot_started(s)
    AND s.max_capacity <> greatest($3, (SELECT count(*) FROM public.bookings b WHERE b.slot_id = s.id)::int);
END;
$$;
CREATE FUNCTION public.pt_sync_schedule(space_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.pt_require_admin();
  RETURN private.pt_sync_schedule($1);
END;
$$;
-- charges: expected amounts for open days, posted net per user for closed days.
-- amount_cents/total_cents are positive costs.
CREATE FUNCTION public.pt_admin_sessions(from_date date, to_date date)
RETURNS TABLE (slot_id uuid, space_id uuid, space_name text, date date, start_time time, end_time time, status text,
  source text, billing_mode text, price_cents integer, voided_reason text, day_closed boolean, mode text,
  participants jsonb, exclusions jsonb, payers jsonb, charges jsonb, total_cents integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
#variable_conflict use_column
BEGIN
  PERFORM private.pt_require_admin();
  PERFORM private.pt_check_range($1, $2);
  RETURN QUERY
  WITH days AS (
    SELECT DISTINCT s.date AS day, private.pt_day_closed(s.date) AS closed
    FROM public.pt_sessions p JOIN public.slots s ON s.id = p.slot_id WHERE s.date BETWEEN $1 AND $2
  ), calc AS (
    SELECT c.* FROM days dy CROSS JOIN LATERAL private.pt_compute_day(dy.day) c
  ), charged AS (
    SELECT c.slot_id, c.user_id, sum(c.amount_cents)::int AS cents
    FROM calc c JOIN public.slots s ON s.id = c.slot_id JOIN days dy ON dy.day = s.date
    WHERE c.user_id IS NOT NULL AND NOT dy.closed GROUP BY 1, 2
    UNION ALL
    SELECT w.slot_id, w.user_id, -sum(w.amount_cents)::int
    FROM public.pt_wallet_entries w JOIN days dy ON dy.day = w.session_date
    WHERE dy.closed AND w.kind IN ('charge', 'adjustment') AND w.slot_id IS NOT NULL
    GROUP BY 1, 2 HAVING sum(w.amount_cents) <> 0
  ), charge_lists AS (
    SELECT ch.slot_id, jsonb_agg(jsonb_build_object('user_id', ch.user_id, 'name', private.pt_user_name(ch.user_id),
        'amount_cents', ch.cents) ORDER BY private.pt_user_name(ch.user_id), ch.user_id) AS list,
      sum(ch.cents)::int AS total
    FROM charged ch GROUP BY ch.slot_id
  )
  SELECT s.id, s.space_id, sp.name, s.date, s.start_time, s.end_time, p.status, p.source, p.billing_mode,
    p.price_cents, p.voided_reason, dy.closed,
    coalesce(sm.details->>'mode', 'voided'),
    coalesce((SELECT jsonb_agg(jsonb_build_object('user_id', b.user_id, 'name', b.user_name, 'email', b.user_email,
        'avatar_url', b.user_avatar_url, 'excluded', ex.user_id IS NOT NULL,
        'counted', p.status = 'active' AND NOT s.is_cancelled AND ex.user_id IS NULL
          AND private.pt_is_member(b.user_id, s.date)) ORDER BY b.created_at)
      FROM public.bookings b
      LEFT JOIN public.pt_session_exclusions ex ON ex.slot_id = b.slot_id AND ex.user_id = b.user_id
      WHERE b.slot_id = s.id), '[]'::jsonb),
    coalesce((SELECT jsonb_agg(jsonb_build_object('user_id', e.user_id, 'name', private.pt_user_name(e.user_id),
        'reason', e.reason) ORDER BY e.created_at)
      FROM public.pt_session_exclusions e WHERE e.slot_id = s.id), '[]'::jsonb),
    coalesce((SELECT jsonb_agg(jsonb_build_object('user_id', py.user_id, 'name', private.pt_user_name(py.user_id))
        ORDER BY py.created_at, py.user_id)
      FROM public.pt_session_payers py WHERE py.slot_id = s.id), '[]'::jsonb),
    coalesce(cl.list, '[]'::jsonb), coalesce(cl.total, 0)
  FROM public.pt_sessions p JOIN public.slots s ON s.id = p.slot_id JOIN public.spaces sp ON sp.id = s.space_id
  JOIN days dy ON dy.day = s.date
  LEFT JOIN calc sm ON sm.slot_id = s.id AND sm.user_id IS NULL
  LEFT JOIN charge_lists cl ON cl.slot_id = s.id
  ORDER BY s.date, s.start_time, sp.sort_order, sp.name;
END;
$$;
CREATE FUNCTION public.pt_low_balances()
RETURNS TABLE (user_id uuid, email text, full_name text, avatar_url text, balance_cents integer, pt_active boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
#variable_conflict use_column
BEGIN
  PERFORM private.pt_require_admin();
  RETURN QUERY
  SELECT x.id, x.email, x.full_name, x.avatar_url, x.balance, x.active
  FROM (
    SELECT u.id, u.email::text AS email, nullif(u.raw_user_meta_data->>'full_name', '') AS full_name,
      nullif(u.raw_user_meta_data->>'avatar_url', '') AS avatar_url,
      (SELECT coalesce(sum(w.amount_cents), 0)::int FROM public.pt_wallet_entries w WHERE w.user_id = u.id) AS balance,
      private.pt_is_member(u.id, private.pt_today()) AS active
    FROM auth.users u
  ) x, public.pt_settings st
  WHERE x.balance < st.low_balance_threshold_cents AND (x.active OR x.balance <> 0)
  ORDER BY x.balance, x.email;
END;
$$;

ALTER TABLE public.pt_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pt_trainers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pt_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pt_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pt_session_exclusions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pt_session_payers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pt_wallet_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY pt_settings_read ON public.pt_settings FOR SELECT TO authenticated USING (public.is_allowed());
CREATE POLICY pt_trainers_admin ON public.pt_trainers FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY pt_memberships_read ON public.pt_memberships FOR SELECT TO authenticated
USING (public.is_allowed() AND (user_id = auth.uid() OR public.is_admin()));
CREATE POLICY pt_sessions_read ON public.pt_sessions FOR SELECT TO authenticated USING (public.is_allowed());
CREATE POLICY pt_exclusions_read ON public.pt_session_exclusions FOR SELECT TO authenticated
USING (public.is_allowed() AND (user_id = auth.uid() OR public.is_admin()));
CREATE POLICY pt_payers_read ON public.pt_session_payers FOR SELECT TO authenticated
USING (public.is_allowed() AND (user_id = auth.uid() OR public.is_admin()));
CREATE POLICY pt_wallet_read ON public.pt_wallet_entries FOR SELECT TO authenticated
USING (public.is_allowed() AND (user_id = auth.uid() OR public.is_admin()));

REVOKE ALL ON public.pt_settings, public.pt_trainers, public.pt_memberships, public.pt_sessions,
  public.pt_session_exclusions, public.pt_session_payers, public.pt_wallet_entries FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.pt_settings, public.pt_trainers, public.pt_memberships, public.pt_sessions,
  public.pt_session_exclusions, public.pt_session_payers, public.pt_wallet_entries TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.pt_trainers TO authenticated;
GRANT ALL ON public.pt_settings, public.pt_trainers, public.pt_memberships, public.pt_sessions,
  public.pt_session_exclusions, public.pt_session_payers TO service_role;
GRANT SELECT, INSERT ON public.pt_wallet_entries TO service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_trainer(), public.pt_my_status(), public.pt_day_preview(date),
  public.pt_trainer_sessions(date, date), public.admin_list_users(), public.pt_save_membership(uuid, uuid, date, date),
  public.pt_delete_membership(uuid), public.pt_add_wallet_entry(uuid, integer, text, text),
  public.pt_void_session(uuid, text), public.pt_restore_session(uuid), public.pt_create_session(uuid),
  public.pt_set_exclusion(uuid, uuid, boolean, text), public.pt_set_payers(uuid, uuid[], text),
  public.pt_update_settings(integer, integer, integer), public.pt_sync_schedule(uuid),
  public.pt_admin_sessions(date, date), public.pt_low_balances() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_trainer(), public.pt_my_status(), public.pt_day_preview(date),
  public.pt_trainer_sessions(date, date), public.admin_list_users(), public.pt_save_membership(uuid, uuid, date, date),
  public.pt_delete_membership(uuid), public.pt_add_wallet_entry(uuid, integer, text, text),
  public.pt_void_session(uuid, text), public.pt_restore_session(uuid), public.pt_create_session(uuid),
  public.pt_set_exclusion(uuid, uuid, boolean, text), public.pt_set_payers(uuid, uuid[], text),
  public.pt_update_settings(integer, integer, integer), public.pt_sync_schedule(uuid),
  public.pt_admin_sessions(date, date), public.pt_low_balances() TO authenticated;

-- Session status changes also bump slots.updated_at; pt_sessions is published for
-- clients that prefer to subscribe to it directly (RLS: allowed users).
ALTER PUBLICATION supabase_realtime ADD TABLE public.pt_sessions;
