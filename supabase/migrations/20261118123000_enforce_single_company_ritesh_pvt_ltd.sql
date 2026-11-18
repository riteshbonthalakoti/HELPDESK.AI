-- Migration: Enforce single-tenant company 'RITESH PVT LTD' (76d16bf6-2ee9-44ad-b64e-ad5ecf0a079b)
-- Generated for Supabase CLI (`supabase db push`)

BEGIN;

-- 1. Unlink profiles referencing any non-RITESH company (clears NO ACTION FK)
UPDATE public.profiles
SET company_id = NULL
WHERE company_id IS NOT NULL
  AND company_id <> '76d16bf6-2ee9-44ad-b64e-ad5ecf0a079b'::uuid;

-- 2. Remove tickets belonging to any non-RITESH company
DELETE FROM public.tickets
WHERE company_id IS NOT NULL
  AND company_id <> '76d16bf6-2ee9-44ad-b64e-ad5ecf0a079b'::uuid;

-- 3. Remove all companies except RITESH PVT LTD
DELETE FROM public.companies
WHERE id <> '76d16bf6-2ee9-44ad-b64e-ad5ecf0a079b'::uuid;

-- 4. Ensure RITESH PVT LTD exists with canonical UUID and name
INSERT INTO public.companies (id, name, status)
VALUES ('76d16bf6-2ee9-44ad-b64e-ad5ecf0a079b'::uuid, 'RITESH PVT LTD', 'active')
ON CONFLICT (id) DO UPDATE SET
  name = 'RITESH PVT LTD',
  status = 'active',
  updated_at = timezone('utc'::text, now());

-- 5. Enforce DB-level single-company guard so no other company can ever be inserted
ALTER TABLE public.companies
  DROP CONSTRAINT IF EXISTS companies_single_tenant_ritesh_only;

ALTER TABLE public.companies
  ADD CONSTRAINT companies_single_tenant_ritesh_only
  CHECK (id = '76d16bf6-2ee9-44ad-b64e-ad5ecf0a079b'::uuid AND name = 'RITESH PVT LTD');

-- 6. Update handle_new_user() trigger so new signups bind to RITESH PVT LTD instead of creating new companies
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
	canonical_company_id uuid := '76d16bf6-2ee9-44ad-b64e-ad5ecf0a079b'::uuid;
	canonical_company_name text := 'RITESH PVT LTD';
	user_role text := coalesce(nullif(new.raw_user_meta_data ->> 'role', ''), 'user');
BEGIN
	INSERT INTO public.profiles (
		id,
		email,
		full_name,
		role,
		company,
		company_id,
		profile_picture,
		phone,
		job_title,
		status
	) VALUES (
		new.id,
		new.email,
		coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), 'User'),
		user_role,
		canonical_company_name,
		canonical_company_id,
		nullif(new.raw_user_meta_data ->> 'profile_picture', ''),
		nullif(new.raw_user_meta_data ->> 'phone', ''),
		nullif(new.raw_user_meta_data ->> 'job_title', ''),
		CASE
			WHEN new.email_confirmed_at IS NULL THEN 'pending_email_verification'
			ELSE 'pending_approval'
		END
	)
	ON CONFLICT (id) DO UPDATE SET
		email = EXCLUDED.email,
		full_name = EXCLUDED.full_name,
		role = EXCLUDED.role,
		company = canonical_company_name,
		company_id = canonical_company_id,
		profile_picture = EXCLUDED.profile_picture,
		phone = EXCLUDED.phone,
		job_title = EXCLUDED.job_title,
		status = EXCLUDED.status,
		updated_at = timezone('utc'::text, now());

	INSERT INTO public.user_companies (user_id, company_id, role)
	VALUES (new.id, canonical_company_id, CASE WHEN user_role = 'admin' THEN 'admin' ELSE 'member' END)
	ON CONFLICT (user_id, company_id) DO UPDATE SET
		role = EXCLUDED.role,
		updated_at = timezone('utc'::text, now());

	RETURN new;
END;
$$;

COMMIT;
