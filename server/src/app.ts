import express, { type Request } from 'express';
import cors from 'cors';
import './utils/env.js';
import authRouter from './routes/auth.js';
import fileRouter from './routes/file.js';
import billingRouter from './routes/billing.js';
import templatesRouter from './routes/templates.js';
import skillsRouter from './routes/skills.js';
import filesRouter from './routes/files.js';
import channelsRouter from './routes/channels.js';

function normalizeJsonBody(req: Request): void {
  if (typeof req.body === 'string' && req.body.length > 0) {
    try {
      req.body = JSON.parse(req.body);
    } catch {
      req.body = {};
    }
  }
}

export const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use((req, _res, next) => {
  normalizeJsonBody(req);
  next();
});

app.use('/api/auth', authRouter);
app.use('/api/file', fileRouter);
app.use('/api/billing', billingRouter);
app.use('/api/templates', templatesRouter);
app.use('/api/skills', skillsRouter);
app.use('/api/files', filesRouter);
app.use('/api/channels', channelsRouter);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});
