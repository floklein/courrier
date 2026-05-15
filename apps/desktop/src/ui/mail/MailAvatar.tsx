import type { CSSProperties } from 'react';
import { Avatar, AvatarFallback } from '../../components/ui/avatar';
import { getInitials, getMailAvatarColor } from '../../lib/mail/mail-utils';

interface MailAvatarProps {
  name: string;
  email: string;
  className?: string;
}

type MailAvatarStyle = CSSProperties & {
  '--mail-avatar-bg': string;
  '--mail-avatar-fg': string;
  '--mail-avatar-bg-dark': string;
  '--mail-avatar-fg-dark': string;
};

export function MailAvatar({ name, email, className }: MailAvatarProps) {
  const colors = getMailAvatarColor(email || name);
  const style: MailAvatarStyle = {
    '--mail-avatar-bg': colors.lightBackground,
    '--mail-avatar-fg': colors.lightForeground,
    '--mail-avatar-bg-dark': colors.darkBackground,
    '--mail-avatar-fg-dark': colors.darkForeground,
  };

  return (
    <Avatar className={className}>
      <AvatarFallback
        className="bg-[var(--mail-avatar-bg)] text-[var(--mail-avatar-fg)] dark:bg-[var(--mail-avatar-bg-dark)] dark:text-[var(--mail-avatar-fg-dark)]"
        style={style}
      >
        {getInitials(name || email)}
      </AvatarFallback>
    </Avatar>
  );
}
