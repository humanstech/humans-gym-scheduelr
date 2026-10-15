-- Posts PT charges for closed days (idempotent, last 14 days).
SELECT cron.schedule('gym-pt-reconcile', '*/5 * * * *', 'SELECT private.pt_reconcile_recent()');
