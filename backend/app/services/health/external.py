"""E7 collector 7: Railway and Vercel usage, read-only metadata.

Both are off unless their token is set (and HEALTH_EXTERNAL_CALLS is not 0),
report "not configured" otherwise, and are never sampled into the trend store.
Tokens come from the environment at collect time and are only ever put in a
request header: never in a result, a log line or an error (failures carry the
exception class or the HTTP status only).

Railway: GraphQL (`RAILWAY_API_URL`, default backboard.railway.com) with a
*project* token in `Project-Access-Token`. One call resolves the project and
environment the token belongs to and lists services; one call per service (run
concurrently) fetches its latest deployment (status and age).

Vercel: `GET /v6/deployments` with a bearer token and `VERCEL_PROJECT_ID`
(optionally `VERCEL_TEAM_ID`): latest deployment state and age, and the number
of deployments created this month. The billing API answers "Plan not found" for
this team, so it is deliberately not called.
"""
from __future__ import annotations

import asyncio
import os
from datetime import datetime, timezone
from typing import Awaitable, Callable, Optional

from app.services.health.base import (
    CRIT, OK, WARN, Collector, external_calls_enabled, result, utc_now,
)

HTTP_TIMEOUT_S = 1.5
RAILWAY_URL = "https://backboard.railway.com/graphql/v2"
VERCEL_URL = "https://api.vercel.com"
RAILWAY_BAD = {"FAILED", "CRASHED"}
VERCEL_BAD = {"ERROR"}

Fetch = Callable[..., Awaitable[dict]]


class UpstreamError(Exception):
    """Carries the HTTP status only, never upstream text."""


async def default_fetch(method: str, url: str, *, headers: dict, json: Optional[dict] = None,
                        params: Optional[dict] = None) -> dict:
    import httpx
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_S) as client:
        r = await client.request(method, url, headers=headers, json=json, params=params)
    if r.status_code >= 400:
        raise UpstreamError(f"HTTP {r.status_code}")
    return r.json()


def _env(name: str) -> str:
    return (os.environ.get(name) or "").strip()


def _age_hours(created: Optional[datetime], now: datetime) -> Optional[float]:
    if created is None:
        return None
    return round(max(0.0, (now - created).total_seconds()) / 3600, 1)


def _parse_iso(value) -> Optional[datetime]:
    if not isinstance(value, str):
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _not_configured(name: str, what: str) -> dict:
    return result(name, state="not_configured", note=f"Not configured. Set {what} to show this.")


class RailwayCollector(Collector):
    name = "railway"
    title = "Railway"
    external = True

    def __init__(self, fetch: Fetch = default_fetch):
        self.fetch = fetch

    async def _gql(self, token: str, query: str, variables: Optional[dict] = None) -> dict:
        url = _env("RAILWAY_API_URL") or RAILWAY_URL
        body = await self.fetch("POST", url, headers={"Project-Access-Token": token, "Content-Type": "application/json"},
                                json={"query": query, "variables": variables or {}})
        if body.get("errors"):
            raise UpstreamError("GraphQL error")
        return body.get("data") or {}

    async def collect(self) -> dict:
        token = _env("RAILWAY_API_TOKEN")
        if not token or not external_calls_enabled():
            return _not_configured(self.name, "RAILWAY_API_TOKEN")
        ctx = await self._gql(token, "query { projectToken { projectId environmentId } }")
        pt = ctx.get("projectToken") or {}
        project_id, env_id = pt.get("projectId"), pt.get("environmentId")
        if not project_id or not env_id:
            raise UpstreamError("no project for token")
        proj = await self._gql(
            token, "query($id: String!) { project(id: $id) { name services { edges { node { id name } } } } }",
            {"id": project_id})
        project = proj.get("project") or {}
        services = [e["node"] for e in (project.get("services") or {}).get("edges", []) if e.get("node")]

        async def latest(svc: dict) -> dict:
            d = await self._gql(
                token,
                "query($p: String!, $e: String!, $s: String!) { deployments(first: 1, input: "
                "{projectId: $p, environmentId: $e, serviceId: $s}) { edges { node { status createdAt } } } }",
                {"p": project_id, "e": env_id, "s": svc["id"]})
            edges = (d.get("deployments") or {}).get("edges") or []
            node = (edges[0] or {}).get("node") if edges else None
            now = utc_now()
            return {
                "service": svc.get("name"),
                "status": (node or {}).get("status"),
                "age_hours": _age_hours(_parse_iso((node or {}).get("createdAt")), now),
            }

        rows = await asyncio.gather(*(latest(s) for s in services[:12]))
        status = OK
        if any((r["status"] or "") in RAILWAY_BAD for r in rows):
            status = CRIT
        return result(self.name, status=status, values={
            "project": project.get("name"), "service_count": len(services), "services": rows,
        })


class VercelCollector(Collector):
    name = "vercel"
    title = "Vercel"
    external = True

    def __init__(self, fetch: Fetch = default_fetch):
        self.fetch = fetch

    async def collect(self) -> dict:
        token, project = _env("VERCEL_API_TOKEN"), _env("VERCEL_PROJECT_ID")
        if not token or not project or not external_calls_enabled():
            return _not_configured(self.name, "VERCEL_API_TOKEN and VERCEL_PROJECT_ID")
        now = utc_now()
        month_start = datetime(now.year, now.month, 1, tzinfo=timezone.utc)
        params = {"projectId": project, "limit": 100, "since": int(month_start.timestamp() * 1000)}
        if _env("VERCEL_TEAM_ID"):
            params["teamId"] = _env("VERCEL_TEAM_ID")
        body = await self.fetch("GET", f"{_env('VERCEL_API_URL') or VERCEL_URL}/v6/deployments",
                                headers={"Authorization": f"Bearer {token}"}, params=params)
        deployments = body.get("deployments") or []
        more = bool((body.get("pagination") or {}).get("next"))
        latest = max(deployments, key=lambda d: d.get("created") or 0) if deployments else None
        created = datetime.fromtimestamp(latest["created"] / 1000, tz=timezone.utc) if latest and latest.get("created") else None
        state = (latest or {}).get("state") or (latest or {}).get("readyState")
        errors = sum(1 for d in deployments if (d.get("state") or d.get("readyState")) in VERCEL_BAD)
        status = CRIT if state in VERCEL_BAD else OK
        return result(self.name, status=status, values={
            "latest_state": state, "latest_age_hours": _age_hours(created, now),
            "latest_target": (latest or {}).get("target"),
            "deployments_month": len(deployments), "deployments_month_capped": more,
            "errors_month": errors,
        }, note="Deployment counts only: the billing API is not available for this team.")
