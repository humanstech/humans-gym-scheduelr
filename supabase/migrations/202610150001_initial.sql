-- Fresh installations only. Historical SQL in supabase/legacy is not a migration chain.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;

CREATE TABLE public.admins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL CHECK (email = lower(trim(email))),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.allowed_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain text UNIQUE NOT NULL CHECK (domain = lower(trim(domain)) AND domain !~ '[@[:space:]]'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.allowed_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL CHECK (email = lower(trim(email))),
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.spaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  description text,
  is_active boolean NOT NULL DEFAULT true,
  max_capacity integer NOT NULL DEFAULT 7 CHECK (max_capacity > 0),
  min_capacity integer NOT NULL DEFAULT 3 CHECK (min_capacity > 0 AND min_capacity <= max_capacity),
  available_days integer[] NOT NULL DEFAULT '{1,2,3,4,5}' CHECK (available_days <@ ARRAY[1,2,3,4,5,6,7]),
  allow_multiple_bookings boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.space_time_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES public.spaces ON DELETE CASCADE,
  day_of_week integer NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
  start_time time NOT NULL,
  end_time time NOT NULL CHECK (end_time > start_time),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (space_id, day_of_week, start_time, end_time)
);
CREATE TABLE public.slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES public.spaces ON DELETE CASCADE,
  date date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL CHECK (end_time > start_time),
  max_capacity integer NOT NULL CHECK (max_capacity > 0),
  min_capacity integer NOT NULL CHECK (min_capacity > 0 AND min_capacity <= max_capacity),
  is_cancelled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (date, start_time, end_time, space_id)
);
CREATE TABLE public.bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id uuid NOT NULL REFERENCES public.slots ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  user_email text NOT NULL,
  user_name text NOT NULL,
  user_avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (slot_id, user_id)
);
CREATE INDEX bookings_user_id_idx ON public.bookings(user_id);
CREATE INDEX slots_space_date_idx ON public.slots(space_id, date);

CREATE FUNCTION public.is_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.admins WHERE email = lower(auth.jwt()->>'email')
  );
$$;
CREATE FUNCTION public.is_allowed() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT auth.uid() IS NOT NULL AND (
    public.is_admin() OR
    EXISTS (SELECT 1 FROM public.allowed_emails WHERE email = lower(auth.jwt()->>'email')) OR
    EXISTS (SELECT 1 FROM public.allowed_domains WHERE domain = split_part(lower(auth.jwt()->>'email'), '@', 2))
  );
$$;
CREATE FUNCTION private.check_email_access() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT (
    EXISTS (SELECT 1 FROM public.admins WHERE email = lower(NEW.email)) OR
    EXISTS (SELECT 1 FROM public.allowed_emails WHERE email = lower(NEW.email)) OR
    EXISTS (SELECT 1 FROM public.allowed_domains WHERE domain = split_part(lower(NEW.email), '@', 2))
  ) THEN
    RAISE EXCEPTION 'Email not authorized' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER enforce_email_access BEFORE INSERT OR UPDATE OF email ON auth.users
FOR EACH ROW EXECUTE FUNCTION private.check_email_access();

ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.allowed_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.allowed_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.space_time_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

CREATE POLICY admins_read ON public.admins FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY domains_admin ON public.allowed_domains FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY emails_admin ON public.allowed_emails FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY spaces_read ON public.spaces FOR SELECT TO authenticated USING (public.is_allowed());
CREATE POLICY spaces_admin ON public.spaces FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY times_read ON public.space_time_slots FOR SELECT TO authenticated USING (public.is_allowed());
CREATE POLICY times_admin ON public.space_time_slots FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY slots_read ON public.slots FOR SELECT TO authenticated USING (public.is_allowed());
CREATE POLICY bookings_read ON public.bookings FOR SELECT TO authenticated
USING (public.is_allowed() AND (user_id = auth.uid() OR public.is_admin()));

-- All booking writes use these RPCs. Lock the space before reading availability:
-- serializes both capacity checks and one-booking-per-user/space/day checks.
CREATE FUNCTION public.create_booking(slot_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  target public.slots;
  space public.spaces;
  account auth.users;
  booking_id uuid;
BEGIN
  IF NOT public.is_allowed() THEN RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501'; END IF;
  SELECT sp.* INTO space FROM public.spaces sp
    JOIN public.slots s ON s.space_id = sp.id WHERE s.id = $1 FOR UPDATE OF sp;
  SELECT * INTO target FROM public.slots WHERE id = $1 FOR UPDATE;
  IF target.id IS NULL OR NOT space.is_active OR target.is_cancelled THEN
    RAISE EXCEPTION 'Slot unavailable';
  END IF;
  IF (target.date + target.start_time) AT TIME ZONE 'Europe/Rome' <= clock_timestamp() + interval '15 minutes' THEN
    RAISE EXCEPTION 'Bookings close 15 minutes before start';
  END IF;
  IF (SELECT count(*) FROM public.bookings b WHERE b.slot_id = $1) >= target.max_capacity THEN
    RAISE EXCEPTION 'Slot full';
  END IF;
  IF NOT space.allow_multiple_bookings AND EXISTS (
    SELECT 1 FROM public.bookings b JOIN public.slots s ON s.id = b.slot_id
    WHERE b.user_id = auth.uid() AND s.space_id = target.space_id AND s.date = target.date AND NOT s.is_cancelled
  ) THEN RAISE EXCEPTION 'Already booked for this space and date'; END IF;
  SELECT * INTO account FROM auth.users WHERE id = auth.uid();
  INSERT INTO public.bookings (slot_id, user_id, user_email, user_name, user_avatar_url)
  VALUES ($1, account.id, account.email,
    coalesce(nullif(account.raw_user_meta_data->>'full_name', ''), account.email),
    account.raw_user_meta_data->>'avatar_url') RETURNING id INTO booking_id;
  RETURN booking_id;
END;
$$;
CREATE FUNCTION public.cancel_booking(booking_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE target public.slots; owner_id uuid;
BEGIN
  IF NOT public.is_allowed() THEN RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501'; END IF;
  PERFORM sp.id FROM public.spaces sp JOIN public.slots s ON s.space_id = sp.id
    JOIN public.bookings b ON b.slot_id = s.id WHERE b.id = $1 FOR UPDATE OF sp;
  SELECT s.* INTO target FROM public.slots s JOIN public.bookings b ON b.slot_id = s.id WHERE b.id = $1 FOR UPDATE OF s;
  SELECT user_id INTO owner_id FROM public.bookings WHERE id = $1;
  IF owner_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Booking not owned by user' USING ERRCODE = '42501'; END IF;
  IF NOT target.is_cancelled AND (target.date + target.start_time) AT TIME ZONE 'Europe/Rome' <= clock_timestamp() + interval '15 minutes' THEN
    RAISE EXCEPTION 'Cancellation closes 15 minutes before start';
  END IF;
  DELETE FROM public.bookings WHERE id = $1;
END;
$$;

-- Public attendee data is separate from private booking rows (emails/user IDs).
CREATE FUNCTION public.get_slot_bookers(slot_ids uuid[])
RETURNS TABLE (slot_id uuid, user_name text, user_avatar_url text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT public.is_allowed() THEN RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501'; END IF;
  IF cardinality(slot_ids) > 500 THEN RAISE EXCEPTION 'Too many slots'; END IF;
  RETURN QUERY SELECT b.slot_id, b.user_name, b.user_avatar_url
    FROM public.bookings b WHERE b.slot_id = ANY(slot_ids) ORDER BY b.created_at;
END;
$$;
CREATE FUNCTION private.notify_slot_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.slots SET updated_at = clock_timestamp() WHERE id = coalesce(NEW.slot_id, OLD.slot_id);
  RETURN NULL;
END;
$$;
CREATE TRIGGER booking_slot_change AFTER INSERT OR DELETE ON public.bookings
FOR EACH ROW EXECUTE FUNCTION private.notify_slot_change();

CREATE FUNCTION public.easter_date(year integer) RETURNS date
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE a int; b int; c int; d int; e int; f int; g int; h int; i int; k int; l int; m int; n int;
BEGIN
  a := year % 19; b := year / 100; c := year % 100; d := b / 4; e := b % 4;
  f := (b + 8) / 25; g := (b - f + 1) / 3; h := (19*a + b - d - g + 15) % 30;
  i := c / 4; k := c % 4; l := (32 + 2*e + 2*i - h - k) % 7;
  m := (a + 11*h + 22*l) / 451; n := h + l - 7*m + 114;
  RETURN make_date(year, n / 31, n % 31 + 1);
END;
$$;
CREATE FUNCTION public.is_italian_holiday(d date) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT to_char(d, 'MM-DD') = ANY(ARRAY['01-01','01-06','04-25','05-01','06-02','08-15','11-01','12-08','12-25','12-26'])
    OR d IN (public.easter_date(extract(year FROM d)::int), public.easter_date(extract(year FROM d)::int) + 1);
$$;
CREATE FUNCTION private.generate_slots(days_ahead integer DEFAULT 90) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF days_ahead NOT BETWEEN 1 AND 180 THEN RAISE EXCEPTION 'days_ahead must be 1..180'; END IF;
  INSERT INTO public.slots (space_id, date, start_time, end_time, max_capacity, min_capacity)
  SELECT sp.id, d.day, t.start_time, t.end_time, sp.max_capacity, sp.min_capacity
  FROM public.spaces sp JOIN public.space_time_slots t ON t.space_id = sp.id
  CROSS JOIN LATERAL (
    SELECT (now() AT TIME ZONE 'Europe/Rome')::date + n AS day FROM generate_series(0, days_ahead - 1) n
  ) d
  WHERE sp.is_active AND extract(isodow FROM d.day)::int = t.day_of_week
    AND t.day_of_week = ANY(sp.available_days) AND NOT public.is_italian_holiday(d.day)
  ON CONFLICT (date, start_time, end_time, space_id) DO NOTHING;
END;
$$;
CREATE FUNCTION public.generate_slots(days_ahead integer DEFAULT 90) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin required' USING ERRCODE = '42501'; END IF;
  PERFORM private.generate_slots(days_ahead);
END;
$$;
CREATE FUNCTION private.cancel_underfilled_slots() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE locked_space_id uuid;
BEGIN
  -- Same lock order as booking RPCs. Fresh count after acquiring the lock.
  FOR locked_space_id IN SELECT id FROM public.spaces ORDER BY id LOOP
    PERFORM id FROM public.spaces WHERE id = locked_space_id FOR UPDATE;
    UPDATE public.slots s SET is_cancelled = true, updated_at = clock_timestamp()
    WHERE s.space_id = locked_space_id AND NOT s.is_cancelled
      AND (s.date + s.start_time) AT TIME ZONE 'Europe/Rome' <= clock_timestamp() + interval '15 minutes'
      AND (s.date + s.end_time) AT TIME ZONE 'Europe/Rome' > clock_timestamp()
      AND (SELECT count(*) FROM public.bookings b WHERE b.slot_id = s.id) < s.min_capacity;
  END LOOP;
END;
$$;

-- Explicit grants override Supabase's permissive defaults, including RPC EXECUTE.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
GRANT SELECT ON public.admins, public.spaces, public.space_time_slots, public.slots, public.bookings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.allowed_domains, public.allowed_emails, public.spaces, public.space_time_slots TO authenticated;
GRANT ALL ON public.admins, public.allowed_domains, public.allowed_emails, public.spaces, public.space_time_slots, public.slots, public.bookings TO service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_admin(), public.is_allowed(), public.create_booking(uuid), public.cancel_booking(uuid), public.get_slot_bookers(uuid[]), public.generate_slots(integer), public.easter_date(integer), public.is_italian_holiday(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin(), public.is_allowed(), public.create_booking(uuid), public.cancel_booking(uuid), public.get_slot_bookers(uuid[]), public.generate_slots(integer) TO authenticated;

-- Realtime follows slots, not private booking rows. Only allowed users can read it.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END $$;
ALTER PUBLICATION supabase_realtime ADD TABLE public.slots, public.spaces;
