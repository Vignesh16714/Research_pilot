"""
Single provider-agnostic interface over Gemini and Groq.

Both providers are wrapped behind `complete()` / `complete_json()` so the
rest of the agent never imports a vendor SDK directly. Free-tier quotas
on both services shift over time, so every call is wrapped in an
exponential-backoff retry on 429s and other transient errors, and any
quota exhaustion is raised as a typed `LLMQuotaError` the API layer can
turn into a clean error response instead of a stack trace.
"""
from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass

from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)


class LLMQuotaError(RuntimeError):
    """Raised when a provider reports quota/rate-limit exhaustion after retries."""


class LLMConfigError(RuntimeError):
    """Raised when required credentials/config are missing."""


class _TransientLLMError(RuntimeError):
    """Internal: retryable error (429, transient 5xx)."""


@dataclass
class LLMResult:
    text: str
    provider: str
    model: str


def _is_rate_limit(exc: Exception) -> bool:
    msg = str(exc).lower()
    return "429" in msg or "rate limit" in msg or "resource_exhausted" in msg or "quota" in msg


def _strip_json_fences(text: str) -> str:
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    return text.strip()


class LLMProvider:
    """Facade selected at construction time via LLM_PROVIDER env var."""

    def __init__(self, provider: str | None = None):
        self.provider = (provider or os.getenv("LLM_PROVIDER", "groq")).lower()
        if self.provider not in ("gemini", "groq"):
            raise LLMConfigError(f"Unknown LLM_PROVIDER '{self.provider}' (expected gemini|groq)")

        if self.provider == "gemini":
            api_key = os.getenv("GOOGLE_API_KEY")
            if not api_key:
                raise LLMConfigError(
                    "GOOGLE_API_KEY is not set. Get a free key with no card required at "
                    "https://ai.google.dev and put it in backend/.env"
                )
            from google import genai  # local import: don't require the SDK unless used

            self._client = genai.Client(api_key=api_key)
            self.model = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")
        else:
            api_key = os.getenv("GROQ_API_KEY")
            if not api_key:
                raise LLMConfigError(
                    "GROQ_API_KEY is not set. Get a free key with no card required at "
                    "https://console.groq.com and put it in backend/.env"
                )
            from groq import Groq  # local import

            self._client = Groq(api_key=api_key)
            self.model = os.getenv("GROQ_MODEL", "openai/gpt-oss-20b")

    # -- public API -------------------------------------------------------

    def complete(self, system: str, user: str, temperature: float = 0.4) -> LLMResult:
        try:
            text = self._complete_with_retry(system, user, temperature)
        except _TransientLLMError as exc:
            raise LLMQuotaError(
                f"{self.provider} ({self.model}) is rate-limited or out of free-tier quota "
                f"after retries. Try again shortly, or switch LLM_PROVIDER in backend/.env. "
                f"Original error: {exc}"
            ) from exc
        return LLMResult(text=text, provider=self.provider, model=self.model)

    def complete_json(self, system: str, user: str, temperature: float = 0.2) -> dict | list:
        """Ask the model for JSON only, and parse it defensively."""
        json_system = (
            system
            + "\n\nRespond with ONLY valid JSON. No markdown fences, no preamble, "
            "no trailing commentary — the entire response must be parseable by json.loads()."
        )
        result = self.complete(json_system, user, temperature=temperature)
        cleaned = _strip_json_fences(result.text)
        try:
            return json.loads(cleaned)
        except json.JSONDecodeError:
            # One repair attempt: sometimes the model wraps JSON in prose anyway.
            match = re.search(r"(\{.*\}|\[.*\])", cleaned, re.DOTALL)
            if match:
                return json.loads(match.group(1))
            raise

    # -- internals ----------------------------------------------------------

    @retry(
        retry=retry_if_exception_type(_TransientLLMError),
        wait=wait_exponential(multiplier=1, min=1, max=20),
        stop=stop_after_attempt(5),
        reraise=True,
    )
    def _complete_with_retry(self, system: str, user: str, temperature: float) -> str:
        try:
            if self.provider == "gemini":
                return self._call_gemini(system, user, temperature)
            return self._call_groq(system, user, temperature)
        except Exception as exc:  # noqa: BLE001 - vendor SDKs raise varied exception types
            if _is_rate_limit(exc):
                raise _TransientLLMError(str(exc)) from exc
            raise

    def _call_gemini(self, system: str, user: str, temperature: float) -> str:
        from google.genai import types

        response = self._client.models.generate_content(
            model=self.model,
            contents=user,
            config=types.GenerateContentConfig(
                system_instruction=system,
                temperature=temperature,
            ),
        )
        return response.text or ""

    def _call_groq(self, system: str, user: str, temperature: float) -> str:
        response = self._client.chat.completions.create(
            model=self.model,
            temperature=temperature,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        )
        return response.choices[0].message.content or ""


_provider_singleton: LLMProvider | None = None


def get_llm() -> LLMProvider:
    """Lazily-constructed process-wide provider instance."""
    global _provider_singleton
    if _provider_singleton is None:
        _provider_singleton = LLMProvider()
    return _provider_singleton


def reset_llm_singleton() -> None:
    """Used by tests / when the provider env var changes at runtime."""
    global _provider_singleton
    _provider_singleton = None
