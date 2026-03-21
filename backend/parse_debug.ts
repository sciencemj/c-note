function parseCCode(code) {
  const lines = code.split('\n');
  const result = {
    includes: [],
    globals: [],
    mainStatements: []
  };

  let inGlobalBlock = false;
  let braceCount = 0;
  let currentGlobalBlock = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === '') continue;

    if (trimmed.startsWith('#include')) {
      result.includes.push(trimmed);
      continue;
    }

    const isGlobalDeclarationStart = /^(?!int\s+main\s*\()(struct|void|int|char|float|double|long|short|unsigned|signed)\s+\w+/.test(trimmed);

    if (!inGlobalBlock && isGlobalDeclarationStart && !trimmed.endsWith(';')) {
      inGlobalBlock = true;
      currentGlobalBlock = line + '\n';
      braceCount += (line.match(/\{/g) || []).length;
      braceCount -= (line.match(/\}/g) || []).length;
      
      if (braceCount === 0 && line.includes('{') && line.includes('}')) {
          inGlobalBlock = false;
          result.globals.push(currentGlobalBlock);
          currentGlobalBlock = '';
      }
      continue;
    }

    if (!inGlobalBlock && isGlobalDeclarationStart && trimmed.endsWith(';')) {
        result.globals.push(line);
        continue;
    }

    if (inGlobalBlock) {
      currentGlobalBlock += line + '\n';
      braceCount += (line.match(/\{/g) || []).length;
      braceCount -= (line.match(/\}/g) || []).length;

      if (braceCount <= 0) {
        inGlobalBlock = false;
        result.globals.push(currentGlobalBlock);
        currentGlobalBlock = '';
        braceCount = 0;
      }
      continue;
    }

    if (trimmed.match(/^int\s+main\s*\(\)\s*\{?/)) {
        continue;
    }
    if (trimmed === '}' && i >= lines.length - 2) {
        continue;
    }
    if (trimmed.match(/^return\s+0\s*;/)) {
        continue;
    }

    result.mainStatements.push(line);
  }
  return result;
}

console.log(parseCCode('#include <stdio.h>\nint main() { printf("Hello Bun+C"); return 0; }'));
