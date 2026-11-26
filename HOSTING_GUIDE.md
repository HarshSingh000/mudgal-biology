# Mudgal Biology — Step-by-Step Web Hosting Guide

Your Node.js app (`mudgal-biology-node`) serves the **Website (`/`)**, **Student App (`/app`)**, **Admin Portal (`/admin`)**, and **REST API (`/api/v1`)** from a single server (`node server.js`).

---

## Option 1: Free / Low-Cost Cloud Hosting on Render.com (Recommended, ~5 mins)

### Step 1: Initialize Git & Push to GitHub
Open PowerShell in `C:\Users\Admin\.gemini\antigravity\scratch\mudgal-biology-node`:
```powershell
git init
git add .
git commit -m "Initial Mudgal Biology platform"
```
Create a new empty repository on [GitHub](https://github.com/new) (e.g. `mudgal-biology`), then run:
```powershell
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/mudgal-biology.git
git push -u origin main
```

### Step 2: Deploy on Render
1. Go to [render.com](https://render.com) and sign in with GitHub.
2. Click **New +** → **Web Service** (or **Blueprint** to auto-read `render.yaml`).
3. Select your `mudgal-biology` GitHub repository.
4. Confirm these settings:
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
5. Under **Environment Variables**, set:
   - `NODE_ENV` = `production`
   - `JWT_SECRET` = *(a random 32+ character string)*
   - `WEBHOOK_SECRET` = *(your Razorpay/Cashfree webhook secret)*
   - `MEDIA_SIGNING_SECRET` = *(a random 32+ character string)*
6. Click **Create Web Service**. Render will build and give you a live HTTPS URL like `https://mudgal-biology.onrender.com`.

> **Important Note on SQLite Persistence**: On Render's Free tier, the filesystem resets on redeploy/restart. For real production student data, either attach a **Render Persistent Disk** mounted at `/opt/render/project/src/data` (or set `SQLITE_PATH=/var/data/mudgal_biology.db`), or upgrade to a managed database later.

---

## Option 2: Deploy with Railway / Fly.io (Using `Dockerfile`)
1. Push your folder to GitHub (Step 1 above).
2. On [railway.app](https://railway.app): click **New Project** → **Deploy from GitHub Repo** → select `mudgal-biology`.
3. Railway automatically detects the `Dockerfile` (`node:24-alpine`, port `3000`).
4. Add the environment variables (`NODE_ENV=production`, `JWT_SECRET`, `WEBHOOK_SECRET`, `MEDIA_SIGNING_SECRET`) and generate a public domain under **Settings → Networking**.
5. *(Recommended)* Attach a Railway **Volume** mounted at `/app/data` so your SQLite database survives redeploys.

---

## Option 3: Host on Your Own VPS (Hostinger / DigitalOcean / AWS EC2)
1. SSH into your Ubuntu server and install Node 22+:
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
   sudo apt-get install -y nodejs
   sudo npm install -g pm2
   ```
2. Clone your repo and start with PM2:
   ```bash
   git clone https://github.com/YOUR_USERNAME/mudgal-biology.git
   cd mudgal-biology
   npm install --omit=dev
   cp .env.example .env
   nano .env   # set production JWT_SECRET, WEBHOOK_SECRET, MEDIA_SIGNING_SECRET, NODE_ENV=production
   pm2 start server.js --name mudgal-biology
   pm2 save
   ```
3. Point your domain (`mudgalbiology.in`) via Nginx reverse proxy to `http://127.0.0.1:3000` and enable free HTTPS with `sudo certbot --nginx -d mudgalbiology.in`.

---

## Post-Deploy Checklist (Before Real Students Join)
1. **Production OTP**: In `NODE_ENV=production`, `devOtpHint` is hidden automatically—connect an SMS OTP provider (MSG91 / Fast2SMS / Twilio) inside `src/routes/auth.js` (`POST /auth/otp/request`) before disabling dev hints.
2. **Payment Gateway**: Replace mock checkout in `src/routes/commerce.js` with live Razorpay/Cashfree order creation and set your `WEBHOOK_SECRET` to match your Razorpay dashboard webhook secret.
3. **Custom Domain & HTTPS**: Point `mudgalbiology.in` to your Render/Railway/VPS endpoint and update `API_BASE_URL` in `mobile/student_app/lib/services/api_client.dart` to `https://YOUR_DOMAIN/api/v1` when building the Android/iOS app.
