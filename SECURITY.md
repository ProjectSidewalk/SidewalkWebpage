# Security Policy

Project Sidewalk collects accessibility data from contributors around the world, and we take the security of the
application and that data seriously. Thank you for helping keep it safe.

## Supported versions

Project Sidewalk is a continuously deployed web application rather than a versioned download. We support and patch:

- **`master`** — the code running on production deployments.
- **`develop`** — the active development branch.

Fixes land on `develop` and roll out to deployments from `master`; there are no separately maintained older
releases.

## Reporting a vulnerability

**Please do not open a public issue, pull request, or discussion for security problems**, and don't disclose them
publicly until we've had a chance to fix them.

Instead, report privately through GitHub's vulnerability reporting:

➡️ **[Report a vulnerability](https://github.com/ProjectSidewalk/SidewalkWebpage/security/advisories/new)**
(repository **Security** tab → **Report a vulnerability**)

This opens a private advisory visible only to you and the maintainers. If you can't use GitHub for any reason, email
**sidewalk@cs.uw.edu** with `SECURITY` in the subject line.

### What to include

A good report helps us reproduce and fix the issue quickly:

- A description of the vulnerability and its potential impact.
- Step-by-step instructions to reproduce it (proof-of-concept, affected URL/endpoint, payload).
- The affected component or area (e.g. a `/v3/api/...` route, the Explore tool, authentication).
- Any relevant logs, screenshots, or suggested remediation.

### What to expect

- **Acknowledgement** of your report, typically within a few business days.
- An assessment and, where confirmed, a fix coordinated with you before public disclosure.
- Credit for the discovery if you'd like it (let us know how you'd like to be named).

We're a small academic/civic-tech team, so timelines depend on severity and capacity — we appreciate your patience
and your discretion in giving us time to remediate before any public disclosure.
