const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const { pool } = require('../db');
const { HttpError, validate } = require('../middleware');

const signupSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(100),
});
const loginSchema = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1) });

const token = u => jwt.sign({ sub: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '1h' });

router.post('/signup', validate(signupSchema), async (req, res) => {
  const { name, email, password } = req.valid;
  const admins = (process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase());
  const role = admins.includes(email) ? 'admin' : 'user';
  try {
    const { rows: [u] } = await pool.query(
      'INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id,name,email,role',
      [name, email, await bcrypt.hash(password, 10), role]);
    res.status(201).json({ user: u, token: token(u) });
  } catch (e) {
    if (e.code === '23505') throw new HttpError(409, 'Email already registered');
    throw e;
  }
});

router.post('/login', validate(loginSchema), async (req, res) => {
  const { rows: [u] } = await pool.query('SELECT * FROM users WHERE email=$1', [req.valid.email]);
  if (!u || !(await bcrypt.compare(req.valid.password, u.password_hash)))
    throw new HttpError(401, 'Invalid credentials');
  res.json({ token: token(u) });
});

module.exports = router;
