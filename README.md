# Kujo Contact Form

[![Version](https://img.shields.io/badge/version-1.0.1-black)](https://github.com/kujolang/cms-contact-form)
[![License](https://img.shields.io/badge/license-MIT-lightgrey)](LICENSE)
[![built for Kujo](https://img.shields.io/badge/built%20for-Kujo-white.svg)](https://github.com/kujolang/kujo)

A production-minded showcase plugin for Kujo CMS. It is a standalone hybrid package: an accessible browser component handles public forms, while a zero-dependency Node service validates and stores submissions for administrators and agents.

## What ships

- `kujo-plugin.json`: portable `kujo.plugin/v1` package contract.
- `src/contact-form.js`: framework-neutral `<kujo-contact-form>` web component.
- `src/server.mjs`: public submission and protected moderation API backed by SQLite.
- `src/cli.mjs`: terminal parity for submission review and moderation.
- `openapi.json`: served dynamically at `/openapi.json` for harnesses and agents.
- signed notification delivery for email adapters, automation services, or private webhooks.

The service rejects unknown fields, limits body size and message lengths, applies per-client rate limits, supports an origin allowlist, uses a honeypot without revealing detection, hashes client addresses before storage, and never exposes administration operations without a configured bearer.

## Run locally

Requires Node 24.22.1+ or 26.12.1+ within the supported release lines.

```bash
cp .env.example .env
set -a
source .env
set +a
npm start
```

The default service URL is `http://127.0.0.1:4310`. Runtime data is written under `.data/` and ignored by Git.

## Register with Kujo CMS

Validate and install the manifest through the CMS API-backed CLI:

```bash
npm run package
CMS_API_TOKEN=... /path/to/cms/scripts/cms-extensions.sh plugin:install-zip dist/cms-contact-form.zip active
```

Administrators can also upload the ZIP from **CMS Studio → Themes & plugins**. Package installation records the portable contract and a digest-bound archive receipt. Run the connector service separately and configure its public URL in the installed plugin settings. Deployment tooling should pin an immutable release and verify its declared integrity digest.

## Add a form to any theme

```html
<script type="module" src="https://forms.example.com/assets/contact-form.js"></script>
<kujo-contact-form
  endpoint="https://forms.example.com"
  form-key="contact"
  success-message="Thanks — we will be in touch.">
</kujo-contact-form>
```

The component inherits the theme's typography and colors. Authors can style `.kujo-contact-form`, `.kujo-contact-status`, and `.kujo-contact-trap`; keep the trap visually hidden while leaving it present in the submitted payload.

## API and CLI

Public:

- `GET /health`
- `GET /openapi.json`
- `GET /assets/contact-form.js`
- `POST /v1/forms/:formKey/submissions`

Administration bearer required:

- `GET /v1/submissions?status=new&limit=25&offset=0`
- `GET /v1/submissions/:id`
- `PATCH /v1/submissions/:id` with `new`, `read`, `replied`, `spam`, or `archived`

Examples:

```bash
npm run cli -- submit --name "Ada" --email "ada@example.com" --message "I would like to learn more."
CONTACT_FORM_ADMIN_BEARER=... npm run cli -- list --status new
CONTACT_FORM_ADMIN_BEARER=... npm run cli -- status --id UUID --set replied
```

The manifest declares equivalent read and moderation abilities so control planes can discover the intended agent surface without scraping documentation.

## Notification and email adapters

Set `CONTACT_FORM_NOTIFY_URL` to an HTTPS endpoint owned by an email service, workflow engine, or internal connector. Each accepted submission sends a `contact.submitted` JSON event. Set `CONTACT_FORM_NOTIFY_SIGNING_KEY` to add an `x-kujo-signature: sha256=...` HMAC signature.

The connector does not embed vendor credentials in the portable manifest. Configure provider credentials only in the receiving service's secret store.

## Production checklist

- Put the connector behind TLS and a trusted reverse proxy.
- Set unique, high-entropy administration and IP-hash values.
- Restrict `CONTACT_FORM_ALLOWED_ORIGINS` to the actual frontend origins.
- Persist `.data/contact-form.sqlite` or provide a deployment-specific storage adapter.
- Back up the database and define retention/deletion requirements for personal data.
- Route notifications to a durable queue if delivery guarantees are required.
- Keep the connector private except for the public submission and asset routes.

## Verification

```bash
npm test
```

The suite covers health, validation, origin policy, honeypot behavior, rate limits, protected listing, and moderation.
