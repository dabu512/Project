const { exec } = require('child_process');
const path = require('path');

let timeoutId = null;

function autoDumpMiddleware(req, res, next) {
  // Check if it's a modifying request (POST, PUT, DELETE) and NOT an auth request
  if (['POST', 'PUT', 'DELETE'].includes(req.method) && !req.originalUrl.includes('/api/auth')) {
    res.on('finish', () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        console.log(`[AutoDump] Detected successful database-modifying request: ${req.method} ${req.originalUrl}`);
        triggerAutoDump();
      }
    });
  }
  next();
}

function triggerAutoDump() {
  if (timeoutId) {
    clearTimeout(timeoutId);
  }
  timeoutId = setTimeout(() => {
    runAutoDumpSnapshot();
  }, 15000); // 15-second debounce
}

function runAutoDumpSnapshot() {
  console.log('[AutoDump] Starting automatic database backup snapshot...');
  
  const pgDumpPath = 'C:\\Program Files\\PostgreSQL\\18\\bin\\pg_dump.exe';
  const dumpFilePath = path.join(__dirname, '../database_dump.sql');
  
  // Set the password environment variable for pg_dump
  const env = { ...process.env, PGPASSWORD: '123456' };
  
  const cmd = `"${pgDumpPath}" -U postgres -h localhost -p 5433 -d DA -f "${dumpFilePath}"`;
  
  exec(cmd, { env }, (error, stdout, stderr) => {
    if (error) {
      console.error(`[AutoDump] Error running pg_dump: ${error.message}`);
      return;
    }
    if (stderr) {
      console.warn(`[AutoDump] pg_dump warning: ${stderr}`);
    }
    console.log('[AutoDump] Automatic database backup successfully saved to database_dump.sql');
  });
}

module.exports = autoDumpMiddleware;
module.exports.triggerAutoDump = triggerAutoDump;

