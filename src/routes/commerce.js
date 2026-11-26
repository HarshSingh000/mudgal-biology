import crypto from 'node:crypto';
import express from 'express';
import { nowIso, uuid } from '../db.js';
import { AppError, asyncHandler, computeHmacSha256, requireAuth, SECURITY_CONFIG, verifyHmacSignature, verifyWebhookSignature } from '../security.js';

function isRazorpayConfigured() {
  return Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}

async function createRazorpayOrder(order) {
  const auth = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64');
  const resp = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: Math.round(Number(order.TotalAmount) * 100),
      currency: order.Currency || 'INR',
      receipt: order.OrderId
    })
  });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    throw new AppError(`Payment gateway order creation failed. ${detail.slice(0, 120)}`.trim(), 502, 'GATEWAY_ERROR');
  }
  return resp.json();
}

export function createCommerceRouter(db) {
  const router = express.Router();

  const mapOrder = (o) => {
    const items = db.prepare('SELECT * FROM OrderItems WHERE OrderId = ?').all(o.OrderId).map((i) => ({
      orderItemId: i.OrderItemId,
      productType: i.ProductType,
      productId: i.ProductId,
      productTitle: i.ProductTitle,
      unitPrice: i.UnitPrice,
      quantity: i.Quantity
    }));
    return {
      orderId: o.OrderId,
      totalAmount: o.TotalAmount,
      currency: o.Currency,
      status: o.Status,
      idempotencyKey: o.IdempotencyKey,
      createdAt: o.CreatedAt,
      items
    };
  };

  const fulfillCapturedOrder = (order, payment) => {
    db.prepare("UPDATE Payments SET Status = 'Captured', VerifiedAt = ? WHERE PaymentId = ?").run(nowIso(), payment.PaymentId);
    db.prepare("UPDATE Orders SET Status = 'Paid' WHERE OrderId = ?").run(order.OrderId);

    const items = db.prepare('SELECT * FROM OrderItems WHERE OrderId = ?').all(order.OrderId);
    const now = Date.now();
    for (const item of items) {
      if (item.ProductType === 'Course') {
        const exists = db.prepare("SELECT 1 FROM Entitlements WHERE UserId = ? AND CourseId = ? AND SourceType = 'Order' AND SourceId = ?")
          .get(order.UserId, item.ProductId, order.OrderId);
        if (!exists) {
          const course = db.prepare('SELECT ValidityDays FROM Courses WHERE CourseId = ?').get(item.ProductId);
          const exp = new Date(now + (course?.ValidityDays || 365) * 86400_000).toISOString();
          db.prepare(`INSERT INTO Entitlements (EntitlementId, UserId, CourseId, StartsAt, ExpiresAt, SourceType, SourceId, Status) VALUES (?, ?, ?, ?, ?, 'Order', ?, 'Active')`)
            .run(uuid(), order.UserId, item.ProductId, nowIso(), exp, order.OrderId);
        }
      } else if (item.ProductType === 'SubscriptionPlan') {
        const subExists = db.prepare('SELECT 1 FROM Subscriptions WHERE SourceOrderId = ? AND PlanId = ?').get(order.OrderId, item.ProductId);
        if (!subExists) {
          const plan = db.prepare('SELECT * FROM SubscriptionPlans WHERE PlanId = ?').get(item.ProductId);
          const subId = uuid();
          const exp = new Date(now + (plan?.DurationDays || 180) * 86400_000).toISOString();
          db.prepare(`INSERT INTO Subscriptions (SubscriptionId, UserId, PlanId, StartsAt, ExpiresAt, Status, SourceOrderId) VALUES (?, ?, ?, ?, ?, 'Active', ?)`)
            .run(subId, order.UserId, item.ProductId, nowIso(), exp, order.OrderId);
          const planCourses = db.prepare('SELECT CourseId FROM SubscriptionPlanCourses WHERE PlanId = ?').all(item.ProductId);
          for (const pc of planCourses) {
            db.prepare(`INSERT INTO Entitlements (EntitlementId, UserId, CourseId, StartsAt, ExpiresAt, SourceType, SourceId, Status) VALUES (?, ?, ?, ?, ?, 'Subscription', ?, 'Active')`)
              .run(uuid(), order.UserId, pc.CourseId, nowIso(), exp, subId);
          }
        }
      }
    }

    db.prepare(`INSERT INTO Notifications (NotificationId, UserId, Title, Body, Type, CreatedAt) VALUES (?, ?, 'Enrollment Confirmed', ?, 'Commerce', ?)`)
      .run(uuid(), order.UserId, `Payment verified for order ${order.OrderId.slice(0, 8)}. Happy learning!`, nowIso());
  };

  const processWebhookCore = (rawBody, signature, dto, provider = 'MockRazorpay') => {
    const isRzp = String(provider).toLowerCase() === 'razorpay';
    if (isRzp) {
      const secret = process.env.RAZORPAY_WEBHOOK_SECRET || SECURITY_CONFIG.webhookSecret;
      if (!verifyHmacSignature(rawBody, signature, secret)) {
        throw new AppError('Invalid Razorpay webhook signature.', 401, 'INVALID_WEBHOOK_SIGNATURE');
      }
      const entity = dto?.payload?.payment?.entity;
      if (!entity?.order_id) throw new AppError('Malformed Razorpay webhook payload.', 400, 'INVALID_WEBHOOK_PAYLOAD');
      const payment = db.prepare('SELECT * FROM Payments WHERE ProviderReference = ?').get(entity.order_id);
      if (!payment) throw new AppError('Payment reference not found.', 404, 'PAYMENT_NOT_FOUND');
      const order = db.prepare('SELECT * FROM Orders WHERE OrderId = ?').get(payment.OrderId);
      if (payment.Status === 'Captured' && order.Status === 'Paid') return mapOrder(order);
      if (Number(entity.amount) !== Math.round(Number(order.TotalAmount) * 100) || String(entity.currency).toUpperCase() !== String(order.Currency).toUpperCase()) {
        throw new AppError('Webhook amount or currency mismatch.', 400, 'AMOUNT_MISMATCH');
      }
      if (dto.event === 'payment.captured' || entity.status === 'captured') {
        fulfillCapturedOrder(order, payment);
      } else if (dto.event === 'payment.failed' || entity.status === 'failed') {
        db.prepare("UPDATE Payments SET Status = 'Failed' WHERE PaymentId = ?").run(payment.PaymentId);
        db.prepare("UPDATE Orders SET Status = 'Failed' WHERE OrderId = ?").run(order.OrderId);
      }
      return mapOrder(db.prepare('SELECT * FROM Orders WHERE OrderId = ?').get(order.OrderId));
    }

    if (!verifyWebhookSignature(rawBody, signature)) {
      throw new AppError('Invalid payment webhook signature.', 401, 'INVALID_WEBHOOK_SIGNATURE');
    }
    const payment = db.prepare('SELECT * FROM Payments WHERE ProviderReference = ? AND OrderId = ?').get(dto.providerReference, dto.orderId);
    if (!payment) throw new AppError('Payment reference not found.', 404, 'PAYMENT_NOT_FOUND');

    const order = db.prepare('SELECT * FROM Orders WHERE OrderId = ?').get(payment.OrderId);
    if (payment.Status === 'Captured' && order.Status === 'Paid') return mapOrder(order);

    if (Number(dto.amount) !== Number(order.TotalAmount) || String(dto.currency).toUpperCase() !== String(order.Currency).toUpperCase()) {
      throw new AppError('Webhook amount or currency mismatch.', 400, 'AMOUNT_MISMATCH');
    }

    const statusNorm = String(dto.status || '').toLowerCase();
    if (statusNorm === 'captured' || statusNorm === 'paid') {
      fulfillCapturedOrder(order, payment);
    } else {
      db.prepare("UPDATE Payments SET Status = 'Failed' WHERE PaymentId = ?").run(payment.PaymentId);
      db.prepare("UPDATE Orders SET Status = 'Failed' WHERE OrderId = ?").run(order.OrderId);
    }

    return mapOrder(db.prepare('SELECT * FROM Orders WHERE OrderId = ?').get(order.OrderId));
  };

  router.get('/subscription-plans', asyncHandler((_req, res) => {
    const plans = db.prepare("SELECT * FROM SubscriptionPlans WHERE Status = 'Active' ORDER BY Price").all();
    res.json(plans.map((p) => {
      const courses = db.prepare('SELECT c.CourseId, c.Title FROM SubscriptionPlanCourses pc JOIN Courses c ON pc.CourseId = c.CourseId WHERE pc.PlanId = ?').all(p.PlanId);
      return {
        planId: p.PlanId,
        name: p.Name,
        description: p.Description,
        price: p.Price,
        currency: p.Currency,
        durationDays: p.DurationDays,
        status: p.Status,
        includedCourseIds: courses.map((c) => c.CourseId),
        includedCourseTitles: courses.map((c) => c.Title)
      };
    }));
  }));

  router.post('/orders', requireAuth, asyncHandler((req, res) => {
    const { productType, productId, idempotencyKey } = req.body || {};
    if (!idempotencyKey || !String(idempotencyKey).trim()) {
      throw new AppError('IdempotencyKey is required.', 400, 'IDEMPOTENCY_KEY_REQUIRED');
    }
    const existing = db.prepare('SELECT * FROM Orders WHERE UserId = ? AND IdempotencyKey = ?').get(req.user.userId, String(idempotencyKey).trim());
    if (existing) return res.json(mapOrder(existing));

    let title, price, currency, normType;
    if (String(productType).toLowerCase() === 'course') {
      normType = 'Course';
      const course = db.prepare("SELECT * FROM Courses WHERE CourseId = ? AND Status = 'Published'").get(productId);
      if (!course) throw new AppError('Course not available for purchase.', 404, 'COURSE_NOT_FOUND');
      title = course.Title; price = course.Price; currency = course.Currency;
    } else if (String(productType).toLowerCase() === 'subscriptionplan') {
      normType = 'SubscriptionPlan';
      const plan = db.prepare("SELECT * FROM SubscriptionPlans WHERE PlanId = ? AND Status = 'Active'").get(productId);
      if (!plan) throw new AppError('Subscription plan not available.', 404, 'PLAN_NOT_FOUND');
      title = plan.Name; price = plan.Price; currency = plan.Currency;
    } else {
      throw new AppError("Invalid ProductType. Use 'Course' or 'SubscriptionPlan'.", 400, 'INVALID_PRODUCT_TYPE');
    }

    const orderId = uuid();
    db.prepare(`INSERT INTO Orders (OrderId, UserId, TotalAmount, Currency, Status, IdempotencyKey, CreatedAt) VALUES (?, ?, ?, ?, 'Pending', ?, ?)`)
      .run(orderId, req.user.userId, price, currency, String(idempotencyKey).trim(), nowIso());
    db.prepare(`INSERT INTO OrderItems (OrderItemId, OrderId, ProductType, ProductId, ProductTitle, UnitPrice, Quantity) VALUES (?, ?, ?, ?, ?, ?, 1)`)
      .run(uuid(), orderId, normType, productId, title, price);

    res.json(mapOrder(db.prepare('SELECT * FROM Orders WHERE OrderId = ?').get(orderId)));
  }));

  router.post('/payments/checkout-session', requireAuth, asyncHandler(async (req, res) => {
    const order = db.prepare('SELECT * FROM Orders WHERE OrderId = ? AND UserId = ?').get(req.body?.orderId, req.user.userId);
    if (!order) throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');
    if (order.Status === 'Paid') throw new AppError('Order is already paid.', 409, 'ORDER_ALREADY_PAID');

    const paymentId = uuid();
    if (isRazorpayConfigured()) {
      const rzpOrder = await createRazorpayOrder(order);
      db.prepare(`INSERT INTO Payments (PaymentId, OrderId, Provider, ProviderReference, Amount, Currency, Status, CreatedAt) VALUES (?, ?, 'Razorpay', ?, ?, ?, 'Initiated', ?)`)
        .run(paymentId, order.OrderId, rzpOrder.id, order.TotalAmount, order.Currency, nowIso());
      return res.json({
        paymentId,
        orderId: order.OrderId,
        provider: 'Razorpay',
        keyId: process.env.RAZORPAY_KEY_ID,
        providerReference: rzpOrder.id,
        amount: order.TotalAmount,
        amountPaise: rzpOrder.amount,
        currency: order.Currency
      });
    }

    if ((process.env.NODE_ENV || 'development') === 'production') {
      throw new AppError('Payment gateway is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.', 503, 'PAYMENT_GATEWAY_NOT_CONFIGURED');
    }

    const reference = `pay_mock_${crypto.randomBytes(6).toString('hex')}`;
    const checkoutUrl = `/app#checkout?orderId=${order.OrderId}&ref=${reference}&amount=${order.TotalAmount}`;
    db.prepare(`INSERT INTO Payments (PaymentId, OrderId, Provider, ProviderReference, Amount, Currency, Status, CreatedAt) VALUES (?, ?, 'MockRazorpay', ?, ?, ?, 'Initiated', ?)`)
      .run(paymentId, order.OrderId, reference, order.TotalAmount, order.Currency, nowIso());

    res.json({ paymentId, orderId: order.OrderId, provider: 'MockRazorpay', providerReference: reference, checkoutUrl, amount: order.TotalAmount, currency: order.Currency });
  }));

  router.post('/payments/razorpay/verify', requireAuth, asyncHandler((req, res) => {
    if (!isRazorpayConfigured()) throw new AppError('Razorpay is not configured.', 503, 'PAYMENT_GATEWAY_NOT_CONFIGURED');
    const { orderId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      throw new AppError('Missing Razorpay verification fields.', 400, 'INVALID_PAYMENT_VERIFICATION');
    }
    const valid = verifyHmacSignature(`${razorpay_order_id}|${razorpay_payment_id}`, razorpay_signature, process.env.RAZORPAY_KEY_SECRET);
    if (!valid) throw new AppError('Invalid Razorpay payment signature.', 401, 'INVALID_PAYMENT_SIGNATURE');

    const payment = db.prepare('SELECT * FROM Payments WHERE ProviderReference = ? AND OrderId = ?').get(razorpay_order_id, orderId);
    if (!payment) throw new AppError('Payment record not found.', 404, 'PAYMENT_NOT_FOUND');
    const order = db.prepare('SELECT * FROM Orders WHERE OrderId = ? AND UserId = ?').get(payment.OrderId, req.user.userId);
    if (!order) throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');

    if (payment.Status === 'Captured' && order.Status === 'Paid') return res.json(mapOrder(order));
    fulfillCapturedOrder(order, payment);
    return res.json(mapOrder(db.prepare('SELECT * FROM Orders WHERE OrderId = ?').get(order.OrderId)));
  }));

  router.post('/payments/webhooks/:provider', asyncHandler((req, res) => {
    const rawBody = req.rawBody || JSON.stringify(req.body || {});
    const signature = req.headers['x-razorpay-signature'] || req.headers['x-webhook-signature'] || '';
    res.json(processWebhookCore(rawBody, signature, req.body || {}, req.params.provider));
  }));

  router.post('/payments/sandbox/simulate', requireAuth, asyncHandler((req, res) => {
    if ((process.env.NODE_ENV || 'development') === 'production') return res.status(404).end();
    const rawBody = JSON.stringify(req.body || {});
    const sig = computeHmacSha256(rawBody, SECURITY_CONFIG.webhookSecret);
    res.json(processWebhookCore(rawBody, sig, req.body || {}, 'MockRazorpay'));
  }));

  router.get('/me/orders', requireAuth, asyncHandler((req, res) => {
    const orders = db.prepare('SELECT * FROM Orders WHERE UserId = ? ORDER BY CreatedAt DESC').all(req.user.userId);
    res.json(orders.map(mapOrder));
  }));

  router.get('/me/subscriptions', requireAuth, asyncHandler((req, res) => {
    const rows = db.prepare('SELECT s.*, p.Name AS PlanName FROM Subscriptions s JOIN SubscriptionPlans p ON s.PlanId = p.PlanId WHERE s.UserId = ? ORDER BY s.StartsAt DESC').all(req.user.userId);
    res.json(rows.map((s) => ({
      subscriptionId: s.SubscriptionId, planId: s.PlanId, planName: s.PlanName, startsAt: s.StartsAt, expiresAt: s.ExpiresAt, status: s.Status
    })));
  }));

  router.get('/me/entitlements', requireAuth, asyncHandler((req, res) => {
    const rows = db.prepare('SELECT e.*, c.Title AS CourseTitle FROM Entitlements e JOIN Courses c ON e.CourseId = c.CourseId WHERE e.UserId = ? ORDER BY e.StartsAt DESC').all(req.user.userId);
    res.json(rows.map((e) => ({
      entitlementId: e.EntitlementId, courseId: e.CourseId, courseTitle: e.CourseTitle, startsAt: e.StartsAt, expiresAt: e.ExpiresAt, sourceType: e.SourceType, status: e.Status
    })));
  }));

  return router;
}
