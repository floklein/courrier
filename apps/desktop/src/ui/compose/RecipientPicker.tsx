import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ClipboardEvent, KeyboardEvent } from 'react';
import { Avatar, AvatarFallback } from '../../components/ui/avatar';
import { Button } from '../../components/ui/button';
import type {
  MailComposeRecipient,
  MailPersonSuggestion,
} from '../../lib/mail-types';
import { mailPeopleQueryOptions } from '../../lib/mail/mail-query-options';
import { getInitials } from '../../lib/mail/mail-utils';
import { parseRecipients } from '../../lib/mail/mail-compose-utils';
import { cn } from '../../lib/utils';

const recipientSeparators = new Set([',', ';']);

export function RecipientPicker({
  id,
  value,
  inputValue,
  disabled,
  invalid,
  onChange,
  onInputChange,
}: {
  id: string;
  value: MailComposeRecipient[];
  inputValue: string;
  disabled?: boolean;
  invalid?: boolean;
  onChange: (recipients: MailComposeRecipient[]) => void;
  onInputChange: (value: string) => void;
}) {
  const listboxId = useId();
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [isFocused, setIsFocused] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const debouncedInputValue = useDebouncedValue(inputValue, 250);
  const peopleQuery = useQuery({
    ...mailPeopleQueryOptions(debouncedInputValue),
    enabled: isFocused && !disabled,
  });
  const selectedEmails = useMemo(
    () => new Set(value.map((recipient) => recipient.email.toLowerCase())),
    [value],
  );
  const suggestions = useMemo(
    () =>
      (peopleQuery.data ?? []).filter(
        (person) => !selectedEmails.has(person.email.toLowerCase()),
      ),
    [peopleQuery.data, selectedEmails],
  );
  const isOpen = isFocused && !disabled;

  useEffect(() => {
    setHighlightedIndex(0);
  }, [debouncedInputValue]);

  useEffect(() => {
    if (highlightedIndex >= suggestions.length) {
      setHighlightedIndex(Math.max(suggestions.length - 1, 0));
    }
  }, [highlightedIndex, suggestions.length]);

  function addRecipient(recipient: MailComposeRecipient) {
    const email = recipient.email.toLowerCase();

    if (selectedEmails.has(email)) {
      onInputChange('');
      return;
    }

    onChange([...value, recipient]);
    onInputChange('');
  }

  function removeRecipient(email: string) {
    onChange(
      value.filter(
        (recipient) => recipient.email.toLowerCase() !== email.toLowerCase(),
      ),
    );
  }

  function commitInput() {
    const parsed = parseRecipients(inputValue);

    if (parsed.invalid.length > 0 || parsed.valid.length === 0) {
      return false;
    }

    addRecipients(parsed.valid);
    onInputChange('');
    return true;
  }

  function addRecipients(recipients: MailComposeRecipient[]) {
    const nextRecipients = [...value];
    const nextEmails = new Set(selectedEmails);

    for (const recipient of recipients) {
      const email = recipient.email.toLowerCase();

      if (nextEmails.has(email)) {
        continue;
      }

      nextEmails.add(email);
      nextRecipients.push(recipient);
    }

    onChange(nextRecipients);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' && suggestions.length > 0) {
      event.preventDefault();
      setHighlightedIndex((current) => {
        const nextIndex = current + 1 >= suggestions.length ? 0 : current + 1;

        scrollOptionIntoView(nextIndex);
        return nextIndex;
      });
      return;
    }

    if (event.key === 'ArrowUp' && suggestions.length > 0) {
      event.preventDefault();
      setHighlightedIndex((current) => {
        const nextIndex = current - 1 < 0 ? suggestions.length - 1 : current - 1;

        scrollOptionIntoView(nextIndex);
        return nextIndex;
      });
      return;
    }

    if (event.key === 'Backspace' && !inputValue && value.length > 0) {
      event.preventDefault();
      onChange(value.slice(0, -1));
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      const suggestion = suggestions[highlightedIndex];

      if (suggestion) {
        addRecipient(personToRecipient(suggestion));
        return;
      }

      commitInput();
      return;
    }

    if (event.key === 'Tab' && inputValue.trim()) {
      if (commitInput()) {
        event.preventDefault();
      }
      return;
    }

    if (recipientSeparators.has(event.key)) {
      event.preventDefault();
      commitInput();
    }
  }

  function scrollOptionIntoView(index: number) {
    window.requestAnimationFrame(() => {
      optionRefs.current[index]?.scrollIntoView({
        block: 'nearest',
      });
    });
  }

  function handlePaste(event: ClipboardEvent<HTMLInputElement>) {
    const text = event.clipboardData.getData('text');

    if (!/[;,]/.test(text)) {
      return;
    }

    const parsed = parseRecipients(text);

    if (parsed.valid.length === 0 || parsed.invalid.length > 0) {
      return;
    }

    event.preventDefault();
    addRecipients(parsed.valid);
    onInputChange('');
  }

  return (
    <div className="relative">
      <div
        className={cn(
          'flex min-h-9 w-full flex-wrap items-center gap-1 rounded-md border border-input bg-transparent px-2 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 dark:bg-input/30',
          invalid && 'border-destructive ring-[3px] ring-destructive/20',
          disabled && 'opacity-50',
        )}
        onClick={() => {
          document.getElementById(id)?.focus();
        }}
      >
        {value.map((recipient) => (
          <span
            key={recipient.email.toLowerCase()}
            className="inline-flex h-6 max-w-full items-center gap-1 rounded-md bg-secondary px-2 text-xs text-secondary-foreground"
          >
            <span className="truncate">
              {recipient.name ? `${recipient.name} <${recipient.email}>` : recipient.email}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={`Remove ${recipient.email}`}
              disabled={disabled}
              className="-mr-1 size-5"
              onClick={() => removeRecipient(recipient.email)}
            >
              <X data-icon="inline-start" />
            </Button>
          </span>
        ))}
        <input
          id={id}
          value={inputValue}
          disabled={disabled}
          placeholder={value.length === 0 ? 'name@example.com' : undefined}
          aria-autocomplete="list"
          aria-activedescendant={
            suggestions[highlightedIndex]
              ? getOptionId(listboxId, highlightedIndex)
              : undefined
          }
          aria-controls={listboxId}
          aria-expanded={isOpen}
          aria-invalid={invalid}
          className="h-6 min-w-40 flex-1 bg-transparent outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
          onBlur={() => {
            window.setTimeout(() => setIsFocused(false), 100);
          }}
          onChange={(event) => onInputChange(event.target.value)}
          onFocus={() => setIsFocused(true)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
        />
      </div>
      {isOpen && (
        <div
          id={listboxId}
          role="listbox"
          className="absolute inset-x-0 top-full z-50 mt-1 max-h-64 overflow-auto rounded-md bg-popover p-1 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10"
        >
          {peopleQuery.isPending && (
            <div className="px-3 py-2 text-muted-foreground">Searching...</div>
          )}
          {peopleQuery.isError && (
            <div className="px-3 py-2 text-destructive">
              Could not load contacts.
            </div>
          )}
          {!peopleQuery.isPending &&
            !peopleQuery.isError &&
            suggestions.length === 0 && (
              <div className="px-3 py-2 text-muted-foreground">
                No matching contacts.
              </div>
            )}
          {suggestions.map((suggestion, index) => (
            <button
              ref={(element) => {
                optionRefs.current[index] = element;
              }}
              id={getOptionId(listboxId, index)}
              key={`${suggestion.id}-${suggestion.email}`}
              type="button"
              role="option"
              aria-selected={index === highlightedIndex}
              className={cn(
                'flex w-full items-center gap-3 rounded-sm px-3 py-2 text-left outline-none hover:bg-accent hover:text-accent-foreground',
                index === highlightedIndex && 'bg-accent text-accent-foreground',
              )}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setHighlightedIndex(index)}
              onClick={() => addRecipient(personToRecipient(suggestion))}
            >
              <Avatar className="size-9">
                <AvatarFallback>{getInitials(suggestion.name)}</AvatarFallback>
              </Avatar>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">
                  {suggestion.name}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {suggestion.email}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function personToRecipient(person: MailPersonSuggestion): MailComposeRecipient {
  return person.name && person.name !== person.email
    ? { name: person.name, email: person.email }
    : { email: person.email };
}

function getOptionId(listboxId: string, index: number) {
  return `${listboxId}-option-${index}`;
}

function useDebouncedValue(value: string, delayMs: number) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedValue(value);
    }, delayMs);

    return () => window.clearTimeout(timeoutId);
  }, [delayMs, value]);

  return debouncedValue;
}
