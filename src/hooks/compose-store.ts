import { create } from 'zustand';
import {
  emptyComposeWindowDraft,
  type ComposeWindowDraft,
} from '../lib/compose-window';

interface ComposeState {
  draft: ComposeWindowDraft;
  isMinimized: boolean;
  isOpen: boolean;
  close: () => void;
  open: () => void;
  setDraft: (draft: ComposeWindowDraft) => void;
  setMinimized: (isMinimized: boolean) => void;
}

export const useComposeStore = create<ComposeState>((set) => ({
  draft: emptyComposeWindowDraft,
  isMinimized: false,
  isOpen: false,
  close: () =>
    set({
      draft: emptyComposeWindowDraft,
      isMinimized: false,
      isOpen: false,
    }),
  open: () =>
    set({
      isMinimized: false,
      isOpen: true,
    }),
  setDraft: (draft) => set({ draft }),
  setMinimized: (isMinimized) => set({ isMinimized }),
}));
