import express from 'express';
import { hasActiveEntitlement } from '../db.js';
import { AppError, asyncHandler, optionalAuth, requireAuth } from '../security.js';

export function createCatalogueRouter(db) {
  const router = express.Router();

  router.get('/exams', asyncHandler((_req, res) => {
    const rows = db.prepare('SELECT ExamId, Name, Code, Description, IsActive FROM Exams WHERE IsActive = 1 ORDER BY Name').all();
    res.json(rows.map((e) => ({
      examId: e.ExamId, name: e.Name, code: e.Code, description: e.Description, isActive: Boolean(e.IsActive)
    })));
  }));

  router.get('/exams/:id/subjects', asyncHandler((req, res) => {
    const rows = db.prepare('SELECT SubjectId, ExamId, Name FROM Subjects WHERE ExamId = ? ORDER BY Name').all(req.params.id);
    res.json(rows.map((s) => ({ subjectId: s.SubjectId, examId: s.ExamId, name: s.Name })));
  }));

  router.get('/courses', asyncHandler((req, res) => {
    const { examId, language, courseType, maxPrice, search, page = '1', pageSize = '20' } = req.query;
    const p = Math.max(1, parseInt(page, 10) || 1);
    const ps = Math.min(50, Math.max(1, parseInt(pageSize, 10) || 20));

    let courses = db.prepare("SELECT * FROM Courses WHERE Status = 'Published' ORDER BY CreatedAt DESC").all();

    if (examId) {
      const matchIds = new Set(db.prepare('SELECT CourseId FROM CourseExams WHERE ExamId = ?').all(examId).map((x) => x.CourseId));
      courses = courses.filter((c) => matchIds.has(c.CourseId));
    }
    if (language) courses = courses.filter((c) => c.Language.toLowerCase() === String(language).trim().toLowerCase());
    if (courseType) courses = courses.filter((c) => c.CourseType.toLowerCase() === String(courseType).trim().toLowerCase());
    if (maxPrice !== undefined && maxPrice !== '') courses = courses.filter((c) => c.Price <= Number(maxPrice));
    if (search) {
      const term = String(search).trim().toLowerCase();
      courses = courses.filter((c) => c.Title.toLowerCase().includes(term) || c.Description.toLowerCase().includes(term));
    }

    const totalCount = courses.length;
    const slice = courses.slice((p - 1) * ps, p * ps);

    const items = slice.map((c) => {
      const examCodes = db.prepare('SELECT e.Code FROM CourseExams ce JOIN Exams e ON ce.ExamId = e.ExamId WHERE ce.CourseId = ?').all(c.CourseId).map((x) => x.Code);
      const facultyNames = db.prepare('SELECT u.FullName FROM CourseFaculties cf JOIN Users u ON cf.FacultyUserId = u.UserId WHERE cf.CourseId = ?').all(c.CourseId).map((x) => x.FullName);
      const lessonCount = db.prepare('SELECT COUNT(*) AS cnt FROM Lessons l JOIN Chapters ch ON l.ChapterId = ch.ChapterId JOIN CourseModules m ON ch.ModuleId = m.ModuleId WHERE m.CourseId = ?').get(c.CourseId).cnt;
      const testCount = db.prepare("SELECT COUNT(*) AS cnt FROM Tests WHERE CourseId = ? AND Status = 'Published'").get(c.CourseId).cnt;
      return {
        courseId: c.CourseId,
        title: c.Title,
        slug: c.Slug,
        description: c.Description,
        language: c.Language,
        courseType: c.CourseType,
        status: c.Status,
        validityDays: c.ValidityDays,
        price: c.Price,
        currency: c.Currency,
        examCodes,
        facultyNames,
        lessonCount,
        testCount
      };
    });

    res.json({ items, page: p, pageSize: ps, totalCount });
  }));

  router.get('/courses/:id', optionalAuth, asyncHandler((req, res) => {
    const c = db.prepare("SELECT * FROM Courses WHERE CourseId = ? AND Status = 'Published'").get(req.params.id);
    if (!c) throw new AppError('Course not found.', 404, 'COURSE_NOT_FOUND');

    const exams = db.prepare('SELECT e.* FROM CourseExams ce JOIN Exams e ON ce.ExamId = e.ExamId WHERE ce.CourseId = ?').all(c.CourseId)
      .map((e) => ({ examId: e.ExamId, name: e.Name, code: e.Code, description: e.Description, isActive: Boolean(e.IsActive) }));
    const facultyNames = db.prepare('SELECT u.FullName FROM CourseFaculties cf JOIN Users u ON cf.FacultyUserId = u.UserId WHERE cf.CourseId = ?').all(c.CourseId).map((x) => x.FullName);
    const lessons = db.prepare('SELECT l.LessonId, l.IsPreview FROM Lessons l JOIN Chapters ch ON l.ChapterId = ch.ChapterId JOIN CourseModules m ON ch.ModuleId = m.ModuleId WHERE m.CourseId = ? ORDER BY m.SortOrder, ch.SortOrder, l.SortOrder').all(c.CourseId);
    const testCount = db.prepare("SELECT COUNT(*) AS cnt FROM Tests WHERE CourseId = ? AND Status = 'Published'").get(c.CourseId).cnt;
    const isEnrolled = req.user ? hasActiveEntitlement(db, req.user.userId, c.CourseId) : false;

    let faqs = [];
    try { faqs = JSON.parse(c.FaqJson || '[]'); } catch { faqs = []; }

    res.json({
      courseId: c.CourseId,
      title: c.Title,
      slug: c.Slug,
      description: c.Description,
      language: c.Language,
      courseType: c.CourseType,
      status: c.Status,
      validityDays: c.ValidityDays,
      price: c.Price,
      currency: c.Currency,
      exams,
      facultyNames,
      faqs,
      isEnrolled,
      sampleLessonId: (lessons.find((l) => l.IsPreview) || lessons[0])?.LessonId || null,
      totalLessons: lessons.length,
      totalTests: testCount
    });
  }));

  router.get('/courses/:id/curriculum', optionalAuth, asyncHandler((req, res) => {
    const course = db.prepare("SELECT * FROM Courses WHERE CourseId = ? AND Status = 'Published'").get(req.params.id);
    if (!course) throw new AppError('Course not found.', 404, 'COURSE_NOT_FOUND');

    const hasAccess = req.user ? hasActiveEntitlement(db, req.user.userId, course.CourseId) : false;
    const modules = db.prepare('SELECT * FROM CourseModules WHERE CourseId = ? ORDER BY SortOrder').all(course.CourseId).map((m) => {
      const chapters = db.prepare('SELECT * FROM Chapters WHERE ModuleId = ? ORDER BY SortOrder').all(m.ModuleId).map((ch) => {
        const lessons = db.prepare('SELECT * FROM Lessons WHERE ChapterId = ? ORDER BY SortOrder').all(ch.ChapterId).map((l) => {
          const prog = req.user ? db.prepare('SELECT * FROM LessonProgresses WHERE UserId = ? AND LessonId = ?').get(req.user.userId, l.LessonId) : null;
          const bmk = req.user ? db.prepare('SELECT 1 FROM LessonBookmarks WHERE UserId = ? AND LessonId = ?').get(req.user.userId, l.LessonId) : null;
          const resources = db.prepare('SELECT ResourceId, Title, ResourceType FROM Resources WHERE LessonId = ?').all(l.LessonId)
            .map((r) => ({ resourceId: r.ResourceId, title: r.Title, resourceType: r.ResourceType }));
          return {
            lessonId: l.LessonId,
            title: l.Title,
            lessonType: l.LessonType,
            durationSeconds: l.DurationSeconds,
            isPreview: Boolean(l.IsPreview),
            sortOrder: l.SortOrder,
            isLocked: !hasAccess && !l.IsPreview,
            lastPositionSeconds: prog?.LastPositionSeconds || 0,
            isCompleted: Boolean(prog?.CompletedAt),
            isBookmarked: Boolean(bmk),
            resources
          };
        });
        return { chapterId: ch.ChapterId, title: ch.Title, sortOrder: ch.SortOrder, lessons };
      });
      return { moduleId: m.ModuleId, title: m.Title, sortOrder: m.SortOrder, chapters };
    });

    res.json({ courseId: course.CourseId, courseTitle: course.Title, hasAccess, modules });
  }));

  router.get('/flashcards', requireAuth, asyncHandler((_req, res) => {
    res.json([
      { id: 1, subject: 'Botany', topic: 'Cell Biology', front: 'Which organelle is semi-autonomous and contains 70S ribosomes & circular DNA?', back: 'Mitochondria and Chloroplasts (both follow endosymbiotic theory).' },
      { id: 2, subject: 'Zoology', topic: 'Human Physiology', front: 'What is the normal stroke volume and cardiac output of a healthy human heart?', back: 'Stroke volume ≈ 70 mL/beat; Cardiac output = 70 × 72 ≈ 5040 mL (~5 L/min).' },
      { id: 3, subject: 'Genetics', topic: 'Molecular Basis', front: 'Which enzyme unwinds the DNA double helix during replication?', back: 'DNA Helicase breaks hydrogen bonds between complementary base pairs.' },
      { id: 4, subject: 'General Science', topic: 'Vitamins', front: 'Deficiency of which vitamin causes Pernicious Anaemia?', back: 'Vitamin B12 (Cyanocobalamin), essential for RBC maturation.' },
      { id: 5, subject: 'Polity', topic: 'Constitution', front: 'Which Article deals with Right to Constitutional Remedies (Heart & Soul)?', back: 'Article 32 (Habeas Corpus, Mandamus, Prohibition, Certiorari, Quo Warranto).' }
    ]);
  }));

  return router;
}
