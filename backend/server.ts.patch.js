import { writeFile } from 'fs/promises';
import { readFileSync } from 'fs';

const content = readFileSync('server.ts', 'utf-8');
const patched = content.replace(
    /const fileId = crypto.randomUUID\(\);/g,
    `const fileId = crypto.randomUUID();\n    console.log("FINAL C CODE:\\n", finalCode);`
);
writeFile('server.ts', patched);
