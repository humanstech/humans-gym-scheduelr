-- Promote an existing account without allowing direct writes to the admin list.
CREATE FUNCTION public.admin_promote_user(user_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE user_email text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin required' USING ERRCODE = '42501';
  END IF;

  SELECT lower(u.email) INTO user_email FROM auth.users u WHERE u.id = $1;
  IF user_email IS NULL OR trim(user_email) = '' THEN
    RAISE EXCEPTION 'User not found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.admins (email) VALUES (user_email)
  ON CONFLICT (email) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_promote_user(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_promote_user(uuid) TO authenticated;
