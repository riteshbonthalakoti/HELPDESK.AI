-- Automatically synchronize public.profiles.email whenever Supabase Auth updates auth.users.email
-- (triggered immediately after 6-digit OTP email_change verification).

CREATE OR REPLACE FUNCTION public.sync_auth_user_email_to_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.email IS DISTINCT FROM OLD.email AND NEW.email IS NOT NULL THEN
        UPDATE public.profiles
        SET email = NEW.email,
            updated_at = NOW()
        WHERE id = NEW.id;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_auth_user_email_to_profile ON auth.users;

CREATE TRIGGER trg_sync_auth_user_email_to_profile
AFTER UPDATE OF email ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.sync_auth_user_email_to_profile();
