const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Runs fn inside a transaction; commits on success, rolls back on any throw.
async function tx(fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
const init = () => pool.query(fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8'));
module.exports = { pool, tx, init };
