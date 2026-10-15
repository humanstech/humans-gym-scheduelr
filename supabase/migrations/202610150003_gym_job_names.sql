-- Keep applied migrations immutable; use pg_cron's API for the owning role.
SELECT cron.unschedule(jobid) FROM cron.job
WHERE jobname IN ('slokta-generate-slots', 'slokta-cancel-underfilled');
SELECT cron.schedule('gym-generate-slots', '0 3 * * *', 'SELECT private.generate_slots(90)');
SELECT cron.schedule('gym-cancel-underfilled', '* * * * *', 'SELECT private.cancel_underfilled_slots()');
