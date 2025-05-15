import http from 'http';
import path from 'path';
import { readFile } from 'fs';
import ejs from 'ejs';

const hostname = '127.0.0.1';
const port = 3000;

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/index') {
    const filePath = path.join(__dirname, 'views', 'index.ejs');
    ejs.renderFile(filePath, {}, {}, (err: Error | null, str?: string) => {
      if (err) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'text/plain');
        res.end('Error rendering page');
        return;
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html');
      res.end(str);
    });
  } else {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain');
    res.end('Not Found');
  }
});

server.listen(port, hostname, () => {
  console.log(`Server running at http://${hostname}:${port}/`);
}); 