"""
Web search tool: thin wrapper around `ddgs` (the maintained successor to
`duckduckgo-search`). No API key required. Since it scrapes DuckDuckGo it
can intermittently rate-limit or return nothing, so calls are wrapped in
retry/backoff and a clean empty-result path rather than a crash.
"""
from __future__ import annotations

from dataclasses import dataclass

from tenacity import retry, stop_after_attempt, wait_exponential


@dataclass
class SearchResult:
    title: str
    url: str
    snippet: str


class WebSearchError(RuntimeError):
    """Raised when ddgs fails after retries — caller should degrade gracefully."""


@retry(
    wait=wait_exponential(multiplier=1, min=1, max=15),
    stop=stop_after_attempt(4),
    reraise=True,
)
def _search_raw(query: str, max_results: int) -> list[dict]:
    from ddgs import DDGS

    with DDGS() as ddgs:
        return list(ddgs.text(query, max_results=max_results))


def web_search(query: str, max_results: int = 5) -> list[SearchResult]:
    try:
        raw = _search_raw(query, max_results)
    except Exception as exc:  # noqa: BLE001 - ddgs raises various scraping/network errors
        raise WebSearchError(
            f"Web search for '{query}' failed after retries: {exc}"
        ) from exc

    results: list[SearchResult] = []
    for item in raw:
        results.append(
            SearchResult(
                title=item.get("title", "").strip(),
                url=item.get("href") or item.get("link") or "",
                snippet=item.get("body", "").strip(),
            )
        )
    return results
