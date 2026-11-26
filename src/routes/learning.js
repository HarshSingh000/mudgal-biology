import express from 'express';
import { hasActiveEntitlement, nowIso, uuid } from '../db.js';
import { AppError, asyncHandler, createSignedMediaUrl, createSignedResourceUrl, requireAuth, verifyMediaSignature } from '../security.js';

export function createLearningRouter(db) {
  const router = express.Router();

  const getLessonWithCourse = (lessonId) => {
    const lesson = db.prepare(`
      SELECT l.*, m.CourseId, ma.Provider, ma.ProviderAssetId, ma.AssetType, ma.Status AS MediaStatus
      FROM Lessons l
      JOIN Chapters ch ON l.ChapterId = ch.ChapterId
      JOIN CourseModules m ON ch.ModuleId = m.ModuleId
      LEFT JOIN MediaAssets ma ON l.MediaAssetId = ma.MediaAssetId
      WHERE l.LessonId = ?
    `).get(lessonId);
    if (!lesson) throw new AppError('Lesson not found.', 404, 'LESSON_NOT_FOUND');
    return lesson;
  };

  router.get('/me/courses', requireAuth, asyncHandler((req, res) => {
    const now = nowIso();
    const rows = db.prepare(`
      SELECT c.CourseId, c.Title, c.Language, MAX(e.ExpiresAt) AS ExpiresAt
      FROM Entitlements e
      JOIN Courses c ON e.CourseId = c.CourseId
      WHERE e.UserId = ? AND e.Status = 'Active' AND e.ExpiresAt > ?
      GROUP BY c.CourseId, c.Title, c.Language
    `).all(req.user.userId, now);

    const results = rows.map((c) => {
      const lessons = db.prepare(`
        SELECT l.LessonId, l.Title
        FROM Lessons l
        JOIN Chapters ch ON l.ChapterId = ch.ChapterId
        JOIN CourseModules m ON ch.ModuleId = m.ModuleId
        WHERE m.CourseId = ?
        ORDER BY m.SortOrder, ch.SortOrder, l.SortOrder
      `).all(c.CourseId);
      const completedSet = new Set(
        db.prepare('SELECT LessonId FROM LessonProgresses WHERE UserId = ? AND CompletedAt IS NOT NULL').all(req.user.userId).map((x) => x.LessonId)
      );
      const completed = lessons.filter((l) => completedSet.has(l.LessonId)).length;
      const resume = lessons.find((l) => !completedSet.has(l.LessonId)) || lessons[0];
      const pct = lessons.length === 0 ? 0 : Math.round((completed / lessons.length) * 1000) / 10;
      return {
        courseId: c.CourseId,
        title: c.Title,
        language: c.Language,
        expiresAt: c.ExpiresAt,
        completedLessons: completed,
        totalLessons: lessons.length,
        progressPercent: pct,
        resumeLessonId: resume?.LessonId || null,
        resumeLessonTitle: resume?.Title || null
      };
    });

    res.json(results);
  }));

  router.get('/lessons/:id/playback', requireAuth, asyncHandler((req, res) => {
    const lesson = getLessonWithCourse(req.params.id);
    if (!lesson.IsPreview && !hasActiveEntitlement(db, req.user.userId, lesson.CourseId)) {
      throw new AppError('Active course enrollment required to access this lesson.', 403, 'ENTITLEMENT_REQUIRED');
    }
    if (!lesson.ProviderAssetId || lesson.MediaStatus !== 'Ready') {
      throw new AppError('Media asset is not available for playback.', 404, 'MEDIA_UNAVAILABLE');
    }
    const signed = createSignedMediaUrl(lesson.ProviderAssetId, 900);
    const prog = db.prepare('SELECT LastPositionSeconds FROM LessonProgresses WHERE UserId = ? AND LessonId = ?').get(req.user.userId, lesson.LessonId);

    res.json({
      lessonId: lesson.LessonId,
      lessonTitle: lesson.Title,
      playbackUrl: signed.url,
      expiresAt: signed.expiresAt,
      provider: lesson.Provider,
      mimeType: lesson.AssetType === 'Pdf' ? 'application/pdf' : 'video/mp4',
      lastPositionSeconds: prog?.LastPositionSeconds || 0
    });
  }));

  router.put('/lessons/:id/progress', requireAuth, asyncHandler((req, res) => {
    const lesson = getLessonWithCourse(req.params.id);
    if (!lesson.IsPreview && !hasActiveEntitlement(db, req.user.userId, lesson.CourseId)) {
      throw new AppError('Active entitlement required.', 403, 'ENTITLEMENT_REQUIRED');
    }
    const pos = Math.max(0, parseInt(req.body?.lastPositionSeconds, 10) || 0);
    const completedAt = req.body?.completed ? nowIso() : null;
    const updatedAt = nowIso();
    db.prepare(`
      INSERT INTO LessonProgresses (UserId, LessonId, LastPositionSeconds, CompletedAt, UpdatedAt)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(UserId, LessonId) DO UPDATE SET
        LastPositionSeconds = excluded.LastPositionSeconds,
        CompletedAt = COALESCE(LessonProgresses.CompletedAt, excluded.CompletedAt),
        UpdatedAt = excluded.UpdatedAt
    `).run(req.user.userId, lesson.LessonId, pos, completedAt, updatedAt);

    const row = db.prepare('SELECT * FROM LessonProgresses WHERE UserId = ? AND LessonId = ?').get(req.user.userId, lesson.LessonId);
    res.json({ lessonId: row.LessonId, lastPositionSeconds: row.LastPositionSeconds, completedAt: row.CompletedAt, updatedAt: row.UpdatedAt });
  }));

  router.get('/lessons/:id/resources', requireAuth, asyncHandler((req, res) => {
    const lesson = getLessonWithCourse(req.params.id);
    if (!lesson.IsPreview && !hasActiveEntitlement(db, req.user.userId, lesson.CourseId)) {
      throw new AppError('Active entitlement required to view PDFs/resources.', 403, 'ENTITLEMENT_REQUIRED');
    }
    const resources = db.prepare('SELECT * FROM Resources WHERE LessonId = ?').all(lesson.LessonId);
    res.json(resources.map((r) => {
      const signed = createSignedResourceUrl(r.StorageKey, 600);
      return { resourceId: r.ResourceId, title: r.Title, resourceType: r.ResourceType, signedUrl: signed.url, expiresAt: signed.expiresAt };
    }));
  }));

  router.post('/lessons/:id/bookmark', requireAuth, asyncHandler((req, res) => {
    const existing = db.prepare('SELECT 1 FROM LessonBookmarks WHERE UserId = ? AND LessonId = ?').get(req.user.userId, req.params.id);
    if (existing) {
      db.prepare('DELETE FROM LessonBookmarks WHERE UserId = ? AND LessonId = ?').run(req.user.userId, req.params.id);
    } else {
      db.prepare('INSERT INTO LessonBookmarks (UserId, LessonId, CreatedAt) VALUES (?, ?, ?)').run(req.user.userId, req.params.id, nowIso());
    }
    res.json({ bookmarkedToggled: true });
  }));

  const getLiveHandler = (req, res) => {
    const now = Date.now();
    const minEnd = new Date(now - 2 * 3600_000).toISOString();
    const courseId = req.params.id || null;
    const rows = courseId
      ? db.prepare('SELECT s.*, c.Title AS CourseTitle FROM LiveSessions s JOIN Courses c ON s.CourseId = c.CourseId WHERE s.CourseId = ? AND s.EndsAt >= ? ORDER BY s.StartsAt').all(courseId, minEnd)
      : db.prepare('SELECT s.*, c.Title AS CourseTitle FROM LiveSessions s JOIN Courses c ON s.CourseId = c.CourseId WHERE s.EndsAt >= ? ORDER BY s.StartsAt').all(minEnd);

    res.json(rows.map((s) => {
      const startsMs = Date.parse(s.StartsAt);
      const endsMs = Date.parse(s.EndsAt);
      const isLiveNow = startsMs <= now + 15 * 60_000 && endsMs >= now;
      return {
        sessionId: s.SessionId,
        courseId: s.CourseId,
        courseTitle: s.CourseTitle,
        title: s.Title,
        facultyName: s.FacultyName,
        startsAt: s.StartsAt,
        endsAt: s.EndsAt,
        provider: s.Provider,
        isLiveNow,
        canJoin: hasActiveEntitlement(db, req.user.userId, s.CourseId)
      };
    }));
  };

  router.get('/live-sessions', requireAuth, asyncHandler(getLiveHandler));
  router.get('/courses/:id/live-sessions', requireAuth, asyncHandler(getLiveHandler));

  router.post('/live-sessions/:id/join', requireAuth, asyncHandler((req, res) => {
    const s = db.prepare('SELECT * FROM LiveSessions WHERE SessionId = ?').get(req.params.id);
    if (!s) throw new AppError('Live session not found.', 404, 'SESSION_NOT_FOUND');
    if (!hasActiveEntitlement(db, req.user.userId, s.CourseId)) {
      throw new AppError('Active course enrollment required to join this live class.', 403, 'ENTITLEMENT_REQUIRED');
    }
    db.prepare('INSERT INTO LiveAttendances (AttendanceId, SessionId, UserId, JoinedAt) VALUES (?, ?, ?, ?)').run(uuid(), s.SessionId, req.user.userId, nowIso());
    const token = encodeURIComponent(Buffer.from(`${s.SessionId}:${req.user.userId}`).toString('base64'));
    res.json({
      sessionId: s.SessionId,
      joinUrl: `${s.JoinUrl}?attendee=${token}`,
      provider: s.Provider,
      meetingCode: s.ProviderSessionId,
      startsAt: s.StartsAt,
      endsAt: s.EndsAt
    });
  }));

  router.get('/media/stream/:assetId', (req, res) => {
    const { assetId } = req.params;
    const { exp, sig } = req.query;
    if (!verifyMediaSignature(`${assetId}:${exp}`, exp, sig)) {
      return res.status(401).json({ error: 'EXPIRED_OR_INVALID_MEDIA_SIGNATURE' });
    }
    const safeId = String(assetId).replace(/[^a-zA-Z0-9_-]/g, '');
    const isYoutubeId = /^[a-zA-Z0-9_-]{11}$/.test(safeId);
    if (isYoutubeId) {
      return res.type('html').send(`<!doctype html><html><body style="margin:0;background:#0f172a;display:flex;align-items:center;justify-content:center;height:100vh;">
        <iframe src="https://www.youtube.com/embed/${safeId}?rel=0" referrerpolicy="strict-origin-when-cross-origin" title="Mudgal Biology Lecture" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen style="width:100%;height:100%;border:0;"></iframe>
      </body></html>`);
    }
    res.type('html').send(`<!doctype html><html><body style="margin:0;background:#0f172a;color:#f8fafc;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:12px;">
      <div style="padding:8px 16px;border-radius:999px;background:#14b8a6;color:#0f172a;font-weight:700;font-size:12px;">SIGNED STREAM ACTIVE</div>
      <h2 style="margin:0;">Mudgal Biology Stream: ${safeId}</h2>
      <p style="opacity:.75;margin:0;">Short-lived HMAC signed playback verified (expires UTC ${new Date(Number(exp) * 1000).toISOString()})</p>
    </body></html>`);
  });

  router.get('/media/resource', (req, res) => {
    const key = String(req.query.key || '');
    const { exp, sig } = req.query;
    if (!verifyMediaSignature(`${key}:${exp}`, exp, sig)) {
      return res.status(401).json({ error: 'EXPIRED_OR_INVALID_RESOURCE_SIGNATURE' });
    }
    res.setHeader('Content-Disposition', `inline; filename="${key.replace(/[^a-zA-Z0-9._-]/g, '_')}"`);
    res.type('text/plain').send(`Mudgal Biology (@MUDGALBIOLOGY) — Smart Study Material & Revision Notes\nBy Hemant Mudgal (Senior Teacher)\nResource Key: ${key}\nGenerated UTC: ${nowIso()}\n-----------------------------------------------------\n1. Krebs Cycle (RPSC 2018 PYQ): Succinate -> Fumarate forms FADH2 (NO NADH formed).\n2. DNA Polymerase (RPSC PYQ): DNA Pol I removes RNA primers (5'->3' exonuclease); DNA Pol III does main synthesis.\n3. Circulation: Annelids (Earthworm) = Closed circulation; Arthropods = Open circulation.\n4. Heart Chambers: Fishes = 2-chambered; Amphibians & Reptiles = 3-chambered; Birds & Mammals = 4-chambered.\n5. Dihybrid Cross: F2 phenotypic ratio = 9:3:3:1 (Law of Independent Assortment).`);
  });

  return router;
}
