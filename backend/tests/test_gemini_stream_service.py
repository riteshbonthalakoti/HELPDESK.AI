import pytest
from backend.services.gemini_stream_service import GeminiStreamHandler


@pytest.mark.asyncio
async def test_gemini_stream_completes_and_releases_resources():
    handler = GeminiStreamHandler()
    chunks = []

    async for chunk in handler.generate_sse_stream("Explain password reset"):
        chunks.append(chunk)

    assert len(chunks) == 4
    assert handler.is_active is False
    assert handler.released is True


@pytest.mark.asyncio
async def test_gemini_stream_releases_resources_on_early_break():
    handler = GeminiStreamHandler()

    gen = handler.generate_sse_stream("Test break stream")
    await gen.__anext__()
    await gen.aclose()

    # verify finally block executed despite early loop termination
    assert handler.is_active is False
    assert handler.released is True
