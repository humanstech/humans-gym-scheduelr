-- Local demo only. Run BEFORE creating the dev auth users: the trainer's external
-- email is admitted by pt_trainers (private.check_email_access).
DO $$ BEGIN
  IF to_regclass('public.pt_trainers') IS NOT NULL THEN
    INSERT INTO public.pt_trainers(email) VALUES ('trainer.pt@example.com') ON CONFLICT (email) DO NOTHING;
  END IF;
END $$;
