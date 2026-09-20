# ADR 0004: Operational Response Contract

## Status

Accepted

## Context

Fortress Platform runs the API, identity service, and MCP gateway as separate Cloudflare Workers. Operational debugging requires a request to be identifiable across clients and services without logging credentials, request bodies, religious content, or URL query values. The static Status portal must also report the environment it is actually deployed in rather than hard-code beta assumptions.

## Decision

All dynamic Workers return:

- `X-Request-ID`, preserving a syntactically safe caller value when supplied.
- `X-Fortress-Platform-Version`, sourced from the shared contracts package.
- `Server-Timing` with application processing duration.
- Baseline content-type, referrer, permissions, and transport security headers.

Workers emit one structured JSON request log containing service, request ID, method, path, status, duration, and environment. Logs exclude query strings, authorization values, request bodies, and response content.

Cloudflare Static Assets use `_headers` files for equivalent browser protections and cross-origin availability checks. The Status portal derives test or production targets from its own hostname, checks every deployed platform component, detects version skew, and stores only the latest 24 checks in that browser.

## Consequences

- Operators can correlate failures through Cloudflare logs and response headers.
- Clients can report a request ID without exposing sensitive request material.
- Version drift during deployments is visible.
- Browser-local history remains an availability aid, not a claim of global uptime or an incident-management system.
- Persistent uptime, alerts, and service-level reporting require a future external monitor or dedicated status backend.
