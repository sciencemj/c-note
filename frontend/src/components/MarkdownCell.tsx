import { useState, useRef, useEffect } from 'react';
import type { CellData } from './CodeCell';
import { Trash2, Pencil, Eye } from 'lucide-react';
import './MarkdownCell.css';

interface MarkdownCellProps {
  cell: CellData;
  onChange: (id: string, code: string) => void;
  onDelete: (id: string) => void;
  onShiftEnter: (id: string) => void;
}

// Simple markdown to HTML renderer
function renderMarkdown(md: string): string {
  let html = md
    // Escape HTML
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Code blocks (``` ... ```)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, _lang, code) => {
    return `<pre><code>${code.trim()}</code></pre>`;
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Headers
  html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Bold and italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  // Horizontal rule
  html = html.replace(/^---$/gm, '<hr/>');

  // Unordered lists
  html = html.replace(/^[\t ]*[-*] (.+)$/gm, '<li>$1</li>');
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');

  // Paragraphs: split by double newlines
  html = html
    .split(/\n{2,}/)
    .map(block => {
      const trimmed = block.trim();
      if (!trimmed) return '';
      // Don't wrap blocks that are already HTML elements
      if (/^<(h[1-4]|ul|ol|pre|hr|blockquote)/.test(trimmed)) return trimmed;
      return `<p>${trimmed.replace(/\n/g, '<br/>')}</p>`;
    })
    .join('\n');

  return html;
}

export const MarkdownCell: React.FC<MarkdownCellProps> = ({ cell, onChange, onDelete, onShiftEnter }) => {
  const [editing, setEditing] = useState(!cell.code);
  const [isHovered, setIsHovered] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus();
      autoResize(textareaRef.current);
    }
  }, [editing]);

  const autoResize = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(cell.id, e.target.value);
    autoResize(e.target);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      setEditing(false);
      return;
    }

    // Shift+Enter: switch to preview and move to next code cell
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      setEditing(false);
      onShiftEnter(cell.id);
      return;
    }

    // Tab: insert \t instead of moving focus
    if (e.key === 'Tab') {
      e.preventDefault();
      const textarea = e.currentTarget;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const value = cell.code;
      const indent = '    '; // 4 spaces
      onChange(cell.id, value.substring(0, start) + indent + value.substring(end));
      // Restore cursor position after React re-render
      requestAnimationFrame(() => {
        textarea.selectionStart = textarea.selectionEnd = start + indent.length;
      });
    }
  };

  return (
    <div
      className={`cell-container markdown-cell ${isHovered ? 'hovered' : ''}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="cell-controls">
        <button
          className="glass-button md-toggle-button"
          onClick={() => setEditing(!editing)}
          title={editing ? 'Preview' : 'Edit'}
        >
          {editing ? <Eye size={16} /> : <Pencil size={16} />}
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

      <div className="cell-editor-wrapper glass-panel markdown-wrapper">
        <div className="markdown-badge">Markdown</div>
        {editing ? (
          <textarea
            ref={textareaRef}
            className="markdown-editor"
            value={cell.code}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder="Write markdown here..."
            rows={3}
          />
        ) : (
          <div
            className="markdown-preview"
            onDoubleClick={() => setEditing(true)}
            dangerouslySetInnerHTML={{ __html: renderMarkdown(cell.code) }}
          />
        )}
      </div>
    </div>
  );
};
