import express from 'express';
import { hasActiveEntitlement, nowIso, uuid } from '../db.js';
import { AppError, asyncHandler, requireAuth } from '../security.js';

export function createEngagementRouter(db) {
  const router = express.Router();
  router.use(requireAuth);

  const isStaff = (user) => user.roles.some((r) => ['Admin', 'SuperAdmin', 'Faculty', 'SupportAgent'].includes(r));

  const mapDoubt = (d) => {
    const replies = db.prepare(`
      SELECT dr.*, u.FullName AS AuthorName
      FROM DoubtReplies dr JOIN Users u ON dr.AuthorUserId = u.UserId
      WHERE dr.DoubtId = ? ORDER BY dr.CreatedAt
    `).all(d.DoubtId).map((r) => ({
      replyId: r.ReplyId, authorUserId: r.AuthorUserId, authorName: r.AuthorName, message: r.Message, createdAt: r.CreatedAt
    }));
    return {
      doubtId: d.DoubtId,
      courseId: d.CourseId,
      courseTitle: d.CourseTitle,
      studentUserId: d.UserId,
      studentName: d.StudentName,
      title: d.Title,
      text: d.Text,
      attachmentUrl: d.AttachmentUrl,
      status: d.Status,
      assignedTo: d.AssignedTo,
      assignedToName: d.AssignedToName || null,
      createdAt: d.CreatedAt,
      replies
    };
  };

  router.get('/me/home-feed', asyncHandler((req, res) => {
    const now = nowIso();
    const continueLearning = db.prepare(`
      SELECT c.CourseId, c.Title, c.Language, MAX(e.ExpiresAt) AS ExpiresAt
      FROM Entitlements e JOIN Courses c ON e.CourseId = c.CourseId
      WHERE e.UserId = ? AND e.Status = 'Active' AND e.ExpiresAt > ?
      GROUP BY c.CourseId, c.Title, c.Language LIMIT 4
    `).all(req.user.userId, now).map((c) => {
      const lessons = db.prepare('SELECT l.LessonId, l.Title FROM Lessons l JOIN Chapters ch ON l.ChapterId = ch.ChapterId JOIN CourseModules m ON ch.ModuleId = m.ModuleId WHERE m.CourseId = ? ORDER BY m.SortOrder, ch.SortOrder, l.SortOrder').all(c.CourseId);
      const completedSet = new Set(db.prepare('SELECT LessonId FROM LessonProgresses WHERE UserId = ? AND CompletedAt IS NOT NULL').all(req.user.userId).map((x) => x.LessonId));
      const completed = lessons.filter((l) => completedSet.has(l.LessonId)).length;
      const resume = lessons.find((l) => !completedSet.has(l.LessonId)) || lessons[0];
      return {
        courseId: c.CourseId, title: c.Title, language: c.Language, expiresAt: c.ExpiresAt,
        completedLessons: completed, totalLessons: lessons.length,
        progressPercent: lessons.length ? Math.round((completed / lessons.length) * 1000) / 10 : 0,
        resumeLessonId: resume?.LessonId || null, resumeLessonTitle: resume?.Title || null
      };
    });

    const nowMs = Date.now();
    const minEnd = new Date(nowMs - 2 * 3600_000).toISOString();
    const upcomingLiveClasses = db.prepare('SELECT s.*, c.Title AS CourseTitle FROM LiveSessions s JOIN Courses c ON s.CourseId = c.CourseId WHERE s.EndsAt >= ? ORDER BY s.StartsAt LIMIT 4').all(minEnd)
      .map((s) => ({
        sessionId: s.SessionId, courseId: s.CourseId, courseTitle: s.CourseTitle, title: s.Title, facultyName: s.FacultyName,
        startsAt: s.StartsAt, endsAt: s.EndsAt, provider: s.Provider,
        isLiveNow: Date.parse(s.StartsAt) <= nowMs + 15 * 60_000 && Date.parse(s.EndsAt) >= nowMs,
        canJoin: hasActiveEntitlement(db, req.user.userId, s.CourseId)
      }));

    const recommendedTests = db.prepare("SELECT t.*, c.Title AS CourseTitle FROM Tests t JOIN Courses c ON t.CourseId = c.CourseId WHERE t.Status = 'Published' LIMIT 4").all()
      .map((t) => {
        const stats = db.prepare('SELECT COUNT(*) AS cnt, COALESCE(SUM(Marks), 0) AS totalMarks FROM TestQuestions WHERE TestId = ?').get(t.TestId);
        const inProg = db.prepare("SELECT AttemptId FROM TestAttempts WHERE TestId = ? AND UserId = ? AND Status = 'InProgress' LIMIT 1").get(t.TestId, req.user.userId);
        return {
          testId: t.TestId, courseId: t.CourseId, courseTitle: t.CourseTitle, title: t.Title, durationSeconds: t.DurationSeconds,
          questionCount: stats.cnt, totalMarks: stats.totalMarks, isLocked: !hasActiveEntitlement(db, req.user.userId, t.CourseId),
          inProgressAttemptId: inProg?.AttemptId || null
        };
      });

    const announcements = db.prepare('SELECT * FROM Notifications WHERE UserId = ? ORDER BY CreatedAt DESC LIMIT 5').all(req.user.userId)
      .map((n) => ({ notificationId: n.NotificationId, title: n.Title, body: n.Body, type: n.Type, readAt: n.ReadAt, createdAt: n.CreatedAt }));

    res.json({ continueLearning, upcomingLiveClasses, recommendedTests, announcements });
  }));

  router.post('/doubts', asyncHandler((req, res) => {
    const { courseId, title, text, attachmentUrl } = req.body || {};
    if (!db.prepare('SELECT 1 FROM Courses WHERE CourseId = ?').get(courseId)) throw new AppError('Course not found.', 404, 'COURSE_NOT_FOUND');
    if (!text || !String(text).trim()) throw new AppError('Doubt description is required.', 400);
    const id = uuid();
    db.prepare(`INSERT INTO Doubts (DoubtId, UserId, CourseId, Title, Text, AttachmentUrl, Status, CreatedAt) VALUES (?, ?, ?, ?, ?, ?, 'Open', ?)`)
      .run(id, req.user.userId, courseId, String(title || 'Subject Doubt').trim(), String(text).trim(), attachmentUrl || null, nowIso());
    const row = db.prepare(`SELECT d.*, c.Title AS CourseTitle, u.FullName AS StudentName, a.FullName AS AssignedToName FROM Doubts d JOIN Courses c ON d.CourseId = c.CourseId JOIN Users u ON d.UserId = u.UserId LEFT JOIN Users a ON d.AssignedTo = a.UserId WHERE d.DoubtId = ?`).get(id);
    res.json(mapDoubt(row));
  }));

  router.get('/me/doubts', asyncHandler((req, res) => {
    const rows = db.prepare(`SELECT d.*, c.Title AS CourseTitle, u.FullName AS StudentName, a.FullName AS AssignedToName FROM Doubts d JOIN Courses c ON d.CourseId = c.CourseId JOIN Users u ON d.UserId = u.UserId LEFT JOIN Users a ON d.AssignedTo = a.UserId WHERE d.UserId = ? ORDER BY d.CreatedAt DESC`).all(req.user.userId);
    res.json(rows.map(mapDoubt));
  }));

  router.get('/doubts/:id', asyncHandler((req, res) => {
    const row = db.prepare(`SELECT d.*, c.Title AS CourseTitle, u.FullName AS StudentName, a.FullName AS AssignedToName FROM Doubts d JOIN Courses c ON d.CourseId = c.CourseId JOIN Users u ON d.UserId = u.UserId LEFT JOIN Users a ON d.AssignedTo = a.UserId WHERE d.DoubtId = ?`).get(req.params.id);
    if (!row) throw new AppError('Doubt not found.', 404, 'DOUBT_NOT_FOUND');
    if (!isStaff(req.user) && row.UserId !== req.user.userId) throw new AppError('Access denied.', 403, 'FORBIDDEN');
    res.json(mapDoubt(row));
  }));

  router.post('/doubts/:id/replies', asyncHandler((req, res) => {
    const doubt = db.prepare('SELECT * FROM Doubts WHERE DoubtId = ?').get(req.params.id);
    if (!doubt) throw new AppError('Doubt not found.', 404, 'DOUBT_NOT_FOUND');
    const staff = isStaff(req.user);
    if (!staff && doubt.UserId !== req.user.userId) throw new AppError('Access denied.', 403, 'FORBIDDEN');

    db.prepare('INSERT INTO DoubtReplies (ReplyId, DoubtId, AuthorUserId, Message, CreatedAt) VALUES (?, ?, ?, ?, ?)')
      .run(uuid(), doubt.DoubtId, req.user.userId, String(req.body?.message || '').trim(), nowIso());
    if (staff) {
      db.prepare("UPDATE Doubts SET Status = 'Answered' WHERE DoubtId = ?").run(doubt.DoubtId);
      db.prepare(`INSERT INTO Notifications (NotificationId, UserId, Title, Body, Type, CreatedAt) VALUES (?, ?, 'Doubt Answered', ?, 'DoubtReply', ?)`)
        .run(uuid(), doubt.UserId, `Your doubt '${doubt.Title}' received a reply.`, nowIso());
    }
    const row = db.prepare(`SELECT d.*, c.Title AS CourseTitle, u.FullName AS StudentName, a.FullName AS AssignedToName FROM Doubts d JOIN Courses c ON d.CourseId = c.CourseId JOIN Users u ON d.UserId = u.UserId LEFT JOIN Users a ON d.AssignedTo = a.UserId WHERE d.DoubtId = ?`).get(doubt.DoubtId);
    res.json(mapDoubt(row));
  }));

  router.get('/community/posts', asyncHandler((req, res) => {
    const { examId, courseId, page = '1', pageSize = '20' } = req.query;
    const p = Math.max(1, parseInt(page, 10) || 1);
    const ps = Math.min(50, Math.max(1, parseInt(pageSize, 10) || 20));
    let posts = db.prepare(`SELECT cp.*, u.FullName AS AuthorName, c.Title AS CourseTitle FROM CommunityPosts cp JOIN Users u ON cp.UserId = u.UserId LEFT JOIN Courses c ON cp.CourseId = c.CourseId WHERE cp.Status = 'Visible' ORDER BY cp.CreatedAt DESC`).all();
    if (examId) posts = posts.filter((x) => x.ExamId === examId);
    if (courseId) posts = posts.filter((x) => x.CourseId === courseId);

    res.json(posts.slice((p - 1) * ps, p * ps).map((cp) => {
      const comments = db.prepare(`SELECT cc.*, u.FullName AS AuthorName FROM CommunityComments cc JOIN Users u ON cc.UserId = u.UserId WHERE cc.PostId = ? AND cc.Status = 'Visible' ORDER BY cc.CreatedAt`).all(cp.PostId)
        .map((c) => ({ commentId: c.CommentId, userId: c.UserId, authorName: c.AuthorName, body: c.Body, status: c.Status, createdAt: c.CreatedAt }));
      return {
        postId: cp.PostId, userId: cp.UserId, authorName: cp.AuthorName, courseId: cp.CourseId, courseTitle: cp.CourseTitle,
        examId: cp.ExamId, body: cp.Body, status: cp.Status, createdAt: cp.CreatedAt, comments
      };
    }));
  }));

  router.post('/community/posts', asyncHandler((req, res) => {
    const user = db.prepare('SELECT Status, FullName FROM Users WHERE UserId = ?').get(req.user.userId);
    if (user.Status === 'Muted' || user.Status === 'Suspended') throw new AppError('Your account is currently muted from posting.', 403, 'USER_MUTED');
    const body = String(req.body?.body || '').trim();
    if (!body) throw new AppError('Post content cannot be empty.', 400);
    const postId = uuid();
    db.prepare(`INSERT INTO CommunityPosts (PostId, UserId, CourseId, ExamId, Body, Status, CreatedAt) VALUES (?, ?, ?, ?, ?, 'Visible', ?)`)
      .run(postId, req.user.userId, req.body?.courseId || null, req.body?.examId || null, body, nowIso());
    const cp = db.prepare('SELECT * FROM CommunityPosts WHERE PostId = ?').get(postId);
    res.json({ postId: cp.PostId, userId: cp.UserId, authorName: user.FullName, courseId: cp.CourseId, courseTitle: null, examId: cp.ExamId, body: cp.Body, status: cp.Status, createdAt: cp.CreatedAt, comments: [] });
  }));

  router.post('/community/posts/:id/comments', asyncHandler((req, res) => {
    const user = db.prepare('SELECT Status, FullName FROM Users WHERE UserId = ?').get(req.user.userId);
    if (user.Status === 'Muted' || user.Status === 'Suspended') throw new AppError('Your account is currently muted from commenting.', 403, 'USER_MUTED');
    const post = db.prepare("SELECT 1 FROM CommunityPosts WHERE PostId = ? AND Status = 'Visible'").get(req.params.id);
    if (!post) throw new AppError('Post not found.', 404, 'POST_NOT_FOUND');
    const commentId = uuid();
    const body = String(req.body?.body || '').trim();
    db.prepare(`INSERT INTO CommunityComments (CommentId, PostId, UserId, Body, Status, CreatedAt) VALUES (?, ?, ?, ?, 'Visible', ?)`)
      .run(commentId, req.params.id, req.user.userId, body, nowIso());
    res.json({ commentId, userId: req.user.userId, authorName: user.FullName, body, status: 'Visible', createdAt: nowIso() });
  }));

  router.post('/community/reports', asyncHandler((req, res) => {
    const { entityType, entityId, reason } = req.body || {};
    const normType = String(entityType || '').toLowerCase() === 'comment' ? 'Comment' : 'Post';
    db.prepare(`INSERT INTO ContentReports (ReportId, ReporterUserId, EntityType, EntityId, Reason, Status, CreatedAt) VALUES (?, ?, ?, ?, ?, 'Open', ?)`)
      .run(uuid(), req.user.userId, normType, entityId, String(reason || 'Inappropriate content').trim(), nowIso());
    res.json({ message: 'Report submitted for moderator review.' });
  }));

  router.get('/notifications', asyncHandler((req, res) => {
    const rows = db.prepare('SELECT * FROM Notifications WHERE UserId = ? ORDER BY CreatedAt DESC LIMIT 50').all(req.user.userId);
    res.json(rows.map((n) => ({ notificationId: n.NotificationId, title: n.Title, body: n.Body, type: n.Type, readAt: n.ReadAt, createdAt: n.CreatedAt })));
  }));

  router.post('/notifications/:id/read', asyncHandler((req, res) => {
    db.prepare('UPDATE Notifications SET ReadAt = COALESCE(ReadAt, ?) WHERE NotificationId = ? AND UserId = ?').run(nowIso(), req.params.id, req.user.userId);
    res.status(204).end();
  }));

  router.get('/me/notification-preferences', asyncHandler((req, res) => {
    const p = db.prepare('SELECT * FROM NotificationPreferences WHERE UserId = ?').get(req.user.userId);
    res.json(p ? {
      pushLiveClasses: Boolean(p.PushLiveClasses), pushCourseUpdates: Boolean(p.PushCourseUpdates),
      pushDoubtReplies: Boolean(p.PushDoubtReplies), pushAnnouncements: Boolean(p.PushAnnouncements)
    } : { pushLiveClasses: true, pushCourseUpdates: true, pushDoubtReplies: true, pushAnnouncements: true });
  }));

  router.put('/me/notification-preferences', asyncHandler((req, res) => {
    const { pushLiveClasses = true, pushCourseUpdates = true, pushDoubtReplies = true, pushAnnouncements = true } = req.body || {};
    db.prepare(`
      INSERT INTO NotificationPreferences (UserId, PushLiveClasses, PushCourseUpdates, PushDoubtReplies, PushAnnouncements)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(UserId) DO UPDATE SET
        PushLiveClasses = excluded.PushLiveClasses,
        PushCourseUpdates = excluded.PushCourseUpdates,
        PushDoubtReplies = excluded.PushDoubtReplies,
        PushAnnouncements = excluded.PushAnnouncements
    `).run(req.user.userId, pushLiveClasses ? 1 : 0, pushCourseUpdates ? 1 : 0, pushDoubtReplies ? 1 : 0, pushAnnouncements ? 1 : 0);
    res.json({ pushLiveClasses: Boolean(pushLiveClasses), pushCourseUpdates: Boolean(pushCourseUpdates), pushDoubtReplies: Boolean(pushDoubtReplies), pushAnnouncements: Boolean(pushAnnouncements) });
  }));

  return router;
}
