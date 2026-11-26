# Mudgal Biology — Full Project & Chat Handoff Context

Use this brief to continue work seamlessly on a new system or in a new AI assistant session.

## 1. Project Overview & Product Decisions
- **Brand**: **Mudgal Biology**
- **Target Exams**: `NEET_BIO` (NEET & Medical Biology), `SSC` (SSC CGL/CHSL), `UPSC` (UPSC CSE), `BANKING` (IBPS/SBI), `STATE_PSC` (State PSC)
- **Inspired By**: Utkarsh Classes (`com.utkarshnew.android`) feature set with a modern, clean, original UI (`Deep Navy #14213D`, `Teal #14B8A6`, `Amber #F4B942`, `Off-white #F8FAFC`, dark mode, EN/HI toggle).
- **Initial Budget & Scope Constraints**: Lean MVP; single-answer MCQ mock tests with server-side negative marking, async doubt tickets (no 1-on-1 live chat), moderated community feed, managed/external live class join links (Zoom/Meet), short-lived signed media/PDF URLs, server-side pricing & HMAC webhook verification.

## 2. Two Deliverables Created
1. **`mudgal-biology-node` (`mudgal-biology-node.zip`) — Primary Easy-to-Host Web Platform**
   - Single unified **Node.js + Express** server (`server.js`, requires **Node >= 22.13** for built-in `node:sqlite`) serving everything on one port (`PORT=3000`):
     - **Public Website & Legal Pages**: `/`, `/about`, `/privacy`, `/terms`, `/refund`, `/contact`
     - **Student Web App**: `/app` (OTP login, exam goal switcher, 8-tile quick action grid, courses/passes store, video player with `0.75x–2x` speed controls, Sepia/Night smart e-book reader, active-recall flashcards, timed mock test runner with palette & solution review, doubts, community, profile/orders/deletion request)
     - **Responsive Admin Portal**: `/admin` (2-step Staff OTP login, mobile hamburger drawer + desktop sidebar, KPI dashboard + CSV order export, exam/course/lesson/PDF management, publish/draft toggle, mock test & question builder, live class scheduler, student directory, doubt replies, content report moderation, audit logs)
     - **REST API**: `/api/v1/*` (identical JSON contract for the Flutter mobile app)
     - **Background Sweep**: `runSweep` in `server.js` (runs every 60s to expire elapsed entitlements/subscriptions and queue live-class reminders)
     - **Deploy Configs**: `render.yaml`, `Dockerfile`, `Procfile`, `.node-version` (`22.14.0`), `.env.example`, `.gitignore`, `HOSTING_GUIDE.md`
   - **Verified**: `npm test` (`tests/api.test.js`) passes 2/2 integration tests; browser-verified across desktop and mobile viewports.

2. **`govexam-edtech` (`mudgal-biology-dotnet-flutter.zip`) — .NET 8 Modular Monolith + Flutter Mobile App**
   - `.NET 8` solution (`ExamPlatform.slnx`): `Platform.Domain`, `Platform.Application`, `Platform.Infrastructure`, `Platform.Api`, `Platform.Admin` (Razor Pages), `Platform.Worker`, `Platform.UnitTests` (4/4 passing), `Platform.IntegrationTests` (3/3 passing).
   - **Flutter Mobile App (`mobile/student_app`)**: Android & iOS Dart/Flutter codebase matching the `/api/v1/*` API (not compiled locally because Flutter SDK was not installed on the original Windows host).

## 3. Security & Authorization Rules (Already Implemented)
- All student, learning, test, community (`/api/v1/community/posts`), flashcards (`/api/v1/flashcards`), doubt, and admin routes require JWT Bearer auth (`requireAuth`).
- Admin endpoints & Razor Pages enforce granular role checks (`Admin`, `SuperAdmin`, `Faculty`, `SupportAgent`), and Admin login uses 2-step OTP verification.
- Client-supplied prices, entitlements, and test scores are never trusted; orders use `IdempotencyKey`, webhooks verify HMAC-SHA256 signatures idempotently, and video/PDF URLs use short-lived HMAC signatures.

## 4. Demo Sandbox Credentials (Development Mode)
- **Student**: `9876543210` (Aarav Sharma — enrolled in NEET Biology & SSC; UPSC/Banking/State PSC remain locked for testing purchase/webhook flow)
- **Admin**: `9999999999`
- **SuperAdmin**: `8888888888`
- **Faculty**: `9811112222` (Dr. Mudgal), `9811113333` (Prof. Rajesh Verma)
- **SupportAgent**: `9811114444` (Priya Nair)
- *(In `NODE_ENV=development`, `/api/v1/auth/otp/request` returns `devOtpHint`. In `production`, `devOtpHint` is `null`.)*

## 5. GitHub & Deployment Status
- Empty public GitHub repo created: `https://github.com/HarshSingh000/mudgal-biology`
- On the previous Windows PC, `git push` failed with HTTP `403` because Windows Credential Manager was signed into `harshvardhanDots` instead of `HarshSingh000`.
- **Next steps on the new system**:
  1. Extract `mudgal-biology-node.zip`, run `npm install && npm test && npm start`.
  2. Sign in to Git as `HarshSingh000`, initialize/push to `https://github.com/HarshSingh000/mudgal-biology.git`.
  3. Deploy on Render (`render.yaml`) / Railway (`Dockerfile`) / VPS with persistent storage for SQLite (`SQLITE_PATH`).
  4. Before real student launch: wire live SMS OTP provider in `src/routes/auth.js`, live Razorpay/Cashfree keys in `src/routes/commerce.js`, set strong production secrets (`JWT_SECRET`, `WEBHOOK_SECRET`, `MEDIA_SIGNING_SECRET`), and build `mobile/student_app` with `API_BASE_URL=https://YOUR_DOMAIN/api/v1`.
