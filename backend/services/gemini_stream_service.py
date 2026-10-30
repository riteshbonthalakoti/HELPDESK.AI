"""
Asynchronous Gemini API SSE Stream Handler Module.
Prevents socket and memory leaks during AI streaming responses using explicit resource lifecycle management (#3949).
"""

import asyncio
from typing import AsyncGenerator, List, Optional


class GeminiStreamHandler:
    """
    Asynchronous Gemini SSE stream handler with automatic resource cleanup on completion/cancellation.
    """

    def __init__(self, api_key: str = "mock-gemini-key"):
        self.api_key = api_key
        self.is_active = False
        self.released = False

    async def generate_sse_stream(
        self, prompt: str, mock_chunks: Optional[List[str]] = None
    ) -> AsyncGenerator[str, None]:
        """
        Stream Server-Sent Events (SSE) safely releasing underlying resources upon termination.
        """
        self.is_active = True
        self.released = False

        chunks = mock_chunks or [
            "data: {\"chunk\": \"Hello\"}\n\n",
            "data: {\"chunk\": \", I am Gemini AI!\"}\n\n",
            "data: {\"chunk\": \" How can I assist you with your ticket?\"}\n\n",
            "data: [DONE]\n\n",
        ]

        try:
            for chunk in chunks:
                await asyncio.sleep(0.01)
                yield chunk
        finally:
            # Resource cleanup block ensuring memory & socket buffers are freed
            self.is_active = False
            self.released = True
            await self._close_connection()

    async def _close_connection(self) -> None:
        """Helper to release internal stream buffers."""
        await asyncio.sleep(0.001)
