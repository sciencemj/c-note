import { useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { cpp } from '@codemirror/lang-cpp';
import { Play, Loader2, Trash2 } from 'lucide-react';
import './CodeCell.css';

export interface CellData {
  id: string;
  type: 'code' | 'markdown';
  code: string;
  output: string | null;
  error: string | null;
  status: 'idle' | 'running' | 'success' | 'error';
}

interface CodeCellProps {
  cell: CellData;
  onChange: (id: string, code: string) => void;
  onExecute: (id: string) => void;
  onDelete: (id: string) => void;
  onShiftEnter: (id: string) => void;
}

export const CodeCell: React.FC<CodeCellProps> = ({ cell, onChange, onExecute, onDelete, onShiftEnter }) => {
  const [isHovered, setIsHovered] = useState(false);

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
          extensions={[cpp()]}
          theme="dark"
          onChange={(value) => onChange(cell.id, value)}
          className="editor"
          basicSetup={{
            lineNumbers: true,
            highlightActiveLine: false,
            foldGutter: false,
            autocompletion: true,
          }}
        />
        
        {(cell.output || cell.error) && (
          <div className={`cell-output ${cell.error ? 'has-error' : ''}`}>
            {cell.output && <pre className="stdout">{cell.output}</pre>}
            {cell.error && <pre className="stderr">{cell.error}</pre>}
          </div>
        )}
      </div>
    </div>
  );
};
