-- Migration: Add audit trigger specifically on privilege access elevations
-- Issue #3906: Save detailed security records detailing target user logins, active operators, and timestamps during admin updates.

CREATE OR REPLACE FUNCTION audit_privilege_access_elevation()
RETURNS TRIGGER AS $$
DECLARE
  v_operator_id text;
  v_operator_type text;
  v_is_elevation boolean;
  v_old_level int;
  v_new_level int;
  v_severity text;
  v_ip_addr text;
  v_msg text;
BEGIN
  -- Check if role has changed
  IF (OLD.role IS DISTINCT FROM NEW.role) THEN
    v_operator_id := coalesce(auth.uid()::text, 'admin_operator');
    v_operator_type := CASE WHEN auth.uid() IS NULL THEN 'system' ELSE 'admin' END;

    -- Compute relative privilege levels
    v_old_level := CASE lower(coalesce(OLD.role, 'user'))
      WHEN 'super_admin' THEN 5
      WHEN 'master_admin' THEN 5
      WHEN 'admin' THEN 4
      WHEN 'manager' THEN 3
      WHEN 'agent' THEN 2
      ELSE 1
    END;

    v_new_level := CASE lower(coalesce(NEW.role, 'user'))
      WHEN 'super_admin' THEN 5
      WHEN 'master_admin' THEN 5
      WHEN 'admin' THEN 4
      WHEN 'manager' THEN 3
      WHEN 'agent' THEN 2
      ELSE 1
    END;

    v_is_elevation := (v_new_level > v_old_level);
    v_severity := CASE
      WHEN v_new_level >= 4 AND v_old_level < 4 THEN 'CRITICAL'
      WHEN v_new_level = 3 AND v_old_level < 3 THEN 'HIGH'
      WHEN v_new_level > v_old_level THEN 'MEDIUM'
      WHEN v_new_level < v_old_level THEN 'DEMOTION'
      ELSE 'LOW'
    END;

    BEGIN
      v_ip_addr := current_setting('request.headers', true)::json->>'x-forwarded-for';
    EXCEPTION WHEN OTHERS THEN
      v_ip_addr := NULL;
    END;

    v_msg := 'Security Audit: Operator [' || v_operator_id || '] changed role for user [' || NEW.id || '] (' || coalesce(NEW.email, '') || ') from ' || coalesce(OLD.role, 'none') || ' to ' || coalesce(NEW.role, 'none');

    INSERT INTO audit_logs (
      event_type,
      action,
      company_id,
      actor_type,
      performed_by,
      message,
      old_value,
      new_value,
      metadata,
      created_at
    ) VALUES (
      CASE WHEN v_is_elevation THEN 'auth_privilege_elevation' ELSE 'auth_role_update' END,
      'privilege_access_elevation',
      coalesce(NEW.company_id, OLD.company_id),
      v_operator_type,
      v_operator_id,
      v_msg,
      jsonb_build_object('role', OLD.role),
      jsonb_build_object('role', NEW.role),
      jsonb_build_object(
        'target_user_id', NEW.id,
        'target_user_email', NEW.email,
        'operator_id', v_operator_id,
        'old_role', OLD.role,
        'new_role', NEW.role,
        'is_elevation', v_is_elevation,
        'severity', v_severity,
        'ip_address', v_ip_addr,
        'timestamp', now()
      ),
      now()
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_privilege_access_elevation ON profiles;
CREATE TRIGGER trigger_privilege_access_elevation
  AFTER UPDATE OF role ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION audit_privilege_access_elevation();
