const router = require('express').Router();
const { z } = require('zod');
const { pool, tx } = require('../db');
const { HttpError, auth, validate } = require('../middleware');

router.use(auth);
const idParam = z.object({ id: z.coerce.number().int().positive() });
const createSchema = z.object({
  centre_id: z.number().int().positive(),
  test_id: z.number().int().positive(),
  appointment_at: z.string().datetime({ offset: true })
    .refine(d => new Date(d) > new Date(), 'Appointment must be in the future'),
});
const page = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

router.post('/', validate(createSchema), async (req, res) => {
  const { centre_id, test_id, appointment_at } = req.valid;
  const { rows: [ct] } = await pool.query(
    'SELECT price FROM centre_tests WHERE centre_id=$1 AND test_id=$2', [centre_id, test_id]);
  if (!ct) throw new HttpError(404, 'This centre does not offer that test');
  const { rows: [b] } = await pool.query(
    `INSERT INTO bookings(user_id,centre_id,test_id,appointment_at,amount)
     VALUES($1,$2,$3,$4,$5) RETURNING *`, [req.user.id, centre_id, test_id, appointment_at, ct.price]);
  res.status(201).json(b);
});

router.get('/', validate(page, 'query'), async (req, res) => {
  const { limit, offset } = req.valid;
  const { rows } = await pool.query(
    'SELECT * FROM bookings WHERE user_id=$1 ORDER BY id DESC LIMIT $2 OFFSET $3', [req.user.id, limit, offset]);
  res.json({ data: rows, limit, offset });
});

// Someone else's booking returns 404 (not 403) so IDs can't be probed.
router.get('/:id', validate(idParam, 'params'), async (req, res) => {
  const { rows: [b] } = await pool.query('SELECT * FROM bookings WHERE id=$1 AND user_id=$2',
    [req.valid.id, req.user.id]);
  if (!b) throw new HttpError(404, 'Booking not found');
  res.json(b);
});

router.patch('/:id/cancel', validate(idParam, 'params'), async (req, res) => {
  const b = await tx(async c => {
    const { rows: [b] } = await c.query('SELECT * FROM bookings WHERE id=$1 AND user_id=$2 FOR UPDATE',
      [req.valid.id, req.user.id]);
    if (!b) throw new HttpError(404, 'Booking not found');
    if (b.status === 'CANCELLED') throw new HttpError(409, 'Booking already cancelled');
    const { rows: [u] } = await c.query(
      "UPDATE bookings SET status='CANCELLED', updated_at=now() WHERE id=$1 RETURNING *", [b.id]);
    return u;
  });
  res.json(b);
});

module.exports = router;
