const router = require('express').Router();
const crypto = require('crypto');
const { z } = require('zod');
const { tx } = require('../db');
const { HttpError, auth, validate } = require('../middleware');

const insertPayment = (c, b, status, source, eventId = null) =>
  c.query('INSERT INTO payments(booking_id,amount,status,source,event_id) VALUES($1,$2,$3,$4,$5)',
    [b.id, b.amount, status, source, eventId]);

const setStatus = async (c, id, status) =>
  (await c.query('UPDATE bookings SET status=$2, updated_at=now() WHERE id=$1 RETURNING *', [id, status])).rows[0];

// ---- POST /payments/ : simulated payment (owner only) ----
const paySchema = z.object({
  booking_id: z.number().int().positive(),
  outcome: z.enum(['SUCCESS', 'FAILED']).optional(), // force result (demo/tests); random if omitted
});

router.post('/', auth, validate(paySchema), async (req, res) => {
  const outcome = req.valid.outcome || (Math.random() < 0.8 ? 'SUCCESS' : 'FAILED');
  const result = await tx(async c => {
    const { rows: [b] } = await c.query('SELECT * FROM bookings WHERE id=$1 AND user_id=$2 FOR UPDATE',
      [req.valid.booking_id, req.user.id]);
    if (!b) throw new HttpError(404, 'Booking not found');
    // Only unpaid bookings can be paid; FAILED may be retried.
    if (!['PENDING', 'FAILED'].includes(b.status))
      throw new HttpError(409, `Cannot pay for a ${b.status} booking`);
    await insertPayment(c, b, outcome, 'API');
    return setStatus(c, b.id, outcome === 'SUCCESS' ? 'CONFIRMED' : 'FAILED');
  });
  res.status(201).json({ payment_status: outcome, booking: result });
});

// ---- POST /payments/webhook/ : idempotent provider callback ----
const webhookSchema = z.object({
  event_id: z.string().min(1).max(100),
  booking_id: z.number().int().positive(),
  status: z.enum(['SUCCESS', 'FAILED']),
});

function verifySignature(req) {
  const sig = Buffer.from(String(req.headers['x-signature'] || ''), 'hex');
  const mac = crypto.createHmac('sha256', process.env.WEBHOOK_SECRET).update(req.rawBody || '').digest();
  if (sig.length !== mac.length || !crypto.timingSafeEqual(sig, mac))
    throw new HttpError(401, 'Invalid webhook signature');
}

router.post('/webhook', (req, _res, next) => { verifySignature(req); next(); },
  validate(webhookSchema), async (req, res) => {
    const { event_id, booking_id, status } = req.valid;
    const out = await tx(async c => {
      // Lock the booking first so concurrent events for it are serialized.
      const { rows: [b] } = await c.query('SELECT * FROM bookings WHERE id=$1 FOR UPDATE', [booking_id]);
      if (!b) throw new HttpError(404, 'Booking not found'); // nothing stored -> provider can retry
      // The PK on event_id makes "already processed?" an atomic check.
      const ins = await c.query(
        'INSERT INTO webhook_events(event_id,booking_id,status) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
        [event_id, booking_id, status]);
      if (ins.rowCount === 0) return { duplicate: true, booking_status: b.status };

      let current = b.status;
      if (status === 'SUCCESS' && ['PENDING', 'FAILED'].includes(b.status)) {
        await insertPayment(c, b, 'SUCCESS', 'WEBHOOK', event_id);
        current = (await setStatus(c, b.id, 'CONFIRMED')).status;
      } else if (status === 'FAILED' && b.status === 'PENDING') {
        await insertPayment(c, b, 'FAILED', 'WEBHOOK', event_id);
        current = (await setStatus(c, b.id, 'FAILED')).status;
      } // otherwise: stale/out-of-order event (e.g. CONFIRMED or CANCELLED) -> recorded, state untouched
      return { duplicate: false, booking_status: current };
    });
    res.status(200).json({ received: true, ...out }); // 200 on duplicates so provider stops retrying
  });

module.exports = router;
