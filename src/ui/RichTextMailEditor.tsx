import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import { StarterKit } from '@tiptap/starter-kit';
import { Link } from '@tiptap/extension-link';
import { Placeholder } from '@tiptap/extension-placeholder';
import { Underline } from '@tiptap/extension-underline';
import {
  Bold,
  Italic,
  type LucideIcon,
  Link as LinkIcon,
  List,
  ListOrdered,
  Quote,
  Redo2,
  Strikethrough,
  Underline as UnderlineIcon,
  Undo2,
  Unlink,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '../components/ui/button';
import { ButtonGroup } from '../components/ui/button-group';
import { Input } from '../components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../components/ui/popover';
import { Separator } from '../components/ui/separator';
import { Toggle } from '../components/ui/toggle';
import { cn } from '../lib/utils';

export interface RichTextMailEditorValue {
  html: string;
  text: string;
  isEmpty: boolean;
}

export function RichTextMailEditor({
  className,
  disabled,
  placeholder = 'Write a message',
  onChange,
}: {
  className?: string;
  disabled?: boolean;
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
    content: '',
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
        'flex min-h-0 flex-col overflow-hidden rounded-md border bg-background',
        className,
      )}
    >
      <EditorToolbar
        editor={editor}
        disabled={disabled}
      />
      <EditorContent
        editor={editor}
        className={cn(
          'flex min-h-36 flex-1 flex-col overflow-y-auto px-3 py-3 text-sm leading-6 [&>.ProseMirror]:flex-1',
          'prose-mail-editor',
          disabled && 'opacity-70',
        )}
      />
    </div>
  );
}

function EditorToolbar({
  editor,
  disabled,
}: {
  editor: Editor | null;
  disabled?: boolean;
}) {
  const [isLinkOpen, setIsLinkOpen] = useState(false);
  const [linkHref, setLinkHref] = useState('');
  const isDisabled = disabled || !editor;

  function openLinkEditor() {
    setLinkHref(editor?.getAttributes('link').href ?? '');
    setIsLinkOpen(true);
  }

  function applyLink() {
    const href = linkHref.trim();

    if (!editor) {
      return;
    }

    if (!href) {
      editor.chain().focus().unsetLink().run();
      setIsLinkOpen(false);
      return;
    }

    editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
    setIsLinkOpen(false);
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-card/60 p-2">
      <ButtonGroup aria-label="Text formatting">
        <ToolbarToggle
          pressed={Boolean(editor?.isActive('bold'))}
          label="Bold"
          disabled={isDisabled}
          onPressedChange={() => editor?.chain().focus().toggleBold().run()}
          icon={Bold}
        />
        <ToolbarToggle
          pressed={Boolean(editor?.isActive('italic'))}
          label="Italic"
          disabled={isDisabled}
          onPressedChange={() => editor?.chain().focus().toggleItalic().run()}
          icon={Italic}
        />
        <ToolbarToggle
          pressed={Boolean(editor?.isActive('underline'))}
          label="Underline"
          disabled={isDisabled}
          onPressedChange={() => editor?.chain().focus().toggleUnderline().run()}
          icon={UnderlineIcon}
        />
        <ToolbarToggle
          pressed={Boolean(editor?.isActive('strike'))}
          label="Strikethrough"
          disabled={isDisabled}
          onPressedChange={() => editor?.chain().focus().toggleStrike().run()}
          icon={Strikethrough}
        />
      </ButtonGroup>

      <Separator orientation="vertical" className="h-8" />

      <ButtonGroup aria-label="Paragraph formatting">
        <ToolbarToggle
          pressed={Boolean(editor?.isActive('bulletList'))}
          label="Bullet list"
          disabled={isDisabled}
          onPressedChange={() => editor?.chain().focus().toggleBulletList().run()}
          icon={List}
        />
        <ToolbarToggle
          pressed={Boolean(editor?.isActive('orderedList'))}
          label="Numbered list"
          disabled={isDisabled}
          onPressedChange={() => editor?.chain().focus().toggleOrderedList().run()}
          icon={ListOrdered}
        />
        <ToolbarToggle
          pressed={Boolean(editor?.isActive('blockquote'))}
          label="Quote"
          disabled={isDisabled}
          onPressedChange={() => editor?.chain().focus().toggleBlockquote().run()}
          icon={Quote}
        />
      </ButtonGroup>

      <Separator orientation="vertical" className="h-8" />

      <ButtonGroup aria-label="Link formatting">
        <Popover open={isLinkOpen} onOpenChange={setIsLinkOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant={editor?.isActive('link') ? 'secondary' : 'outline'}
              size="icon-sm"
              aria-label="Edit link"
              title="Edit link"
              disabled={isDisabled}
              onClick={openLinkEditor}
            >
              <LinkIcon data-icon="inline-start" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80" align="start">
            <form
              className="flex flex-col gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                applyLink();
              }}
            >
              <Input
                value={linkHref}
                onChange={(event) => setLinkHref(event.target.value)}
                placeholder="https://example.com"
                aria-label="Link URL"
              />
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsLinkOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" size="sm">
                  Apply
                </Button>
              </div>
            </form>
          </PopoverContent>
        </Popover>
        <ToolbarButton
          label="Remove link"
          disabled={isDisabled || !editor?.isActive('link')}
          onClick={() => editor?.chain().focus().unsetLink().run()}
          icon={Unlink}
        />
      </ButtonGroup>

      <Separator orientation="vertical" className="h-8" />

      <ButtonGroup aria-label="History">
        <ToolbarButton
          label="Undo"
          disabled={isDisabled || !editor?.can().undo()}
          onClick={() => editor?.chain().focus().undo().run()}
          icon={Undo2}
        />
        <ToolbarButton
          label="Redo"
          disabled={isDisabled || !editor?.can().redo()}
          onClick={() => editor?.chain().focus().redo().run()}
          icon={Redo2}
        />
      </ButtonGroup>
    </div>
  );
}

function ToolbarToggle({
  icon: Icon,
  label,
  ...props
}: React.ComponentProps<typeof Toggle> & {
  icon: LucideIcon;
  label: string;
}) {
  return (
    <Toggle
      variant="outline"
      size="sm"
      aria-label={label}
      title={label}
      {...props}
    >
      <Icon data-icon="inline-start" />
    </Toggle>
  );
}

function ToolbarButton({
  icon: Icon,
  label,
  ...props
}: React.ComponentProps<typeof Button> & {
  icon: LucideIcon;
  label: string;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="icon-sm"
      aria-label={label}
      title={label}
      {...props}
    >
      <Icon data-icon="inline-start" />
    </Button>
  );
}

function getEditorValue(editor: Editor): RichTextMailEditorValue {
  return {
    html: editor.getHTML(),
    text: editor.getText(),
    isEmpty: editor.isEmpty,
  };
}
