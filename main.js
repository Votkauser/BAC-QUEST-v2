// Serves the bundled app on 127.0.0.1 (same as the original launcher) so
// storage/service worker behave exactly like in the browser version.
const { app, BrowserWindow, shell } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, 'app');
const TYPES = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8',
  '.svg':'image/svg+xml', '.png':'image/png', '.woff2':'font/woff2', '.webmanifest':'application/manifest+json', '.json':'application/json' };
const PORT = 8137; // fixed port = stable origin = your saved data stays put

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

function createWindow() {
  const win = new BrowserWindow({ width: 1280, height: 820, autoHideMenuBar: true, icon: path.join(ROOT, 'icon-512.png') });
  win.loadURL('http://127.0.0.1:' + PORT);
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

if (!app.requestSingleInstanceLock()) app.quit();
app.whenReady().then(() => {
  server.listen(PORT, '127.0.0.1', createWindow);
  server.on('error', () => app.quit());
});
app.on('window-all-closed', () => { server.close(); app.quit(); });
