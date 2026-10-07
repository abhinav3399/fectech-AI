const http = require('node:http');
function freePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}
freePort().then(port => console.log('Port:', port)).catch(e => console.log('Error:', e));
