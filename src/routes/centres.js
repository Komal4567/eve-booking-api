const router = require('express').Router();
const { z } = require('zod');
const { pool } = require('../db');
const { HttpError, auth, adminOnly, validate } = require('../middleware');

const page = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
const idParam = z.object({ id: z.coerce.number().int().positive() });

router.get('/centres', validate(page, 'query'), async (req, res) => {
  const { limit, offset } = req.valid;
  const { rows } = await pool.query('SELECT * FROM centres ORDER BY id LIMIT $1 OFFSET $2', [limit, offset]);
  res.json({ data: rows, limit, offset });
});

router.get('/centres/:id', validate(idParam, 'params'), async (req, res) => {
  const { rows: [c] } = await pool.query(
    `SELECT c.*, COALESCE(json_agg(json_build_object('test_id',t.id,'name',t.name,'price',ct.price))
       FILTER (WHERE t.id IS NOT NULL), '[]') AS tests
     FROM centres c LEFT JOIN centre_tests ct ON ct.centre_id=c.id
     LEFT JOIN tests t ON t.id=ct.test_id WHERE c.id=$1 GROUP BY c.id`, [req.valid.id]);
  if (!c) throw new HttpError(404, 'Centre not found');
  res.json(c);
});

router.get('/tests', async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM tests ORDER BY name');
  res.json({ data: rows });
});

// ---- admin-only management ----
router.post('/centres', auth, adminOnly,
  validate(z.object({ name: z.string().trim().min(1), location: z.string().trim().min(1) })),
  async (req, res) => {
    const { rows: [c] } = await pool.query(
      'INSERT INTO centres(name,location) VALUES($1,$2) RETURNING *', [req.valid.name, req.valid.location]);
    res.status(201).json(c);
  });

router.post('/tests', auth, adminOnly, validate(z.object({ name: z.string().trim().min(1) })),
  async (req, res) => {
    try {
      const { rows: [t] } = await pool.query('INSERT INTO tests(name) VALUES($1) RETURNING *', [req.valid.name]);
      res.status(201).json(t);
    } catch (e) {
      if (e.code === '23505') throw new HttpError(409, 'Test already exists');
      throw e;
    }
  });

// Offer (or re-price) a test at a centre
router.put('/centres/:id/tests', auth, adminOnly, validate(idParam, 'params'), async (req, res, next) => {
  const body = z.object({ test_id: z.number().int().positive(), price: z.number().min(0) }).safeParse(req.body);
  if (!body.success) return next(Object.assign(new HttpError(400, 'Validation failed'), { details: body.error.issues }));
  try {
    const { rows: [r] } = await pool.query(
      `INSERT INTO centre_tests(centre_id,test_id,price) VALUES($1,$2,$3)
       ON CONFLICT (centre_id,test_id) DO UPDATE SET price=EXCLUDED.price RETURNING *`,
      [req.valid.id, body.data.test_id, body.data.price]);
    res.json(r);
  } catch (e) {
    if (e.code === '23503') throw new HttpError(404, 'Centre or test not found');
    throw e;
  }
});

module.exports = router;
