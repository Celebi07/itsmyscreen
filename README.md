# Real-Time Poll Rooms

A minimal full-stack polling app for the assessment.

## Features implemented

- Create a poll with a question and 2+ options.
- Generate a shareable link (`/poll/:id`).
- Join by link and cast a single-choice vote.
- Real-time result updates using Server-Sent Events (SSE).
- Persistent data with SQLite (`polls.db`).
- Fairness / anti-abuse controls:
  1. **One vote per browser per poll** using a persistent `voter_id` cookie and unique DB constraint.
  2. **One vote per IP per poll** using stored `ip_address` and unique DB constraint.
- Additional abuse control: IP-based poll creation rate limit (max 5 polls/minute/IP).

## Edge cases handled

- Reject invalid JSON payloads.
- Enforce minimum question length and at least 2 **unique** non-empty options.
- Reject votes on non-existent polls/options.
- Return clear error messages for duplicate vote attempts.
- Poll data remains after server restarts via SQLite persistence.

## Known limitations / next improvements

- IP-based protection can block legitimate users behind shared networks.
- Cookie-based protection can be bypassed in private/incognito mode.
- No authentication/ownership model for poll management.
- No CAPTCHA/bot-detection layer.
- SQLite is sufficient for assignment scale; production should use Postgres + Redis pub/sub for multi-instance realtime.

## Run locally

```bash
python3 app.py
```

Open `http://localhost:8000`.

## Deployment

You can deploy this as a single Python service on platforms like Render, Railway, or Fly.io.

Recommended production settings:
- Use persistent disk volume for `polls.db`.
- Put behind HTTPS reverse proxy.
- Configure trusted forwarded headers for accurate client IP handling.
