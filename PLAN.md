# Real-Time Poll Rooms - Architecture Plan

## Stack
- Next.js App Router + TypeScript
- Supabase Postgres for persistence
- Supabase Realtime on `votes` inserts
- Route handlers (`app/api`) for create/read/vote

## Data flow
1. Create poll (`POST /api/polls`)
   - Validate question/options.
   - Generate 6-char uppercase room code with collision retry.
   - Insert poll + options.
2. Load room (`GET /api/polls/[code]`)
   - Fetch poll + options + vote counts.
3. Vote (`POST /api/polls/[code]/vote`)
   - Validate option exists and poll is open.
   - Apply anti-abuse checks.
   - Insert vote, return 409/429 for blocked attempts.
4. Realtime
   - Room client subscribes to `votes` insert events filtered by `poll_id`.
   - On update, refetch poll snapshot.

## Fairness controls
- Device one-vote lock: `device_id` cookie + salted `voter_hash` with unique DB constraint.
- Per-poll IP rate limit: hashed IP bucket max 5 votes/min per poll.

## UX decisions
- Results hidden until user votes or poll is closed.
- Copy link with mounted full URL to avoid hydration mismatch.
- Clear API error surfaces and submit/vote loading states.
