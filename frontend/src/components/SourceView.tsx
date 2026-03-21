import CodeMirror from '@uiw/react-codemirror';
import { cpp } from '@codemirror/lang-cpp';
import { X } from 'lucide-react';
import './SourceView.css';

interface SourceViewProps {
  code: string;
  onClose: () => void;
}

export const SourceView: React.FC<SourceViewProps> = ({ code, onClose }) => {
  // Hide CELL_OUTPUT_BOUNDARY printf/fflush lines from the source view
  const cleanedCode = code.split('\n').filter((line, i, arr) => {
    if (line.includes('CELL_OUTPUT_BOUNDARY')) return false;
    // Also hide the fflush line that immediately follows the boundary printf
    if (i > 0 && arr[i - 1]?.includes('CELL_OUTPUT_BOUNDARY') && line.trim().startsWith('fflush')) return false;
    return true;
  }).join('\n');

  return (
    <div className="source-view-overlay" onClick={onClose}>
      <div className="source-view-panel glass-panel" onClick={(e) => e.stopPropagation()}>
        <div className="source-view-header">
          <h3>Generated C Source</h3>
          <span className="source-view-badge">Read-only</span>
          <button className="glass-button source-view-close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="source-view-editor">
          <CodeMirror
            value={cleanedCode}
            height="100%"
            extensions={[cpp()]}
            theme="dark"
            readOnly={true}
            editable={false}
            basicSetup={{
              lineNumbers: true,
              highlightActiveLine: false,
              foldGutter: true,
              autocompletion: false,
            }}
          />
        </div>
      </div>
    </div>
  );
};
