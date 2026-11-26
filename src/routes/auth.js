import crypto from 'node:crypto';
import express from 'express';
import { nowIso, uuid } from '../db.js';
import { AppError, asyncHandler, issueJwt, normalizePhone, requireAuth, SECURITY_CONFIG, sha256Hex } from '../security.js';

export function createAuthRouter(db) {
  const router = express.Router();

  const getProfile = (userId) => {
    const u = db.prepare(`
      SELECT u.*, sp.PreferredLanguage, sp.State, sp.TargetExamId, sp.AcceptedTerms, e.Name AS TargetExamName
      FROM Users u
      LEFT JOIN StudentProfiles sp ON u.UserId = sp.UserId
      LEFT JOIN Exams e ON sp.TargetExamId = e.ExamId
      WHERE u.UserId = ?
    `).get(userId);
    if (!u) throw new AppError('User not found.', 404, 'NOT_FOUND');
    const roles = db.prepare(`
      SELECT r.Name FROM UserRoles ur JOIN Roles r ON ur.RoleId = r.RoleId WHERE ur.UserId = ?
    `).all(userId).map((r) => r.Name);
    return {
      userId: u.UserId,
      phone: u.Phone,
      email: u.Email,
      fullName: u.FullName,
      status: u.Status,
      roles,
      preferredLanguage: u.PreferredLanguage || 'en',
      state: u.State,
      targetExamId: u.TargetExamId,
      targetExamName: u.TargetExamName,
      acceptedTerms: Boolean(u.AcceptedTerms)
    };
  };

  const issueTokens = (userId) => {
    const u = db.prepare('SELECT * FROM Users WHERE UserId = ?').get(userId);
    const roles = db.prepare('SELECT r.Name FROM UserRoles ur JOIN Roles r ON ur.RoleId = r.RoleId WHERE ur.UserId = ?').all(userId).map((r) => r.Name);
    const { accessToken, expiresAt } = issueJwt(u, roles);
    const rawRefresh = crypto.randomBytes(48).toString('base64');
    const expRefresh = new Date(Date.now() + 30 * 86400_000).toISOString();
    db.prepare('INSERT INTO RefreshTokens (TokenId, UserId, TokenHash, ExpiresAt, CreatedAt) VALUES (?, ?, ?, ?, ?)')
      .run(uuid(), userId, sha256Hex(rawRefresh), expRefresh, nowIso());
    return { accessToken, refreshToken: rawRefresh, expiresAt, user: getProfile(userId) };
  };

  router.post('/auth/otp/request', asyncHandler((req, res) => {
    const phone = normalizePhone(req.body?.phone);
    if (phone.length < 10) throw new AppError('Please enter a valid 10-digit mobile number.', 400, 'INVALID_PHONE');
    const otp = String(crypto.randomInt(100000, 999999));
    const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
    db.prepare('INSERT INTO OtpChallenges (ChallengeId, Phone, CodeHash, ExpiresAt, Attempts, Consumed, CreatedAt) VALUES (?, ?, ?, ?, 0, 0, ?)')
      .run(uuid(), phone, sha256Hex(otp), expiresAt, nowIso());
    res.json({
      message: 'OTP sent successfully.',
      devOtpHint: SECURITY_CONFIG.isDev ? otp : null,
      expiresInSeconds: 300
    });
  }));

  router.post('/auth/otp/verify', asyncHandler((req, res) => {
    const phone = normalizePhone(req.body?.phone);
    const otp = String(req.body?.otp || '').trim();
    const challenge = db.prepare('SELECT * FROM OtpChallenges WHERE Phone = ? AND Consumed = 0 ORDER BY CreatedAt DESC LIMIT 1').get(phone);
    if (!challenge || challenge.ExpiresAt < nowIso()) throw new AppError('OTP expired or not requested.', 400, 'OTP_EXPIRED');
    if (challenge.Attempts >= 5) throw new AppError('Maximum OTP attempts exceeded.', 429, 'OTP_LOCKED');

    db.prepare('UPDATE OtpChallenges SET Attempts = Attempts + 1 WHERE ChallengeId = ?').run(challenge.ChallengeId);
    if (challenge.CodeHash !== sha256Hex(otp)) throw new AppError('Invalid OTP code.', 401, 'INVALID_OTP');
    db.prepare('UPDATE OtpChallenges SET Consumed = 1 WHERE ChallengeId = ?').run(challenge.ChallengeId);

    let user = db.prepare('SELECT * FROM Users WHERE Phone = ?').get(phone);
    if (!user) {
      const uid = uuid();
      const fullName = String(req.body?.fullName || '').trim() || 'Aspirant';
      db.prepare('INSERT INTO Users (UserId, Phone, FullName, Status, CreatedAt) VALUES (?, ?, ?, ?, ?)').run(uid, phone, fullName, 'Active', nowIso());
      const role = db.prepare("SELECT RoleId FROM Roles WHERE Name = 'Student'").get();
      if (role) db.prepare('INSERT INTO UserRoles (UserId, RoleId) VALUES (?, ?)').run(uid, role.RoleId);
      db.prepare('INSERT INTO StudentProfiles (UserId, PreferredLanguage, AcceptedTerms, TermsAcceptedAt) VALUES (?, ?, 1, ?)').run(uid, 'en', nowIso());
      db.prepare('INSERT INTO NotificationPreferences (UserId) VALUES (?)').run(uid);
      user = db.prepare('SELECT * FROM Users WHERE UserId = ?').get(uid);
    } else if (user.Status === 'Suspended') {
      throw new AppError('Account is suspended. Contact support.', 403, 'ACCOUNT_SUSPENDED');
    }

    res.json(issueTokens(user.UserId));
  }));

  router.post('/auth/refresh', asyncHandler((req, res) => {
    const raw = String(req.body?.refreshToken || '');
    const token = db.prepare('SELECT * FROM RefreshTokens WHERE TokenHash = ?').get(sha256Hex(raw));
    if (!token || token.RevokedAt || token.ExpiresAt < nowIso()) throw new AppError('Invalid or expired refresh token.', 401, 'INVALID_REFRESH_TOKEN');
    db.prepare('UPDATE RefreshTokens SET RevokedAt = ? WHERE TokenId = ?').run(nowIso(), token.TokenId);
    res.json(issueTokens(token.UserId));
  }));

  router.post('/auth/logout', requireAuth, asyncHandler((req, res) => {
    const raw = req.body?.refreshToken;
    if (raw) {
      db.prepare('UPDATE RefreshTokens SET RevokedAt = ? WHERE UserId = ? AND TokenHash = ?').run(nowIso(), req.user.userId, sha256Hex(raw));
    } else {
      db.prepare('UPDATE RefreshTokens SET RevokedAt = ? WHERE UserId = ? AND RevokedAt IS NULL').run(nowIso(), req.user.userId);
    }
    res.status(204).end();
  }));

  router.get('/me', requireAuth, asyncHandler((req, res) => {
    res.json(getProfile(req.user.userId));
  }));

  router.patch('/me/profile', requireAuth, asyncHandler((req, res) => {
    const { fullName, email, state, preferredLanguage } = req.body || {};
    if (fullName && String(fullName).trim()) {
      db.prepare('UPDATE Users SET FullName = ? WHERE UserId = ?').run(String(fullName).trim(), req.user.userId);
    }
    if (email !== undefined) {
      db.prepare('UPDATE Users SET Email = ? WHERE UserId = ?').run(email ? String(email).trim() : null, req.user.userId);
    }
    if (state !== undefined) {
      db.prepare('UPDATE StudentProfiles SET State = ? WHERE UserId = ?').run(state ? String(state).trim() : null, req.user.userId);
    }
    if (preferredLanguage) {
      db.prepare('UPDATE StudentProfiles SET PreferredLanguage = ? WHERE UserId = ?').run(String(preferredLanguage).trim(), req.user.userId);
    }
    res.json(getProfile(req.user.userId));
  }));

  router.put('/me/exam-preferences', requireAuth, asyncHandler((req, res) => {
    const { targetExamId, preferredLanguage } = req.body || {};
    const exam = db.prepare('SELECT * FROM Exams WHERE ExamId = ? AND IsActive = 1').get(targetExamId);
    if (!exam) throw new AppError('Selected exam does not exist or is inactive.', 404, 'EXAM_NOT_FOUND');
    db.prepare(`
      INSERT INTO StudentProfiles (UserId, TargetExamId, PreferredLanguage, AcceptedTerms, TermsAcceptedAt)
      VALUES (?, ?, ?, 1, ?)
      ON CONFLICT(UserId) DO UPDATE SET TargetExamId = excluded.TargetExamId, PreferredLanguage = COALESCE(excluded.PreferredLanguage, StudentProfiles.PreferredLanguage)
    `).run(req.user.userId, exam.ExamId, preferredLanguage || 'en', nowIso());
    res.json(getProfile(req.user.userId));
  }));

  router.post('/me/delete-request', requireAuth, asyncHandler((req, res) => {
    db.prepare("UPDATE Users SET Status = 'DeletionRequested' WHERE UserId = ?").run(req.user.userId);
    db.prepare('UPDATE RefreshTokens SET RevokedAt = ? WHERE UserId = ? AND RevokedAt IS NULL').run(nowIso(), req.user.userId);
    res.json({ message: 'Account deletion request recorded and active sessions revoked.' });
  }));

  return router;
}
