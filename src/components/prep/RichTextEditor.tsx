import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import Image from '@tiptap/extension-image';
import Highlight from '@tiptap/extension-highlight';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { useEffect, useCallback, useImperativeHandle, forwardRef } from 'react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough, Heading1, Heading2, Heading3,
  List, ListOrdered, CheckSquare, Quote, Code, Link as LinkIcon,
  Image as ImageIcon, Table as TableIcon, AlignLeft, AlignCenter, AlignRight,
  Highlighter, Undo2, Redo2, Minus,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import Showdown from 'showdown';
import TurndownService from 'turndown';

// Converters
const showdownConverter = new Showdown.Converter({
  tables: true,
  tasklists: true,
  strikethrough: true,
  ghCodeBlocks: true,
});

const turndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
});
// Add table support to turndown
turndownService.addRule('tableCell', {
  filter: ['th', 'td'],
  replacement: (content) => ` ${content.trim()} |`,
});
turndownService.addRule('tableRow', {
  filter: 'tr',
  replacement: (content) => `|${content}\n`,
});
turndownService.addRule('table', {
  filter: 'table',
  replacement: (content) => `\n${content}\n`,
});
turndownService.addRule('taskListItem', {
  filter: (node) => node.nodeName === 'LI' && node.getAttribute('data-type') === 'taskItem',
  replacement: (content, node) => {
    const checked = (node as HTMLElement).getAttribute('data-checked') === 'true';
    return `- [${checked ? 'x' : ' '}] ${content.trim()}\n`;
  },
});

export function markdownToHtml(md: string): string {
  return showdownConverter.makeHtml(md);
}

export function htmlToMarkdown(html: string): string {
  return turndownService.turndown(html);
}

export interface RichTextEditorRef {
  getMarkdown: () => string;
  setContent: (md: string) => void;
  insertContent: (text: string) => void;
  getHTML: () => string;
}

interface RichTextEditorProps {
  initialMarkdown: string;
  onChange?: (markdown: string) => void;
  className?: string;
}

const ToolbarButton = ({ active, onClick, title, children }: { active?: boolean; onClick: () => void; title: string; children: React.ReactNode }) => (
  <Button
    variant="ghost"
    size="icon"
    className={cn("h-7 w-7", active && "bg-accent text-accent-foreground")}
    onClick={onClick}
    title={title}
    type="button"
  >
    {children}
  </Button>
);

export const RichTextEditor = forwardRef<RichTextEditorRef, RichTextEditorProps>(
  ({ initialMarkdown, onChange, className }, ref) => {
    const editor = useEditor({
      extensions: [
        StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
        Table.configure({ resizable: true }),
        TableRow,
        TableCell,
        TableHeader,
        Link.configure({ openOnClick: false, HTMLAttributes: { class: 'text-primary underline cursor-pointer' } }),
        Placeholder.configure({ placeholder: 'Start writing... Use / for AI commands' }),
        Underline,
        TextAlign.configure({ types: ['heading', 'paragraph'] }),
        Image,
        Highlight.configure({ multicolor: false }),
        TaskList,
        TaskItem.configure({ nested: true }),
      ],
      content: markdownToHtml(initialMarkdown),
      onUpdate: ({ editor }) => {
        onChange?.(htmlToMarkdown(editor.getHTML()));
      },
      editorProps: {
        attributes: {
          class: 'prose prose-sm dark:prose-invert max-w-none min-h-[450px] focus:outline-none px-4 py-3',
        },
      },
    });

    useImperativeHandle(ref, () => ({
      getMarkdown: () => (editor ? htmlToMarkdown(editor.getHTML()) : ''),
      setContent: (md: string) => editor?.commands.setContent(markdownToHtml(md)),
      insertContent: (text: string) => editor?.commands.insertContent(markdownToHtml(text)),
      getHTML: () => editor?.getHTML() || '',
    }), [editor]);

    const addLink = useCallback(() => {
      if (!editor) return;
      const url = window.prompt('Enter URL:');
      if (url) editor.chain().focus().setLink({ href: url }).run();
    }, [editor]);

    const addImage = useCallback(() => {
      if (!editor) return;
      const url = window.prompt('Enter image URL:');
      if (url) editor.chain().focus().setImage({ src: url }).run();
    }, [editor]);

    const addTable = useCallback(() => {
      if (!editor) return;
      editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
    }, [editor]);

    if (!editor) return null;

    return (
      <div className={cn("border rounded-lg bg-card overflow-hidden", className)}>
        {/* Toolbar */}
        <div className="flex items-center gap-0.5 flex-wrap px-2 py-1.5 border-b border-border bg-muted/30">
          <ToolbarButton active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} title="Bold">
            <Bold className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} title="Italic">
            <Italic className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()} title="Underline">
            <UnderlineIcon className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()} title="Strikethrough">
            <Strikethrough className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton active={editor.isActive('highlight')} onClick={() => editor.chain().focus().toggleHighlight().run()} title="Highlight">
            <Highlighter className="h-3.5 w-3.5" />
          </ToolbarButton>

          <Separator orientation="vertical" className="h-5 mx-1" />

          <ToolbarButton active={editor.isActive('heading', { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} title="Heading 1">
            <Heading1 className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="Heading 2">
            <Heading2 className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} title="Heading 3">
            <Heading3 className="h-3.5 w-3.5" />
          </ToolbarButton>

          <Separator orientation="vertical" className="h-5 mx-1" />

          <ToolbarButton active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()} title="Bullet List">
            <List className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Numbered List">
            <ListOrdered className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton active={editor.isActive('taskList')} onClick={() => editor.chain().focus().toggleTaskList().run()} title="Task List">
            <CheckSquare className="h-3.5 w-3.5" />
          </ToolbarButton>

          <Separator orientation="vertical" className="h-5 mx-1" />

          <ToolbarButton active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()} title="Quote">
            <Quote className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton active={editor.isActive('codeBlock')} onClick={() => editor.chain().focus().toggleCodeBlock().run()} title="Code Block">
            <Code className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton onClick={() => editor.chain().focus().setHorizontalRule().run()} title="Divider">
            <Minus className="h-3.5 w-3.5" />
          </ToolbarButton>

          <Separator orientation="vertical" className="h-5 mx-1" />

          <ToolbarButton onClick={addLink} title="Link" active={editor.isActive('link')}>
            <LinkIcon className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton onClick={addImage} title="Image">
            <ImageIcon className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton onClick={addTable} title="Table">
            <TableIcon className="h-3.5 w-3.5" />
          </ToolbarButton>

          <Separator orientation="vertical" className="h-5 mx-1" />

          <ToolbarButton active={editor.isActive({ textAlign: 'left' })} onClick={() => editor.chain().focus().setTextAlign('left').run()} title="Align Left">
            <AlignLeft className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton active={editor.isActive({ textAlign: 'center' })} onClick={() => editor.chain().focus().setTextAlign('center').run()} title="Align Center">
            <AlignCenter className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton active={editor.isActive({ textAlign: 'right' })} onClick={() => editor.chain().focus().setTextAlign('right').run()} title="Align Right">
            <AlignRight className="h-3.5 w-3.5" />
          </ToolbarButton>

          <div className="ml-auto flex items-center gap-0.5">
            <ToolbarButton onClick={() => editor.chain().focus().undo().run()} title="Undo">
              <Undo2 className="h-3.5 w-3.5" />
            </ToolbarButton>
            <ToolbarButton onClick={() => editor.chain().focus().redo().run()} title="Redo">
              <Redo2 className="h-3.5 w-3.5" />
            </ToolbarButton>
          </div>
        </div>

        {/* Bubble menu for quick formatting */}
        {editor && (
          <BubbleMenu editor={editor} tippyOptions={{ duration: 150 }} className="flex items-center gap-0.5 bg-popover border border-border rounded-lg shadow-lg p-1">
            <ToolbarButton active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} title="Bold">
              <Bold className="h-3 w-3" />
            </ToolbarButton>
            <ToolbarButton active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} title="Italic">
              <Italic className="h-3 w-3" />
            </ToolbarButton>
            <ToolbarButton active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()} title="Underline">
              <UnderlineIcon className="h-3 w-3" />
            </ToolbarButton>
            <ToolbarButton active={editor.isActive('highlight')} onClick={() => editor.chain().focus().toggleHighlight().run()} title="Highlight">
              <Highlighter className="h-3 w-3" />
            </ToolbarButton>
            <ToolbarButton onClick={addLink} title="Link" active={editor.isActive('link')}>
              <LinkIcon className="h-3 w-3" />
            </ToolbarButton>
          </BubbleMenu>
        )}

        {/* Editor Content */}
        <EditorContent editor={editor} />
      </div>
    );
  }
);

RichTextEditor.displayName = 'RichTextEditor';
