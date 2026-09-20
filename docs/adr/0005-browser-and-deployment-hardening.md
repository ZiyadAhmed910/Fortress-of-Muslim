# ADR 0005: Browser and Deployment Hardening

## Status

Accepted

## Context

Fortress Platform uses secure cookie sessions across the Developer and Admin portals, JSON Workers on sibling subdomains, and independent deployments for dynamic services, static portals, and the PWA. Browser failures must be recoverable, session-authenticated writes must not be accepted from unrelated origins, and a successful provider upload alone is not sufficient evidence of a healthy release.

## Decision

Session-authenticated mutation routes under `/v1/control` and `/v1/admin` reject browser requests from unknown origins or with `Sec-Fetch-Site: cross-site`. Their request bodies are limited to 64 KB. Non-browser automation without an Origin header remains supported and still requires a valid session.

Auth responses are non-cacheable and cannot be framed. Static portals use a restrictive Content Security Policy that permits only same-origin resources and HTTPS connections to Fortress subdomains.

The Developer Console applies a 12-second request timeout, retries failed GET requests once, sends a unique request ID, handles non-JSON errors, exposes request IDs in support messages, prevents duplicate form submissions, and tolerates one resource panel failing without discarding the rest of the console.

CI audits production dependencies. Deployments have explicit time limits and finish with live smoke checks that verify service health, platform version, portal identity, and browser security policy.

## Consequences

- Cross-site form and fetch attempts cannot mutate cookie-authenticated management resources.
- Large custom management payloads fail predictably with HTTP 413.
- Developers receive actionable failures instead of indefinite loading states.
- Keyboard and assistive-technology users receive explicit state, focus, and error feedback.
- Deployment workflows fail when the live target is unavailable, stale, or missing its expected protection.
- Smoke tests confirm immediate reachability, not long-term uptime; continuous external monitoring remains separate work.
