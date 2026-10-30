"""
Sliding-Window IP Rate Limiting Middleware Module.
Protects FastAPI auth and ticket creation endpoints against brute-force and DoS attacks (#3950).
"""

import time
from typing import Dict, List, Tuple


class RateLimiter:
    """
    Sliding-window IP rate limiter.
    """

    def __init__(self, requests_per_minute: int = 20, window_seconds: int = 60):
        self.requests_per_minute = requests_per_minute
        self.window_seconds = window_seconds
        # Storage schema: { client_ip: [timestamp1, timestamp2, ...] }
        self._ip_history: Dict[str, List[float]] = {}

    def is_rate_limited(self, client_ip: str) -> Tuple[bool, int]:
        """
        Check if a client IP exceeds request rate limits.
        Returns Tuple[is_limited: bool, retry_after_seconds: int]
        """
        now = time.time()
        window_start = now - self.window_seconds

        if client_ip not in self._ip_history:
            self._ip_history[client_ip] = []

        # Purge timestamps outside sliding window
        history = [ts for ts in self._ip_history[client_ip] if ts > window_start]
        self._ip_history[client_ip] = history

        if len(history) >= self.requests_per_minute:
            oldest_timestamp = history[0]
            retry_after = int(self.window_seconds - (now - oldest_timestamp))
            return True, max(1, retry_after)

        self._ip_history[client_ip].append(now)
        return False, 0
