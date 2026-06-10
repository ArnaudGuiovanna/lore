# Security Policy

## Supported Versions

LORE is under active development. Security fixes are handled on the default
branch first, then backported to maintained release branches when they exist.

Self-hosted operators should keep their deployment current and run a tested
backup before every upgrade.

## Reporting a Vulnerability

Please do not open a public issue for a suspected vulnerability.

Use one of these private channels:

- GitHub private vulnerability reporting:
  <https://github.com/ArnaudGuiovanna/lore/security/advisories/new>
- If private reporting is unavailable, contact the repository maintainer
  privately and include `LORE security report` in the subject.

Include as much concrete information as possible:

- affected commit, release, or deployment mode;
- impacted component (`cmd/lore`, `internal/httpapi`, `deploy`, `web`, etc.);
- reproduction steps or proof of concept;
- expected impact and whether tenant isolation, authentication, data export,
  credentials, or generated content are involved;
- relevant logs with secrets, tokens, learner data, and personal data redacted.

## Handling

The maintainer will triage the report privately, prepare a fix, and coordinate
public disclosure once users have a reasonable upgrade path. If exploitation is
likely, operators should rotate exposed secrets, restrict network access, and
restore from known-good backups as needed.

## Production Baseline

Before real OF usage, operators should at minimum:

- run with `LORE_ENV=production`;
- set strong `JWT_SECRET`, `LORE_BOOTSTRAP_TOKEN`, `LORE_METRICS_TOKEN`, and
  `SESSION_SECRET`;
- keep `deploy/.env` out of git and with mode `0600`;
- expose only Caddy on 80/443, keeping Postgres and the Go backend private;
- keep Caddy security headers enabled;
- schedule and test backups for Postgres, `deploy/.env`, and `web-gen`;
- document their local incident contact and retention obligations.
