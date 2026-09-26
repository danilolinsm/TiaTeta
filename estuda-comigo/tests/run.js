// Roda todos os tests/*.test.js com o runner nativo do Node (sem dependências).
// Ignora argumentos extras (o preflight.sh chama `npm test -- --reporter=json`).
const { run } = require('node:test');
const { tap } = require('node:test/reporters');
const fs = require('fs');
const path = require('path');

const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js')).map(f => path.join(__dirname, f));
const stream = run({ files });
stream.on('test:fail', () => { process.exitCode = 1; });
stream.compose(tap).pipe(process.stdout);
