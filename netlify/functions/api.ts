import serverless from 'serverless-http';
import { app } from '../../server/src/app.js';

const serverlessHandler = serverless(app, {
  binary: ['*/*'],
});

export const handler = serverlessHandler;
