-- Run explicitly once, after migrations, with psql -v admin_email=...
INSERT INTO public.admins(email) VALUES (lower(:'admin_email')) ON CONFLICT (email) DO NOTHING;
INSERT INTO public.allowed_domains(domain) VALUES ('humans.tech') ON CONFLICT (domain) DO NOTHING;
INSERT INTO public.spaces(id, name, description)
VALUES ('10000000-0000-4000-8000-000000000001', 'Palestra', 'Sala attrezzi principale')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.space_time_slots(space_id, day_of_week, start_time, end_time)
SELECT '10000000-0000-4000-8000-000000000001', d, t.start_time, t.end_time
FROM generate_series(1,5) d CROSS JOIN (VALUES
  ('07:00'::time, '08:00'::time), ('08:00'::time, '09:00'::time),
  ('18:00'::time, '19:00'::time), ('19:00'::time, '20:00'::time), ('20:00'::time, '21:00'::time)
) t(start_time, end_time)
ON CONFLICT DO NOTHING;
SELECT private.generate_slots(90);
