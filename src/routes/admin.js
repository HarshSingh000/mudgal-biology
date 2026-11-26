import express from 'express';
import { nowIso, recordAudit, uuid } from '../db.js';
import { AppError, asyncHandler, hashPassword, normalizePhone, requireAuth, requireRoles } from '../security.js';

function getStudentsDetailed(db) {
  const now = nowIso();
  const rows = db.prepare(`
    SELECT DISTINCT u.UserId, u.FullName, u.Phone, u.Email, u.IsVerified, u.VerificationSource, u.Status, u.CreatedAt,
      sp.State, e.Code AS TargetExam
    FROM Users u
    JOIN UserRoles ur ON u.UserId = ur.UserId
    JOIN Roles r ON ur.RoleId = r.RoleId
    LEFT JOIN StudentProfiles sp ON u.UserId = sp.UserId
    LEFT JOIN Exams e ON sp.TargetExamId = e.ExamId
    WHERE r.Name = 'Student'
    ORDER BY u.CreatedAt DESC LIMIT 200
  `).all();

  const entStmt = db.prepare(`
    SELECT c.Title
    FROM Entitlements en
    JOIN Courses c ON en.CourseId = c.CourseId
    WHERE en.UserId = ? AND en.Status = 'Active' AND en.ExpiresAt > ?
  `);
  const spentStmt = db.prepare("SELECT COALESCE(SUM(TotalAmount), 0) AS total FROM Orders WHERE UserId = ? AND Status = 'Paid'");

  return rows.map((u) => {
    const enrolled = entStmt.all(u.UserId, now).map((x) => x.Title);
    const totalSpentInr = spentStmt.get(u.UserId).total;
    return {
      userId: u.UserId,
      fullName: u.FullName,
      phone: u.Phone,
      email: u.Email || '-',
      state: u.State || '-',
      targetExam: u.TargetExam || '-',
      isVerified: Boolean(u.IsVerified),
      verificationSource: u.VerificationSource || 'Pending',
      status: u.Status,
      enrolledCount: enrolled.length,
      enrolledCourses: enrolled,
      totalSpentInr,
      createdAt: u.CreatedAt
    };
  });
}

export function createAdminRouter(db) {
  const router = express.Router();
  router.use(requireAuth, requireRoles('Admin', 'SuperAdmin', 'Faculty', 'SupportAgent'));

  router.get('/dashboard', asyncHandler((_req, res) => {
    const now = nowIso();
    const totalStudents = db.prepare("SELECT COUNT(DISTINCT ur.UserId) AS cnt FROM UserRoles ur JOIN Roles r ON ur.RoleId = r.RoleId WHERE r.Name = 'Student'").get().cnt;
    const verifiedStudents = db.prepare("SELECT COUNT(DISTINCT u.UserId) AS cnt FROM Users u JOIN UserRoles ur ON u.UserId = ur.UserId JOIN Roles r ON ur.RoleId = r.RoleId WHERE r.Name = 'Student' AND u.IsVerified = 1").get().cnt;
    const activeEntitlements = db.prepare("SELECT COUNT(*) AS cnt FROM Entitlements WHERE Status = 'Active' AND ExpiresAt > ?").get(now).cnt;
    const publishedCourses = db.prepare("SELECT COUNT(*) AS cnt FROM Courses WHERE Status = 'Published'").get().cnt;
    const openDoubts = db.prepare("SELECT COUNT(*) AS cnt FROM Doubts WHERE Status IN ('Open', 'Assigned')").get().cnt;
    const openReports = db.prepare("SELECT COUNT(*) AS cnt FROM ContentReports WHERE Status = 'Open'").get().cnt;
    const totalRevenueInr = db.prepare("SELECT COALESCE(SUM(TotalAmount), 0) AS rev FROM Orders WHERE Status = 'Paid'").get().rev;
    const recentOrders = db.prepare('SELECT * FROM Orders ORDER BY CreatedAt DESC LIMIT 10').all().map((o) => ({
      orderId: o.OrderId,
      totalAmount: o.TotalAmount,
      currency: o.Currency,
      status: o.Status,
      idempotencyKey: o.IdempotencyKey,
      createdAt: o.CreatedAt,
      items: db.prepare('SELECT * FROM OrderItems WHERE OrderId = ?').all(o.OrderId).map((i) => ({
        orderItemId: i.OrderItemId, productType: i.ProductType, productId: i.ProductId, productTitle: i.ProductTitle, unitPrice: i.UnitPrice, quantity: i.Quantity
      }))
    }));
    const students = getStudentsDetailed(db).slice(0, 25);
    res.json({ totalStudents, verifiedStudents, activeEntitlements, publishedCourses, openDoubts, openReports, totalRevenueInr, recentOrders, students });
  }));

  router.get('/courses', asyncHandler((_req, res) => {
    const rows = db.prepare('SELECT * FROM Courses ORDER BY CreatedAt DESC').all();
    res.json(rows.map((c) => ({
      courseId: c.CourseId, title: c.Title, slug: c.Slug, language: c.Language, price: c.Price, status: c.Status, validityDays: c.ValidityDays
    })));
  }));

  router.post('/exams', requireRoles('Admin', 'SuperAdmin'), asyncHandler((req, res) => {
    const { name, code, description = '', isActive = true } = req.body || {};
    const id = uuid();
    const upper = String(code || '').trim().toUpperCase();
    db.prepare('INSERT INTO Exams (ExamId, Name, Code, Description, IsActive) VALUES (?, ?, ?, ?, ?)').run(id, String(name).trim(), upper, String(description).trim(), isActive ? 1 : 0);
    recordAudit(db, req.user.userId, req.user.name, 'CREATE_EXAM', 'Exam', id, upper);
    res.json({ examId: id, name: String(name).trim(), code: upper, description, isActive: Boolean(isActive) });
  }));

  router.post('/courses', requireRoles('Admin', 'SuperAdmin', 'Faculty'), asyncHandler((req, res) => {
    const { title, slug, description = '', language = 'Bilingual (EN/HI)', courseType = 'Foundation', validityDays = 365, price = 1499, currency = 'INR', examIds = [] } = req.body || {};
    const id = uuid();
    db.prepare(`INSERT INTO Courses (CourseId, Title, Slug, Description, Language, CourseType, Status, ValidityDays, Price, Currency, CreatedAt) VALUES (?, ?, ?, ?, ?, ?, 'Draft', ?, ?, ?, ?)`)
      .run(id, String(title).trim(), String(slug).trim().toLowerCase(), String(description).trim(), language, courseType, Number(validityDays), Number(price), currency, nowIso());
    for (const eid of examIds) db.prepare('INSERT INTO CourseExams (CourseId, ExamId) VALUES (?, ?)').run(id, eid);
    recordAudit(db, req.user.userId, req.user.name, 'CREATE_COURSE', 'Course', id, String(title).trim());
    res.json({ courseId: id, title: String(title).trim(), status: 'Draft' });
  }));

  router.post('/courses/:id/publish', requireRoles('Admin', 'SuperAdmin'), asyncHandler((req, res) => {
    const c = db.prepare('SELECT Title FROM Courses WHERE CourseId = ?').get(req.params.id);
    if (!c) throw new AppError('Course not found.', 404);
    db.prepare("UPDATE Courses SET Status = 'Published' WHERE CourseId = ?").run(req.params.id);
    recordAudit(db, req.user.userId, req.user.name, 'COURSE_STATUS_Published', 'Course', req.params.id, c.Title);
    res.status(204).end();
  }));

  router.post('/courses/:id/unpublish', requireRoles('Admin', 'SuperAdmin'), asyncHandler((req, res) => {
    const c = db.prepare('SELECT Title FROM Courses WHERE CourseId = ?').get(req.params.id);
    if (!c) throw new AppError('Course not found.', 404);
    db.prepare("UPDATE Courses SET Status = 'Draft' WHERE CourseId = ?").run(req.params.id);
    recordAudit(db, req.user.userId, req.user.name, 'COURSE_STATUS_Draft', 'Course', req.params.id, c.Title);
    res.status(204).end();
  }));

  router.post('/courses/:id/quick-lesson', requireRoles('Admin', 'SuperAdmin', 'Faculty'), asyncHandler((req, res) => {
    const { lessonTitle, assetId = 'mudgal_lecture', pdfTitle, isPreview = false } = req.body || {};
    let mod = db.prepare('SELECT * FROM CourseModules WHERE CourseId = ? ORDER BY SortOrder LIMIT 1').get(req.params.id);
    if (!mod) {
      const modId = uuid();
      db.prepare('INSERT INTO CourseModules (ModuleId, CourseId, Title, SortOrder) VALUES (?, ?, ?, 1)').run(modId, req.params.id, 'Module 1: Core Syllabus');
      mod = { ModuleId: modId };
    }
    let ch = db.prepare('SELECT * FROM Chapters WHERE ModuleId = ? ORDER BY SortOrder LIMIT 1').get(mod.ModuleId);
    if (!ch) {
      const chId = uuid();
      db.prepare('INSERT INTO Chapters (ChapterId, ModuleId, Title, SortOrder) VALUES (?, ?, ?, 1)').run(chId, mod.ModuleId, 'Chapter 1: Foundations');
      ch = { ChapterId: chId };
    }
    const maId = uuid(), lessonId = uuid();
    const sortOrder = db.prepare('SELECT COUNT(*) AS cnt FROM Lessons WHERE ChapterId = ?').get(ch.ChapterId).cnt + 1;
    db.prepare(`INSERT INTO MediaAssets (MediaAssetId, Provider, ProviderAssetId, AssetType, Status) VALUES (?, 'MockHlsCdn', ?, 'Video', 'Ready')`).run(maId, assetId);
    db.prepare(`INSERT INTO Lessons (LessonId, ChapterId, Title, LessonType, MediaAssetId, DurationSeconds, IsPreview, SortOrder) VALUES (?, ?, ?, 'Video', ?, 1800, ?, ?)`)
      .run(lessonId, ch.ChapterId, String(lessonTitle).trim(), maId, isPreview ? 1 : 0, sortOrder);
    if (pdfTitle && String(pdfTitle).trim()) {
      db.prepare(`INSERT INTO Resources (ResourceId, LessonId, StorageKey, ResourceType, Title) VALUES (?, ?, ?, 'Pdf', ?)`)
        .run(uuid(), lessonId, `${assetId}.pdf`, String(pdfTitle).trim());
    }
    recordAudit(db, req.user.userId, req.user.name, 'CREATE_LESSON', 'Lesson', lessonId, String(lessonTitle).trim());
    res.json({ lessonId });
  }));

  router.get('/tests-meta', asyncHandler((_req, res) => {
    const tests = db.prepare('SELECT TestId, Title FROM Tests ORDER BY Title').all().map((t) => ({ testId: t.TestId, title: t.Title }));
    const subjects = db.prepare('SELECT SubjectId, Name FROM Subjects ORDER BY Name').all().map((s) => ({ subjectId: s.SubjectId, name: s.Name }));
    res.json({ tests, subjects });
  }));

  router.post('/tests', requireRoles('Admin', 'SuperAdmin', 'Faculty'), asyncHandler((req, res) => {
    const { courseId, title, instructions = 'Each correct answer awards +2 marks. Negative marking: -0.5.', durationSeconds = 900 } = req.body || {};
    const id = uuid();
    db.prepare(`INSERT INTO Tests (TestId, CourseId, Title, Instructions, DurationSeconds, AllowReviewAfterSubmit, Status) VALUES (?, ?, ?, ?, ?, 1, 'Published')`)
      .run(id, courseId, String(title).trim(), instructions, Number(durationSeconds));
    recordAudit(db, req.user.userId, req.user.name, 'CREATE_TEST', 'Test', id, String(title).trim());
    res.json({ testId: id });
  }));

  router.post('/questions', requireRoles('Admin', 'SuperAdmin', 'Faculty'), asyncHandler((req, res) => {
    const { testId, subjectId, sectionName = 'General', stem, explanation = '', marks = 2, negativeMarks = 0.5, options = [] } = req.body || {};
    if (options.filter((o) => o.isCorrect).length !== 1) throw new AppError('Single-choice MCQ must have exactly 1 correct option.', 400);
    const qId = uuid();
    db.prepare(`INSERT INTO Questions (QuestionId, SubjectId, Type, SectionName, Stem, Explanation, Difficulty) VALUES (?, ?, 'SingleChoiceMcq', ?, ?, ?, 'Medium')`)
      .run(qId, subjectId, sectionName, String(stem).trim(), explanation);
    options.forEach((o, i) => {
      db.prepare('INSERT INTO QuestionOptions (OptionId, QuestionId, Text, IsCorrect, SortOrder) VALUES (?, ?, ?, ?, ?)').run(uuid(), qId, String(o.text).trim(), o.isCorrect ? 1 : 0, i + 1);
    });
    const sortOrder = db.prepare('SELECT COUNT(*) AS cnt FROM TestQuestions WHERE TestId = ?').get(testId).cnt + 1;
    db.prepare('INSERT INTO TestQuestions (TestId, QuestionId, Marks, NegativeMarks, SortOrder) VALUES (?, ?, ?, ?, ?)').run(testId, qId, Number(marks), Number(negativeMarks), sortOrder);
    recordAudit(db, req.user.userId, req.user.name, 'ADD_QUESTION', 'Question', qId, sectionName);
    res.json({ questionId: qId });
  }));

  router.post('/live-sessions', requireRoles('Admin', 'SuperAdmin', 'Faculty'), asyncHandler((req, res) => {
    const { courseId, title, facultyName, startsAt, endsAt, provider = 'Zoom', joinUrl = 'https://zoom.us/j/9988776655' } = req.body || {};
    const id = uuid();
    const start = startsAt || new Date(Date.now() + 3600_000).toISOString();
    const end = endsAt || new Date(Date.now() + 7200_000).toISOString();
    db.prepare('INSERT INTO LiveSessions (SessionId, CourseId, Title, FacultyName, StartsAt, EndsAt, Provider, ProviderSessionId, JoinUrl) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, courseId, String(title).trim(), String(facultyName).trim(), start, end, provider, `LIVE-${id.slice(0, 8).toUpperCase()}`, joinUrl);
    recordAudit(db, req.user.userId, req.user.name, 'SCHEDULE_LIVE', 'LiveSession', id, String(title).trim());
    res.json({ sessionId: id });
  }));

  router.get('/orders', requireRoles('Admin', 'SuperAdmin'), asyncHandler((_req, res) => {
    const orders = db.prepare('SELECT * FROM Orders ORDER BY CreatedAt DESC LIMIT 100').all().map((o) => ({
      orderId: o.OrderId, totalAmount: o.TotalAmount, currency: o.Currency, status: o.Status, createdAt: o.CreatedAt,
      items: db.prepare('SELECT ProductTitle FROM OrderItems WHERE OrderId = ?').all(o.OrderId).map((i) => i.ProductTitle)
    }));
    res.json(orders);
  }));

  router.get('/orders/export', requireRoles('Admin', 'SuperAdmin'), asyncHandler((_req, res) => {
    const orders = db.prepare('SELECT o.*, u.Phone, u.FullName FROM Orders o JOIN Users u ON o.UserId = u.UserId ORDER BY o.CreatedAt DESC').all();
    const lines = ['OrderId,StudentPhone,StudentName,Items,TotalAmount,Currency,Status,CreatedAtUtc'];
    for (const o of orders) {
      const items = db.prepare('SELECT ProductTitle FROM OrderItems WHERE OrderId = ?').all(o.OrderId).map((i) => i.ProductTitle.replace(/,/g, ' ')).join(' | ');
      lines.push(`${o.OrderId},${o.Phone},${o.FullName.replace(/,/g, ' ')},${items},${o.TotalAmount},${o.Currency},${o.Status},${o.CreatedAt}`);
    }
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="orders-${nowIso().slice(0, 10)}.csv"`);
    res.send(lines.join('\n'));
  }));

  router.get('/students', requireRoles('Admin', 'SuperAdmin', 'Faculty', 'SupportAgent'), asyncHandler((_req, res) => {
    res.json(getStudentsDetailed(db));
  }));

  router.get('/students/export', requireRoles('Admin', 'SuperAdmin'), asyncHandler((_req, res) => {
    const students = getStudentsDetailed(db);
    const lines = ['UserId,FullName,Phone,Email,State,TargetExam,Verified,VerificationSource,Status,EnrolledBatches,TotalPaidINR,JoinedUtc'];
    for (const s of students) {
      const batches = s.enrolledCourses.join(' | ').replace(/,/g, ' ');
      lines.push(`${s.userId},${s.fullName.replace(/,/g, ' ')},${s.phone},${s.email},${s.state},${s.targetExam},${s.isVerified ? 'Yes' : 'No'},${s.verificationSource},${s.status},${batches},${s.totalSpentInr},${s.createdAt}`);
    }
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="students-${nowIso().slice(0, 10)}.csv"`);
    res.send(lines.join('\n'));
  }));

  router.post('/students/:id/verify', requireRoles('Admin', 'SuperAdmin', 'SupportAgent'), asyncHandler((req, res) => {
    const u = db.prepare('SELECT UserId, FullName FROM Users WHERE UserId = ?').get(req.params.id);
    if (!u) throw new AppError('Student not found.', 404, 'NOT_FOUND');
    const verified = req.body?.verified !== false;
    db.prepare('UPDATE Users SET IsVerified = ?, VerificationSource = ? WHERE UserId = ?')
      .run(verified ? 1 : 0, verified ? 'AdminApproved' : 'Pending', u.UserId);
    recordAudit(db, req.user.userId, req.user.name, verified ? 'VERIFY_STUDENT' : 'UNVERIFY_STUDENT', 'User', u.UserId, u.FullName);
    res.json({ userId: u.UserId, isVerified: verified });
  }));

  router.get('/staff', requireRoles('Admin', 'SuperAdmin'), asyncHandler((_req, res) => {
    const rows = db.prepare(`
      SELECT u.UserId, u.FullName, u.Phone, u.Email, u.Status, u.CreatedAt, r.Name AS RoleName
      FROM Users u
      JOIN UserRoles ur ON u.UserId = ur.UserId
      JOIN Roles r ON ur.RoleId = r.RoleId
      WHERE r.Name IN ('SuperAdmin', 'Admin', 'Faculty', 'SupportAgent')
      ORDER BY u.CreatedAt DESC
    `).all();
    res.json(rows.map((s) => ({
      userId: s.UserId, fullName: s.FullName, phone: s.Phone, email: s.Email || '-', role: s.RoleName, status: s.Status, createdAt: s.CreatedAt
    })));
  }));

  router.post('/faculties', requireRoles('SuperAdmin'), asyncHandler((req, res) => {
    const { fullName, phone: rawPhone, email = '', password, role = 'Faculty' } = req.body || {};
    const phone = normalizePhone(rawPhone);
    if (!/^[6-9]\d{9}$/.test(phone)) throw new AppError('Enter a valid 10-digit Indian mobile number.', 400, 'INVALID_PHONE');
    if (!fullName || !String(fullName).trim()) throw new AppError('Faculty full name is required.', 400, 'INVALID_NAME');
    const allowedStaffRoles = ['Faculty', 'SupportAgent', 'Admin'];
    const targetRole = allowedStaffRoles.includes(role) ? role : 'Faculty';
    const passwordHash = hashPassword(password);

    if (db.prepare('SELECT 1 FROM Users WHERE Phone = ?').get(phone)) {
      throw new AppError('A user with this mobile number already exists.', 409, 'ACCOUNT_EXISTS');
    }
    const roleRow = db.prepare('SELECT RoleId FROM Roles WHERE Name = ?').get(targetRole);
    if (!roleRow) throw new AppError('Target role not found.', 400, 'INVALID_ROLE');

    const uid = uuid();
    db.prepare("INSERT INTO Users (UserId, Phone, Email, FullName, PasswordHash, IsVerified, VerificationSource, Status, CreatedAt) VALUES (?, ?, ?, ?, ?, 1, 'SuperAdminCreated', 'Active', ?)")
      .run(uid, phone, email ? String(email).trim() : null, String(fullName).trim(), passwordHash, nowIso());
    db.prepare('INSERT INTO UserRoles (UserId, RoleId) VALUES (?, ?)').run(uid, roleRow.RoleId);
    recordAudit(db, req.user.userId, req.user.name, `ADD_${targetRole.toUpperCase()}`, 'User', uid, `${String(fullName).trim()} (${phone})`);
    res.json({ userId: uid, fullName: String(fullName).trim(), phone, email: email || '-', role: targetRole, status: 'Active' });
  }));

  router.post('/staff/:id/status', requireRoles('SuperAdmin'), asyncHandler((req, res) => {
    const nextStatus = req.body?.status === 'Suspended' ? 'Suspended' : 'Active';
    const u = db.prepare('SELECT UserId, FullName FROM Users WHERE UserId = ?').get(req.params.id);
    if (!u) throw new AppError('Staff member not found.', 404, 'NOT_FOUND');
    if (u.UserId === req.user.userId) throw new AppError('Cannot change your own status.', 400, 'INVALID_ACTION');
    db.prepare('UPDATE Users SET Status = ? WHERE UserId = ?').run(nextStatus, u.UserId);
    recordAudit(db, req.user.userId, req.user.name, `STAFF_STATUS_${nextStatus.toUpperCase()}`, 'User', u.UserId, u.FullName);
    res.json({ userId: u.UserId, status: nextStatus });
  }));

  router.get('/doubts', asyncHandler((_req, res) => {
    const rows = db.prepare(`SELECT d.*, c.Title AS CourseTitle, u.FullName AS StudentName FROM Doubts d JOIN Courses c ON d.CourseId = c.CourseId JOIN Users u ON d.UserId = u.UserId ORDER BY d.CreatedAt DESC LIMIT 50`).all();
    res.json(rows.map((d) => ({
      doubtId: d.DoubtId, title: d.Title, text: d.Text, status: d.Status, studentName: d.StudentName, courseTitle: d.CourseTitle, createdAt: d.CreatedAt
    })));
  }));

  router.get('/reports', requireRoles('Admin', 'SuperAdmin', 'SupportAgent'), asyncHandler((_req, res) => {
    const rows = db.prepare('SELECT r.*, u.FullName AS ReporterName FROM ContentReports r JOIN Users u ON r.ReporterUserId = u.UserId ORDER BY r.CreatedAt DESC LIMIT 50').all();
    res.json(rows.map((r) => ({
      reportId: r.ReportId, reporterName: r.ReporterName, entityType: r.EntityType, entityId: r.EntityId, reason: r.Reason, status: r.Status, createdAt: r.CreatedAt
    })));
  }));

  router.post('/community/:entityType/:id/moderate', requireRoles('Admin', 'SuperAdmin', 'SupportAgent'), asyncHandler((req, res) => {
    const { entityType, id } = req.params;
    const action = String(req.body?.action || '').trim().toLowerCase();
    const mapMod = { remove: 'Removed', hide: 'Hidden', restore: 'Visible' };
    const mapUser = { mute: 'Muted', suspend: 'Suspended', activate: 'Active' };
    if (entityType.toLowerCase() === 'post' && mapMod[action]) {
      db.prepare('UPDATE CommunityPosts SET Status = ? WHERE PostId = ?').run(mapMod[action], id);
    } else if (entityType.toLowerCase() === 'comment' && mapMod[action]) {
      db.prepare('UPDATE CommunityComments SET Status = ? WHERE CommentId = ?').run(mapMod[action], id);
    } else if (entityType.toLowerCase() === 'user' && mapUser[action]) {
      db.prepare('UPDATE Users SET Status = ? WHERE UserId = ?').run(mapUser[action], id);
    }
    const repStatus = action === 'dismiss' ? 'Dismissed' : 'ReviewedActionTaken';
    db.prepare("UPDATE ContentReports SET Status = ? WHERE EntityId = ? AND Status = 'Open'").run(repStatus, id);
    recordAudit(db, req.user.userId, req.user.name, `MODERATE_${entityType.toUpperCase()}_${action.toUpperCase()}`, entityType, id, req.body?.note || '');
    res.status(204).end();
  }));

  router.get('/audit-logs', requireRoles('Admin', 'SuperAdmin'), asyncHandler((_req, res) => {
    const rows = db.prepare('SELECT * FROM AuditLogs ORDER BY CreatedAt DESC LIMIT 100').all();
    res.json(rows.map((a) => ({
      auditId: a.AuditId, actorUserId: a.ActorUserId, actorName: a.ActorName, action: a.Action, entityType: a.EntityType, entityId: a.EntityId, details: a.Details, createdAt: a.CreatedAt
    })));
  }));

  return router;
}
