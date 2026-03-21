import { useState, useCallback, useRef } from 'react';
import { CodeCell } from './CodeCell';
import type { CellData } from './CodeCell';
import { MarkdownCell } from './MarkdownCell';
import { SourceView } from './SourceView';
import { Plus, Code2, Wrench, Save, FolderOpen, Type } from 'lucide-react';
import './Notebook.css';

interface CNoteSaveFile {
  version: 1;
  name: string;
  cells: Array<{
    id: string;
    type?: 'code' | 'markdown';
    code: string;
    output: string | null;
    error: string | null;
  }>;
}

const API_URL = 'http://localhost:3001';

export const Notebook: React.FC = () => {
  const [cells, setCells] = useState<CellData[]>([
    {
      id: crypto.randomUUID(),
      type: 'code',
      code: '#include <stdio.h>\n\nprintf("Welcome to C-Note!\\n");',
      output: null,
      error: null,
      status: 'idle'
    }
  ]);

  const [noteName, setNoteName] = useState('Untitled');
  const [autoFixSemicolons, setAutoFixSemicolons] = useState(true);
  const [generatedSource, setGeneratedSource] = useState<string | null>(null);
  const [showSourceView, setShowSourceView] = useState(false);
  const [autoFixMessages, setAutoFixMessages] = useState<string[]>([]);

  const cellsRef = useRef(cells);
  cellsRef.current = cells;

  const addCell = (index: number, type: 'code' | 'markdown' = 'code'): string => {
    const newCell: CellData = {
      id: crypto.randomUUID(),
      type,
      code: '',
      output: null,
      error: null,
      status: 'idle'
    };
    const newCells = [...cellsRef.current];
    newCells.splice(index + 1, 0, newCell);
    setCells(newCells);
    return newCell.id;
  };

  const updateCellCode = (id: string, code: string) => {
    setCells(cellsRef.current.map(cell => cell.id === id ? { ...cell, code } : cell));
  };

  const deleteCell = (id: string) => {
    if (cellsRef.current.length > 1) {
      setCells(cellsRef.current.filter(cell => cell.id !== id));
    }
  };

  const executeCell = useCallback(async (id: string) => {
    // Skip markdown cells
    const targetCell = cellsRef.current.find(c => c.id === id);
    if (targetCell?.type === 'markdown') return;

    // Use functional updaters for setCells to avoid stale state during executeAll
    setCells(prev => prev.map(cell =>
      cell.id === id ? { ...cell, status: 'running', output: null, error: null } : cell
    ));
    setAutoFixMessages([]);

    try {
      // Read cell data from ref for building the execution context (code cells only)
      const currentCells = cellsRef.current;
      const targetIndex = currentCells.findIndex(c => c.id === id);
      const executionContext = currentCells
        .slice(0, targetIndex + 1)
        .filter(c => c.type !== 'markdown')
        .map(c => c.code);

      const response = await fetch(`${API_URL}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cells: executionContext,
          autoFixSemicolonsEnabled: autoFixSemicolons
        }),
      });

      const data = await response.json();

      // Save generated source code for source view tab
      if (data.generatedCode) {
        setGeneratedSource(data.generatedCode);
      }

      // Track auto-fix messages
      if (data.autoFixApplied && data.autoFixApplied.length > 0) {
        setAutoFixMessages(data.autoFixApplied);
      }

      setCells(prev => {
        // fixedCells indices correspond to code-only cells, not the full array.
        // Build a mapping from full-array index to code-only index.
        const codeOnlyIndexMap = new Map<number, number>();
        let codeIdx = 0;
        for (let i = 0; i <= targetIndex && i < prev.length; i++) {
          if (prev[i].type !== 'markdown') {
            codeOnlyIndexMap.set(i, codeIdx++);
          }
        }

        return prev.map((cell, idx) => {
          const fixedCodeIdx = codeOnlyIndexMap.get(idx);
          const fixedCode = data.fixedCells && fixedCodeIdx !== undefined
            ? data.fixedCells[fixedCodeIdx]
            : undefined;

          if (cell.id === id) {
            return {
              ...cell,
              code: fixedCode ?? cell.code,
              status: response.ok && !data.error ? 'success' : (data.error ? 'error' : 'success'),
              output: data.output || null,
              error: data.error || null
            };
          }

          // Update code for earlier cells if they were also fixed
          if (fixedCode !== undefined) {
            return { ...cell, code: fixedCode };
          }

          return cell;
        });
      });
    } catch (err) {
      setCells(prev => prev.map(cell =>
        cell.id === id ? {
          ...cell,
          status: 'error',
          error: err instanceof Error ? err.message : 'Unknown error occurred'
        } : cell
      ));
    }
  }, [autoFixSemicolons]);

  const focusNextCodeCell = useCallback((fromId: string) => {
    const currentCells = cellsRef.current;
    const currentIndex = currentCells.findIndex(c => c.id === fromId);

    // Find the next code cell, skipping markdown cells
    for (let i = currentIndex + 1; i < currentCells.length; i++) {
      if (currentCells[i].type !== 'markdown') {
        const nextId = currentCells[i].id;
        setTimeout(() => {
          const el = document.querySelector(`[data-cell-id="${nextId}"] .cm-editor .cm-content`);
          if (el instanceof HTMLElement) el.focus();
        }, 100);
        return;
      }
    }

    // No code cell found after — create a new one at the end
    const newId = addCell(currentCells.length - 1, 'code');
    setTimeout(() => {
      const el = document.querySelector(`[data-cell-id="${newId}"] .cm-editor .cm-content`);
      if (el instanceof HTMLElement) el.focus();
    }, 100);
  }, []);

  const handleShiftEnter = useCallback((id: string) => {
    const cell = cellsRef.current.find(c => c.id === id);

    // For code cells: execute then move to next code cell
    if (cell?.type !== 'markdown') {
      executeCell(id);
    }

    focusNextCodeCell(id);
  }, [executeCell, focusNextCodeCell]);

  const executeAll = async () => {
    for (const cell of cellsRef.current) {
      if (cell.type === 'markdown') continue;
      await executeCell(cell.id);
    }
  };

  const handleSave = () => {
    const saveData: CNoteSaveFile = {
      version: 1,
      name: noteName,
      cells: cellsRef.current.map(cell => ({
        id: cell.id,
        type: cell.type,
        code: cell.code,
        output: cell.output,
        error: cell.error,
      })),
    };
    const safeName = (noteName || 'Untitled').replace(/[^a-zA-Z0-9_\-]/g, '_');
    const blob = new Blob([JSON.stringify(saveData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeName}.cnote`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleLoad = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.cnote';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text) as CNoteSaveFile;
        if (!data.version || !data.cells || !Array.isArray(data.cells)) {
          throw new Error('Invalid .cnote file');
        }
        setNoteName(data.name || 'Untitled');
        setCells(data.cells.map(cell => ({
          id: cell.id || crypto.randomUUID(),
          type: cell.type || 'code',
          code: cell.code,
          output: cell.output,
          error: cell.error,
          status: (cell.error ? 'error' : cell.output ? 'success' : 'idle') as CellData['status'],
        })));
        setGeneratedSource(null);
        setAutoFixMessages([]);
      } catch {
        alert('Failed to load file. Make sure it is a valid .cnote file.');
      }
    };
    input.click();
  };

  return (
    <div className="notebook-container">
      <header className="notebook-header glass-panel">
        <div className="logo-container">
          <div className="logo-icon">C</div>
          <h1>C-Note</h1>
          <span className="note-name-separator">/</span>
          <input
            className="note-name-input"
            value={noteName}
            onChange={(e) => setNoteName(e.target.value)}
            placeholder="Untitled"
            spellCheck={false}
          />
          <button className="glass-button note-file-button" onClick={handleSave} title="Save as .cnote file">
            <Save size={14} />
          </button>
          <button className="glass-button note-file-button" onClick={handleLoad} title="Load .cnote file">
            <FolderOpen size={14} />
          </button>
        </div>
        <div className="header-actions">
          {/* Auto-fix semicolons toggle */}
          <label className="toggle-label" title="Automatically fix missing semicolons and retry compilation">
            <Wrench size={14} />
            <span>Auto-fix ;</span>
            <div className={`toggle-switch ${autoFixSemicolons ? 'active' : ''}`} onClick={() => setAutoFixSemicolons(!autoFixSemicolons)}>
              <div className="toggle-knob" />
            </div>
          </label>

          {/* View generated source button */}
          <button 
            className="glass-button source-button" 
            onClick={() => setShowSourceView(true)}
            disabled={!generatedSource}
            title="View the generated C source code from the last execution"
          >
            <Code2 size={16} />
            <span>Source</span>
          </button>

          <button className="glass-button primary" onClick={executeAll}>
            Run All Cells
          </button>
        </div>
      </header>

      {/* Auto-fix notification */}
      {autoFixMessages.length > 0 && (
        <div className="autofix-notification glass-panel">
          <Wrench size={14} />
          <span>Auto-fixed: {autoFixMessages.join(', ')}</span>
        </div>
      )}

      <main className="notebook-content">
        {cells.map((cell, index) => (
          <div key={cell.id} className="cell-wrapper" data-cell-id={cell.id}>
            {cell.type === 'markdown' ? (
              <MarkdownCell
                cell={cell}
                onChange={updateCellCode}
                onDelete={deleteCell}
                onShiftEnter={handleShiftEnter}
              />
            ) : (
              <CodeCell
                cell={cell}
                previousCode={cells
                  .slice(0, index)
                  .filter(c => c.type !== 'markdown')
                  .map(c => c.code)}
                onChange={updateCellCode}
                onExecute={executeCell}
                onDelete={deleteCell}
                onShiftEnter={handleShiftEnter}
              />
            )}

            <div className="add-cell-divider">
              <button
                className="add-cell-button"
                onClick={() => addCell(index, 'code')}
                aria-label="Add code cell below"
                title="Add code cell"
              >
                <Plus size={16} />
              </button>
              <button
                className="add-cell-button add-md-button"
                onClick={() => addCell(index, 'markdown')}
                aria-label="Add markdown cell below"
                title="Add markdown cell"
              >
                <Type size={16} />
              </button>
              <div className="line" />
            </div>
          </div>
        ))}
      </main>

      {/* Source View Modal */}
      {showSourceView && generatedSource && (
        <SourceView
          code={generatedSource}
          fileName={noteName || 'Untitled'}
          onClose={() => setShowSourceView(false)}
        />
      )}
    </div>
  );
};
