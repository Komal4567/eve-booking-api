process.env.JWT_SECRET = 'test'; process.env.WEBHOOK_SECRET = 'whsec';
process.env.ADMIN_EMAILS = 'admin@test.com';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const request = require('supertest');
const crypto = require('crypto');
const app = require('../src/app');
const { pool, init } = require('../src/db');

const future = new Date(Date.now() + 864e5).toISOString();
const bearer = t => ({ Authorization: `Bearer ${t}` });
const signup = async (email) =>
  (await request(app).post('/auth/signup').send({ name: 'T', email, password: 'password1' })).body.token;
const hook = (payload, secret = 'whsec') => {
  const raw = JSON.stringify(payload);
  const sig = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  return request(app).post('/payments/webhook/').set('Content-Type', 'application/json')
    .set('X-Signature', sig).send(raw);
};

let admin, alice, bob, booking;
beforeAll(async () => {
  await init();
  await pool.query('TRUNCATE users,centres,tests,centre_tests,bookings,payments,webhook_events RESTART IDENTITY CASCADE');
  admin = await signup('admin@test.com'); alice = await signup('alice@test.com'); bob = await signup('bob@test.com');
  await request(app).post('/centres').set(bearer(admin)).send({ name: 'C1', location: 'Pune' });
  await request(app).post('/tests').set(bearer(admin)).send({ name: 'CBC' });
  await request(app).put('/centres/1/tests').set(bearer(admin)).send({ test_id: 1, price: 499 });
});
afterAll(() => pool.end());

describe('auth & validation', () => {
  test('rejects bad signup', async () => {
    const r = await request(app).post('/auth/signup').send({ email: 'x', password: '1' });
    expect(r.status).toBe(400);
  });
  test('duplicate email -> 409', async () => {
    const r = await request(app).post('/auth/signup').send({ name: 'A', email: 'alice@test.com', password: 'password1' });
    expect(r.status).toBe(409);
  });
  test('wrong password -> 401', async () => {
    const r = await request(app).post('/auth/login').send({ email: 'alice@test.com', password: 'nope' });
    expect(r.status).toBe(401);
  });
  test('non-admin cannot create centre', async () => {
    const r = await request(app).post('/centres').set(bearer(alice)).send({ name: 'X', location: 'Y' });
    expect(r.status).toBe(403);
  });
});

describe('bookings', () => {
  test('requires auth', async () => expect((await request(app).get('/bookings')).status).toBe(401));
  test('amount comes from centre price', async () => {
    const r = await request(app).post('/bookings').set(bearer(alice))
      .send({ centre_id: 1, test_id: 1, appointment_at: future });
    expect(r.status).toBe(201);
    expect(Number(r.body.amount)).toBe(499);
    expect(r.body.status).toBe('PENDING');
    booking = r.body;
  });
  test('other user cannot see or pay it', async () => {
    expect((await request(app).get(`/bookings/${booking.id}`).set(bearer(bob))).status).toBe(404);
    expect((await request(app).post('/payments/').set(bearer(bob))
      .send({ booking_id: booking.id, outcome: 'SUCCESS' })).status).toBe(404);
  });
  test('invalid id -> 400, unknown id -> 404', async () => {
    expect((await request(app).get('/bookings/abc').set(bearer(alice))).status).toBe(400);
    expect((await request(app).get('/bookings/9999').set(bearer(alice))).status).toBe(404);
  });
});

describe('payments', () => {
  test('failed payment marks FAILED, retry can confirm, then no double pay', async () => {
    let r = await request(app).post('/payments/').set(bearer(alice)).send({ booking_id: booking.id, outcome: 'FAILED' });
    expect(r.body.booking.status).toBe('FAILED');
    r = await request(app).post('/payments/').set(bearer(alice)).send({ booking_id: booking.id, outcome: 'SUCCESS' });
    expect(r.body.booking.status).toBe('CONFIRMED');
    r = await request(app).post('/payments/').set(bearer(alice)).send({ booking_id: booking.id, outcome: 'SUCCESS' });
    expect(r.status).toBe(409);
  });
});

describe('webhook idempotency', () => {
  let b2;
  beforeAll(async () => {
    b2 = (await request(app).post('/bookings').set(bearer(alice))
      .send({ centre_id: 1, test_id: 1, appointment_at: future })).body;
  });
  test('bad signature -> 401', async () =>
    expect((await hook({ event_id: 'e0', booking_id: b2.id, status: 'SUCCESS' }, 'wrong')).status).toBe(401));
  test('unknown booking -> 404', async () =>
    expect((await hook({ event_id: 'e0', booking_id: 9999, status: 'SUCCESS' })).status).toBe(404));
  test('same event 3x (incl. concurrent) creates one payment', async () => {
    const p = { event_id: 'evt_1', booking_id: b2.id, status: 'SUCCESS' };
    const rs = await Promise.all([hook(p), hook(p), hook(p)]);
    rs.forEach(r => expect(r.status).toBe(200));
    expect(rs.filter(r => r.body.duplicate).length).toBe(2);
    const { rows } = await pool.query('SELECT count(*)::int n FROM payments WHERE booking_id=$1', [b2.id]);
    expect(rows[0].n).toBe(1);
    expect((await request(app).get(`/bookings/${b2.id}`).set(bearer(alice))).body.status).toBe('CONFIRMED');
  });
  test('late FAILED event does not downgrade CONFIRMED', async () => {
    await hook({ event_id: 'evt_2', booking_id: b2.id, status: 'FAILED' });
    expect((await request(app).get(`/bookings/${b2.id}`).set(bearer(alice))).body.status).toBe('CONFIRMED');
  });
});
