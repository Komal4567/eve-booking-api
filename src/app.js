const express = require('express');
const { errorHandler } = require('./middleware');

const app = express();
// keep raw bytes: the webhook HMAC must be computed over exactly what was sent
app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));
app.get('/health', (_req, res) => res.json({ ok: true }));
app.use('/auth', require('./routes/auth'));
app.use('/', require('./routes/centres'));
app.use('/bookings', require('./routes/bookings'));
app.use('/payments', require('./routes/payments'));
app.use((_req, res) => res.status(404).json({ error: 'Route not found' }));
app.use(errorHandler);
module.exports = app;
