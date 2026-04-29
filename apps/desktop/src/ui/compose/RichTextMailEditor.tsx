import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import { StarterKit } from '@tiptap/starter-kit';
import { Link } from '@tiptap/extension-link';
import { Placeholder } from '@tiptap/extension-placeholder';
import { Underline } from '@tiptap/extension-underline';
import { useEffect, useState } from 'react';
import type { ComposeEditorValue } from '../../lib/compose-window';
import { cn } from '../../lib/utils';
import { RichTextMailEditorToolbar } from './RichTextMailEditorToolbar';

export type RichTextMailEditorValue = ComposeEditorValue;

export function RichTextMailEditor({
  className,
  disabled,
  initialValue,
  placeholder = 'Write a message',
  onChange,
}: {
  className?: string;
  disabled?: boolean;
  initialValue?: RichTextMailEditorValue;
  placeholder?: string;
  onChange: (value: RichTextMailEditorValue) => void;
}) {
  const [, setEditorVersion] = useState(0);
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

    const handleTransaction = () => {
      setEditorVersion((version) => version + 1);
    };

    editor.on('transaction', handleTransaction);

    return () => {
      editor.off('transaction', handleTransaction);
    };
  }, [editor]);

  return (
    <div
      className={cn(
        'flex min-h-0 flex-col gap-2',
        className,
      )}
    >
      <RichTextMailEditorToolbar
        editor={editor}
        disabled={disabled}
      />
      <EditorContent
        editor={editor}
        className={cn(
          'border-input focus-within:border-ring focus-within:ring-ring/50 flex min-h-36 w-full flex-1 flex-col rounded-md border bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none focus-within:ring-[3px] md:text-sm',
          '[&>.ProseMirror]:flex-1 [&>.ProseMirror]:overflow-y-auto [&>.ProseMirror]:outline-none',
          'prose-mail-editor',
          disabled && 'cursor-not-allowed opacity-50',
        )}
      />
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
