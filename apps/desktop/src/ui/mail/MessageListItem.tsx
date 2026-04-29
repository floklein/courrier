import { draggable } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { disableNativeDragPreview } from '@atlaskit/pragmatic-drag-and-drop/element/disable-native-drag-preview';
import { Link } from '@tanstack/react-router';
import { Paperclip } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Avatar, AvatarFallback } from '../../components/ui/avatar';
import { mailMessageDragType } from '../../lib/mail/mail-drag';
import { formatMailDate, getInitials } from '../../lib/mail/mail-utils';
import type { MailMessageSummary } from '../../lib/mail-types';
import { encodeRouteId } from '../../lib/route-ids';
import { cn } from '../../lib/utils';
import { MailDragPreview } from './MailDragPreview';

export function MessageListItem({
  folderId,
  isSelected,
  isActionPending,
  message,
  onDragActiveChange,
}: {
  folderId: string;
  isSelected: boolean;
  isActionPending: boolean;
  message: MailMessageSummary;
  onDragActiveChange: (isActive: boolean) => void;
}) {
  const dragRef = useRef<HTMLDivElement>(null);
  const isActionPendingRef = useRef(isActionPending);
  const folderIdRef = useRef(folderId);
  const messageRef = useRef(message);
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
  }, [folderId, message]);

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
        sourceFolderId: folderIdRef.current,
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
        )}
      >
        <div className="flex min-w-0 items-start gap-3">
          <Avatar className="size-9">
            <AvatarFallback>{getInitials(message.sender.name)}</AvatarFallback>
          </Avatar>
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
            <MailDragPreview message={message} />
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
