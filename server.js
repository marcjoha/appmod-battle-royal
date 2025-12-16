import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 8080;
const PUBLIC_DIR = path.join(__dirname, 'dist');

console.log(`Server starting...`);

const rooms = new Map(); // Map: roomId -> Array<{ id: number, data: any }>

// Cleanup old rooms periodically
setInterval(() => {
    const now = Date.now();
    for (const [room, messages] of rooms.entries()) {
        if (messages.length > 0) {
            const lastMsg = messages[messages.length - 1];
            if (now - lastMsg.timestamp > 3600000) { // 1 hour
                rooms.delete(room);
            }
        }
    }
}, 600000);

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // API Routes
  if (req.url.startsWith('/api/')) {
      if (req.url === '/api/send' && req.method === 'POST') {
          let body = '';
          req.on('data', chunk => body += chunk.toString());
          req.on('end', () => {
              try {
                  const data = JSON.parse(body);
                  const { room, payload, senderId, targetId } = data;
                  
                  if (!rooms.has(room)) {
                      rooms.set(room, []);
                  }
                  
                  const msg = {
                      id: Date.now() + Math.random(),
                      timestamp: Date.now(),
                      payload,
                      senderId,
                      targetId
                  };
                  
                  const roomMsgs = rooms.get(room);
                  roomMsgs.push(msg);
                  
                  if (roomMsgs.length > 100) roomMsgs.shift();
                  
                  res.writeHead(200, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify({ success: true }));
              } catch (e) {
                  res.writeHead(400);
                  res.end(JSON.stringify({ error: 'Invalid JSON' }));
              }
          });
          return;
      }
      
      if (req.url.startsWith('/api/poll') && req.method === 'GET') {
          const url = new URL(req.url, `http://${req.headers.host}`);
          const room = url.searchParams.get('room');
          const lastId = parseFloat(url.searchParams.get('lastId') || '0');
          const myId = url.searchParams.get('myId');
          
          if (!rooms.has(room)) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify([]));
              return;
          }
          
          const msgs = rooms.get(room).filter(m => {
              if (m.id <= lastId) return false;
              if (m.senderId === myId) return false;
              if (m.targetId) return m.targetId === myId;
              return true;
          });
          
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(msgs));
          return;
      }
      
      res.writeHead(404);
      res.end('API Not Found');
      return;
  }

  // Static File Serving
  let reqPath = req.url === '/' ? '/index.html' : req.url;
  const safeSuffix = path.normalize(reqPath).replace(/^(\.\.[/\\])+/, '');
  let filePath = path.join(PUBLIC_DIR, safeSuffix);

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
       const ext = path.extname(filePath).toLowerCase();
       if (req.method === 'GET' && !ext) {
           const fallbackPath = path.join(PUBLIC_DIR, 'index.html');
           fs.readFile(fallbackPath, (error, content) => {
               if (error) {
                   res.writeHead(404);
                   res.end('Not found');
               } else {
                   res.writeHead(200, { 'Content-Type': 'text/html' });
                   res.end(content, 'utf-8');
               }
           });
           return;
       } else {
           res.writeHead(404);
           res.end('Not found');
           return;
       }
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (error, content) => {
      if (error) {
         res.writeHead(500);
         res.end('Error');
      } else {
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content, 'utf-8');
      }
    });
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});