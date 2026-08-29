# Security Policy

Report vulnerabilities privately through the security advisory flow for this repository. Do not include live credentials, contact submissions, email addresses, or other personal data in a public issue.

## Supported versions

Security fixes are applied to the latest released minor version. Package authors who fork this showcase are responsible for publishing their own support window.

## Security boundaries

- The CMS package manifest is declarative and contains no operational credentials.
- Public clients can create submissions but cannot read them.
- Reading and moderation require a high-entropy administration bearer.
- Browser origins are exact-match allowlisted when configured.
- Notification delivery is configured at runtime and can be HMAC-signed.
- Client addresses are HMAC-hashed before storage.
- Deployment operators own TLS termination, durable storage, backups, retention, deletion, monitoring, and secret rotation.

The in-memory rate limiter is a single-instance safeguard. Multi-instance deployments should enforce shared rate limits at the edge or replace it with a shared store.
