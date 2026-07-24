import { create } from 'zustand';
import {
  emptyComposeWindowDraft,
  type ComposeWindowDraft,
} from '@/lib/compose-window';

interface ComposeState {
  draft: ComposeWindowDraft;
  flushHandler?: () => Promise<boolean>;
  isMinimized: boolean;
  isOpen: boolean;
  close: () => void;
  flushAndClose: () => Promise<boolean>;
  open: (draft?: ComposeWindowDraft) => void;
  setDraft: (draft: ComposeWindowDraft) => void;
  setFlushHandler: (
    handler: (() => Promise<boolean>) | undefined,
  ) => void;
  setMinimized: (isMinimized: boolean) => void;
}

export const useComposeStore = create<ComposeState>((set, get) => ({
  draft: emptyComposeWindowDraft,
  isMinimized: false,
  isOpen: false,
  close: () =>
    set({
      draft: emptyComposeWindowDraft,
      flushHandler: undefined,
      isMinimized: false,
      isOpen: false,
    }),
  flushAndClose: async () => {
    const flushHandler = get().flushHandler;

    if (flushHandler) {
      return flushHandler();
    }

    get().close();
    return true;
  },
  open: (draft) =>
    set({
      ...(draft ? { draft } : {}),
      isMinimized: false,
      isOpen: true,
    }),
  setDraft: (draft) => set({ draft }),
  setFlushHandler: (flushHandler) => set({ flushHandler }),
  setMinimized: (isMinimized) => set({ isMinimized }),
}));
