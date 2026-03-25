import { useState, useCallback, useRef, useEffect } from 'react';
import { CodeCell } from './CodeCell';
import type { CellData } from './CodeCell';
import { MarkdownCell } from './MarkdownCell';
import { SourceView } from './SourceView';
import { Plus, Code2, Wrench, Save, FolderOpen, Type, GripVertical, Check, Loader, ShieldCheck } from 'lucide-react';
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
const AUTOSAVE_INTERVAL = 30_000; // 30 seconds
const AUTOSAVE_DEBOUNCE = 2_000; // 2 seconds after last edit

type AutosaveStatus = 'idle' | 'saving' | 'saved' | 'error';

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
  const [memoryCheck, setMemoryCheck] = useState(false);
  const [generatedSource, setGeneratedSource] = useState<string | null>(null);
  const [showSourceView, setShowSourceView] = useState(false);
  const [autoFixMessages, setAutoFixMessages] = useState<string[]>([]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [autosaveStatus, setAutosaveStatus] = useState<AutosaveStatus>('idle');
  const [hasFileHandle, setHasFileHandle] = useState(false);

  const cellsRef = useRef(cells);
  cellsRef.current = cells;

  const fileHandleRef = useRef<FileSystemFileHandle | null>(null);
  const noteNameRef = useRef(noteName);
  noteNameRef.current = noteName;
  const autosaveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const buildSaveData = useCallback((): CNoteSaveFile => ({
    version: 1,
    name: noteNameRef.current,
    cells: cellsRef.current.map(cell => ({
      id: cell.id,
      type: cell.type,
      code: cell.code,
      output: cell.output,
      error: cell.error,
    })),
  }), []);

  const writeToFileHandle = useCallback(async (handle: FileSystemFileHandle) => {
    setAutosaveStatus('saving');
    try {
      const writable = await handle.createWritable();
      await writable.write(JSON.stringify(buildSaveData(), null, 2));
      await writable.close();
      setAutosaveStatus('saved');
      setTimeout(() => setAutosaveStatus(prev => prev === 'saved' ? 'idle' : prev), 2000);
    } catch {
      setAutosaveStatus('error');
    }
  }, [buildSaveData]);

  // Autosave on interval
  useEffect(() => {
    if (!fileHandleRef.current) return;
    const interval = setInterval(() => {
      if (fileHandleRef.current) {
        writeToFileHandle(fileHandleRef.current);
      }
    }, AUTOSAVE_INTERVAL);
    return () => clearInterval(interval);
  }, [writeToFileHandle, autosaveStatus]);

  // Debounced autosave on cell/name changes
  const triggerAutosave = useCallback(() => {
    if (!fileHandleRef.current) return;
    if (autosaveDebounceRef.current) clearTimeout(autosaveDebounceRef.current);
    autosaveDebounceRef.current = setTimeout(() => {
      if (fileHandleRef.current) {
        writeToFileHandle(fileHandleRef.current);
      }
    }, AUTOSAVE_DEBOUNCE);
  }, [writeToFileHandle]);

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
    triggerAutosave();
  };

  const deleteCell = (id: string) => {
    if (cellsRef.current.length > 1) {
      setCells(cellsRef.current.filter(cell => cell.id !== id));
    }
  };

  const handleDragStart = (index: number) => {
    setDragIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverIndex(index);
  };

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === dropIndex) {
      setDragIndex(null);
      setDragOverIndex(null);
      return;
    }
    const newCells = [...cellsRef.current];
    const [moved] = newCells.splice(dragIndex, 1);
    newCells.splice(dropIndex, 0, moved);
    setCells(newCells);
    setDragIndex(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    setDragIndex(null);
    setDragOverIndex(null);
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
          autoFixSemicolonsEnabled: autoFixSemicolons,
          memoryCheckEnabled: memoryCheck
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
              error: data.error || null,
              memoryLeaks: data.memoryLeaks || null
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
  }, [autoFixSemicolons, memoryCheck]);

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

  const handleSave = async () => {
    // If we already have a file handle, save directly
    if (fileHandleRef.current) {
      await writeToFileHandle(fileHandleRef.current);
      return;
    }
    await handleSaveAs();
  };

  const handleSaveAs = async () => {
    const safeName = (noteName || 'Untitled').replace(/[^a-zA-Z0-9_\-]/g, '_');

    // Try File System Access API (allows picking a path)
    if ('showSaveFilePicker' in window) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: `${safeName}.cnote`,
          types: [{
            description: 'C-Note files',
            accept: { 'application/json': ['.cnote'] },
          }],
        });
        fileHandleRef.current = handle;
        setHasFileHandle(true);
        await writeToFileHandle(handle);
        return;
      } catch (err) {
        // User cancelled the picker
        if (err instanceof DOMException && err.name === 'AbortError') return;
      }
    }

    // Fallback: browser download
    const blob = new Blob([JSON.stringify(buildSaveData(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeName}.cnote`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const loadFromData = (data: CNoteSaveFile) => {
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
  };

  const handleLoad = async () => {
    // Try File System Access API
    if ('showOpenFilePicker' in window) {
      try {
        const [handle] = await window.showOpenFilePicker({
          types: [{
            description: 'C-Note files',
            accept: { 'application/json': ['.cnote'] },
          }],
          multiple: false,
        });
        const file = await handle.getFile();
        const text = await file.text();
        const data = JSON.parse(text) as CNoteSaveFile;
        loadFromData(data);
        fileHandleRef.current = handle; // Enable autosave to this file
        setHasFileHandle(true);
        setAutosaveStatus('idle');
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
      }
    }

    // Fallback: file input
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.cnote';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text) as CNoteSaveFile;
        loadFromData(data);
        fileHandleRef.current = null; // No handle from input fallback
        setHasFileHandle(false);
      } catch {
        alert('Failed to load file. Make sure it is a valid .cnote file.');
      }
    };
    input.click();
  };

  // Ctrl+S / Cmd+S to save
  const handleSaveRef = useRef(handleSave);
  handleSaveRef.current = handleSave;
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSaveRef.current();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

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
            onChange={(e) => { setNoteName(e.target.value); triggerAutosave(); }}
            placeholder="Untitled"
            spellCheck={false}
          />
          <button className="glass-button note-file-button" onClick={handleSave} title="Save (Ctrl+S)">
            <Save size={14} />
          </button>
          <button className="glass-button note-file-button" onClick={handleSaveAs} title="Save As...">
            <Save size={14} /><span className="save-as-label">As</span>
          </button>
          <button className="glass-button note-file-button" onClick={handleLoad} title="Open .cnote file">
            <FolderOpen size={14} />
          </button>
          {hasFileHandle && (
            <span className={`autosave-indicator ${autosaveStatus}`}>
              {autosaveStatus === 'saving' && <><Loader size={12} className="spin" /> Saving...</>}
              {autosaveStatus === 'saved' && <><Check size={12} /> Saved</>}
              {autosaveStatus === 'error' && <>Save failed</>}
            </span>
          )}
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

          {/* Memory leak detection toggle */}
          <label className="toggle-label" title="Detect memory leaks and auto-free unfreed allocations at exit">
            <ShieldCheck size={14} />
            <span>Leak Check</span>
            <div className={`toggle-switch ${memoryCheck ? 'active' : ''}`} onClick={() => setMemoryCheck(!memoryCheck)}>
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
          <div
            key={cell.id}
            className={`cell-wrapper ${dragIndex === index ? 'dragging' : ''} ${dragOverIndex === index && dragIndex !== index ? 'drag-over' : ''}`}
            data-cell-id={cell.id}
            onDragOver={(e) => handleDragOver(e, index)}
            onDrop={(e) => handleDrop(e, index)}
            onDragEnd={handleDragEnd}
          >
            <div className="cell-with-handle">
              <div
                className="drag-handle"
                draggable
                onDragStart={() => handleDragStart(index)}
                title="Drag to reorder"
              >
                <GripVertical size={16} />
              </div>
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
            </div>

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
