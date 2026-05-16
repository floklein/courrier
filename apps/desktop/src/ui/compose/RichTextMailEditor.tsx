import { containsFiles, getFiles } from '@atlaskit/pragmatic-drag-and-drop/external/file';
import { dropTargetForExternal } from '@atlaskit/pragmatic-drag-and-drop/external/adapter';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import { StarterKit } from '@tiptap/starter-kit';
import { Link } from '@tiptap/extension-link';
import { Placeholder } from '@tiptap/extension-placeholder';
import { Underline } from '@tiptap/extension-underline';
import { useEffect, useRef, useState } from 'react';
import type { ComposeEditorValue } from '@/lib/compose-window';
import { cn } from '@/lib/utils';
import { RichTextMailEditorToolbar } from '@/ui/compose/RichTextMailEditorToolbar';

export type RichTextMailEditorValue = ComposeEditorValue;

export function RichTextMailEditor({
  className,
  disabled,
  id,
  initialValue,
  onAddAttachments,
  placeholder = 'Write a message',
  onPickAttachments,
  onChange,
}: {
  className?: string;
  disabled?: boolean;
  id?: string;
  initialValue?: RichTextMailEditorValue;
  onAddAttachments?: (files: File[]) => void;
  placeholder?: string;
  onPickAttachments?: () => void;
  onChange: (value: RichTextMailEditorValue) => void;
}) {
  const [, setEditorVersion] = useState(0);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const editor = useEditor({
    editable: !disabled,
    extensions: [
      StarterKit.configure({
        code: false,
        codeBlock: false,
        heading: false,
        horizontalRule: false,
      }),
      Underline,
      Link.configure({
        autolink: true,
        defaultProtocol: 'https',
        openOnClick: false,
        HTMLAttributes: {
          rel: 'noopener noreferrer',
          target: '_blank',
        },
      }),
      Placeholder.configure({
        placeholder,
      }),
    ],
    content: initialValue?.html ?? '',
    editorProps: {
      attributes: {
        'aria-label': placeholder,
      },
    },
    onCreate: ({ editor }) => {
      onChange(getEditorValue(editor));
    },
    onUpdate: ({ editor }) => {
      onChange(getEditorValue(editor));
    },
    onSelectionUpdate: () => {
      setEditorVersion((version) => version + 1);
    },
  });

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [disabled, editor]);

  useEffect(() => {
    if (!editor) {
      return;
    }

    editor.setOptions({
      editorProps: {
        attributes: {
          'aria-label': placeholder,
        },
      },
    });
  }, [editor, id, placeholder]);

  useEffect(() => {
    if (!editor) {
      return;
    }

    const handleTransaction = () => {
      setEditorVersion((version) => version + 1);
    };

    editor.on('transaction', handleTransaction);

    return () => {
      editor.off('transaction', handleTransaction);
    };
  }, [editor]);

  useEffect(() => {
    const element = wrapperRef.current;

    if (!element || disabled || !onAddAttachments) {
      return;
    }

    return dropTargetForExternal({
      element,
      canDrop: ({ source }) => containsFiles({ source }),
      onDragEnter: () => setIsDraggingFiles(true),
      onDragLeave: () => setIsDraggingFiles(false),
      onDrop: ({ source }) => {
        setIsDraggingFiles(false);
        onAddAttachments(getFiles({ source }));
      },
    });
  }, [disabled, onAddAttachments]);

  return (
    <div
      ref={wrapperRef}
      className={cn(
        'border-input focus-within:border-ring focus-within:ring-ring/50 relative flex min-h-36 w-full flex-col rounded-md border bg-transparent text-base shadow-xs transition-[color,box-shadow] outline-none focus-within:ring-[3px] md:text-sm dark:bg-input/30',
        isDraggingFiles && 'border-primary ring-3 ring-primary/20',
        disabled && 'cursor-not-allowed opacity-50',
        className,
      )}
    >
      {id && (
        <textarea
          id={id}
          tabIndex={-1}
          className="sr-only"
          readOnly
          value={editor?.getText() ?? ''}
          aria-label={placeholder}
          onFocus={() => editor?.chain().focus().run()}
        />
      )}
      <div className="shrink-0 border-b px-2 py-2">
        <RichTextMailEditorToolbar
          editor={editor}
          disabled={disabled}
          onPickAttachments={onPickAttachments}
        />
      </div>
      <EditorContent
        editor={editor}
        className={cn(
          'flex min-h-0 flex-1 flex-col px-3 py-2',
          '[&>.ProseMirror]:flex-1 [&>.ProseMirror]:overflow-y-auto [&>.ProseMirror]:outline-none',
          'prose-mail-editor',
        )}
      />
      {isDraggingFiles && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-md border-2 border-dashed border-primary bg-background/85 text-sm font-medium text-foreground">
          Drop files to attach
        </div>
      )}
    </div>
  );
}

function getEditorValue(editor: Editor): RichTextMailEditorValue {
  return {
    html: editor.getHTML(),
    text: editor.getText(),
    isEmpty: editor.isEmpty,
  };
}
