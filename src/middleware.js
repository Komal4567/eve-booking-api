const jwt = require('jsonwebtoken');

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const auth = (req, _res, next) => {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) throw new HttpError(401, 'Missing bearer token');
  try {
    const p = jwt.verify(h.slice(7), process.env.JWT_SECRET);
    req.user = { id: Number(p.sub), role: p.role };
    next();
  } catch { throw new HttpError(401, 'Invalid or expired token'); }
};

const adminOnly = (req, _res, next) => {
  if (req.user.role !== 'admin') throw new HttpError(403, 'Admin only');
  next();
};

// validate(schema, 'body'|'query'|'params') -> req.valid
const validate = (schema, src = 'body') => (req, _res, next) => {
  const r = schema.safeParse(req[src]);
  if (!r.success) {
    const details = r.error.issues.map(i => ({ field: i.path.join('.'), message: i.message }));
    return next(Object.assign(new HttpError(400, 'Validation failed'), { details }));
  }
  req.valid = r.data;
  next();
};

const errorHandler = (err, _req, res, _next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON' });
  if (err.status) return res.status(err.status).json({ error: err.message, details: err.details });
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
};

module.exports = { HttpError, auth, adminOnly, validate, errorHandler };
