import fs from 'node:fs';
import path from 'node:path';
const dir = path.resolve('data');
for (const f of ['attendance.db', 'attendance.db-wal', 'attendance.db-shm']) {
  try { fs.unlinkSync(path.join(dir, f)); console.log('removed', f); } catch {}
}
console.log('Database reset. It will be re-seeded on next start.');
