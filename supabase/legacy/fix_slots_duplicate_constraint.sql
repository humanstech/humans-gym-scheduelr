-- Fix: drop redundant 3-column unique constraint on slots table.
-- The constraint (date, start_time, space_id) is more restrictive than the
-- 4-column constraint (date, start_time, end_time, space_id) already in place.
-- generate_slots() uses ON CONFLICT (date, start_time, end_time, space_id) DO NOTHING,
-- so the 3-column constraint caused false duplicate errors when the same (date, start_time, space_id)
-- appeared with a different end_time across different day_of_week configurations.
ALTER TABLE public.slots DROP CONSTRAINT slots_date_start_time_space_key;
