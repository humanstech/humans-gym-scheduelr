-- ============================================================
-- GymBooking Schema — Humans.tech
-- Esegui nel SQL Editor del tuo progetto Supabase
-- ============================================================

-- ------------------------------------------------------------
-- 1. TABELLE
-- ------------------------------------------------------------

-- Spazi prenotabili (palestra, sala corsi, ecc.)
CREATE TABLE IF NOT EXISTS spaces (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                     text NOT NULL,
  description              text,
  is_active                boolean NOT NULL DEFAULT true,
  max_capacity             int NOT NULL DEFAULT 7,
  min_capacity             int NOT NULL DEFAULT 3,
  available_days           int[] NOT NULL DEFAULT '{1,2,3,4,5}',  -- ISO: 1=lun … 7=dom
  allow_multiple_bookings  boolean NOT NULL DEFAULT false,
  created_at               timestamptz DEFAULT now()
);

-- Fasce orarie configurabili per spazio (stile Calendly)
CREATE TABLE IF NOT EXISTS space_time_slots (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id    uuid REFERENCES spaces(id) ON DELETE CASCADE NOT NULL,
  start_time  time NOT NULL,
  end_time    time NOT NULL,
  created_at  timestamptz DEFAULT now(),
  UNIQUE (space_id, start_time, end_time)
);

-- Slot disponibili (generati dalla funzione generate_slots)
CREATE TABLE IF NOT EXISTS slots (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id    uuid REFERENCES spaces(id) ON DELETE CASCADE,
  date        date NOT NULL,
  start_time  time NOT NULL,
  end_time    time NOT NULL,
  max_capacity int NOT NULL DEFAULT 7,
  created_at  timestamptz DEFAULT now(),
  UNIQUE (date, start_time, end_time, space_id)
);

-- Prenotazioni degli utenti
CREATE TABLE IF NOT EXISTS bookings (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id    uuid REFERENCES slots(id) ON DELETE CASCADE NOT NULL,
  user_id    uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  user_email text NOT NULL,
  user_name  text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE (slot_id, user_id)
);

-- Lista admin (email)
CREATE TABLE IF NOT EXISTS admins (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email      text UNIQUE NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- ------------------------------------------------------------
-- 2. TRIGGER — BLOCCO DOMINIO @humans.tech
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.check_email_domain()
RETURNS trigger AS $$
BEGIN
  IF NEW.email NOT LIKE '%@humans.tech' THEN
    RAISE EXCEPTION 'Access denied: only @humans.tech accounts are allowed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS enforce_company_domain ON auth.users;
CREATE TRIGGER enforce_company_domain
  BEFORE INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.check_email_domain();

-- ------------------------------------------------------------
-- 3. ROW LEVEL SECURITY (RLS)
-- ------------------------------------------------------------

ALTER TABLE spaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE space_time_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE admins ENABLE ROW LEVEL SECURITY;

-- Spaces: tutti gli autenticati possono leggere
CREATE POLICY "spaces_select_authenticated"
  ON spaces FOR SELECT
  TO authenticated
  USING (true);

-- Spaces: solo admin possono modificare
CREATE POLICY "spaces_insert_admin"
  ON spaces FOR INSERT
  TO authenticated
  WITH CHECK ((auth.jwt() ->> 'email') IN (SELECT email FROM admins));

CREATE POLICY "spaces_update_admin"
  ON spaces FOR UPDATE
  TO authenticated
  USING ((auth.jwt() ->> 'email') IN (SELECT email FROM admins));

CREATE POLICY "spaces_delete_admin"
  ON spaces FOR DELETE
  TO authenticated
  USING ((auth.jwt() ->> 'email') IN (SELECT email FROM admins));

-- Space time slots: tutti gli autenticati possono leggere
CREATE POLICY "space_time_slots_select_authenticated"
  ON space_time_slots FOR SELECT
  TO authenticated
  USING (true);

-- Space time slots: solo admin possono modificare
CREATE POLICY "space_time_slots_insert_admin"
  ON space_time_slots FOR INSERT
  TO authenticated
  WITH CHECK ((auth.jwt() ->> 'email') IN (SELECT email FROM admins));

CREATE POLICY "space_time_slots_update_admin"
  ON space_time_slots FOR UPDATE
  TO authenticated
  USING ((auth.jwt() ->> 'email') IN (SELECT email FROM admins));

CREATE POLICY "space_time_slots_delete_admin"
  ON space_time_slots FOR DELETE
  TO authenticated
  USING ((auth.jwt() ->> 'email') IN (SELECT email FROM admins));

-- Slots: tutti gli autenticati possono leggere
CREATE POLICY "slots_select_authenticated"
  ON slots FOR SELECT
  TO authenticated
  USING (true);

-- Bookings: l'utente vede solo le sue
CREATE POLICY "bookings_select_own"
  ON bookings FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Bookings: gli admin vedono tutto
CREATE POLICY "bookings_select_admin"
  ON bookings FOR SELECT
  TO authenticated
  USING (
    (auth.jwt() ->> 'email') IN (SELECT email FROM admins)
  );

-- Bookings: l'utente può prenotare (check capacità + prenotazione singola per spazio)
CREATE POLICY "bookings_insert_own"
  ON bookings FOR INSERT
  TO authenticated
  WITH CHECK (
    -- L'utente prenota solo per sé
    user_id = auth.uid()

    -- Controllo capacità massima slot
    AND (
      SELECT COUNT(*) FROM bookings b WHERE b.slot_id = bookings.slot_id
    ) < (
      SELECT s.max_capacity FROM slots s WHERE s.id = bookings.slot_id
    )

    -- Controllo prenotazione singola per spazio+data (se allow_multiple_bookings = false)
    AND (
      -- Se lo spazio permette più prenotazioni, nessun vincolo aggiuntivo
      (
        SELECT sp.allow_multiple_bookings
        FROM spaces sp
        JOIN slots s ON s.space_id = sp.id
        WHERE s.id = bookings.slot_id
      ) = true

      OR

      -- Altrimenti: l'utente non deve avere già una prenotazione
      -- in un qualsiasi slot dello stesso spazio nella stessa data
      NOT EXISTS (
        SELECT 1
        FROM bookings b
        JOIN slots s       ON s.id = b.slot_id
        JOIN slots ts      ON ts.id = bookings.slot_id
        WHERE b.user_id    = auth.uid()
          AND s.space_id   = ts.space_id
          AND s.date       = ts.date
      )
    )
  );

-- Bookings: l'utente può cancellare solo la sua
CREATE POLICY "bookings_delete_own"
  ON bookings FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- Admins: solo gli admin possono leggere la tabella
CREATE POLICY "admins_select"
  ON admins FOR SELECT
  TO authenticated
  USING (
    (auth.jwt() ->> 'email') IN (SELECT email FROM admins)
  );

-- ------------------------------------------------------------
-- 4. FUNZIONE generate_slots
-- Genera slot per i prossimi N giorni basandosi su spaces e
-- space_time_slots. Idempotente: usa ON CONFLICT DO NOTHING.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.generate_slots(days_ahead int DEFAULT 14)
RETURNS void AS $$
DECLARE
  current_date date := CURRENT_DATE;
  target_date  date;
  i            int;
  space_rec    RECORD;
  slot_rec     RECORD;
  dow          int;
BEGIN
  FOR i IN 0..days_ahead - 1 LOOP
    target_date := current_date + i;
    dow := EXTRACT(ISODOW FROM target_date);  -- 1=lun … 7=dom

    FOR space_rec IN
      SELECT s.id, s.max_capacity, s.available_days
      FROM spaces s
      WHERE s.is_active = true
        AND dow = ANY(s.available_days)
    LOOP
      FOR slot_rec IN
        SELECT start_time, end_time
        FROM space_time_slots
        WHERE space_id = space_rec.id
        ORDER BY start_time
      LOOP
        INSERT INTO slots (space_id, date, start_time, end_time, max_capacity)
        VALUES (space_rec.id, target_date, slot_rec.start_time, slot_rec.end_time, space_rec.max_capacity)
        ON CONFLICT (date, start_time, end_time, space_id) DO NOTHING;
      END LOOP;
    END LOOP;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 5. SEED SPACES
-- ------------------------------------------------------------

INSERT INTO spaces (name, description) VALUES
  ('Palestra', 'Sala attrezzi principale')
ON CONFLICT DO NOTHING;

-- ------------------------------------------------------------
-- 6. SEED space_time_slots (5 fasce orarie standard)
-- ------------------------------------------------------------

INSERT INTO space_time_slots (space_id, start_time, end_time)
SELECT s.id, t.start_time, t.end_time
FROM spaces s
CROSS JOIN (
  VALUES
    ('07:00'::time, '08:00'::time),
    ('08:00'::time, '09:00'::time),
    ('18:00'::time, '19:00'::time),
    ('19:00'::time, '20:00'::time),
    ('20:00'::time, '21:00'::time)
) AS t(start_time, end_time)
ON CONFLICT (space_id, start_time, end_time) DO NOTHING;

-- Genera subito gli slot per i prossimi 14 giorni
SELECT public.generate_slots(14);

-- ------------------------------------------------------------
-- 7. SEED ADMIN
-- Sostituisci con le email admin reali
-- ------------------------------------------------------------

INSERT INTO admins (email) VALUES
  ('admin@humans.tech')
ON CONFLICT (email) DO NOTHING;

-- ============================================================
-- FINE SCHEMA
-- Dopo aver eseguito questo file:
--   1. Vai su Authentication > Providers > Google e abilita Google OAuth
--   2. Configura i Redirect URLs (vedi SETUP.md)
--   3. Aggiungi le env vars nel file .env.local
-- ============================================================
