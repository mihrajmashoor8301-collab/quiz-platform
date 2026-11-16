# Quiz Platform

A multiplayer quiz app built with Next.js 16 and React 19. The production deployment exports the UI as static assets, serves them from a Cloudflare Worker, keeps live room state and WebSockets in Durable Objects, and stores saved quizzes and results in Supabase.

## Local development

Requirements: Node.js 22.12 or newer, npm, Docker (for the local Supabase stack), and the Supabase CLI through `npx`.

```sh
npm ci
cp frontend/.dev.vars.example frontend/.dev.vars
npm run supabase:start
npx supabase db reset
npm run dev
```

The local Supabase stack prints its API URL and keys. Put its API URL, anon key, and service role key into `frontend/.dev.vars`. Wrangler serves the app at `http://localhost:8787`; the Next dev server at port 3000 is UI-only and does not provide the Worker API or Durable Objects. To stop local Supabase, run `npm run supabase:stop`.

For a standalone Next UI iteration, `npm run dev --workspace=frontend` remains available, but auth and multiplayer API features require the Worker runtime.

## Architecture

- Next.js static export is written to `frontend/out` and served by the Worker Assets binding.
- Worker routes under `/api/*` validate host access tokens with Supabase Auth, validate request bodies, and apply Durable Object backed rate limits.
- One SQLite-backed Durable Object is created for each six-digit room. It owns active players, WebSocket sessions, answer state, timers, scoring, and leaderboards. It uses WebSocket Hibernation and Durable Object alarms.
- Supabase stores saved quizzes, room records, participants, answers, and completed results. The service role key is only used in Worker server-side bindings. The browser receives only the Supabase URL and public anon key.
- Room PINs are available in both `/room?pin=123456` and legacy `/room/123456` URLs. Correct answers are only sent to the host and revealed to players when a question closes.

Static export keeps this Next.js 15 app compatible with Workers static assets and avoids depending on a Node server runtime. See Cloudflare's [static assets documentation](https://developers.cloudflare.com/workers/static-assets/), [Durable Object WebSocket guidance](https://developers.cloudflare.com/durable-objects/best-practices/websockets/), and Next.js [static export documentation](https://nextjs.org/docs/15/pages/guides/static-exports).

## Supabase setup

1. Create a Supabase project, or use the local stack above.
2. Apply `supabase/migrations/202611160001_initial_quiz_platform.sql` (the local `supabase db reset` applies it automatically).
3. In Supabase Auth, enable email/password sign-in and configure the site's URL and allowed redirect URLs for the deployed hostname. For local use, allow `http://localhost:8787`.
4. Do not expose the service role key to browser code. The Worker uses it to persist room data; table access is protected by RLS.

## Cloudflare setup and deployment

The Worker is configured in `frontend/wrangler.jsonc`. Cloudflare Workers Free currently includes static asset serving, Durable Objects, and a daily Durable Object request allowance; review the current [Workers pricing and limits](https://developers.cloudflare.com/workers/platform/pricing/) before setting expected class size or traffic. The Worker sends question deadlines once; clients render the countdown locally, and the Durable Object alarm closes the question. This keeps timer UI responsive without broadcasting a message every second.

1. Create a Cloudflare account and enable Workers. Install/configure Wrangler locally with `npx wrangler login` if you want to deploy from your machine.
2. Configure the GitHub Actions credentials below, then run **Actions → Deploy Cloudflare Worker → Run workflow** (or deploy locally with `npm run deploy`). This first deployment creates the Worker and its Durable Object namespace.
3. In **Workers & Pages → quiz-platform-cloudflare → Settings → Variables and Secrets**, add these Worker secrets:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
4. Copy the deployed `workers.dev` URL into Supabase Auth's site URL and allowed redirect URLs, along with the local URL if needed.
5. Open the `workers.dev` URL and test host sign-in, quiz saving, room creation, joining, and a complete quiz.

The GitHub Actions workflow validates pushes to `cloudflare-deployment` and deploys once repository Actions secrets `CLOUDFLARE_API_TOKEN` (Workers Scripts: Edit) and `CLOUDFLARE_ACCOUNT_ID` are configured. Until both Cloudflare secrets exist, it runs tests and builds but skips deployment. Set the three Supabase values directly as Worker secrets in Cloudflare; they do not need to be copied into GitHub. GitHub integration uses the official Wrangler CLI; no paid build service is required.

## Environment variable names

Worker secrets / local `frontend/.dev.vars`:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

GitHub Actions repository secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Templates are in `frontend/.dev.vars.example` and `frontend/.env.example`. Never commit real values.

## Commands

```sh
npm run dev        # Build static UI, then run the Worker locally
npm run build      # Production static export
npm test           # Unit and existing backend tests
npm run typecheck
npm run lint
npm run deploy     # Build and deploy with Wrangler
```

For manual Supabase SQL validation against the linked project, use the Supabase dashboard SQL editor or `npx supabase link` and `npx supabase db push`. The project migration is tracked in `supabase/migrations`.

## Notes

- Room state is intentionally ephemeral in Durable Objects. Quiz definitions and completed room results are persisted in Supabase.
- The free tier has request and storage quotas. This configuration limits rooms to 200 players and quizzes to 50 questions; adjust these only after evaluating both platform limits and app behavior.
- The original Express backend remains in the repository for existing local database scripts and tests. Production routing goes through `frontend/worker.js`.
