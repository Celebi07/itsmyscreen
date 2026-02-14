# Real-Time Poll Rooms

A full-stack poll room app built with Next.js App Router, TypeScript, Supabase Postgres, and Supabase Realtime.

## Features
- Create a poll with question + 2..8 options.
- Share `/room/[code]` link.
- Single-choice voting by anyone with the link.
- Realtime vote updates across clients.
- Persistent polls and votes in Supabase.
- Fairness controls:
  1. **One vote per poll per device** via `device_id` cookie + salted `voter_hash` + DB uniqueness.
  2. **Per-poll IP rate limit** hashed `ip_hash`, max **5 votes/minute**.

## Environment variables
Copy `.env.example` to `.env.local` and fill:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `VOTER_HASH_SALT`

## Run locally
```bash
npm install
npm run dev
```
Open `http://localhost:3000`.

## SQL migration
Run `supabase/migrations/001_init.sql` in Supabase SQL editor.

## Realtime setup in Supabase
1. Database > Replication.
2. Ensure `public.votes` is added to `supabase_realtime` publication.
3. Keep Realtime enabled for the project.

## Anti-abuse mechanisms and limitations
1. **Device lock (cookie + voter hash)**
   - Prevents repeat voting from the same browser device for same poll.
   - Limitation: clearing cookies/private mode/new device can bypass.
2. **IP rate limit (hashed)**
   - Prevents high-frequency vote spam bursts from the same IP on same poll.
   - Limitation: shared NAT can affect many users; VPN/IP rotation can bypass.

## Edge cases handled
- Duplicate options (case and whitespace insensitive) rejected.
- Option length and question length enforcement.
- Poll closed check on vote.
- Invalid option for poll rejected.
- Room code collision retry loop.
- Clear 400/404/409/429/500 JSON responses.

## Manual test checklist
- [ ] Create poll with valid question + options.
- [ ] Try invalid question (<5 chars) and duplicate options.
- [ ] Open same room in two tabs, vote in one, verify live update in other.
- [ ] Vote twice on same device -> 409.
- [ ] Trigger >5 votes/min same IP -> 429 with `retryAfterSeconds`.
- [ ] Refresh room page and confirm votes persist.

## Vercel deployment
1. Push repo to GitHub.
2. Import project into Vercel.
3. Add env vars from above.
4. Deploy.

## Supabase dashboard final checklist
1. Create a Supabase project.
2. Copy project URL + anon key + service role key.
3. Set env vars in `.env.local` and Vercel project.
4. Run SQL from `supabase/migrations/001_init.sql`.
5. Confirm `public.votes` is included in Realtime publication.
6. Test live updates by voting from two browser tabs.
