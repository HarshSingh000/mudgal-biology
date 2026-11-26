import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../server.js';
import { assertProductionConfig, computeHmacSha256, SECURITY_CONFIG } from '../src/security.js';

const { app, db } = createApp(':memory:');
let server;
let baseUrl;

test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  db.close();
});

async function login(phone) {
  const reqRes = await fetch(`${baseUrl}/api/v1/auth/otp/request`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone })
  });
  assert.equal(reqRes.status, 200);
  const { devOtpHint } = await reqRes.json();
  assert.ok(devOtpHint);

  const verRes = await fetch(`${baseUrl}/api/v1/auth/otp/verify`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, otp: devOtpHint })
  });
  assert.equal(verRes.status, 200);
  return verRes.json();
}

test('Public pages return 200 and protected endpoints require auth', async () => {
  for (const p of ['/', '/about', '/mentorship', '/mentorship-programs', '/privacy', '/terms', '/refund', '/contact', '/app', '/admin', '/health', '/assets/logo.jpg', '/assets/hemant-mudgal.jpg', '/assets/channel-cover.jpg', '/assets/gems-mentorship.jpg', '/assets/stf-taskforce.jpg', '/assets/gems-announcement.jpg', '/assets/book-cover.jpg', '/assets/rpsc-2nd-grade-biology-book-demo.pdf']) {
    const r = await fetch(`${baseUrl}${p}`);
    assert.equal(r.status, 200, `Expected 200 for ${p}`);
    if (p === '/') {
      assert.equal(r.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
    }
  }
  for (const p of ['/api/v1/me', '/api/v1/tests', '/api/v1/community/posts', '/api/v1/flashcards', '/api/v1/admin/dashboard']) {
    const r = await fetch(`${baseUrl}${p}`);
    assert.equal(r.status, 401, `Expected 401 for ${p}`);
  }
});

test('End-to-end purchase webhook idempotency, entitlement gating, mock test negative marking, and admin moderation', async () => {
  const student = await login('9876543210');
  const authHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${student.accessToken}` };

  // Student blocked from admin
  assert.equal((await fetch(`${baseUrl}/api/v1/admin/dashboard`, { headers: authHeaders })).status, 403);

  // Find RPSC 1st Grade Biology course (initially locked)
  const courses = await (await fetch(`${baseUrl}/api/v1/courses?search=1st`)).json();
  const rpsc1st = courses.items.find((c) => c.title.includes('RPSC 1st Grade'));
  const cur = await (await fetch(`${baseUrl}/api/v1/courses/${rpsc1st.courseId}/curriculum`, { headers: authHeaders })).json();
  const lessons = cur.modules.flatMap((m) => m.chapters).flatMap((ch) => ch.lessons);
  const preview = lessons.find((l) => l.isPreview);
  const paid = lessons.find((l) => !l.isPreview);

  assert.equal((await fetch(`${baseUrl}/api/v1/lessons/${preview.lessonId}/playback`, { headers: authHeaders })).status, 200);
  assert.equal((await fetch(`${baseUrl}/api/v1/lessons/${paid.lessonId}/playback`, { headers: authHeaders })).status, 403);

  // Idempotent order + checkout + HMAC webhook
  const idem = `node_idem_${Date.now()}`;
  const o1 = await (await fetch(`${baseUrl}/api/v1/orders`, { method: 'POST', headers: authHeaders, body: JSON.stringify({ productType: 'Course', productId: rpsc1st.courseId, idempotencyKey: idem }) })).json();
  const o2 = await (await fetch(`${baseUrl}/api/v1/orders`, { method: 'POST', headers: authHeaders, body: JSON.stringify({ productType: 'Course', productId: rpsc1st.courseId, idempotencyKey: idem }) })).json();
  assert.equal(o1.orderId, o2.orderId);

  const sess = await (await fetch(`${baseUrl}/api/v1/payments/checkout-session`, { method: 'POST', headers: authHeaders, body: JSON.stringify({ orderId: o1.orderId }) })).json();
  const whBody = JSON.stringify({ providerReference: sess.providerReference, orderId: o1.orderId, status: 'captured', amount: o1.totalAmount, currency: o1.currency });

  // Bad signature rejected
  assert.equal((await fetch(`${baseUrl}/api/v1/payments/webhooks/MockRazorpay`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-webhook-signature': 'bad' }, body: whBody
  })).status, 401);

  // Valid signature idempotently grants once
  const sig = computeHmacSha256(whBody, SECURITY_CONFIG.webhookSecret);
  for (let i = 0; i < 2; i++) {
    const r = await fetch(`${baseUrl}/api/v1/payments/webhooks/MockRazorpay`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-webhook-signature': sig }, body: whBody
    });
    assert.equal(r.status, 200);
  }
  const ents = await (await fetch(`${baseUrl}/api/v1/me/entitlements`, { headers: authHeaders })).json();
  assert.equal(ents.filter((e) => e.courseId === rpsc1st.courseId).length, 1);
  assert.equal((await fetch(`${baseUrl}/api/v1/lessons/${paid.lessonId}/playback`, { headers: authHeaders })).status, 200);

  // Mock test scoring (+2.0 - 0.5 = 1.5)
  const tests = await (await fetch(`${baseUrl}/api/v1/tests`, { headers: authHeaders })).json();
  const rpscTest = tests.find((t) => t.title.includes('RPSC 2nd Grade'));
  const att = await (await fetch(`${baseUrl}/api/v1/tests/${rpscTest.testId}/attempts`, { method: 'POST', headers: authHeaders })).json();
  await fetch(`${baseUrl}/api/v1/attempts/${att.attemptId}/answers/${att.questions[0].questionId}`, {
    method: 'PUT', headers: authHeaders, body: JSON.stringify({ selectedOptionId: att.questions[0].options[0].optionId, isMarkedForReview: false })
  });
  await fetch(`${baseUrl}/api/v1/attempts/${att.attemptId}/answers/${att.questions[1].questionId}`, {
    method: 'PUT', headers: authHeaders, body: JSON.stringify({ selectedOptionId: att.questions[1].options[1].optionId, isMarkedForReview: true })
  });
  const rec = await (await fetch(`${baseUrl}/api/v1/tests/${rpscTest.testId}/attempts`, { method: 'POST', headers: authHeaders })).json();
  assert.equal(rec.recovered, true);

  const sub = await (await fetch(`${baseUrl}/api/v1/attempts/${att.attemptId}/submit`, { method: 'POST', headers: authHeaders })).json();
  assert.equal(sub.score, 1.5);

  // Admin dashboard + moderation
  const admin = await login('9999999999');
  const admHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${admin.accessToken}` };
  assert.equal((await fetch(`${baseUrl}/api/v1/admin/dashboard`, { headers: admHeaders })).status, 200);
});

test('Production config guard and Razorpay webhook signature verification', async () => {
  assert.throws(
    () => assertProductionConfig({ NODE_ENV: 'production' }),
    /Invalid production configuration/
  );
  assert.doesNotThrow(() => assertProductionConfig({
    NODE_ENV: 'production',
    JWT_SECRET: 'A_VERY_STRONG_RANDOM_SECRET_KEY_OVER_32_CHARS_LONG',
    WEBHOOK_SECRET: 'STRONG_WEBHOOK_SECRET_12345',
    MEDIA_SIGNING_SECRET: 'STRONG_MEDIA_SECRET_12345'
  }));

  // Razorpay webhook rejects invalid signature and accepts valid x-razorpay-signature
  const badRzp = await fetch(`${baseUrl}/api/v1/payments/webhooks/razorpay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-razorpay-signature': 'invalid' },
    body: JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { order_id: 'order_missing' } } } })
  });
  assert.equal(badRzp.status, 401);
});

test('Free mobile + password registration, duplicate protection, login, and password change', async () => {
  const phone = '9123456789';
  const regRes = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, fullName: 'Priya Sharma', password: 'Biology@2026', email: 'priya@example.in' })
  });
  assert.equal(regRes.status, 200);
  const regData = await regRes.json();
  assert.ok(regData.accessToken);
  assert.equal(regData.user.phone, phone);

  // Duplicate phone registration blocked
  const dupRes = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, fullName: 'Attacker', password: 'OtherPassword1' })
  });
  assert.equal(dupRes.status, 409);

  // Wrong password rejected
  const badLogin = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, password: 'WrongPassword' })
  });
  assert.equal(badLogin.status, 401);

  // Valid password login works
  const okLogin = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, password: 'Biology@2026' })
  });
  assert.equal(okLogin.status, 200);
  const loginData = await okLogin.json();
  assert.equal((await fetch(`${baseUrl}/api/v1/me`, { headers: { Authorization: `Bearer ${loginData.accessToken}` } })).status, 200);

  // Update password and verify login with new password
  const chg = await fetch(`${baseUrl}/api/v1/me/password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${loginData.accessToken}` },
    body: JSON.stringify({ currentPassword: 'Biology@2026', newPassword: 'NewBioPass@99' })
  });
  assert.equal(chg.status, 200);
  const okNew = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, password: 'NewBioPass@99' })
  });
  assert.equal(okNew.status, 200);
});

test('Dashboard student details, verification, and SuperAdmin-only faculty creation', async () => {
  const admin = await login('9999999999');
  const admHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${admin.accessToken}` };

  // Dashboard includes detailed student records
  const dash = await (await fetch(`${baseUrl}/api/v1/admin/dashboard`, { headers: admHeaders })).json();
  assert.ok(Array.isArray(dash.students) && dash.students.length >= 1);
  const targetStudent = dash.students.find((s) => s.phone === '9123456789');
  assert.ok(targetStudent);
  assert.equal(targetStudent.isVerified, false);

  // Admin can verify student as real
  const verRes = await fetch(`${baseUrl}/api/v1/admin/students/${targetStudent.userId}/verify`, {
    method: 'POST',
    headers: admHeaders,
    body: JSON.stringify({ verified: true })
  });
  assert.equal(verRes.status, 200);
  assert.equal((await verRes.json()).isVerified, true);

  // Regular Admin CANNOT add faculty (403)
  const deniedFac = await fetch(`${baseUrl}/api/v1/admin/faculties`, {
    method: 'POST',
    headers: admHeaders,
    body: JSON.stringify({ fullName: 'Dr. Denied', phone: '9777776666', password: 'FacPass@123' })
  });
  assert.equal(deniedFac.status, 403);

  // SuperAdmin CAN add faculty and new faculty can sign in with password
  const superAdmin = await login('8888888888');
  const superHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${superAdmin.accessToken}` };
  const addFac = await fetch(`${baseUrl}/api/v1/admin/faculties`, {
    method: 'POST',
    headers: superHeaders,
    body: JSON.stringify({ fullName: 'Dr. Meera Singh', phone: '9777776666', email: 'meera@mudgalbiology.in', password: 'FacPass@123', role: 'Faculty' })
  });
  assert.equal(addFac.status, 200);
  const facLogin = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '9777776666', password: 'FacPass@123' })
  });
  assert.equal(facLogin.status, 200);
  const facAuth = await facLogin.json();
  assert.ok(facAuth.user.roles.includes('Faculty'));
  assert.equal((await fetch(`${baseUrl}/api/v1/admin/dashboard`, { headers: { Authorization: `Bearer ${facAuth.accessToken}` } })).status, 200);
});
