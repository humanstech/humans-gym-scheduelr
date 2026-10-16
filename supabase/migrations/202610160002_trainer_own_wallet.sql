-- A trainer can read their own compensation ledger, never choose another account.
-- Raw ledger access and all financial mutations remain admin-only.
CREATE FUNCTION public.pt_my_trainer_wallet() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE own_trainer uuid; target uuid; result jsonb;
BEGIN
  SELECT t.id INTO own_trainer FROM public.pt_trainers t
  WHERE t.email = lower(auth.jwt()->>'email') AND auth.uid() IS NOT NULL;
  IF own_trainer IS NULL THEN
    RAISE EXCEPTION 'Trainer required' USING ERRCODE = '42501';
  END IF;

  -- Match the existing lock order and accrue completed assigned sessions even
  -- when the scheduled job has not run yet. Future/voided sessions earn nothing.
  PERFORM private.pt_lock_all_spaces();
  FOR target IN
    SELECT a.slot_id FROM public.pt_session_trainers a JOIN public.slots s ON s.id = a.slot_id
    WHERE a.trainer_id = own_trainer
      AND (s.date + s.end_time) AT TIME ZONE 'Europe/Rome' <= clock_timestamp()
    ORDER BY s.space_id, s.id
  LOOP
    PERFORM private.pt_reconcile_trainer_session(target, 'compenso maturato');
  END LOOP;

  -- One snapshot for totals and history; not subject to PostgREST's row limit.
  SELECT jsonb_build_object(
    'earned_cents', coalesce(sum(w.amount_cents) FILTER (WHERE w.kind IN ('earning', 'adjustment')), 0),
    'paid_cents', -coalesce(sum(w.amount_cents) FILTER (WHERE w.kind IN ('payment', 'payment_reversal')), 0),
    'balance_cents', coalesce(sum(w.amount_cents), 0),
    'entries', coalesce(jsonb_agg(to_jsonb(w) ORDER BY w.created_at DESC, w.id), '[]'::jsonb)
  ) INTO result
  FROM public.pt_trainer_wallet_entries w WHERE w.trainer_id = own_trainer;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.pt_my_trainer_wallet() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pt_my_trainer_wallet() TO authenticated;
