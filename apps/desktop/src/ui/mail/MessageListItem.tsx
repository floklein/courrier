import { draggable } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { disableNativeDragPreview } from '@atlaskit/pragmatic-drag-and-drop/element/disable-native-drag-preview';
import { Link } from '@tanstack/react-router';
import { Check, Paperclip } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { mailMessageDragType } from '@/lib/mail/mail-drag';
import { formatMailDate } from '@/lib/mail/mail-utils';
import type { MailMessageSummary } from '@/lib/mail-types';
import { encodeRouteId } from '@/lib/route-ids';
import { cn } from '@/lib/utils';
import { MailDragPreview } from '@/ui/mail/MailDragPreview';
import { MailAvatar } from '@/ui/mail/MailAvatar';

export function MessageListItem({
  folderId,
  isSelected,
  isActionPending,
  isBulkSelected,
  dragMessages,
  message,
  onDragActiveChange,
  onMessageClick,
}: {
  folderId: string;
  isSelected: boolean;
  isActionPending: boolean;
  isBulkSelected: boolean;
  dragMessages: MailMessageSummary[];
  message: MailMessageSummary;
  onDragActiveChange: (isActive: boolean) => void;
  onMessageClick: (
    event: MouseEvent<HTMLAnchorElement>,
    message: MailMessageSummary,
  ) => void;
}) {
  const dragRef = useRef<HTMLDivElement>(null);
  const isActionPendingRef = useRef(isActionPending);
  const folderIdRef = useRef(folderId);
  const messageRef = useRef(message);
  const dragMessagesRef = useRef(dragMessages);
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
    folderIdRef.current = folderId;
    messageRef.current = message;
    dragMessagesRef.current = dragMessages;
  }, [dragMessages, folderId, message]);

  useEffect(() => {
    return clearDragState;
  }, [clearDragState]);

  useEffect(() => {
    const element = dragRef.current;

    if (!element) {
      return;
    }

    const cleanup = draggable({
      element,
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
        'group min-w-0 overflow-hidden border-b transition-opacity',
        !isActionPending && 'cursor-grab active:cursor-grabbing',
        isDragging && 'opacity-50',
      )}
    >
      <Link
        draggable={false}
        to="/mail/$folderId/$messageId"
        params={{
          folderId: encodeRouteId(folderId),
          messageId: encodeRouteId(message.id),
        }}
          className={cn(
          'block min-w-0 overflow-hidden px-3 py-3 transition-colors hover:bg-accent/70',
          isSelected && 'bg-accent',
          isBulkSelected && !isSelected && 'bg-primary/10',
        )}
        onClick={(event) => onMessageClick(event, message)}
      >
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={cn(
              'mt-1 flex size-4 shrink-0 items-center justify-center rounded border text-primary opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100',
              isBulkSelected && 'opacity-100 bg-primary text-primary-foreground',
            )}
            aria-hidden="true"
          >
            {isBulkSelected && <Check className="size-3" />}
          </span>
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
                <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />
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

interface DragPreviewState {
  pointerX: number;
  pointerY: number;
}
