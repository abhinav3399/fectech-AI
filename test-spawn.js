const { spawn } = require('child_process');
const child = spawn('C:/Users/abhin/AppData/Local/Programs/Factech AI/resources/runtime/model.exe', [], { 
    cwd: 'C:/Users/abhin/AppData/Local/Programs/Factech AI/resources', 
    env: { ...process.env, MODEL_SERVICE_PORT: '8999' }, 
    windowsHide: true 
});
child.stdout.on('data', d => console.log('OUT:', d.toString()));
child.stderr.on('data', d => console.log('ERR:', d.toString()));
child.on('error', e => console.log('ERROR:', e));
child.on('exit', c => console.log('EXIT:', c));
console.log('PID:', child.pid);
