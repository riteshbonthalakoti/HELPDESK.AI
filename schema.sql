


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";



CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";

CREATE SCHEMA IF NOT EXISTS "extensions";
CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";



CREATE OR REPLACE FUNCTION public.update_timestamp()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	NEW.updated_at = timezone('utc'::text, now());
	RETURN NEW;
END;
$$;



CREATE TABLE IF NOT EXISTS companies (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	name text NOT NULL,
	admin_id uuid,
	company_size text,
	industry text,
	website text,
	country text,
	status text NOT NULL DEFAULT 'active',
	created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
	updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);



CREATE TABLE IF NOT EXISTS profiles (
	id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
	email text NOT NULL UNIQUE,
	full_name text,
	role text NOT NULL DEFAULT 'user',
	company text,
	company_id uuid,
	profile_picture text,
	phone text,
	job_title text,
	status text NOT NULL DEFAULT 'pending_email_verification',
	created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
	updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE profiles
	ADD CONSTRAINT profiles_company_id_fkey
	FOREIGN KEY (company_id) REFERENCES companies(id)
	DEFERRABLE INITIALLY DEFERRED;



ALTER TABLE companies
	ADD CONSTRAINT companies_admin_id_fkey
	FOREIGN KEY (admin_id) REFERENCES profiles(id)
	DEFERRABLE INITIALLY DEFERRED;



CREATE TABLE IF NOT EXISTS user_companies (
	user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
	company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
	role text NOT NULL DEFAULT 'member',
	created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
	updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
	PRIMARY KEY (user_id, company_id)
);



CREATE TABLE IF NOT EXISTS admin_requests (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	admin_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
	company_name text NOT NULL,
	company_size text,
	industry text,
	website text,
	country text,
	phone text,
	job_title text,
	status text NOT NULL DEFAULT 'pending',
	reviewed_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
	review_notes text,
	created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
	updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);



CREATE TABLE IF NOT EXISTS tickets (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
	company_id uuid REFERENCES companies(id) ON DELETE CASCADE,
	assigned_agent_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
	subject text,
	summary text,
	description text,
	category text,
	priority text NOT NULL DEFAULT 'medium',
	status text NOT NULL DEFAULT 'open',
	metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
	ai_confidence numeric(5,4),
	duplicate_of uuid REFERENCES tickets(id) ON DELETE SET NULL,
	resolved_at timestamptz,
	closed_at timestamptz,
	auto_closed boolean NOT NULL DEFAULT false,
	last_user_viewed_at timestamptz,
	created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
	updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);



CREATE TABLE IF NOT EXISTS ticket_messages (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
	sender_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
	sender_name text NOT NULL,
	message text NOT NULL,
	message_type text NOT NULL DEFAULT 'text',
	is_internal boolean NOT NULL DEFAULT false,
	created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);



CREATE TABLE IF NOT EXISTS internal_notes (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
	agent_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
	note text NOT NULL,
	created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);



CREATE TABLE IF NOT EXISTS bug_reports (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	reporter_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
	company_id uuid REFERENCES companies(id) ON DELETE SET NULL,
	bug_title text NOT NULL,
	description text NOT NULL,
	severity text NOT NULL DEFAULT 'medium',
	status text NOT NULL DEFAULT 'open',
	created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
	updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);



CREATE TABLE IF NOT EXISTS enterprise_leads (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	company_name text NOT NULL,
	contact_name text NOT NULL,
	email text NOT NULL,
	phone text,
	website text,
	message text,
	status text NOT NULL DEFAULT 'new',
	created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
	updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);



CREATE TABLE IF NOT EXISTS kb_articles (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	company_id uuid REFERENCES companies(id) ON DELETE CASCADE,
	title text NOT NULL,
	content text NOT NULL,
	category text,
	tags text[] NOT NULL DEFAULT '{}'::text[],
	search_vector tsvector,
	created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
	updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);



CREATE TABLE IF NOT EXISTS knowledge_base (
	id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
	title text NOT NULL,
	content text NOT NULL,
	embedding vector(384),
	category text,
	created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);



CREATE TABLE IF NOT EXISTS sla_config (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	company_id uuid NOT NULL UNIQUE REFERENCES companies(id) ON DELETE CASCADE,
	priority text NOT NULL,
	resolution_sla_hours integer NOT NULL,
	created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
	updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);



CREATE TABLE IF NOT EXISTS user_feedback (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
	company_id uuid REFERENCES companies(id) ON DELETE SET NULL,
	ticket_id uuid REFERENCES tickets(id) ON DELETE SET NULL,
	feedback_type text NOT NULL,
	rating integer,
	comment text,
	created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);



CREATE TABLE IF NOT EXISTS system_settings (
	company_id uuid UNIQUE NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
	ai_confidence_threshold float DEFAULT 0.80,
	duplicate_sensitivity float DEFAULT 0.85,
	enable_auto_resolve boolean DEFAULT false,
	auto_close_enabled boolean DEFAULT true,
	auto_close_days integer DEFAULT 7,
	email_notifications boolean DEFAULT true,
	admin_alerts boolean DEFAULT true,
	digest_frequency text DEFAULT 'daily',
	created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
	updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);



ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON system_settings
	FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Users can view own company settings" ON system_settings
	FOR SELECT USING (
		company_id IN (
			SELECT company_id FROM user_companies WHERE user_id = auth.uid()
		)
	);



CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
	new_company_id uuid;
	company_name text := nullif(new.raw_user_meta_data ->> 'company', '');
	user_role text := coalesce(nullif(new.raw_user_meta_data ->> 'role', ''), 'user');
BEGIN
	IF company_name IS NOT NULL THEN
		INSERT INTO public.companies (
			name,
			admin_id,
			company_size,
			industry,
			website,
			country
		) VALUES (
			company_name,
			new.id,
			nullif(new.raw_user_meta_data ->> 'company_size', ''),
			nullif(new.raw_user_meta_data ->> 'industry', ''),
			nullif(new.raw_user_meta_data ->> 'website', ''),
			nullif(new.raw_user_meta_data ->> 'country', '')
		)
		RETURNING id INTO new_company_id;
	END IF;

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
		company_name,
		new_company_id,
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
		company = EXCLUDED.company,
		company_id = COALESCE(EXCLUDED.company_id, profiles.company_id),
		profile_picture = EXCLUDED.profile_picture,
		phone = EXCLUDED.phone,
		job_title = EXCLUDED.job_title,
		status = EXCLUDED.status,
		updated_at = timezone('utc'::text, now());

	IF new_company_id IS NOT NULL THEN
		INSERT INTO public.user_companies (user_id, company_id, role)
		VALUES (new.id, new_company_id, 'admin')
		ON CONFLICT (user_id, company_id) DO UPDATE SET
			role = EXCLUDED.role,
			updated_at = timezone('utc'::text, now());
	END IF;

	RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
	AFTER INSERT ON auth.users
	FOR EACH ROW
	EXECUTE FUNCTION public.handle_new_user();



CREATE OR REPLACE FUNCTION public.get_my_company_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
	SELECT company_id
	FROM public.profiles
	WHERE id = auth.uid();
$$;



CREATE OR REPLACE FUNCTION public.is_admin_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
	SELECT EXISTS (
		SELECT 1
		FROM public.profiles
		WHERE id = auth.uid()
		  AND role IN ('admin', 'master_admin')
	);
$$;



CREATE OR REPLACE FUNCTION match_articles (
  query_embedding vector(384),
  match_threshold float,
  match_count int
)
RETURNS TABLE (
  id uuid,
  title text,
  content text,
  similarity float
)
LANGUAGE sql
STABLE
AS $$
  SELECT
	knowledge_base.id,
	knowledge_base.title,
	knowledge_base.content,
	1 - (knowledge_base.embedding <=> query_embedding) AS similarity
  FROM knowledge_base
  WHERE 1 - (knowledge_base.embedding <=> query_embedding) > match_threshold
  ORDER BY knowledge_base.embedding <=> query_embedding
  LIMIT match_count;
$$;



CREATE INDEX IF NOT EXISTS idx_tickets_status_updated_at ON tickets(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_tickets_auto_closed_closed_at ON tickets(auto_closed, closed_at);
CREATE INDEX IF NOT EXISTS idx_tickets_company_id ON tickets(company_id);
CREATE INDEX IF NOT EXISTS idx_tickets_user_id ON tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_tickets_assigned_agent_id ON tickets(assigned_agent_id);
CREATE INDEX IF NOT EXISTS idx_profiles_company_id ON profiles(company_id);
CREATE INDEX IF NOT EXISTS idx_companies_admin_id ON companies(admin_id);
CREATE INDEX IF NOT EXISTS idx_user_companies_company_id ON user_companies(company_id);
CREATE INDEX IF NOT EXISTS idx_user_companies_user_id ON user_companies(user_id);
CREATE INDEX IF NOT EXISTS idx_kb_articles_company_id ON kb_articles(company_id);
CREATE INDEX IF NOT EXISTS idx_system_settings_company_id ON system_settings(company_id);



ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE internal_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE bug_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE kb_articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE sla_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_feedback ENABLE ROW LEVEL SECURITY;



CREATE POLICY "Profiles are viewable by owners and admins" ON profiles
	FOR SELECT TO authenticated
	USING (
		id = auth.uid()
		OR public.is_admin_user()
	);

CREATE POLICY "Profiles are editable by owners and admins" ON profiles
	FOR UPDATE TO authenticated
	USING (
		id = auth.uid()
		OR public.is_admin_user()
	)
	WITH CHECK (
		id = auth.uid()
		OR public.is_admin_user()
	);

CREATE POLICY "Companies are viewable by company members" ON companies
	FOR SELECT TO authenticated
	USING (
		id IN (SELECT company_id FROM user_companies WHERE user_id = auth.uid())
		OR public.is_admin_user()
	);

CREATE POLICY "Companies are editable by admins" ON companies
	FOR UPDATE TO authenticated
	USING (
		public.is_admin_user()
	)
	WITH CHECK (
		public.is_admin_user()
	);

CREATE POLICY "Users can view their company memberships" ON user_companies
	FOR SELECT TO authenticated
	USING (user_id = auth.uid());

CREATE POLICY "Admins can view admin requests" ON admin_requests
	FOR SELECT TO authenticated
	USING (
		public.is_admin_user()
	);

CREATE POLICY "Users can create admin requests" ON admin_requests
	FOR INSERT TO authenticated
	WITH CHECK (admin_id = auth.uid());

CREATE POLICY "Admins can update admin requests" ON admin_requests
	FOR UPDATE TO authenticated
	USING (
		public.is_admin_user()
	)
	WITH CHECK (
		public.is_admin_user()
	);

CREATE POLICY "Tickets are viewable by members and admins" ON tickets
	FOR SELECT TO authenticated
	USING (
		user_id = auth.uid()
		OR assigned_agent_id = auth.uid()
		OR company_id IN (SELECT company_id FROM user_companies WHERE user_id = auth.uid())
		OR public.is_admin_user()
	);

CREATE POLICY "Tickets are insertable by authenticated users" ON tickets
	FOR INSERT TO authenticated
	WITH CHECK (user_id = auth.uid());

CREATE POLICY "Tickets are updatable by members and admins" ON tickets
	FOR UPDATE TO authenticated
	USING (
		user_id = auth.uid()
		OR assigned_agent_id = auth.uid()
		OR company_id IN (SELECT company_id FROM user_companies WHERE user_id = auth.uid())
		OR public.is_admin_user()
	)
	WITH CHECK (
		user_id = auth.uid()
		OR assigned_agent_id = auth.uid()
		OR company_id IN (SELECT company_id FROM user_companies WHERE user_id = auth.uid())
		OR public.is_admin_user()
	);

CREATE POLICY "Ticket messages are viewable by ticket participants" ON ticket_messages
	FOR SELECT TO authenticated
	USING (
		ticket_id IN (
			SELECT id
			FROM tickets
			WHERE user_id = auth.uid()
			   OR assigned_agent_id = auth.uid()
			   OR company_id IN (SELECT company_id FROM user_companies WHERE user_id = auth.uid())
		)
	);

CREATE POLICY "Ticket messages are insertable by ticket participants" ON ticket_messages
	FOR INSERT TO authenticated
	WITH CHECK (
		sender_id = auth.uid()
		AND ticket_id IN (
			SELECT id
			FROM tickets
			WHERE user_id = auth.uid()
			   OR assigned_agent_id = auth.uid()
			   OR company_id IN (SELECT company_id FROM user_companies WHERE user_id = auth.uid())
		)
	);

CREATE POLICY "Internal notes are viewable by admins" ON internal_notes
	FOR SELECT TO authenticated
	USING (public.is_admin_user());

CREATE POLICY "Internal notes are insertable by admins" ON internal_notes
	FOR INSERT TO authenticated
	WITH CHECK (
		agent_id = auth.uid()
		AND public.is_admin_user()
	);

CREATE POLICY "Bug reports are viewable by authenticated users" ON bug_reports
	FOR SELECT TO authenticated
	USING (true);

CREATE POLICY "Bug reports are insertable by authenticated users" ON bug_reports
	FOR INSERT TO authenticated
	WITH CHECK (reporter_id = auth.uid());

CREATE POLICY "Enterprise leads are insertable by anyone" ON enterprise_leads
	FOR INSERT TO anon, authenticated
	WITH CHECK (true);

CREATE POLICY "Knowledge base is viewable by authenticated users" ON knowledge_base
	FOR SELECT TO authenticated
	USING (true);

CREATE POLICY "Knowledge base is editable by admins" ON knowledge_base
	FOR ALL TO authenticated
	USING (public.is_admin_user());

CREATE POLICY "SLA config is viewable by company members" ON sla_config
	FOR SELECT TO authenticated
	USING (
		company_id IN (SELECT company_id FROM user_companies WHERE user_id = auth.uid())
		OR public.is_admin_user()
	);

CREATE POLICY "User feedback is viewable by company members" ON user_feedback
	FOR SELECT TO authenticated
	USING (
		company_id IN (SELECT company_id FROM user_companies WHERE user_id = auth.uid())
		OR reporter_id = auth.uid()
		OR public.is_admin_user()
	);

CREATE POLICY "User feedback is insertable by authenticated users" ON user_feedback
	FOR INSERT TO authenticated
	WITH CHECK (reporter_id = auth.uid());



GRANT SELECT, INSERT, UPDATE, DELETE ON companies TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON profiles TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_companies TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON admin_requests TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON tickets TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ticket_messages TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON internal_notes TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON bug_reports TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON enterprise_leads TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON kb_articles TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON knowledge_base TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON sla_config TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_feedback TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON system_settings TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.update_timestamp() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_company_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_admin_user() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION match_articles(vector, float, int) TO authenticated, service_role;

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE internal_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE bug_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE kb_articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE sla_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_feedback ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER update_companies_timestamp
	BEFORE UPDATE ON companies
	FOR EACH ROW
	EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER update_profiles_timestamp
	BEFORE UPDATE ON profiles
	FOR EACH ROW
	EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER update_user_companies_timestamp
	BEFORE UPDATE ON user_companies
	FOR EACH ROW
	EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER update_admin_requests_timestamp
	BEFORE UPDATE ON admin_requests
	FOR EACH ROW
	EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER update_tickets_timestamp
	BEFORE UPDATE ON tickets
	FOR EACH ROW
	EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER update_bug_reports_timestamp
	BEFORE UPDATE ON bug_reports
	FOR EACH ROW
	EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER update_enterprise_leads_timestamp
	BEFORE UPDATE ON enterprise_leads
	FOR EACH ROW
	EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER update_kb_articles_timestamp
	BEFORE UPDATE ON kb_articles
	FOR EACH ROW
	EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER update_sla_config_timestamp
	BEFORE UPDATE ON sla_config
	FOR EACH ROW
	EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER update_system_settings_timestamp
	BEFORE UPDATE ON system_settings
	FOR EACH ROW
	EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER update_user_feedback_timestamp
	BEFORE UPDATE ON user_feedback
	FOR EACH ROW
	EXECUTE FUNCTION update_timestamp();

-- Agentic Self-Healing Actions Engine (#4115)
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS resolution_note text;

CREATE TABLE IF NOT EXISTS action_execution_logs (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	ticket_id text NOT NULL,
	company_id uuid REFERENCES companies(id) ON DELETE CASCADE,
	playbook_name text NOT NULL,
	parameters jsonb NOT NULL DEFAULT '{}'::jsonb,
	dry_run boolean NOT NULL DEFAULT false,
	status text NOT NULL,
	diagnostic_summary text,
	executed_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_action_execution_logs_ticket_id ON action_execution_logs(ticket_id);
ALTER TABLE action_execution_logs ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON action_execution_logs TO authenticated, service_role;
