import unittest
from unittest.mock import MagicMock
from backend.services.privilege_audit_service import (
    PrivilegeAuditService,
    get_role_level,
    is_privilege_elevation,
    get_elevation_severity,
    ROLE_HIERARCHY,
)


class FakeSupabaseTable:
    def __init__(self, data=None):
        self.data = data if data is not None else []
        self.inserted = []

    def insert(self, payload):
        self.inserted.append(payload)
        class Exec:
            def execute(self_inner):
                class Res:
                    data = [payload]
                return Res()
        return Exec()

    def select(self, *args):
        return self

    def in_(self, col, values):
        return self

    def eq(self, col, val):
        return self

    def order(self, col, desc=True):
        return self

    def limit(self, count):
        return self

    def execute(self):
        class Res:
            data = self.data
        return Res()


class FakeSupabaseClient:
    def __init__(self):
        self.table_mock = FakeSupabaseTable()

    def table(self, name):
        return self.table_mock


class TestPrivilegeAuditService(unittest.TestCase):
    def test_get_role_level(self):
        self.assertEqual(get_role_level("user"), 1)
        self.assertEqual(get_role_level("agent"), 2)
        self.assertEqual(get_role_level("manager"), 3)
        self.assertEqual(get_role_level("admin"), 4)
        self.assertEqual(get_role_level("master_admin"), 5)
        self.assertEqual(get_role_level(None), 1)
        self.assertEqual(get_role_level("unknown_custom_role"), 1)

    def test_is_privilege_elevation(self):
        # Elevation cases
        self.assertTrue(is_privilege_elevation("user", "admin"))
        self.assertTrue(is_privilege_elevation("user", "agent"))
        self.assertTrue(is_privilege_elevation("agent", "admin"))
        self.assertTrue(is_privilege_elevation("admin", "master_admin"))

        # Non-elevation cases (demotion or same)
        self.assertFalse(is_privilege_elevation("admin", "user"))
        self.assertFalse(is_privilege_elevation("admin", "agent"))
        self.assertFalse(is_privilege_elevation("admin", "admin"))
        self.assertFalse(is_privilege_elevation("user", "user"))
        self.assertFalse(is_privilege_elevation("user", None))

    def test_get_elevation_severity(self):
        self.assertEqual(get_elevation_severity("user", "admin"), "CRITICAL")
        self.assertEqual(get_elevation_severity("agent", "master_admin"), "CRITICAL")
        self.assertEqual(get_elevation_severity("user", "manager"), "HIGH")
        self.assertEqual(get_elevation_severity("user", "agent"), "MEDIUM")
        self.assertEqual(get_elevation_severity("admin", "user"), "DEMOTION")
        self.assertEqual(get_elevation_severity("user", "user"), "LOW")

    def test_record_privilege_elevation_creates_structured_record(self):
        fake_db = FakeSupabaseClient()
        service = PrivilegeAuditService(supabase_client=fake_db)

        record = service.record_privilege_elevation(
            operator_id="admin-123",
            target_user_id="user-456",
            old_role="user",
            new_role="admin",
            operator_email="admin@company.com",
            target_user_email="john@company.com",
            company_id="corp-789",
            ip_address="192.168.1.50",
            reason="Promoted to IT Admin",
        )

        self.assertEqual(record["event_type"], "auth_privilege_elevation")
        self.assertEqual(record["action"], "privilege_access_elevation")
        self.assertEqual(record["performed_by"], "admin-123")
        self.assertEqual(record["company_id"], "corp-789")
        self.assertIn("elevated target user", record["message"])

        meta = record["metadata"]
        self.assertEqual(meta["target_user_id"], "user-456")
        self.assertEqual(meta["target_user_email"], "john@company.com")
        self.assertEqual(meta["operator_id"], "admin-123")
        self.assertEqual(meta["operator_email"], "admin@company.com")
        self.assertEqual(meta["old_role"], "user")
        self.assertEqual(meta["new_role"], "admin")
        self.assertTrue(meta["is_elevation"])
        self.assertEqual(meta["severity"], "CRITICAL")
        self.assertEqual(meta["ip_address"], "192.168.1.50")
        self.assertEqual(meta["reason"], "Promoted to IT Admin")

    def test_record_role_modification_without_elevation(self):
        service = PrivilegeAuditService(supabase_client=None)

        record = service.record_privilege_elevation(
            operator_id="admin-999",
            target_user_id="user-111",
            old_role="admin",
            new_role="agent",
            operator_email="superadmin@corp.io",
            target_user_email="demoted@corp.io",
            reason="Departing support team role",
        )

        self.assertEqual(record["event_type"], "auth_role_update")
        self.assertEqual(record["action"], "role_modification")
        self.assertFalse(record["metadata"]["is_elevation"])
        self.assertEqual(record["metadata"]["severity"], "DEMOTION")

    def test_get_privilege_audit_logs_filters_by_target_user(self):
        sample_logs = [
            {
                "id": "log-1",
                "event_type": "auth_privilege_elevation",
                "metadata": {"target_user_id": "target-A"}
            },
            {
                "id": "log-2",
                "event_type": "auth_privilege_elevation",
                "metadata": {"target_user_id": "target-B"}
            }
        ]
        fake_db = MagicMock()
        fake_query = MagicMock()
        fake_db.table.return_value.select.return_value.in_.return_value.order.return_value.limit.return_value = fake_query
        fake_query.execute.return_value.data = sample_logs

        service = PrivilegeAuditService(supabase_client=fake_db)
        results = service.get_privilege_audit_logs(target_user_id="target-A")
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["id"], "log-1")


if __name__ == "__main__":
    unittest.main()
