import { draggable } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { disableNativeDragPreview } from '@atlaskit/pragmatic-drag-and-drop/element/disable-native-drag-preview';
import { Link } from '@tanstack/react-router';
import { BadgeAlert, Check, Flag, Paperclip, Star } from 'lucide-react';
import {
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { mailMessageDragType } from '@/lib/mail/mail-drag';
import { formatMailDate } from '@/lib/mail/mail-utils';
import type { MailMessageSummary } from '@/lib/mail-types';
import { encodeRouteId } from '@/lib/route-ids';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { MailDragPreview } from '@/ui/mail/MailDragPreview';
import { MailAvatar } from '@/ui/mail/MailAvatar';

export function MessageListItem({
  folderId,
  isSelected,
  isKeyboardActive,
  isActionPending,
  isBulkSelected,
  dragMessages,
  message,
  onDragActiveChange,
  onMessageClick,
  onMessageFocus,
  onSelectionToggle,
}: {
  folderId: string;
  isSelected: boolean;
  isKeyboardActive: boolean;
  isActionPending: boolean;
  isBulkSelected: boolean;
  dragMessages: MailMessageSummary[];
  message: MailMessageSummary;
  onDragActiveChange: (isActive: boolean) => void;
  onMessageClick: (
    event: MouseEvent<HTMLAnchorElement>,
    message: MailMessageSummary,
  ) => void;
  onMessageFocus: (message: MailMessageSummary) => void;
  onSelectionToggle: (
    event: MouseEvent<HTMLButtonElement>,
    message: MailMessageSummary,
  ) => void;
}) {
  const dragRef = useRef<HTMLDivElement>(null);
  const dragHandleRef = useRef<HTMLAnchorElement>(null);
  const isActionPendingRef = useRef(isActionPending);
  const folderIdRef = useRef(folderId);
  const messageRef = useRef(message);
  const dragMessagesRef = useRef(dragMessages);
  const effectiveFolderId = message.folderId || folderId;
  const [isDragging, setIsDragging] = useState(false);
  const [dragPreview, setDragPreview] = useState<DragPreviewState>();

  const clearDragState = useCallback(() => {
    setIsDragging(false);
    setDragPreview(undefined);
    onDragActiveChange(false);
  }, [onDragActiveChange]);

  useEffect(() => {
    isActionPendingRef.current = isActionPending;
  }, [isActionPending]);

  useEffect(() => {
    folderIdRef.current = effectiveFolderId;
    messageRef.current = message;
    dragMessagesRef.current = dragMessages;
  }, [dragMessages, effectiveFolderId, message]);

  useEffect(() => {
    return clearDragState;
  }, [clearDragState]);

  useEffect(() => {
    const element = dragRef.current;
    const dragHandle = dragHandleRef.current;

    if (!element || !dragHandle) {
      return;
    }

    const cleanup = draggable({
      element,
      dragHandle,
      canDrag: () => !isActionPendingRef.current,
      getInitialData: () => ({
        type: mailMessageDragType,
        message: messageRef.current,
        messages: dragMessagesRef.current,
        sourceFolderId: folderIdRef.current,
        primaryMessageId: messageRef.current.id,
      }),
      onGenerateDragPreview: ({ nativeSetDragImage }) => {
        disableNativeDragPreview({ nativeSetDragImage });
      },
      onDragStart: ({ location }) => {
        const input = location.current.input;

        setIsDragging(true);
        setDragPreview({
          pointerX: input.clientX,
          pointerY: input.clientY,
        });
        onDragActiveChange(true);
      },
      onDrag: ({ location }) => {
        setDragPreview((current) =>
          current
            ? {
                ...current,
                pointerX: location.current.input.clientX,
                pointerY: location.current.input.clientY,
              }
            : current,
        );
      },
      onDrop: () => {
        clearDragState();
      },
    });

    return () => {
      cleanup();
      clearDragState();
    };
  }, [clearDragState]);

  return (
    <div
      ref={dragRef}
      data-mail-message-id={message.id}
      className={cn(
        'group relative min-w-0 overflow-hidden border-b transition-opacity',
        !isActionPending && 'cursor-grab active:cursor-grabbing',
        isDragging && 'opacity-50',
      )}
    >
      <button
        type="button"
        aria-label={`${isBulkSelected ? 'Deselect' : 'Select'} ${message.subject}`}
        aria-pressed={isBulkSelected}
        className={cn(
          'absolute top-4 left-3 z-10 flex size-4 items-center justify-center rounded border bg-card text-primary opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring',
          isBulkSelected && 'bg-primary text-primary-foreground opacity-100',
        )}
        onClick={(event) => onSelectionToggle(event, message)}
        onFocus={() => onMessageFocus(message)}
      >
        {isBulkSelected && <Check className="size-3" aria-hidden="true" />}
      </button>
      <Link
        ref={dragHandleRef}
        data-message-link
        draggable={false}
        to="/mail/$folderId/$messageId"
        params={{
          folderId: encodeRouteId(effectiveFolderId),
          messageId: encodeRouteId(message.id),
        }}
        className={cn(
          'block min-w-0 overflow-hidden px-3 py-3 transition-colors hover:bg-accent/70',
          isSelected && 'bg-accent',
          isBulkSelected && !isSelected && 'bg-primary/10',
          isKeyboardActive &&
            'ring-2 ring-inset ring-ring/70 focus-visible:ring-ring',
        )}
        onClick={(event) => onMessageClick(event, message)}
        onFocus={() => onMessageFocus(message)}
      >
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-1 size-4 shrink-0" aria-hidden="true" />
          <MailAvatar
            name={message.sender.name}
            email={message.sender.email}
            className="size-9"
          />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <p
                className={cn(
                  'min-w-0 truncate text-sm',
                  !message.isRead && 'font-semibold',
                )}
              >
                {message.sender.name}
              </p>
              {message.hasAttachments && (
                <MessageStatusIconTooltip label="Has attachments">
                  <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />
                </MessageStatusIconTooltip>
              )}
              {message.isStarred && (
                <MessageStatusIconTooltip label="Starred">
                  <Star className="size-3.5 shrink-0 text-amber-500" />
                </MessageStatusIconTooltip>
              )}
              {message.isFlagged && (
                <MessageStatusIconTooltip label="Flagged">
                  <Flag className="size-3.5 shrink-0 fill-rose-500 text-rose-500" />
                </MessageStatusIconTooltip>
              )}
              {message.isImportant && (
                <MessageStatusIconTooltip label="Important">
                  <BadgeAlert className="size-3.5 shrink-0 text-orange-500" />
                </MessageStatusIconTooltip>
              )}
              <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                {formatMailDate(message.receivedDateTime, 'short')}
              </span>
            </div>
            <p
              className={cn(
                'mt-1 truncate text-sm text-foreground',
                !message.isRead && 'font-medium',
              )}
            >
              {message.subject}
            </p>
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
              {message.preview}
            </p>
            {message.folderLabel && (
              <p className="mt-2 w-fit max-w-full truncate rounded-sm bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                {message.folderLabel}
              </p>
            )}
          </div>
        </div>
      </Link>
      {isDragging &&
        dragPreview &&
        createPortal(
          <div
            className="pointer-events-none fixed z-[2147483647]"
            style={{
              left: dragPreview.pointerX + 12,
              top: dragPreview.pointerY + 12,
            }}
          >
            <MailDragPreview message={message} count={dragMessages.length} />
          </div>,
          document.body,
        )}
    </div>
  );
}

function MessageStatusIconTooltip({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span aria-label={label} className="inline-flex shrink-0">
            {children}
          </span>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

interface DragPreviewState {
  pointerX: number;
  pointerY: number;
}
