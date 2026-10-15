-- ============================================================
-- Phase 2 — Per-day time slots
-- Aggiunge day_of_week a space_time_slots e aggiorna
-- generate_slots() per filtrare per giorno della settimana
-- ============================================================

-- ------------------------------------------------------------
-- 1. Aggiungi colonna day_of_week (nullable inizialmente)
-- ------------------------------------------------------------
ALTER TABLE space_time_slots
  ADD COLUMN IF NOT EXISTS day_of_week int;

-- ------------------------------------------------------------
-- 2. Backfill: per ogni riga esistente (day_of_week IS NULL)
--    inserisce una riga per ciascun giorno in available_days
--    dello spazio padre
-- ------------------------------------------------------------
INSERT INTO space_time_slots (space_id, start_time, end_time, day_of_week)
SELECT sts.space_id, sts.start_time, sts.end_time, d.day
FROM space_time_slots sts
JOIN spaces s ON s.id = sts.space_id
CROSS JOIN LATERAL unnest(s.available_days) AS d(day)
WHERE sts.day_of_week IS NULL
ON CONFLICT DO NOTHING;

-- Rimuovi le righe originali senza day_of_week
DELETE FROM space_time_slots WHERE day_of_week IS NULL;

-- ------------------------------------------------------------
-- 3. Rendi day_of_week NOT NULL
-- ------------------------------------------------------------
ALTER TABLE space_time_slots
  ALTER COLUMN day_of_week SET NOT NULL;

-- ------------------------------------------------------------
-- 4. Aggiorna il vincolo UNIQUE
-- ------------------------------------------------------------
ALTER TABLE space_time_slots
  DROP CONSTRAINT IF EXISTS space_time_slots_space_id_start_time_end_time_key;

ALTER TABLE space_time_slots
  ADD CONSTRAINT space_time_slots_space_id_day_of_week_start_time_end_time_key
  UNIQUE (space_id, day_of_week, start_time, end_time);

-- ------------------------------------------------------------
-- 5. Aggiorna generate_slots() per filtrare per day_of_week
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
          AND day_of_week = dow
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
