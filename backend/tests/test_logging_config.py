"""
Unit tests for structured JSON logging configuration (issue #3905).

Run with:  pytest backend/tests/test_logging_config.py -v
"""

import io
import json
import logging
import unittest
from datetime import datetime

from backend.logging_config import JSONFormatter, setup_logging


class TestJSONFormatter(unittest.TestCase):
    def setUp(self):
        self.formatter = JSONFormatter()

    def test_json_formatter_standard_fields(self):
        record = logging.LogRecord(
            name="test_logger",
            level=logging.INFO,
            pathname=__file__,
            lineno=42,
            msg="User %s logged in successfully",
            args=("alice",),
            exc_info=None,
            func="test_func",
        )

        formatted_str = self.formatter.format(record)
        data = json.loads(formatted_str)

        self.assertEqual(data["level"], "INFO")
        self.assertEqual(data["logger"], "test_logger")
        self.assertEqual(data["message"], "User alice logged in successfully")
        self.assertEqual(data["lineno"], 42)
        self.assertEqual(data["function"], "test_func")
        self.assertIn("timestamp", data)
        self.assertIn("process", data)
        self.assertIn("thread", data)

    def test_json_formatter_iso_timestamp(self):
        record = logging.LogRecord(
            name="test_logger",
            level=logging.WARNING,
            pathname=__file__,
            lineno=10,
            msg="High memory usage detected",
            args=(),
            exc_info=None,
        )

        data = json.loads(self.formatter.format(record))
        # Ensure timestamp parses as valid ISO 8601 UTC
        parsed_dt = datetime.fromisoformat(data["timestamp"])
        self.assertIsNotNone(parsed_dt.tzinfo)

    def test_json_formatter_exception_traceback(self):
        try:
            raise ValueError("Invalid tenant token provided")
        except ValueError:
            import sys
            exc_info = sys.exc_info()

        record = logging.LogRecord(
            name="auth_service",
            level=logging.ERROR,
            pathname=__file__,
            lineno=55,
            msg="Authentication failed",
            args=(),
            exc_info=exc_info,
        )

        data = json.loads(self.formatter.format(record))
        self.assertEqual(data["level"], "ERROR")
        self.assertIn("exception", data)
        self.assertIn("ValueError: Invalid tenant token provided", data["exception"])

    def test_json_formatter_custom_extra_fields(self):
        record = logging.LogRecord(
            name="audit_service",
            level=logging.INFO,
            pathname=__file__,
            lineno=80,
            msg="Audit log record emitted",
            args=(),
            exc_info=None,
        )
        record.company_id = "tenant-enterprise-99"
        record.request_id = "req-uuid-001"
        record.latency_ms = 14.8

        data = json.loads(self.formatter.format(record))
        self.assertEqual(data["company_id"], "tenant-enterprise-99")
        self.assertEqual(data["request_id"], "req-uuid-001")
        self.assertEqual(data["latency_ms"], 14.8)

    def test_json_formatter_non_serializable_extra_handled(self):
        class CustomObj:
            def __str__(self):
                return "CustomObject(id=101)"

        record = logging.LogRecord(
            name="test_logger",
            level=logging.INFO,
            pathname=__file__,
            lineno=99,
            msg="Complex extra field",
            args=(),
            exc_info=None,
        )
        record.custom_payload = CustomObj()
        record.tag_set = {"tag1", "tag2"}

        data = json.loads(self.formatter.format(record))
        self.assertEqual(data["custom_payload"], "CustomObject(id=101)")
        self.assertIn(type(data["tag_set"]), (list, str))


class TestSetupLogging(unittest.TestCase):
    def test_setup_logging_configures_root_logger(self):
        stream = io.StringIO()
        root = setup_logging(level=logging.DEBUG, stream=stream)

        self.assertEqual(root.level, logging.DEBUG)
        self.assertEqual(len(root.handlers), 1)
        self.assertIsInstance(root.handlers[0].formatter, JSONFormatter)

        logger = logging.getLogger("test_module")
        logger.info("Test message written to stream", extra={"tenant": "acme"})

        output = stream.getvalue().strip()
        data = json.loads(output)
        self.assertEqual(data["message"], "Test message written to stream")
        self.assertEqual(data["tenant"], "acme")
        self.assertEqual(data["level"], "INFO")


if __name__ == "__main__":
    unittest.main()
