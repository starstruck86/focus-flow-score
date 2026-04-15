/**
 * ComposerAttachments — drag-drop, paste, upload attachment rail for the command composer.
 * Compact, elegant, native to the composer surface.
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import {
  Paperclip, X, FileText, Image as ImageIcon, Link2, Upload,
  File as FileIcon,
} from 'lucide-react';

export interface Attachment {
  id: string;
  type: 'file' | 'image' | 'url';
  name: string;
  file?: File;
  url?: string;
  preview?: string;
  mimeType?: string;
  size?: number;
}

interface Props {
  attachments: Attachment[];
  onAdd: (attachments: Attachment[]) => void;
  onRemove: (id: string) => void;
  disabled?: boolean;
}

const ACCEPTED_EXTENSIONS = '.pdf,.png,.jpg,.jpeg,.webp,.gif,.txt,.md,.csv,.doc,.docx';

function getAttachmentIcon(att: Attachment) {
  if (att.type === 'url') return Link2;
  if (att.type === 'image') return ImageIcon;
  if (att.mimeType?.includes('pdf')) return FileText;
  return FileIcon;
}

function formatSize(bytes?: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

let _attachmentId = 0;
function nextId() { return `att-${++_attachmentId}-${Date.now()}`; }

export function ComposerAttachments({ attachments, onAdd, onRemove, disabled }: Props) {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);

  const processFiles = useCallback((files: FileList | File[]) => {
    const newAttachments: Attachment[] = [];
    for (const file of Array.from(files)) {
      const isImage = file.type.startsWith('image/');
      const att: Attachment = {
        id: nextId(),
        type: isImage ? 'image' : 'file',
        name: file.name,
        file,
        mimeType: file.type,
        size: file.size,
      };
      if (isImage) {
        const reader = new FileReader();
        reader.onload = (e) => {
          att.preview = e.target?.result as string;
          onAdd([{ ...att }]);
        };
        reader.readAsDataURL(file);
      }
      newAttachments.push(att);
    }
    if (newAttachments.length > 0) onAdd(newAttachments);
  }, [onAdd]);

  const processUrl = useCallback((url: string) => {
    const trimmed = url.trim();
    if (!trimmed) return;
    try {
      new URL(trimmed);
      onAdd([{
        id: nextId(),
        type: 'url',
        name: trimmed.length > 50 ? trimmed.slice(0, 47) + '…' : trimmed,
        url: trimmed,
      }]);
    } catch { /* ignore */ }
  }, [onAdd]);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    dragCounterRef.current++;
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDragging(false);
    const text = e.dataTransfer.getData('text/plain');
    if (text && text.startsWith('http')) { processUrl(text); return; }
    if (e.dataTransfer.files.length > 0) processFiles(e.dataTransfer.files);
  }, [processFiles, processUrl]);

  const handlePaste = useCallback((e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (const item of Array.from(items)) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) files.push(file);
      } else if (item.kind === 'string' && item.type === 'text/plain') {
        item.getAsString(text => {
          if (text.startsWith('http://') || text.startsWith('https://')) processUrl(text);
        });
      }
    }
    if (files.length > 0) { e.preventDefault(); processFiles(files); }
  }, [processFiles, processUrl]);

  useEffect(() => {
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  });

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) { processFiles(e.target.files); e.target.value = ''; }
  }, [processFiles]);

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className="relative"
    >
      {/* Drop overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-10 rounded-xl border-2 border-dashed border-primary/30 bg-primary/[0.03] flex items-center justify-center pointer-events-none">
          <div className="flex items-center gap-2 text-primary/50 text-[12px] font-medium">
            <Upload className="h-3.5 w-3.5" />
            Drop files here
          </div>
        </div>
      )}

      {/* Attachment chips + add button */}
      {(attachments.length > 0 || !disabled) && (
        <div className="flex items-center gap-1.5 flex-wrap mt-1.5 px-0.5">
          {attachments.map(att => {
            const Icon = getAttachmentIcon(att);
            return (
              <span
                key={att.id}
                className={cn(
                  'inline-flex items-center gap-1.5 text-[11px] font-medium',
                  'pl-2 pr-1 py-1 rounded-lg border shrink-0',
                  'border-border/15 bg-card/40 text-foreground/55',
                  'animate-in fade-in-0 zoom-in-95 duration-100',
                  att.type === 'image' && 'border-violet-500/10 bg-violet-500/[0.03]',
                  att.type === 'url' && 'border-sky-500/10 bg-sky-500/[0.03]',
                )}
              >
                {att.preview ? (
                  <img src={att.preview} alt="" className="h-4 w-4 rounded-sm object-cover" />
                ) : (
                  <Icon className={cn(
                    'h-3 w-3',
                    att.type === 'image' ? 'text-violet-400/50' : att.type === 'url' ? 'text-sky-400/50' : 'text-muted-foreground/40'
                  )} />
                )}
                <span className="truncate max-w-[130px]">{att.name}</span>
                {att.size && (
                  <span className="text-muted-foreground/25 text-[10px]">{formatSize(att.size)}</span>
                )}
                <button
                  onClick={() => onRemove(att.id)}
                  className="rounded-md hover:bg-foreground/5 p-0.5 transition-colors"
                  tabIndex={-1}
                >
                  <X className="h-2.5 w-2.5 text-muted-foreground/30 hover:text-muted-foreground/60" />
                </button>
              </span>
            );
          })}

          {/* Add attachment button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
            className={cn(
              'inline-flex items-center gap-1 text-[11px] text-muted-foreground/25',
              'hover:text-muted-foreground/45 px-1.5 py-1 rounded-md transition-colors duration-100',
              'hover:bg-muted/15',
              disabled && 'opacity-50 pointer-events-none'
            )}
          >
            <Paperclip className="h-3 w-3" />
            {attachments.length === 0 && 'Attach files, images, or links'}
          </button>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ACCEPTED_EXTENSIONS}
            onChange={handleFileSelect}
            className="hidden"
          />
        </div>
      )}
    </div>
  );
}
