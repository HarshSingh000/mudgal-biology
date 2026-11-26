import crypto from 'node:crypto';
import express from 'express';
import { nowIso, uuid } from '../db.js';
import { AppError, asyncHandler, normalizePhone, requireAuth, sha256Hex } from '../security.js';

function timingSafeEqualStr(a, b) {
  const bufA = Buffer.from(String(a || ''));
  const bufB = Buffer.from(String(b || ''));
  if (bufA.length === 0 || bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function verifyMetaSignature(rawBody, signatureHeader, appSecret) {
  if (!appSecret) return true;
  if (!signatureHeader || !String(signatureHeader).startsWith('sha256=')) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  return timingSafeEqualStr(expected, signatureHeader);
}

async function sendWhatsAppTextReply(toDigits, text) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) return;
  try {
    await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(phoneNumberId)}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: toDigits,
        type: 'text',
        text: { body: text }
      })
    });
  } catch { /* non-blocking confirmation */ }
}

export function createWhatsAppRouter(db) {
  const router = express.Router();

  // Meta Webhook Verification (Callback URL)
  router.get('/webhooks/whatsapp', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    const expectedToken = process.env.WHATSAPP_VERIFY_TOKEN || '';

    if (mode === 'subscribe' && expectedToken && timingSafeEqualStr(token, expectedToken)) {
      return res.status(200).type('text/plain').send(String(challenge || ''));
    }
    return res.status(403).json({ error: 'WHATSAPP_WEBHOOK_VERIFY_FAILED' });
  });

  // Meta Incoming WhatsApp Messages & Delivery Updates
  router.post('/webhooks/whatsapp', asyncHandler(async (req, res) => {
    const rawBody = req.rawBody || JSON.stringify(req.body || {});
    const sig = req.headers['x-hub-signature-256'] || '';
    if (!verifyMetaSignature(rawBody, sig, process.env.WHATSAPP_APP_SECRET)) {
      return res.status(401).json({ error: 'INVALID_META_SIGNATURE' });
    }

    const entries = Array.isArray(req.body?.entry) ? req.body.entry : [];
    for (const entry of entries) {
      const changes = Array.isArray(entry?.changes) ? entry.changes : [];
      for (const ch of changes) {
        const messages = Array.isArray(ch?.value?.messages) ? ch.value.messages : [];
        for (const msg of messages) {
          const fromPhone = normalizePhone(msg.from || '');
          const textBody = String(msg.text?.body || '').trim();
          const match = textBody.match(/\bVERIFY\s+(\d{6})\b/i);
          if (fromPhone.length === 10 && match) {
            const code = match[1];
            const challenge = db.prepare('SELECT * FROM OtpChallenges WHERE Phone = ? AND Consumed = 0 ORDER BY CreatedAt DESC LIMIT 1').get(fromPhone);
            if (challenge && challenge.ExpiresAt >= nowIso() && challenge.CodeHash === sha256Hex(code)) {
              db.prepare('UPDATE OtpChallenges SET Consumed = 1 WHERE ChallengeId = ?').run(challenge.ChallengeId);
              db.prepare("UPDATE Users SET IsVerified = 1, VerificationSource = 'WhatsApp' WHERE Phone = ?").run(fromPhone);
              await sendWhatsAppTextReply(msg.from, 'Mudgal Biology: Your student account is now verified!');
            }
          }
        }
      }
    }

    res.json({ received: true });
  }));

  // Generate 6-digit code for inbound "Verify via WhatsApp"
  router.post('/me/whatsapp-verify-code', requireAuth, asyncHandler((req, res) => {
    const phone = normalizePhone(req.user.phone);
    if (phone.length < 10) throw new AppError('Valid mobile number required.', 400, 'INVALID_PHONE');
    const code = String(crypto.randomInt(100000, 999999));
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    db.prepare('INSERT INTO OtpChallenges (ChallengeId, Phone, CodeHash, ExpiresAt, Attempts, Consumed, CreatedAt) VALUES (?, ?, ?, ?, 0, 0, ?)')
      .run(uuid(), phone, sha256Hex(code), expiresAt, nowIso());
    const waNumber = String(process.env.WHATSAPP_BUSINESS_NUMBER || '918949073931').replace(/\D/g, '');
    const waLink = `https://wa.me/${waNumber}?text=${encodeURIComponent(`VERIFY ${code}`)}`;
    res.json({ code, whatsappNumber: waNumber, waLink, expiresInSeconds: 600 });
  }));

  return router;
}
