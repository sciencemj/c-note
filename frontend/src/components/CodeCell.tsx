import { useState, useMemo } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { cpp } from '@codemirror/lang-cpp';
import { autocompletion, type CompletionContext, type Completion } from '@codemirror/autocomplete';
import { Play, Loader2, Trash2, AlertTriangle } from 'lucide-react';
import './CodeCell.css';

export interface MemoryLeakInfo {
  leaks: Array<{ bytes: number; line: number }>;
  totalBytes: number;
  totalAllocations: number;
}

export interface CellData {
  id: string;
  type: 'code' | 'markdown';
  code: string;
  output: string | null;
  error: string | null;
  status: 'idle' | 'running' | 'success' | 'error';
  memoryLeaks?: MemoryLeakInfo | null;
}

interface CodeCellProps {
  cell: CellData;
  previousCode: string[];
  onChange: (id: string, code: string) => void;
  onExecute: (id: string) => void;
  onDelete: (id: string) => void;
  onShiftEnter: (id: string) => void;
}

// C keywords
const C_KEYWORDS: Completion[] = [
  'auto', 'break', 'case', 'char', 'const', 'continue', 'default', 'do',
  'double', 'else', 'enum', 'extern', 'float', 'for', 'goto', 'if',
  'int', 'long', 'register', 'return', 'short', 'signed', 'sizeof',
  'static', 'struct', 'switch', 'typedef', 'union', 'unsigned', 'void',
  'volatile', 'while', 'inline', 'restrict', '_Bool', '_Complex', '_Imaginary',
  'NULL', 'true', 'false', 'bool', 'size_t',
].map(k => ({ label: k, type: 'keyword' }));

// Common C stdlib functions
const C_STDLIB: Completion[] = [
  // stdio.h
  'printf', 'fprintf', 'sprintf', 'snprintf', 'scanf', 'fscanf', 'sscanf',
  'fopen', 'fclose', 'fread', 'fwrite', 'fgets', 'fputs', 'feof', 'fflush',
  'getchar', 'putchar', 'puts', 'gets', 'getline', 'perror',
  // stdlib.h
  'malloc', 'calloc', 'realloc', 'free', 'exit', 'abort', 'atexit',
  'atoi', 'atof', 'atol', 'strtol', 'strtod', 'strtoul',
  'rand', 'srand', 'abs', 'labs', 'qsort', 'bsearch',
  'system',
  // string.h
  'strlen', 'strcpy', 'strncpy', 'strcat', 'strncat', 'strcmp', 'strncmp',
  'strchr', 'strrchr', 'strstr', 'strtok', 'memcpy', 'memmove', 'memset', 'memcmp',
  // math.h
  'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2',
  'exp', 'log', 'log10', 'pow', 'sqrt', 'ceil', 'floor', 'fabs', 'round',
  // ctype.h
  'isalpha', 'isdigit', 'isalnum', 'isspace', 'isupper', 'islower',
  'toupper', 'tolower',
].map(f => ({ label: f, type: 'function', detail: 'stdlib' }));

// Extract user-defined identifiers from code
function extractIdentifiers(code: string): Completion[] {
  const completions: Completion[] = [];
  const seen = new Set<string>();

  const add = (label: string, type: string, detail?: string) => {
    if (!seen.has(label) && label.length > 1) {
      seen.add(label);
      completions.push({ label, type, detail });
    }
  };

  // Function declarations: type name(...)
  const funcRegex = /^[ \t]*(?:(?:static|inline|extern|const|unsigned|signed|long|short)\s+)*(?:void|int|char|float|double|long|short|unsigned|signed|bool|size_t|\w+_t|\w+)\s*\*?\s+(\w+)\s*\(/gm;
  let m;
  while ((m = funcRegex.exec(code)) !== null) {
    if (!C_KEYWORDS.some(k => k.label === m[1]) && !C_STDLIB.some(f => f.label === m[1])) {
      add(m[1], 'function', 'user function');
    }
  }

  // Variable declarations: type name (with optional = ...)
  const varRegex = /^[ \t]*(?:(?:static|const|unsigned|signed|long|short|extern|register|volatile)\s+)*(?:void|int|char|float|double|long|short|unsigned|signed|bool|size_t|\w+_t|\w+)\s*\*?\s+(\w+)\s*(?:[=;,\[])/gm;
  while ((m = varRegex.exec(code)) !== null) {
    if (!C_KEYWORDS.some(k => k.label === m[1]) && !C_STDLIB.some(f => f.label === m[1])) {
      add(m[1], 'variable', 'user variable');
    }
  }

  // Struct/enum/union names: struct Name
  const structRegex = /\b(?:struct|enum|union)\s+(\w+)/g;
  while ((m = structRegex.exec(code)) !== null) {
    add(m[1], 'class', 'struct/enum/union');
  }

  // Typedef names: typedef ... Name;
  const typedefRegex = /\btypedef\s+[\s\S]*?\s+(\w+)\s*;/g;
  while ((m = typedefRegex.exec(code)) !== null) {
    add(m[1], 'type', 'typedef');
  }

  // #define macros
  const defineRegex = /^[ \t]*#define\s+(\w+)/gm;
  while ((m = defineRegex.exec(code)) !== null) {
    add(m[1], 'constant', 'macro');
  }

  return completions;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const CodeCell: React.FC<CodeCellProps> = ({ cell, previousCode, onChange, onExecute, onDelete, onShiftEnter }) => {
  const [isHovered, setIsHovered] = useState(false);

  // Build custom completions from previous cells + current cell
  const cCompletionSource = useMemo(() => {
    const allCode = [...previousCode, cell.code].join('\n');
    const userCompletions = extractIdentifiers(allCode);
    const allCompletions = [...C_KEYWORDS, ...C_STDLIB, ...userCompletions];

    return (context: CompletionContext) => {
      const word = context.matchBefore(/\w+/);
      if (!word || (word.from === word.to && !context.explicit)) return null;
      return {
        from: word.from,
        options: allCompletions,
        validFor: /^\w*$/,
      };
    };
  }, [previousCode, cell.code]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      onShiftEnter(cell.id);
    }
  };

  return (
    <div 
      className={`cell-container ${isHovered ? 'hovered' : ''}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onKeyDownCapture={handleKeyDown}
    >
      <div className="cell-controls">
        <button 
          className="glass-button primary run-button"
          onClick={() => onExecute(cell.id)}
          disabled={cell.status === 'running'}
        >
          {cell.status === 'running' ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Play size={16} />
          )}
        </button>
        
        {isHovered && (
          <button 
            className="glass-button delete-button"
            onClick={() => onDelete(cell.id)}
            aria-label="Delete cell"
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>

      <div className="cell-editor-wrapper glass-panel">
        <CodeMirror
          value={cell.code}
          height="auto"
          extensions={[
            cpp(),
            autocompletion({ override: [cCompletionSource] }),
          ]}
          theme="dark"
          onChange={(value) => onChange(cell.id, value)}
          className="editor"
          basicSetup={{
            lineNumbers: true,
            highlightActiveLine: false,
            foldGutter: false,
            autocompletion: false,
          }}
        />
        
        {(cell.output || cell.error || cell.memoryLeaks) && (
          <div className={`cell-output ${cell.error ? 'has-error' : ''}`}>
            {cell.output && <pre className="stdout">{cell.output}</pre>}
            {cell.error && <pre className="stderr">{cell.error}</pre>}
            {cell.memoryLeaks && (
              <div className="memory-leak-warning">
                <div className="leak-header">
                  <AlertTriangle size={14} />
                  <span>Memory Leak Detected — {cell.memoryLeaks.totalAllocations} allocation(s), {formatBytes(cell.memoryLeaks.totalBytes)} leaked (auto-freed)</span>
                </div>
                <ul className="leak-details">
                  {cell.memoryLeaks.leaks.map((leak, i) => (
                    <li key={i}>{formatBytes(leak.bytes)} not freed (line {leak.line})</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
