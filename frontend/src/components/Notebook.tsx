import { useState, useCallback, useRef } from 'react';
import { CodeCell } from './CodeCell';
import type { CellData } from './CodeCell';
import { SourceView } from './SourceView';
import { Plus, Code2, Wrench } from 'lucide-react';
import './Notebook.css';

const API_URL = 'http://localhost:3001';

export const Notebook: React.FC = () => {
  const [cells, setCells] = useState<CellData[]>([
    {
      id: crypto.randomUUID(),
      code: '#include <stdio.h>\n\nprintf("Welcome to C-Note!\\n");',
      output: null,
      error: null,
      status: 'idle'
    }
  ]);

  const [autoFixSemicolons, setAutoFixSemicolons] = useState(true);
  const [generatedSource, setGeneratedSource] = useState<string | null>(null);
  const [showSourceView, setShowSourceView] = useState(false);
  const [autoFixMessages, setAutoFixMessages] = useState<string[]>([]);

  const cellsRef = useRef(cells);
  cellsRef.current = cells;

  const addCell = (index: number): string => {
    const newCell: CellData = {
      id: crypto.randomUUID(),
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
    const currentCells = cellsRef.current;
    setCells(currentCells.map(cell => 
      cell.id === id ? { ...cell, status: 'running', output: null, error: null } : cell
    ));
    setAutoFixMessages([]);

    try {
      const targetIndex = currentCells.findIndex(c => c.id === id);
      const executionContext = currentCells.slice(0, targetIndex + 1).map(c => c.code);

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

      setCells(cellsRef.current.map((cell, idx) => {
        // Apply auto-fixed code back to cells
        const fixedCode = data.fixedCells && idx <= targetIndex
          ? data.fixedCells[idx]
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
      }));
    } catch (err) {
      setCells(cellsRef.current.map(cell => 
        cell.id === id ? { 
          ...cell, 
          status: 'error', 
          error: err instanceof Error ? err.message : 'Unknown error occurred' 
        } : cell
      ));
    }
  }, [autoFixSemicolons]);

  const handleShiftEnter = useCallback((id: string) => {
    executeCell(id);

    const currentCells = cellsRef.current;
    const currentIndex = currentCells.findIndex(c => c.id === id);
    
    if (currentIndex < currentCells.length - 1) {
      const nextCellId = currentCells[currentIndex + 1].id;
      setTimeout(() => {
        const nextEl = document.querySelector(`[data-cell-id="${nextCellId}"] .cm-editor .cm-content`);
        if (nextEl instanceof HTMLElement) nextEl.focus();
      }, 100);
    } else {
      const newId = addCell(currentIndex);
      setTimeout(() => {
        const newEl = document.querySelector(`[data-cell-id="${newId}"] .cm-editor .cm-content`);
        if (newEl instanceof HTMLElement) newEl.focus();
      }, 100);
    }
  }, [executeCell]);

  const executeAll = async () => {
    for (const cell of cellsRef.current) {
      await executeCell(cell.id);
    }
  };

  return (
    <div className="notebook-container">
      <header className="notebook-header glass-panel">
        <div className="logo-container">
          <div className="logo-icon">C</div>
          <h1>C-Note</h1>
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
            <CodeCell
              cell={cell}
              onChange={updateCellCode}
              onExecute={executeCell}
              onDelete={deleteCell}
              onShiftEnter={handleShiftEnter}
            />
            
            <div className="add-cell-divider">
              <button 
                className="add-cell-button"
                onClick={() => addCell(index)}
                aria-label="Add cell below"
              >
                <Plus size={20} />
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
          onClose={() => setShowSourceView(false)} 
        />
      )}
    </div>
  );
};
