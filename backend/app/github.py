"""Async GitHub REST client with a personal access token and rate-limit-aware pacing."""

import asyncio
import logging
import re
import time
from dataclasses import dataclass

import httpx

from . import config

log = logging.getLogger("uvicorn.error")
API = "https://api.github.com"


class GitHubError(Exception):
    """An error that is safe to show to the user."""


@dataclass
class RepoRef:
    owner: str
    name: str

    @property
    def key(self) -> str:
        return f"{self.owner}/{self.name}".lower()


_NAME = r"[A-Za-z0-9_.-]+"


def parse_repo_url(text: str) -> RepoRef:
    """Accepts https/SSH GitHub URLs (any page inside the repo) or plain 'owner/repo'."""
    s = text.strip()
    s = re.sub(r"^git@github\.com:", "", s)
    s = re.sub(r"^(https?://)?(www\.)?github\.com/", "", s, flags=re.I)
    parts = s.split("?")[0].split("#")[0].strip("/").split("/")
    if len(parts) < 2 or not re.fullmatch(_NAME, parts[0]) or not re.fullmatch(_NAME, parts[1]):
        raise GitHubError("That doesn't look like a GitHub repository. Use a link like https://github.com/owner/repo")
    return RepoRef(parts[0], re.sub(r"\.git$", "", parts[1]))


class GitHubClient:
    """One client per ingestion job.

    Rate limiting strategy (GitHub allows 5,000 authenticated requests/hour):
    - a semaphore caps parallel requests (GITHUB_CONCURRENCY),
    - every request is followed by asyncio.sleep(GITHUB_REQUEST_DELAY) so bursts are spread out,
    - when X-RateLimit-Remaining runs low we sleep until X-RateLimit-Reset,
    - 403/429 responses are retried after Retry-After or an exponential backoff.
    """

    def __init__(self) -> None:
        if not config.GITHUB_TOKEN:
            raise GitHubError("GITHUB_TOKEN is not set. Add a GitHub personal access token to backend/.env.")
        self._http = httpx.AsyncClient(
            base_url=API,
            headers={
                "Authorization": f"Bearer {config.GITHUB_TOKEN}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
                "User-Agent": "RepoLens",
            },
            timeout=httpx.Timeout(30, read=60),
        )
        self._sem = asyncio.Semaphore(config.GITHUB_CONCURRENCY)
        self._pause_until = 0.0
        self.requests_made = 0

    async def __aenter__(self) -> "GitHubClient":
        return self

    async def __aexit__(self, *exc) -> None:
        await self._http.aclose()

    async def _get(self, url: str, accept: str | None = None) -> httpx.Response:
        headers = {"Accept": accept} if accept else None
        for attempt in range(6):
            async with self._sem:
                wait = self._pause_until - time.time()
                if wait > 0:
                    log.warning("GitHub rate limit low: sleeping %.0fs", wait)
                    await asyncio.sleep(wait)
                try:
                    r = await self._http.get(url, headers=headers)
                except httpx.HTTPError as e:
                    if attempt == 5:
                        raise GitHubError(f"Network error talking to GitHub: {e}") from e
                    await asyncio.sleep(2 ** attempt)
                    continue
                self.requests_made += 1
                self._track_limits(r)
                await asyncio.sleep(config.GITHUB_REQUEST_DELAY)  # pacing between bulk requests

            if r.status_code in (403, 429) and self._is_rate_limited(r):
                delay = self._retry_delay(r, attempt)
                log.warning("GitHub %s on %s; retrying in %.0fs", r.status_code, url, delay)
                await asyncio.sleep(delay)
                continue
            if r.status_code >= 500 and attempt < 5:
                await asyncio.sleep(2 ** attempt)
                continue
            return r
        raise GitHubError("GitHub kept rate-limiting the requests. Try again in a few minutes.")

    def _track_limits(self, r: httpx.Response) -> None:
        remaining = r.headers.get("X-RateLimit-Remaining")
        reset = r.headers.get("X-RateLimit-Reset")
        if remaining is not None and reset is not None and int(remaining) < 20:
            self._pause_until = max(self._pause_until, int(reset) + 1)

    @staticmethod
    def _is_rate_limited(r: httpx.Response) -> bool:
        if r.status_code == 429 or r.headers.get("Retry-After"):
            return True
        if r.headers.get("X-RateLimit-Remaining") == "0":
            return True
        return "rate limit" in r.text.lower()

    @staticmethod
    def _retry_delay(r: httpx.Response, attempt: int) -> float:
        if r.headers.get("Retry-After"):
            return float(r.headers["Retry-After"]) + 1
        if r.headers.get("X-RateLimit-Remaining") == "0" and r.headers.get("X-RateLimit-Reset"):
            return max(1.0, int(r.headers["X-RateLimit-Reset"]) - time.time() + 1)
        return min(60.0, 5 * 2 ** attempt)  # secondary rate limit: back off exponentially

    # ------------------------------------------------------------------ endpoints

    async def repo(self, ref: RepoRef) -> dict:
        r = await self._get(f"/repos/{ref.owner}/{ref.name}")
        if r.status_code == 404:
            raise GitHubError(f"Repository {ref.owner}/{ref.name} was not found, or the token can't access it.")
        if r.status_code == 401:
            raise GitHubError("GitHub rejected the token. Check GITHUB_TOKEN in backend/.env.")
        r.raise_for_status()
        return r.json()

    async def tree(self, ref: RepoRef, branch: str) -> tuple[str, list[dict], bool]:
        """All files in the repo in one request: returns (commit sha, blobs, truncated)."""
        r = await self._get(f"/repos/{ref.owner}/{ref.name}/git/trees/{branch}?recursive=1")
        if r.status_code == 409:
            raise GitHubError("This repository is empty.")
        r.raise_for_status()
        data = r.json()
        blobs = [e for e in data.get("tree", []) if e.get("type") == "blob"]
        return data.get("sha", ""), blobs, bool(data.get("truncated"))

    async def readme(self, ref: RepoRef) -> str:
        r = await self._get(f"/repos/{ref.owner}/{ref.name}/readme", accept="application/vnd.github.raw+json")
        return r.text if r.status_code == 200 else ""

    async def blob_text(self, ref: RepoRef, sha: str) -> str | None:
        """File content by blob SHA (one request per file). None if it isn't text."""
        r = await self._get(f"/repos/{ref.owner}/{ref.name}/git/blobs/{sha}", accept="application/vnd.github.raw+json")
        if r.status_code != 200:
            return None
        try:
            return r.content.decode("utf-8")
        except UnicodeDecodeError:
            return None
