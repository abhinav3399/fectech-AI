const path = require('node:path');
const fs = require('node:fs');
const dir = path.join('C:/Users/abhin/AppData/Roaming/Factech AI', 'logs');
fs.mkdirSync(dir, { recursive: true });
fs.appendFileSync(path.join(dir, 'desktop.log'), 'test\n');
console.log('Done');
