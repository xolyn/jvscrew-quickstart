import express from 'express';
import cors from 'cors';
import './utils/env.js';
import authRouter from './routes/auth.js';
import fileRouter from './routes/file.js';
import billingRouter from './routes/billing.js';
import templatesRouter from './routes/templates.js';
import skillsRouter from './routes/skills.js';
import filesRouter from './routes/files.js';
import channelsRouter from './routes/channels.js';

export const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));

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
