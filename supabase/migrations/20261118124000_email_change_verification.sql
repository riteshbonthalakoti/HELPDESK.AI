-- Migration: Verified Email Change System for Company Admins & Users
-- Supports both 6-digit OTP verification and one-click secure token verification.
-- Generated for Supabase CLI (`supabase db push`)

BEGIN;

CREATE TABLE IF NOT EXISTS public.email_change_requests (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
	company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
	old_email text NOT NULL,
	new_email text NOT NULL,
	token_hash text NOT NULL UNIQUE,
	otp_code_hash text NOT NULL,
	status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'expired', 'cancelled')),
	attempts integer NOT NULL DEFAULT 0,
	expires_at timestamptz NOT NULL,
	verified_at timestamptz,
	created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
	updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_email_change_requests_user_status
	ON public.email_change_requests (user_id, status);

CREATE INDEX IF NOT EXISTS idx_email_change_requests_new_email
	ON public.email_change_requests (lower(new_email));

CREATE INDEX IF NOT EXISTS idx_email_change_requests_expires_at
	ON public.email_change_requests (expires_at);

ALTER TABLE public.email_change_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on email_change_requests" ON public.email_change_requests;
CREATE POLICY "Service role full access on email_change_requests"
	ON public.email_change_requests
	FOR ALL
	USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Users can view own email change requests" ON public.email_change_requests;
CREATE POLICY "Users can view own email change requests"
	ON public.email_change_requests
	FOR SELECT
	USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS update_email_change_requests_timestamp ON public.email_change_requests;
CREATE TRIGGER update_email_change_requests_timestamp
	BEFORE UPDATE ON public.email_change_requests
	FOR EACH ROW
	EXECUTE FUNCTION public.update_timestamp();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_change_requests TO authenticated, service_role;

COMMIT;
