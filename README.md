# Mudgal Biology — Easy-to-Host Node.js Platform

Single unified Node.js + Express web application serving:
- **Public Website**: `/` (`/about`, `/privacy`, `/terms`, `/refund`, `/contact`)
- **Student Web App**: `/app`
- **Responsive Admin Portal**: `/admin`
- **REST API**: `/api/v1/*` (compatible with Flutter Android & iOS app)

## Run Locally
```bash
npm install
npm start
```
Then open:
- Website: `http://localhost:3000/`
- Student App: `http://localhost:3000/app` (Demo Student: `9876543210`)
- Admin Portal: `http://localhost:3000/admin` (Demo Admin: `9999999999`)

## 1-Click Cloud Hosting Options
1. **Render.com (Free / Starter)**: Push this folder to GitHub → New Blueprint / Web Service → automatically detects `render.yaml` (`npm install` + `node server.js`).
2. **Railway / Fly.io / Koyeb**: Push to GitHub → auto-detects `Dockerfile` or `Procfile` (`web: node server.js`).
3. **Any VPS (Ubuntu / DigitalOcean / Hostinger)**: Install Node 22+, copy folder, run `npm install && pm2 start server.js --name mudgal-biology`.
