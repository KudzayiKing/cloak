# Cloaq Production Launch Checklist

## Required Environment

- `DATABASE_URL`: Supabase pooled PostgreSQL connection string for the runtime.
- `DIRECT_URL`: direct or session-pooler PostgreSQL connection string for Prisma migrations.
- `NEXT_PUBLIC_APP_URL`: canonical HTTPS origin, for example `https://cloaq.app`.
- `CLOAQ_ADMIN_HANDLES` or `CLOAQ_ADMIN_USER_IDS`: comma-separated admin allowlist for adviser invitations.
- `SOLANA_RPC_ENDPOINT`: production Solana RPC endpoint used by payment verification.
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`: Web Push credentials and a real contact mailbox.
- `NEXT_PUBLIC_CLOAK_MODEL_GEMMA_URL`, `NEXT_PUBLIC_CLOAK_MODEL_EMBEDDING_URL`, `NEXT_PUBLIC_CLOAK_MODEL_TRANSLATION_URL`: public model artifact URLs when local AI is enabled.

Keep `CLOAK_ALLOW_DEV_ACTIVATION=0` in production. Leave `PRISMA_LOG_QUERIES` and `PRISMA_LOG_ERRORS` off unless debugging a live incident.

## Deploy Steps

1. Install with `npm ci`.
2. Generate the Prisma client with `npm run db:generate`.
3. Apply migrations with `npm run db:deploy`.
4. Run `npm audit --omit=dev` and confirm zero production vulnerabilities.
5. Run `npm test`, `npm run lint`, and `npx tsc --noEmit`.
6. Build with `npm run build` on Vercel, or `npm run build:standalone` for a self-hosted Node bundle.
7. Smoke-test sign-in, `/app/messages`, payment verification, push subscription, Remote Dagger polling, adviser invitation creation, invitation redemption, and invite revocation.

## Security Gates

- All write methods under `/api/*` pass through shared same-origin checks and in-memory IP rate limits in `src/proxy.ts`.
- Browser security headers are configured in `next.config.ts`, including CSP, clickjacking protection, MIME sniffing protection, Permissions Policy, and production HSTS.
- Adviser invitation pages and APIs send no-store cache headers.
- Supabase storage/R2 model bucket CORS should allow only the canonical app origin.
- Session cookies must be `HttpOnly`, `SameSite=Lax`, and `Secure` over HTTPS.
- Admin invitation access must be limited to production admin handles or user IDs only.
- USDC Solana mint and Base contract identifiers were verified against Circle's public contract-address documentation on 2026-09-16; re-check before enabling new payment networks.

## Public Copy And Legal

- Public security copy must not claim a completed audit until an assessment is complete and the report is available.
- Terms, privacy, refund/payment, and responsible-disclosure copy should be reviewed by counsel before public launch.
- The security disclosure route is private-launch friendly today: researchers should use the launch contact channel and must not test against real user accounts, perform denial of service, or exfiltrate data.
- Legal entity and jurisdiction details are handled through private onboarding until formal public legal pages are approved.
