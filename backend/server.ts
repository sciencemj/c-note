import express from 'express';
import cors from 'cors';
import { spawn } from 'child_process';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import crypto from 'crypto';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

interface ParseResult {
  includes: string[];
  globals: string[];
  mainStatements: string[];
}

// Simple heuristic parser for C code 
// Extracts includes, attempts to extract simple global functions/structs, and keeps the rest for main()
function parseCCode(code: string): ParseResult {
  const result: ParseResult = {
    includes: [],
    globals: [],
    mainStatements: []
  };

  // 1. Extract includes
  const includeRegex = /^\s*#include\s*[<"][^>"]+[>"]/gm;
  let match;
  while ((match = includeRegex.exec(code)) !== null) {
      result.includes.push(match[0].trim());
  }
  let codeWithoutIncludes = code.replace(includeRegex, '');

  // 2. Extract main() body if it exists
  const mainRegex = /int\s+main\s*\([^)]*\)\s*\{([\s\S]*)\}/;
  const mainMatch = codeWithoutIncludes.match(mainRegex);

  if (mainMatch) {
      let mainContent = mainMatch[1] ?? '';
      mainContent = mainContent.replace(/return\s+0\s*;\s*$/, '');
      // Dedent: strip common leading whitespace so buildFinalCode can re-indent uniformly
      const contentLines = mainContent.split('\n');
      const nonEmptyLines = contentLines.filter(l => l.trim().length > 0);
      if (nonEmptyLines.length > 0) {
        const minIndent = Math.min(...nonEmptyLines.map(l => {
          const m = l.match(/^(\s*)/);
          return m ? m[1].length : 0;
        }));
        if (minIndent > 0) {
          mainContent = contentLines.map(l => l.length >= minIndent ? l.slice(minIndent) : l).join('\n');
        }
      }
      result.mainStatements.push(mainContent);

      const globalsCode = codeWithoutIncludes.replace(mainRegex, '').trim();
      if (globalsCode) {
          result.globals.push(globalsCode);
      }
  } else {
      const lines = codeWithoutIncludes.split('\n');
      let inGlobalBlock = false;
      let currentGlobalBlock = '';
      let braceCount = 0;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? '';
        const trimmed = line.trim();
        if (!trimmed) continue;

        const isGlobalDeclarationStart = /^(?!int\s+main\s*\()(struct|void|int|char|float|double|long|short|unsigned|signed)\s+\w+\s*(\(|\{|=)/.test(trimmed);

        if (!inGlobalBlock && isGlobalDeclarationStart && !trimmed.endsWith(';')) {
          // Only start a multi-line global block for functions/structs (lines with { or ().
          // Simple variable assignments like "int a = 10" are just main statements.
          if (!trimmed.includes('{') && !trimmed.includes('(')) {
            result.mainStatements.push(line);
            continue;
          }

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

        result.mainStatements.push(line);
      }

      // Safety net: if the loop ended inside an unfinished global block, push it as main statements
      if (inGlobalBlock && currentGlobalBlock) {
        result.mainStatements.push(...currentGlobalBlock.split('\n').filter(l => l.trim()));
      }
  }

  return result;
}

// ─── Auto-fix missing semicolons ───────────────────────────────────────────────
// GCC errors like: error: expected ';' before ...  or  error: expected ';' at end of ...
// Finds the offending lines in the generated code, matches them back to the original
// cell source, and fixes the cell code directly so the editor can reflect the change.
function autoFixCellSemicolons(
  cells: string[],
  generatedCode: string,
  compileError: string
): { fixedCells: string[]; appliedFixes: string[] } {
  const genLines = generatedCode.split('\n');
  const appliedFixes: string[] = [];
  const fixedCells = cells.map(c => c); // clone

  // Matches both:  expected ';' before ...  AND  expected ',' or ';' before ...
  const semicolonErrorRegex = /\.c:(\d+):\d+:.*error:.*expected\s+.*\W;\W/gi;
  let m;

  // Collect the trimmed content of each line that needs a semicolon
  const linesToFix: string[] = [];

  while ((m = semicolonErrorRegex.exec(compileError)) !== null && m[1] !== undefined) {
    const errorLine = parseInt(m[1], 10);
    // GCC reports the error at the token it couldn't parse (e.g. 'int', 'return').
    // The missing ';' is usually on the PREVIOUS line. Search up to 3 nearby lines
    // to handle blank lines or comments between the missing ';' and the error.
    for (const candidate of [errorLine - 1, errorLine, errorLine - 2]) {
      if (candidate > 0 && candidate <= genLines.length) {
        const line = genLines[candidate - 1];
        if (line !== undefined) {
          const trimmed = line.trimEnd();
          if (trimmed && !trimmed.endsWith(';') && !trimmed.endsWith('{') && !trimmed.endsWith('}') && !trimmed.startsWith('#')) {
            linesToFix.push(line.trim());
            break;
          }
        }
      }
    }
  }

  // Match each line back to a cell and fix it there
  for (const target of linesToFix) {
    // Search from last cell backward (most recent cell is most likely)
    for (let ci = fixedCells.length - 1; ci >= 0; ci--) {
      const cellLines = fixedCells[ci].split('\n');
      let found = false;
      for (let cli = 0; cli < cellLines.length; cli++) {
        if (cellLines[cli].trim() === target) {
          cellLines[cli] = cellLines[cli] + ';';
          fixedCells[ci] = cellLines.join('\n');
          appliedFixes.push(`Added missing ';' after: ${target}`);
          found = true;
          break;
        }
      }
      if (found) break;
    }
  }

  return { fixedCells, appliedFixes };
}

// ─── Memory leak tracker (injected into generated C code) ───────────────────
const MEMORY_TRACKER_CODE = `
/* ── C-Note Memory Leak Tracker ─────────────────────────────────── */
#include <stdlib.h>
#include <stdio.h>
#include <string.h>

#define _CNOTE_MAX_ALLOCS 4096

typedef struct {
    void *ptr;
    size_t size;
    int line;
} _CNote_AllocEntry;

static _CNote_AllocEntry _cnote_allocs[_CNOTE_MAX_ALLOCS];
static int _cnote_alloc_count = 0;

static void _cnote_track_add(void *ptr, size_t size, int line) {
    if (!ptr || _cnote_alloc_count >= _CNOTE_MAX_ALLOCS) return;
    _cnote_allocs[_cnote_alloc_count].ptr = ptr;
    _cnote_allocs[_cnote_alloc_count].size = size;
    _cnote_allocs[_cnote_alloc_count].line = line;
    _cnote_alloc_count++;
}

static void _cnote_track_remove(void *ptr) {
    for (int i = 0; i < _cnote_alloc_count; i++) {
        if (_cnote_allocs[i].ptr == ptr) {
            _cnote_allocs[i] = _cnote_allocs[--_cnote_alloc_count];
            return;
        }
    }
}

static void *_cnote_tracked_malloc(size_t size, int line) {
    void *ptr = malloc(size);
    _cnote_track_add(ptr, size, line);
    return ptr;
}

static void *_cnote_tracked_calloc(size_t n, size_t size, int line) {
    void *ptr = calloc(n, size);
    _cnote_track_add(ptr, n * size, line);
    return ptr;
}

static void *_cnote_tracked_realloc(void *old, size_t size, int line) {
    if (old) _cnote_track_remove(old);
    void *ptr = realloc(old, size);
    _cnote_track_add(ptr, size, line);
    return ptr;
}

static void _cnote_tracked_free(void *ptr) {
    if (ptr) _cnote_track_remove(ptr);
    free(ptr);
}

static void _cnote_leak_check(void) {
    if (_cnote_alloc_count == 0) return;
    size_t total = 0;
    fprintf(stderr, "\\n-----MEMORY_LEAK_REPORT-----\\n");
    for (int i = 0; i < _cnote_alloc_count; i++) {
        fprintf(stderr, "LEAK: %zu bytes at %p (line %d)\\n",
            _cnote_allocs[i].size, _cnote_allocs[i].ptr, _cnote_allocs[i].line);
        total += _cnote_allocs[i].size;
        free(_cnote_allocs[i].ptr);
    }
    fprintf(stderr, "SUMMARY: %d allocation(s), %zu bytes leaked — auto-freed\\n", _cnote_alloc_count, total);
    fprintf(stderr, "-----END_MEMORY_LEAK_REPORT-----\\n");
}

__attribute__((constructor))
static void _cnote_init_leak_checker(void) {
    atexit(_cnote_leak_check);
}

/* Redirect user malloc/calloc/realloc/free to tracked versions */
#define malloc(s)    _cnote_tracked_malloc(s, __LINE__)
#define calloc(n,s)  _cnote_tracked_calloc(n, s, __LINE__)
#define realloc(p,s) _cnote_tracked_realloc(p, s, __LINE__)
#define free(p)      _cnote_tracked_free(p)
/* ── End Memory Leak Tracker ────────────────────────────────────── */
`;

const LEAK_REPORT_START = '-----MEMORY_LEAK_REPORT-----';
const LEAK_REPORT_END = '-----END_MEMORY_LEAK_REPORT-----';

interface MemoryLeakInfo {
  leaks: Array<{ bytes: number; line: number }>;
  totalBytes: number;
  totalAllocations: number;
}

function parseLeakReport(stderr: string): { cleanStderr: string; leakInfo: MemoryLeakInfo | null } {
  const startIdx = stderr.indexOf(LEAK_REPORT_START);
  if (startIdx === -1) return { cleanStderr: stderr, leakInfo: null };

  const endIdx = stderr.indexOf(LEAK_REPORT_END);
  const reportBlock = stderr.slice(startIdx, endIdx !== -1 ? endIdx + LEAK_REPORT_END.length : undefined);
  const cleanStderr = stderr.slice(0, startIdx).trimEnd();

  const leaks: Array<{ bytes: number; line: number }> = [];
  const leakRegex = /LEAK:\s+(\d+)\s+bytes\s+at\s+\S+\s+\(line\s+(\d+)\)/g;
  let m;
  while ((m = leakRegex.exec(reportBlock)) !== null) {
    leaks.push({ bytes: parseInt(m[1], 10), line: parseInt(m[2], 10) });
  }

  const summaryRegex = /SUMMARY:\s+(\d+)\s+allocation\(s\),\s+(\d+)\s+bytes/;
  const sm = summaryRegex.exec(reportBlock);
  const totalAllocations = sm ? parseInt(sm[1], 10) : leaks.length;
  const totalBytes = sm ? parseInt(sm[2], 10) : leaks.reduce((a, l) => a + l.bytes, 0);

  return { cleanStderr, leakInfo: { leaks, totalBytes, totalAllocations } };
}

// ─── Build final C code from cells ─────────────────────────────────────────────
function buildFinalCode(cells: string[], memoryCheckEnabled = false): string {
  const aggregatedIncludes = new Set<string>();
  const aggregatedGlobals: string[] = [];
  const aggregatedMain: string[] = [];

  const OUTPUT_BOUNDARY = '-----CELL_OUTPUT_BOUNDARY-----';

  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    if (cell === undefined) continue;
    const parsed = parseCCode(cell);
    
    parsed.includes.forEach(inc => aggregatedIncludes.add(inc));
    aggregatedGlobals.push(...parsed.globals);

    if (i === cells.length - 1) {
      aggregatedMain.push(`printf("\\n${OUTPUT_BOUNDARY}\\n");\nfflush(stdout);`);
    }
    
    aggregatedMain.push(...parsed.mainStatements);
  }

  const mainBody = aggregatedMain
    .join('\n')
    .split('\n')
    .map(line => line.trim() ? '    ' + line : '')
    .join('\n');

  // When memory check is enabled, inject the tracker after includes but before globals.
  // The tracker already includes stdlib.h so we ensure it's present.
  const trackerBlock = memoryCheckEnabled ? MEMORY_TRACKER_CODE : '';

  return `
${Array.from(aggregatedIncludes).join('\n')}
${trackerBlock}
${aggregatedGlobals.join('\n')}

int main() {
${mainBody}
    return 0;
}
`;
}

// ─── Compile helper ────────────────────────────────────────────────────────────
async function compileCode(cFilePath: string, outFilePath: string): Promise<{ code: number | null; error: string }> {
  return new Promise((resolve) => {
    const compiler = spawn('gcc', [cFilePath, '-o', outFilePath, '-lm']);
    let compileErr = '';

    const compileTimeout = setTimeout(() => {
      compiler.kill('SIGKILL');
      resolve({ code: -1, error: 'Compilation timed out (10s)' });
    }, 10000);

    compiler.stderr.on('data', (data) => compileErr += data.toString());
    
    compiler.on('error', (err) => {
      clearTimeout(compileTimeout);
      resolve({ code: -1, error: `Failed to start compiler: ${err.message}` });
    });

    compiler.on('close', (code) => {
      clearTimeout(compileTimeout);
      resolve({ code, error: compileErr });
    });
  });
}

// ─── Resource Management ───────────────────────────────────────────────────────
const MAX_CONCURRENT = 5;
let activeExecutions = 0;

const tempFiles = new Set<string>();

function registerTempFile(path: string) {
  tempFiles.add(path);
}

async function cleanupTempFile(path: string) {
  tempFiles.delete(path);
  await unlink(path).catch(() => {});
}

async function cleanupAll() {
  const promises = [...tempFiles].map(f => unlink(f).catch(() => {}));
  await Promise.all(promises);
  tempFiles.clear();
}

process.on('SIGINT', async () => { await cleanupAll(); process.exit(0); });
process.on('SIGTERM', async () => { await cleanupAll(); process.exit(0); });

// ─── Execution Endpoint ────────────────────────────────────────────────────────
const OUTPUT_BOUNDARY = '-----CELL_OUTPUT_BOUNDARY-----';

app.post('/execute', async (req, res) => {
  const { cells, autoFixSemicolonsEnabled, memoryCheckEnabled } = req.body;

  if (!cells || !Array.isArray(cells) || cells.length === 0) {
    return res.status(400).json({ error: 'No cells provided' });
  }

  if (activeExecutions >= MAX_CONCURRENT) {
    return res.status(429).json({ error: 'Server busy: too many concurrent executions. Try again shortly.' });
  }

  activeExecutions++;

  const fileId = crypto.randomUUID();
  const cFilePath = join(tmpdir(), `${fileId}.c`);
  const outFilePath = join(tmpdir(), `${fileId}.out`);

  registerTempFile(cFilePath);
  registerTempFile(outFilePath);

  try {
    let executionCells = [...cells];
    let finalCode = buildFinalCode(executionCells, !!memoryCheckEnabled);
    let autoFixApplied: string[] = [];
    let fixedCells: string[] | undefined;

    await writeFile(cFilePath, finalCode);

    // 1. Compile (first attempt)
    let compileResult = await compileCode(cFilePath, outFilePath);

    // 2. If auto-fix is enabled and there are semicolon errors, fix the cell code and recompile.
    //    Retry up to 10 times to handle cases where GCC doesn't report all errors at once.
    if (autoFixSemicolonsEnabled) {
      for (let attempt = 0; attempt < 10 && compileResult.code !== 0; attempt++) {
        const result = autoFixCellSemicolons(executionCells, finalCode, compileResult.error);

        if (result.appliedFixes.length === 0) break; // no more fixes found

        executionCells = result.fixedCells;
        fixedCells = result.fixedCells;
        autoFixApplied.push(...result.appliedFixes);
        finalCode = buildFinalCode(executionCells, !!memoryCheckEnabled);
        await writeFile(cFilePath, finalCode);
        compileResult = await compileCode(cFilePath, outFilePath);
      }
    }

    if (compileResult.code !== 0) {
      return res.json({
        error: `Compilation Error:\n${compileResult.error}`,
        generatedCode: finalCode,
        autoFixApplied,
        fixedCells
      });
    }

    // 3. Execute with timeout
    const executionResult = await new Promise<{ output: string; error: string; code: number | null }>((resolve) => {
      const executor = spawn(outFilePath);
      let execOut = '';
      let execErr = '';

      const timeout = setTimeout(() => {
        executor.kill('SIGKILL');
        resolve({ output: execOut, error: 'Execution Timeout: Process took longer than 5 seconds', code: -1 });
      }, 5000);

      executor.stdout.on('data', (data) => execOut += data.toString());
      executor.stderr.on('data', (data) => execErr += data.toString());

      executor.on('error', (err) => {
        clearTimeout(timeout);
        resolve({ output: '', error: `Failed to execute binary: ${err.message}`, code: -1 });
      });

      executor.on('close', (code) => {
        clearTimeout(timeout);
        resolve({ output: execOut, error: execErr, code });
      });
    });

    // Parse the output to only return the latest cell's output
    const { output, error } = executionResult;

    let currentCellOutput = output;
    if (output.includes(`${OUTPUT_BOUNDARY}\n`)) {
      currentCellOutput = output.split(`${OUTPUT_BOUNDARY}\n`).pop() || '';
    } else if (output.includes(OUTPUT_BOUNDARY)) {
      currentCellOutput = output.split(OUTPUT_BOUNDARY).pop() || '';
    }

    // Parse memory leak report from stderr if memory check was enabled
    let leakInfo: MemoryLeakInfo | null = null;
    let cleanError = error.trim();
    if (memoryCheckEnabled) {
      const parsed = parseLeakReport(cleanError);
      cleanError = parsed.cleanStderr;
      leakInfo = parsed.leakInfo;
    }

    res.json({
      output: currentCellOutput,
      error: cleanError || undefined,
      generatedCode: finalCode,
      autoFixApplied,
      fixedCells,
      memoryLeaks: leakInfo
    });

  } catch (error) {
    console.error('Execution handler error:', error);
    res.status(500).json({ error: 'Internal server error during execution' });
  } finally {
    activeExecutions--;
    await Promise.all([
      cleanupTempFile(cFilePath),
      cleanupTempFile(outFilePath)
    ]);
  }
});

app.listen(PORT, () => {
  console.log(`Backend server listening on port ${PORT}`);
});
