-- ============================================================
-- Phase 1A — Space Management Enhancement
-- Esegui nel SQL Editor di Supabase
-- ============================================================

-- ============================================================
-- 1. ALTER spaces — aggiungi colonne di configurazione
-- ============================================================

ALTER TABLE spaces
  ADD COLUMN IF NOT EXISTS max_capacity int NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS min_capacity int NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS available_days int[] NOT NULL DEFAULT '{1,2,3,4,5}',
  ADD COLUMN IF NOT EXISTS allow_multiple_bookings boolean NOT NULL DEFAULT false;

-- ============================================================
-- 2. ALTER slots — aggiungi space_id (FK verso spaces)
-- ============================================================

ALTER TABLE slots
  ADD COLUMN IF NOT EXISTS space_id uuid REFERENCES spaces(id) ON DELETE CASCADE;

-- ============================================================
-- 3. Aggiorna vincolo UNIQUE su slots per includere space_id
-- ============================================================

ALTER TABLE slots DROP CONSTRAINT IF EXISTS slots_date_start_time_end_time_key;

ALTER TABLE slots
  ADD CONSTRAINT slots_date_start_time_end_time_space_id_key
  UNIQUE (date, start_time, end_time, space_id);

-- ============================================================
-- 4. Crea tabella space_time_slots
-- ============================================================

CREATE TABLE IF NOT EXISTS space_time_slots (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id    uuid REFERENCES spaces(id) ON DELETE CASCADE NOT NULL,
  start_time  time NOT NULL,
  end_time    time NOT NULL,
  created_at  timestamptz DEFAULT now(),
  UNIQUE (space_id, start_time, end_time)
);

-- ============================================================
-- 5. Row Level Security per space_time_slots
-- ============================================================

ALTER TABLE space_time_slots ENABLE ROW LEVEL SECURITY;

-- SELECT: tutti gli autenticati
CREATE POLICY "space_time_slots_select_authenticated"
  ON space_time_slots FOR SELECT
  TO authenticated
  USING (true);

-- INSERT: solo admin
CREATE POLICY "space_time_slots_insert_admin"
  ON space_time_slots FOR INSERT
  TO authenticated
  WITH CHECK (
    (auth.jwt() ->> 'email') IN (SELECT email FROM admins)
  );

-- UPDATE: solo admin
CREATE POLICY "space_time_slots_update_admin"
  ON space_time_slots FOR UPDATE
  TO authenticated
  USING (
    (auth.jwt() ->> 'email') IN (SELECT email FROM admins)
  );

-- DELETE: solo admin
CREATE POLICY "space_time_slots_delete_admin"
  ON space_time_slots FOR DELETE
  TO authenticated
  USING (
    (auth.jwt() ->> 'email') IN (SELECT email FROM admins)
  );

-- ============================================================
-- 6. Seed space_time_slots con i 5 slot standard
--    per tutti gli spazi esistenti
-- ============================================================

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
