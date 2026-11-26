import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { openDatabase, nowIso, uuid } from './src/db.js';
import { AppError, assertProductionConfig } from './src/security.js';
import { createAuthRouter } from './src/routes/auth.js';
import { createCatalogueRouter } from './src/routes/catalogue.js';
import { createCommerceRouter } from './src/routes/commerce.js';
import { createLearningRouter } from './src/routes/learning.js';
import { createTestsRouter } from './src/routes/tests.js';
import { createEngagementRouter } from './src/routes/engagement.js';
import { createAdminRouter } from './src/routes/admin.js';
import { createWhatsAppRouter } from './src/routes/whatsapp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp(dbPath) {
  const db = openDatabase(dbPath);
  const app = express();

  app.set('trust proxy', 1);
  app.use(helmet({
    contentSecurityPolicy: false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
  }));
  const allowedOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean)
    : true;
  app.use(cors({ origin: allowedOrigins }));
  app.use(express.json({
    limit: '2mb',
    verify: (req, _res, buf) => { req.rawBody = buf.toString('utf8'); }
  }));

  // API v1
  const api = express.Router();
  api.use(createAuthRouter(db));
  api.use(createCatalogueRouter(db));
  api.use(createCommerceRouter(db));
  api.use(createWhatsAppRouter(db));
  api.use(createLearningRouter(db));
  api.use(createTestsRouter(db));
  api.use(createEngagementRouter(db));
  api.use('/admin', createAdminRouter(db));
  app.use('/api/v1', api);

  // Health
  app.get('/health', (_req, res) => res.json({ status: 'healthy', stack: 'node-express', utc: nowIso() }));

  // Public Website + Student App + Admin Portal static pages
  const pub = path.join(__dirname, 'public');
  app.use(express.static(pub));
  app.get('/about', (_req, res) => res.sendFile(path.join(pub, 'about.html')));
  app.get('/mentorship', (_req, res) => res.sendFile(path.join(pub, 'mentorship.html')));
  app.get('/mentorship-programs', (_req, res) => res.sendFile(path.join(pub, 'mentorship.html')));
  app.get('/privacy', (_req, res) => res.sendFile(path.join(pub, 'privacy.html')));
  app.get('/terms', (_req, res) => res.sendFile(path.join(pub, 'terms.html')));
  app.get('/refund', (_req, res) => res.sendFile(path.join(pub, 'refund.html')));
  app.get('/contact', (_req, res) => res.sendFile(path.join(pub, 'contact.html')));
  app.get('/app', (_req, res) => res.sendFile(path.join(pub, 'app', 'index.html')));
  app.get('/admin', (_req, res) => res.sendFile(path.join(pub, 'admin', 'index.html')));

  // Error Handler
  app.use((err, _req, res, _next) => {
    if (err instanceof AppError) {
      return res.status(err.statusCode).json({ error: err.errorCode, message: err.message });
    }
    console.error(err);
    return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' });
  });

  // Background Maintenance Sweep (entitlement expiration + live reminders)
  const runSweep = () => {
    const now = nowIso();
    db.prepare("UPDATE Entitlements SET Status = 'Expired' WHERE Status = 'Active' AND ExpiresAt <= ?").run(now);
    db.prepare("UPDATE Subscriptions SET Status = 'Expired' WHERE Status = 'Active' AND ExpiresAt <= ?").run(now);
    const soon = new Date(Date.now() + 30 * 60_000).toISOString();
    const sessions = db.prepare('SELECT * FROM LiveSessions WHERE StartsAt >= ? AND StartsAt <= ?').all(now, soon);
    for (const s of sessions) {
      const users = db.prepare("SELECT DISTINCT UserId FROM Entitlements WHERE CourseId = ? AND Status = 'Active' AND ExpiresAt > ?").all(s.CourseId, now);
      for (const u of users) {
        const marker = `[Live:${s.SessionId}]`;
        const sent = db.prepare('SELECT 1 FROM Notifications WHERE UserId = ? AND Body LIKE ?').get(u.UserId, `%${marker}%`);
        if (!sent) {
          db.prepare(`INSERT INTO Notifications (NotificationId, UserId, Title, Body, Type, CreatedAt) VALUES (?, ?, ?, ?, 'LiveClass', ?)`)
            .run(uuid(), u.UserId, `Upcoming Live Class: ${s.Title}`, `${s.FacultyName} starts soon. ${marker}`, now);
        }
      }
    }
  };

  return { app, db, runSweep };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  assertProductionConfig();
  const port = Number(process.env.PORT || 3000);
  const { app, runSweep } = createApp();
  const timer = setInterval(runSweep, 60_000);
  timer.unref();
  app.listen(port, () => {
    console.log(`Mudgal Biology Platform running at http://localhost:${port}`);
    console.log(`  Website:     http://localhost:${port}/`);
    console.log(`  Student App: http://localhost:${port}/app`);
    console.log(`  Admin Panel: http://localhost:${port}/admin`);
  });
}
