const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const express = require('express');
const mongoose = require('mongoose');
const cookieParser = require('cookie-parser');
const { router: authRouter, requireAuth } = require('./routes/auth');
const mailer = require('./services/mailer');

const PORT = Number(process.env.PORT) || 5000;
const app = express();
app.set('trust proxy', 'loopback'); // only trust X-Forwarded-* from Nginx on this machine
app.disable('x-powered-by');
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// Public (recipient-facing) tracking + unsubscribe routes.
app.use(require('./routes/tracking'));
app.use(require('./routes/images').pub);

app.use('/api/auth', authRouter);
app.use('/api', requireAuth,
  require('./routes/businesses'),
  require('./routes/contacts'),
  require('./routes/campaigns'),
  require('./routes/templates'),
  require('./routes/images').api,
  require('./routes/analytics'));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// The React client is hosted separately (Vercel). If a build is present locally it is still served,
// which keeps `npm start` working as a single app for local use.
const dist = path.join(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
} else {
  app.get('/', (req, res) => res.json({ service: 'MailPilot API', status: 'ok' }));
}

app.use((err, req, res, next) => {
  const status = err.status || (err.name === 'ValidationError' || err.name === 'CastError' ? 400 : 500);
  if (status >= 500) console.error(err);
  if (res.headersSent) return next(err);
  res.status(status).json({ error: err.message || 'Server error' });
});

mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/mailpilot')
  .then(async () => {
    console.log('MongoDB connected');
    await mailer.startWorker();
    const host = process.env.HOST || '0.0.0.0';
    app.listen(PORT, host, () => console.log(`MailPilot API running on http://${host}:${PORT}`));
  })
  .catch((e) => {
    console.error('Could not connect to MongoDB:', e.message);
    process.exit(1);
  });
