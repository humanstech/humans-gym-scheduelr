CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule('slokta-generate-slots', '0 3 * * *', 'SELECT private.generate_slots(90)');
SELECT cron.schedule('slokta-cancel-underfilled', '* * * * *', 'SELECT private.cancel_underfilled_slots()');
