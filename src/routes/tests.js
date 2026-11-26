import express from 'express';
import { hasActiveEntitlement, nowIso, uuid } from '../db.js';
import { AppError, asyncHandler, requireAuth } from '../security.js';

export function createTestsRouter(db) {
  const router = express.Router();
  router.use(requireAuth);

  const finalizeAttempt = (attempt, test, finalStatus) => {
    const tqs = db.prepare('SELECT * FROM TestQuestions WHERE TestId = ?').all(test.TestId);
    const answers = db.prepare('SELECT * FROM AttemptAnswers WHERE AttemptId = ?').all(attempt.AttemptId);
    const ansMap = new Map(answers.map((a) => [a.QuestionId, a]));

    let score = 0, maxScore = 0, correct = 0, incorrect = 0, unanswered = 0;
    for (const tq of tqs) {
      maxScore += Number(tq.Marks);
      const ans = ansMap.get(tq.QuestionId);
      if (!ans || !ans.SelectedOptionId) {
        unanswered++;
        continue;
      }
      const correctOpt = db.prepare('SELECT OptionId FROM QuestionOptions WHERE QuestionId = ? AND IsCorrect = 1 LIMIT 1').get(tq.QuestionId);
      if (correctOpt && ans.SelectedOptionId === correctOpt.OptionId) {
        score += Number(tq.Marks);
        correct++;
      } else {
        score -= Number(tq.NegativeMarks);
        incorrect++;
      }
    }

    const submittedAt = nowIso();
    db.prepare(`UPDATE TestAttempts SET Score = ?, MaxScore = ?, CorrectCount = ?, IncorrectCount = ?, UnansweredCount = ?, SubmittedAt = ?, Status = ? WHERE AttemptId = ?`)
      .run(score, maxScore, correct, incorrect, unanswered, submittedAt, finalStatus, attempt.AttemptId);
    return db.prepare('SELECT * FROM TestAttempts WHERE AttemptId = ?').get(attempt.AttemptId);
  };

  const mapResult = (a, test) => {
    const answered = a.CorrectCount + a.IncorrectCount;
    const accuracyPercent = answered === 0 ? 0 : Math.round((a.CorrectCount / answered) * 1000) / 10;
    return {
      attemptId: a.AttemptId,
      testId: test.TestId,
      testTitle: test.Title,
      status: a.Status,
      startedAt: a.StartedAt,
      submittedAt: a.SubmittedAt || nowIso(),
      score: a.Score || 0,
      maxScore: a.MaxScore || 0,
      accuracyPercent,
      correctCount: a.CorrectCount,
      incorrectCount: a.IncorrectCount,
      unansweredCount: a.UnansweredCount,
      canReview: Boolean(test.AllowReviewAfterSubmit)
    };
  };

  router.get('/tests', asyncHandler((req, res) => {
    const { courseId } = req.query;
    const rows = courseId
      ? db.prepare("SELECT t.*, c.Title AS CourseTitle FROM Tests t JOIN Courses c ON t.CourseId = c.CourseId WHERE t.Status = 'Published' AND t.CourseId = ?").all(courseId)
      : db.prepare("SELECT t.*, c.Title AS CourseTitle FROM Tests t JOIN Courses c ON t.CourseId = c.CourseId WHERE t.Status = 'Published'").all();

    res.json(rows.map((t) => {
      const stats = db.prepare('SELECT COUNT(*) AS cnt, COALESCE(SUM(Marks), 0) AS totalMarks FROM TestQuestions WHERE TestId = ?').get(t.TestId);
      const inProg = db.prepare("SELECT AttemptId FROM TestAttempts WHERE TestId = ? AND UserId = ? AND Status = 'InProgress' LIMIT 1").get(t.TestId, req.user.userId);
      const lastSub = db.prepare("SELECT AttemptId FROM TestAttempts WHERE TestId = ? AND UserId = ? AND Status != 'InProgress' ORDER BY SubmittedAt DESC LIMIT 1").get(t.TestId, req.user.userId);
      return {
        testId: t.TestId,
        courseId: t.CourseId,
        courseTitle: t.CourseTitle,
        title: t.Title,
        durationSeconds: t.DurationSeconds,
        questionCount: stats.cnt,
        totalMarks: stats.totalMarks,
        allowReviewAfterSubmit: Boolean(t.AllowReviewAfterSubmit),
        status: t.Status,
        isLocked: !hasActiveEntitlement(db, req.user.userId, t.CourseId),
        inProgressAttemptId: inProg?.AttemptId || null,
        lastSubmittedAttemptId: lastSub?.AttemptId || null
      };
    }));
  }));

  router.get('/tests/:id', asyncHandler((req, res) => {
    const t = db.prepare("SELECT * FROM Tests WHERE TestId = ? AND Status = 'Published'").get(req.params.id);
    if (!t) throw new AppError('Test not found.', 404, 'TEST_NOT_FOUND');
    const stats = db.prepare('SELECT COUNT(*) AS cnt, COALESCE(SUM(Marks), 0) AS totalMarks FROM TestQuestions WHERE TestId = ?').get(t.TestId);
    res.json({
      testId: t.TestId,
      courseId: t.CourseId,
      title: t.Title,
      instructions: t.Instructions,
      durationSeconds: t.DurationSeconds,
      questionCount: stats.cnt,
      totalMarks: stats.totalMarks,
      allowReviewAfterSubmit: Boolean(t.AllowReviewAfterSubmit)
    });
  }));

  router.post('/tests/:id/attempts', asyncHandler((req, res) => {
    const test = db.prepare("SELECT * FROM Tests WHERE TestId = ? AND Status = 'Published'").get(req.params.id);
    if (!test) throw new AppError('Test not found.', 404, 'TEST_NOT_FOUND');
    if (!hasActiveEntitlement(db, req.user.userId, test.CourseId)) {
      throw new AppError('Active course enrollment required to take this mock test.', 403, 'ENTITLEMENT_REQUIRED');
    }

    let attempt = db.prepare("SELECT * FROM TestAttempts WHERE TestId = ? AND UserId = ? AND Status = 'InProgress' LIMIT 1").get(test.TestId, req.user.userId);
    let recovered = Boolean(attempt);
    if (attempt && Date.parse(attempt.StartedAt) + test.DurationSeconds * 1000 <= Date.now()) {
      finalizeAttempt(attempt, test, 'TimedOut');
      attempt = null;
      recovered = false;
    }
    if (!attempt) {
      const attemptId = uuid();
      db.prepare(`INSERT INTO TestAttempts (AttemptId, TestId, UserId, StartedAt, Status) VALUES (?, ?, ?, ?, 'InProgress')`)
        .run(attemptId, test.TestId, req.user.userId, nowIso());
      attempt = db.prepare('SELECT * FROM TestAttempts WHERE AttemptId = ?').get(attemptId);
    }

    const ansMap = new Map(db.prepare('SELECT * FROM AttemptAnswers WHERE AttemptId = ?').all(attempt.AttemptId).map((a) => [a.QuestionId, a]));
    const deadlineMs = Date.parse(attempt.StartedAt) + test.DurationSeconds * 1000;
    const remainingSeconds = Math.max(0, Math.floor((deadlineMs - Date.now()) / 1000));

    const questions = db.prepare(`
      SELECT tq.*, q.SectionName, q.Stem
      FROM TestQuestions tq JOIN Questions q ON tq.QuestionId = q.QuestionId
      WHERE tq.TestId = ? ORDER BY tq.SortOrder
    `).all(test.TestId).map((tq) => {
      const saved = ansMap.get(tq.QuestionId);
      const options = db.prepare('SELECT OptionId, Text, SortOrder FROM QuestionOptions WHERE QuestionId = ? ORDER BY SortOrder').all(tq.QuestionId)
        .map((o) => ({ optionId: o.OptionId, text: o.Text, sortOrder: o.SortOrder }));
      return {
        questionId: tq.QuestionId,
        sectionName: tq.SectionName,
        stem: tq.Stem,
        marks: tq.Marks,
        negativeMarks: tq.NegativeMarks,
        sortOrder: tq.SortOrder,
        selectedOptionId: saved?.SelectedOptionId || null,
        isMarkedForReview: Boolean(saved?.IsMarkedForReview),
        options
      };
    });

    res.json({
      attemptId: attempt.AttemptId,
      testId: test.TestId,
      testTitle: test.Title,
      startedAt: attempt.StartedAt,
      deadlineAt: new Date(deadlineMs).toISOString(),
      remainingSeconds,
      recovered,
      questions
    });
  }));

  router.put('/attempts/:id/answers/:questionId', asyncHandler((req, res) => {
    const attempt = db.prepare('SELECT * FROM TestAttempts WHERE AttemptId = ? AND UserId = ?').get(req.params.id, req.user.userId);
    if (!attempt) throw new AppError('Test attempt not found.', 404, 'ATTEMPT_NOT_FOUND');
    if (attempt.Status !== 'InProgress') throw new AppError('Attempt has already been submitted.', 409, 'ATTEMPT_SUBMITTED');

    const belongs = db.prepare('SELECT 1 FROM TestQuestions WHERE TestId = ? AND QuestionId = ?').get(attempt.TestId, req.params.questionId);
    if (!belongs) throw new AppError('Question does not belong to this test.', 400, 'INVALID_QUESTION');

    db.prepare(`
      INSERT INTO AttemptAnswers (AttemptId, QuestionId, SelectedOptionId, IsMarkedForReview, SavedAt)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(AttemptId, QuestionId) DO UPDATE SET
        SelectedOptionId = excluded.SelectedOptionId,
        IsMarkedForReview = excluded.IsMarkedForReview,
        SavedAt = excluded.SavedAt
    `).run(attempt.AttemptId, req.params.questionId, req.body?.selectedOptionId || null, req.body?.isMarkedForReview ? 1 : 0, nowIso());

    res.status(204).end();
  }));

  router.post('/attempts/:id/submit', asyncHandler((req, res) => {
    let attempt = db.prepare('SELECT * FROM TestAttempts WHERE AttemptId = ? AND UserId = ?').get(req.params.id, req.user.userId);
    if (!attempt) throw new AppError('Test attempt not found.', 404, 'ATTEMPT_NOT_FOUND');
    const test = db.prepare('SELECT * FROM Tests WHERE TestId = ?').get(attempt.TestId);
    if (attempt.Status === 'InProgress') {
      const timedOut = Date.parse(attempt.StartedAt) + (test.DurationSeconds + 15) * 1000 < Date.now();
      attempt = finalizeAttempt(attempt, test, timedOut ? 'TimedOut' : 'Submitted');
    }
    res.json(mapResult(attempt, test));
  }));

  router.get('/attempts/:id/result', asyncHandler((req, res) => {
    let attempt = db.prepare('SELECT * FROM TestAttempts WHERE AttemptId = ? AND UserId = ?').get(req.params.id, req.user.userId);
    if (!attempt) throw new AppError('Attempt not found.', 404, 'ATTEMPT_NOT_FOUND');
    const test = db.prepare('SELECT * FROM Tests WHERE TestId = ?').get(attempt.TestId);
    if (attempt.Status === 'InProgress') attempt = finalizeAttempt(attempt, test, 'Submitted');
    res.json(mapResult(attempt, test));
  }));

  router.get('/attempts/:id/review', asyncHandler((req, res) => {
    const attempt = db.prepare('SELECT * FROM TestAttempts WHERE AttemptId = ? AND UserId = ?').get(req.params.id, req.user.userId);
    if (!attempt) throw new AppError('Attempt not found.', 404, 'ATTEMPT_NOT_FOUND');
    if (attempt.Status === 'InProgress') throw new AppError('Submit the test before viewing solutions.', 400, 'NOT_SUBMITTED');

    const test = db.prepare('SELECT * FROM Tests WHERE TestId = ?').get(attempt.TestId);
    if (!test.AllowReviewAfterSubmit) throw new AppError('Solution review is disabled for this test.', 403, 'REVIEW_DISABLED');

    const ansMap = new Map(db.prepare('SELECT * FROM AttemptAnswers WHERE AttemptId = ?').all(attempt.AttemptId).map((a) => [a.QuestionId, a]));
    const questions = db.prepare(`
      SELECT tq.*, q.SectionName, q.Stem, q.Explanation
      FROM TestQuestions tq JOIN Questions q ON tq.QuestionId = q.QuestionId
      WHERE tq.TestId = ? ORDER BY tq.SortOrder
    `).all(test.TestId).map((tq) => {
      const ans = ansMap.get(tq.QuestionId);
      const options = db.prepare('SELECT OptionId, Text, IsCorrect FROM QuestionOptions WHERE QuestionId = ? ORDER BY SortOrder').all(tq.QuestionId);
      const correctOpt = options.find((o) => o.IsCorrect);
      return {
        questionId: tq.QuestionId,
        sectionName: tq.SectionName,
        stem: tq.Stem,
        explanation: tq.Explanation,
        marks: tq.Marks,
        negativeMarks: tq.NegativeMarks,
        selectedOptionId: ans?.SelectedOptionId || null,
        correctOptionId: correctOpt?.OptionId || null,
        isCorrect: Boolean(ans?.SelectedOptionId && correctOpt && ans.SelectedOptionId === correctOpt.OptionId),
        options: options.map((o) => ({ optionId: o.OptionId, text: o.Text, isCorrect: Boolean(o.IsCorrect) }))
      };
    });

    res.json({ attemptId: attempt.AttemptId, testTitle: test.Title, score: attempt.Score || 0, maxScore: attempt.MaxScore || 0, questions });
  }));

  return router;
}
