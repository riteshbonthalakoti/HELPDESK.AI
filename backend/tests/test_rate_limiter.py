import time
import pytest
from backend.services.rate_limiter import RateLimiter


def test_rate_limiter_allows_requests_under_limit():
    limiter = RateLimiter(requests_per_minute=3, window_seconds=60)
    ip = "192.168.1.1"

    is_limited, _ = limiter.is_rate_limited(ip)
    assert is_limited is False

    is_limited, _ = limiter.is_rate_limited(ip)
    assert is_limited is False


def test_rate_limiter_blocks_requests_over_limit():
    limiter = RateLimiter(requests_per_minute=2, window_seconds=60)
    ip = "10.0.0.1"

    limiter.is_rate_limited(ip)
    limiter.is_rate_limited(ip)

    # 3rd request should be rate limited
    is_limited, retry_after = limiter.is_rate_limited(ip)
    assert is_limited is True
    assert retry_after > 0


def test_rate_limiter_isolated_by_ip():
    limiter = RateLimiter(requests_per_minute=1, window_seconds=60)

    limiter.is_rate_limited("1.1.1.1")
    is_limited1, _ = limiter.is_rate_limited("1.1.1.1")
    assert is_limited1 is True

    # Different IP should not be affected
    is_limited2, _ = limiter.is_rate_limited("2.2.2.2")
    assert is_limited2 is False
