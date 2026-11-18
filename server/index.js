import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { seedIfEmpty } from './seed.js';
import { createAttendanceRouter } from './router.js';
import { startScheduler } from './scheduler.js';

export { createAttendanceRouter, openDb, seedIfEmpty, startScheduler };

/**
 * Hub integration: call `mountAttendance(app, { db, mountPath })` from the MCCIA app hub.
 * Pass the hub's own node:sqlite DatabaseSync (tables are all `att_*`) or omit to use ./data/attendance.db.
 */
export function mountAttendance(app, { db, dbFile, mountPath = '/api/attendance', secret, demo = false } = {}) {
  const database = db || openDb(dbFile || path.resolve('data', 'attendance.db'));
  seedIfEmpty(database, { demo });
  const router = createAttendanceRouter(database, { secret: secret || process.env.ATT_SECRET || crypto.randomBytes(32).toString('hex') });
  app.use(mountPath, router);
  const stop = startScheduler(router.core);
  return { router, db: database, stop };
}

// ---- standalone server ----
const here = path.dirname(fileURLToPath(import.meta.url));
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(here, 'index.js')) {
  const dataDir = path.resolve(here, '..', 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const secretFile = path.join(dataDir, '.secret');
  if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, crypto.randomBytes(32).toString('hex'));
  const app = express();
  app.disable('x-powered-by');
  mountAttendance(app, {
    dbFile: path.join(dataDir, 'attendance.db'),
    secret: process.env.ATT_SECRET || fs.readFileSync(secretFile, 'utf8'),
    demo: process.env.SEED_DEMO !== '0',
  });

  const dist = path.resolve(here, '..', 'client', 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }
  const port = +process.env.PORT || 4000;
  app.listen(port, '0.0.0.0', () => console.log(`MCCIA Attendance API on http://localhost:${port}`));
}
