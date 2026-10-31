"""
Structured JSON logging configuration for CloudWatch, Datadog, and ELK ingestion (issue #3905).

Provides high-performance, single-line JSON log formatting with context enrichment,
exception serialization, and customizable log levels.
"""

import json
import logging
import sys
from datetime import datetime, timezone
from typing import Any, Dict, Optional

# Standard LogRecord attribute names to ignore when extracting custom extra fields
_STANDARD_LOG_ATTRIBUTES = frozenset({
    "args",
    "asctime",
    "created",
    "exc_info",
    "exc_text",
    "filename",
    "funcName",
    "levelname",
    "levelno",
    "lineno",
    "module",
    "msecs",
    "message",
    "msg",
    "name",
    "pathname",
    "process",
    "processName",
    "relativeCreated",
    "stack_info",
    "thread",
    "threadName",
})


class JSONFormatter(logging.Formatter):
    """Outputs each log record as a single JSON line formatted for log aggregators."""

    def format(self, record: logging.LogRecord) -> str:
        log_entry: Dict[str, Any] = {
            "timestamp": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "module": record.module,
            "function": record.funcName,
            "lineno": record.lineno,
            "process": record.process,
            "thread": record.threadName,
        }

        # Format exception traceback if present
        if record.exc_info and record.exc_info[0] is not None:
            log_entry["exception"] = self.formatException(record.exc_info)

        # Include custom extra fields passed to logger calls
        for key, value in record.__dict__.items():
            if key not in _STANDARD_LOG_ATTRIBUTES and not key.startswith("_"):
                try:
                    # Ensure value is JSON-serializable
                    json.dumps(value)
                    log_entry[key] = value
                except (TypeError, OverflowError):
                    log_entry[key] = str(value)

        return json.dumps(log_entry, default=str)


def setup_logging(
    level: int = logging.INFO,
    stream: Optional[Any] = None,
) -> logging.Logger:
    """
    Configure the root logger with a JSON stream handler.

    Clears pre-existing handlers to prevent duplicate output and configures
    structured JSON formatting for containerized environments.
    """
    if stream is None:
        stream = sys.stdout

    handler = logging.StreamHandler(stream)
    handler.setFormatter(JSONFormatter())

    root = logging.getLogger()
    root.setLevel(level)

    # Remove any pre-existing handlers to ensure clean, non-duplicated output
    root.handlers.clear()
    root.addHandler(handler)

    return root
