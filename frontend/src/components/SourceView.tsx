import { useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { cpp } from '@codemirror/lang-cpp';
import { X, Copy, Check, Download } from 'lucide-react';
import './SourceView.css';

interface SourceViewProps {
  code: string;
  fileName: string;
  onClose: () => void;
}

export const SourceView: React.FC<SourceViewProps> = ({ code, fileName, onClose }) => {
  const [copied, setCopied] = useState(false);

  // Hide CELL_OUTPUT_BOUNDARY and memory tracker from the source view
  const cleanedCode = (() => {
    const lines = code.split('\n');
    const result: string[] = [];
    let inTracker = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes('C-Note Memory Leak Tracker')) { inTracker = true; continue; }
      if (inTracker) {
        if (line.includes('End Memory Leak Tracker')) { inTracker = false; }
        continue;
      }
      if (line.includes('CELL_OUTPUT_BOUNDARY')) continue;
      if (i > 0 && lines[i - 1]?.includes('CELL_OUTPUT_BOUNDARY') && line.trim().startsWith('fflush')) continue;
      result.push(line);
    }
    return result.join('\n');
  })();

  const handleCopy = async () => {
    await navigator.clipboard.writeText(cleanedCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const safeName = fileName.replace(/[^a-zA-Z0-9_\-]/g, '_');
    const blob = new Blob([cleanedCode], { type: 'text/x-c' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeName}.c`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="source-view-overlay" onClick={onClose}>
      <div className="source-view-panel glass-panel" onClick={(e) => e.stopPropagation()}>
        <div className="source-view-header">
          <h3>Generated C Source</h3>
          <span className="source-view-badge">Read-only</span>
          <div className="source-view-actions">
            <button className="glass-button source-action-button" onClick={handleCopy} title="Copy to clipboard">
              {copied ? <Check size={16} /> : <Copy size={16} />}
              <span>{copied ? 'Copied!' : 'Copy'}</span>
            </button>
            <button className="glass-button source-action-button" onClick={handleDownload} title={`Download as ${fileName}.c`}>
              <Download size={16} />
              <span>Download</span>
            </button>
          </div>
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
