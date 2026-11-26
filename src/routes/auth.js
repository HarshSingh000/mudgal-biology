import crypto from 'node:crypto';
import express from 'express';
import { nowIso, uuid } from '../db.js';
import { AppError, asyncHandler, createRateLimiter, hashPassword, issueJwt, normalizePhone, requireAuth, SECURITY_CONFIG, sha256Hex, verifyPassword } from '../security.js';

async function sendOtpSms(phone, otp) {
  const provider = (process.env.SMS_PROVIDER || 'none').trim().toLowerCase();
  const isProd = (process.env.NODE_ENV || 'development') === 'production';

  if (provider === 'none' || !provider) {
    if (isProd) {
      throw new AppError('SMS OTP provider is not configured. Set SMS_PROVIDER and provider keys.', 503, 'SMS_NOT_CONFIGURED');
    }
    return;
  }

  if (provider === 'msg91') {
    const authkey = process.env.MSG91_AUTH_KEY;
    const templateId = process.env.MSG91_TEMPLATE_ID;
    if (!authkey || !templateId) throw new AppError('MSG91 credentials missing.', 503, 'SMS_NOT_CONFIGURED');
    const resp = await fetch(`https://control.msg91.com/api/v5/otp?template_id=${encodeURIComponent(templateId)}&mobile=91${encodeURIComponent(phone)}&otp=${encodeURIComponent(otp)}`, {
      method: 'POST',
      headers: { authkey, 'Content-Type': 'application/json' }
    });
    if (!resp.ok) throw new AppError('Failed to send OTP via MSG91.', 502, 'SMS_DELIVERY_FAILED');
    return;
  }

  if (provider === 'fast2sms') {
    const apiKey = process.env.FAST2SMS_API_KEY;
    if (!apiKey) throw new AppError('Fast2SMS API key missing.', 503, 'SMS_NOT_CONFIGURED');
    const payload = process.env.FAST2SMS_TEMPLATE_ID
      ? {
          route: 'dlt',
          sender_id: process.env.FAST2SMS_SENDER_ID || 'MUDGAL',
          message: process.env.FAST2SMS_TEMPLATE_ID,
          variables_values: otp,
          numbers: phone
        }
      : { route: 'otp', variables_values: otp, numbers: phone };
    const resp = await fetch('https://www.fast2sms.com/dev/bulkV2', {
      method: 'POST',
      headers: { authorization: apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!resp.ok) throw new AppError('Failed to send OTP via Fast2SMS.', 502, 'SMS_DELIVERY_FAILED');
    return;
  }

  if (provider === 'twilio') {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_FROM_NUMBER;
    if (!sid || !token || !from) throw new AppError('Twilio credentials missing.', 503, 'SMS_NOT_CONFIGURED');
    const auth = Buffer.from(`${sid}:${token}`).toString('base64');
    const body = new URLSearchParams({
      To: `+91${phone}`,
      From: from,
      Body: `Your Mudgal Biology verification OTP is ${otp}. Valid for 5 minutes.`
    });
    const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
    if (!resp.ok) throw new AppError('Failed to send OTP via Twilio.', 502, 'SMS_DELIVERY_FAILED');
    return;
  }

  throw new AppError(`Unsupported SMS_PROVIDER: ${provider}`, 500, 'SMS_CONFIG_ERROR');
}

export function createAuthRouter(db) {
  const router = express.Router();
  const otpIpLimiter = createRateLimiter({ windowMs: 10 * 60_000, max: 30, message: 'Too many OTP requests from this IP. Try again later.' });
  const verifyIpLimiter = createRateLimiter({ windowMs: 10 * 60_000, max: 50, message: 'Too many verification attempts. Try again later.' });

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

  const createStudentAccount = ({ phone, fullName, email = null, state = null, passwordHash = null }) => {
    const uid = uuid();
    db.prepare('INSERT INTO Users (UserId, Phone, Email, FullName, PasswordHash, Status, CreatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(uid, phone, email ? String(email).trim() : null, String(fullName || '').trim() || 'Aspirant', passwordHash, 'Active', nowIso());
    const role = db.prepare("SELECT RoleId FROM Roles WHERE Name = 'Student'").get();
    if (role) db.prepare('INSERT INTO UserRoles (UserId, RoleId) VALUES (?, ?)').run(uid, role.RoleId);
    db.prepare('INSERT INTO StudentProfiles (UserId, PreferredLanguage, State, AcceptedTerms, TermsAcceptedAt) VALUES (?, ?, ?, 1, ?)')
      .run(uid, 'en', state ? String(state).trim() : null, nowIso());
    db.prepare('INSERT INTO NotificationPreferences (UserId) VALUES (?)').run(uid);
    return db.prepare('SELECT * FROM Users WHERE UserId = ?').get(uid);
  };

  router.post('/auth/register', verifyIpLimiter, asyncHandler((req, res) => {
    const phone = normalizePhone(req.body?.phone);
    if (phone.length < 10) throw new AppError('Please enter a valid 10-digit mobile number.', 400, 'INVALID_PHONE');
    const fullName = String(req.body?.fullName || '').trim();
    if (!fullName) throw new AppError('Please enter your full name.', 400, 'INVALID_NAME');
    const passwordHash = hashPassword(req.body?.password);

    const existing = db.prepare('SELECT UserId FROM Users WHERE Phone = ?').get(phone);
    if (existing) {
      throw new AppError('This mobile number is already registered. Please sign in with your password.', 409, 'ACCOUNT_EXISTS');
    }

    const user = createStudentAccount({
      phone,
      fullName,
      email: req.body?.email || null,
      state: req.body?.state || null,
      passwordHash
    });
    res.json(issueTokens(user.UserId));
  }));

  router.post('/auth/login', verifyIpLimiter, asyncHandler((req, res) => {
    const phone = normalizePhone(req.body?.phone);
    const password = String(req.body?.password || '');
    if (phone.length < 10 || !password) {
      throw new AppError('Mobile number and password are required.', 400, 'INVALID_CREDENTIALS');
    }
    const user = db.prepare('SELECT * FROM Users WHERE Phone = ?').get(phone);
    if (!user || !user.PasswordHash || !verifyPassword(password, user.PasswordHash)) {
      throw new AppError('Invalid mobile number or password.', 401, 'INVALID_CREDENTIALS');
    }
    if (user.Status === 'Suspended' || user.Status === 'DeletionRequested') {
      throw new AppError('Account is inactive or suspended. Contact support.', 403, 'ACCOUNT_SUSPENDED');
    }
    res.json(issueTokens(user.UserId));
  }));

  router.post('/auth/otp/request', otpIpLimiter, asyncHandler(async (req, res) => {
    const phone = normalizePhone(req.body?.phone);
    if (phone.length < 10) throw new AppError('Please enter a valid 10-digit mobile number.', 400, 'INVALID_PHONE');

    const cooldownSec = Number(process.env.OTP_COOLDOWN_SECONDS ?? ((process.env.NODE_ENV || 'development') === 'production' ? 30 : 0));
    if (cooldownSec > 0) {
      const latest = db.prepare('SELECT CreatedAt FROM OtpChallenges WHERE Phone = ? ORDER BY CreatedAt DESC LIMIT 1').get(phone);
      if (latest && (Date.now() - Date.parse(latest.CreatedAt)) < cooldownSec * 1000) {
        throw new AppError(`Please wait ${cooldownSec} seconds before requesting another OTP.`, 429, 'OTP_COOLDOWN');
      }
    }

    const otp = String(crypto.randomInt(100000, 999999));
    const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
    db.prepare('INSERT INTO OtpChallenges (ChallengeId, Phone, CodeHash, ExpiresAt, Attempts, Consumed, CreatedAt) VALUES (?, ?, ?, ?, 0, 0, ?)')
      .run(uuid(), phone, sha256Hex(otp), expiresAt, nowIso());

    await sendOtpSms(phone, otp);
    const showHint = (process.env.NODE_ENV || 'development') !== 'production';
    res.json({
      message: 'OTP sent successfully.',
      devOtpHint: showHint ? otp : null,
      expiresInSeconds: 300
    });
  }));

  router.post('/auth/otp/verify', verifyIpLimiter, asyncHandler((req, res) => {
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
      user = createStudentAccount({ phone, fullName: req.body?.fullName });
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

  router.post('/me/password', requireAuth, asyncHandler((req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    const user = db.prepare('SELECT * FROM Users WHERE UserId = ?').get(req.user.userId);
    if (!user) throw new AppError('User not found.', 404, 'NOT_FOUND');
    if (user.PasswordHash && !verifyPassword(currentPassword, user.PasswordHash)) {
      throw new AppError('Current password is incorrect.', 401, 'INVALID_CREDENTIALS');
    }
    const nextHash = hashPassword(newPassword);
    db.prepare('UPDATE Users SET PasswordHash = ? WHERE UserId = ?').run(nextHash, req.user.userId);
    res.json({ message: 'Password updated successfully.' });
  }));

  router.post('/me/delete-request', requireAuth, asyncHandler((req, res) => {
    db.prepare("UPDATE Users SET Status = 'DeletionRequested' WHERE UserId = ?").run(req.user.userId);
    db.prepare('UPDATE RefreshTokens SET RevokedAt = ? WHERE UserId = ? AND RevokedAt IS NULL').run(nowIso(), req.user.userId);
    res.json({ message: 'Account deletion request recorded and active sessions revoked.' });
  }));

  return router;
}
