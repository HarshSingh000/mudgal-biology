import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

export const SECURITY_CONFIG = {
  jwtSecret: process.env.JWT_SECRET || 'DEV_ONLY_REPLACE_WITH_MIN_32_CHAR_SECRET_KEY_2026!',
  jwtIssuer: process.env.JWT_ISSUER || 'ExamPlatform',
  jwtAudience: process.env.JWT_AUDIENCE || 'ExamPlatformClients',
  webhookSecret: process.env.WEBHOOK_SECRET || 'DEV_WEBHOOK_SECRET_KEY_2026',
  mediaSigningSecret: process.env.MEDIA_SIGNING_SECRET || 'DEV_MEDIA_SIGNING_SECRET_2026',
  isDev: (process.env.NODE_ENV || 'development') !== 'production'
};

export class AppError extends Error {
  constructor(message, statusCode = 400, errorCode = 'BAD_REQUEST') {
    super(message);
    this.statusCode = statusCode;
    this.errorCode = errorCode;
  }
}

export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

export function normalizePhone(raw = '') {
  let digits = String(raw).replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  return digits;
}

export function sha256Hex(raw) {
  return crypto.createHash('sha256').update(String(raw)).digest('hex');
}

export function computeHmacSha256(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex').toLowerCase();
}

export function verifyWebhookSignature(rawPayload, signatureHeader) {
  if (!signatureHeader) return false;
  const expected = computeHmacSha256(rawPayload, SECURITY_CONFIG.webhookSecret);
  const actual = String(signatureHeader).trim().toLowerCase();
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}

export function createSignedMediaUrl(assetId, ttlSeconds = 900) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = computeHmacSha256(`${assetId}:${exp}`, SECURITY_CONFIG.mediaSigningSecret);
  return {
    url: `/api/v1/media/stream/${encodeURIComponent(assetId)}?exp=${exp}&sig=${sig}`,
    expiresAt: new Date(exp * 1000).toISOString()
  };
}

export function createSignedResourceUrl(storageKey, ttlSeconds = 600) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = computeHmacSha256(`${storageKey}:${exp}`, SECURITY_CONFIG.mediaSigningSecret);
  return {
    url: `/api/v1/media/resource?key=${encodeURIComponent(storageKey)}&exp=${exp}&sig=${sig}`,
    expiresAt: new Date(exp * 1000).toISOString()
  };
}

export function verifyMediaSignature(payload, exp, sig) {
  const expNum = Number(exp);
  if (!sig || !Number.isFinite(expNum) || Math.floor(Date.now() / 1000) > expNum) return false;
  const expected = computeHmacSha256(payload, SECURITY_CONFIG.mediaSigningSecret);
  const actual = String(sig).trim().toLowerCase();
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}

export function issueJwt(user, roles) {
  const expiresInSeconds = 4 * 3600;
  const token = jwt.sign(
    {
      sub: user.UserId,
      name: user.FullName,
      phone: user.Phone,
      roles
    },
    SECURITY_CONFIG.jwtSecret,
    {
      issuer: SECURITY_CONFIG.jwtIssuer,
      audience: SECURITY_CONFIG.jwtAudience,
      expiresIn: expiresInSeconds
    }
  );
  return {
    accessToken: token,
    expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString()
  };
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Authentication token required.' });
  }
  const token = header.slice(7).trim();
  try {
    const payload = jwt.verify(token, SECURITY_CONFIG.jwtSecret, {
      issuer: SECURITY_CONFIG.jwtIssuer,
      audience: SECURITY_CONFIG.jwtAudience
    });
    req.user = {
      userId: payload.sub,
      name: payload.name,
      phone: payload.phone,
      roles: Array.isArray(payload.roles) ? payload.roles : []
    };
    return next();
  } catch {
    return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Invalid or expired access token.' });
  }
}

export function optionalAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(header.slice(7).trim(), SECURITY_CONFIG.jwtSecret, {
        issuer: SECURITY_CONFIG.jwtIssuer,
        audience: SECURITY_CONFIG.jwtAudience
      });
      req.user = {
        userId: payload.sub,
        name: payload.name,
        phone: payload.phone,
        roles: Array.isArray(payload.roles) ? payload.roles : []
      };
    } catch { /* ignore invalid optional token */ }
  }
  next();
}

export function requireRoles(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Authentication required.' });
    }
    const ok = req.user.roles.some((r) => allowedRoles.includes(r));
    if (!ok) {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Insufficient role permissions.' });
    }
    return next();
  };
}
