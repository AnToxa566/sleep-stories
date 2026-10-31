import { create } from 'zustand';

// One toast at a time: showing a new one replaces the old one. Pure module (no React Native),
// so it is unit-tested; ToastHost renders it and owns the auto-dismiss timer.
// Which icon the toast wears, as in the designs: «Создаётся» (dashed circle), «Заменили на»
// (refresh) and «Убрали» (cross). `plain` has no icon.
export type ToastKind = 'create' | 'replace' | 'remove' | 'plain';

export type ToastInput = {
  // The small line above, for example «Убрали».
  label: string;
  // The bigger line, for example a story title. Optional (an error toast has a label only).
  title?: string;
  kind?: ToastKind;
};

export type Toast = {
  // Grows with every toast, so the host restarts its timer and animation even when the
  // same text is shown twice in a row.
  id: number;
  label: string;
  title: string | null;
  kind: ToastKind;
};

// How long a toast stays on screen. The design keeps it for 4.5 s; the owner's plan says ~3 s.
export const TOAST_DURATION_MS = 3000;

type ToastState = {
  current: Toast | null;
  nextId: number;
  show: (input: ToastInput) => void;
  // Hides the toast with this id; a stale id (already replaced) is ignored.
  hide: (id: number) => void;
  clear: () => void;
};

export const useToastStore = create<ToastState>((set) => ({
  current: null,
  nextId: 1,
  show: (input) =>
    set((state) => ({
      current: {
        id: state.nextId,
        label: input.label,
        title: input.title ?? null,
        kind: input.kind ?? 'plain',
      },
      nextId: state.nextId + 1,
    })),
  hide: (id) => set((state) => (state.current?.id === id ? { current: null } : state)),
  clear: () => set({ current: null }),
}));

// Callable from anywhere (a mutation's onSuccess, a plain function), outside React.
export function showToast(input: ToastInput): void {
  useToastStore.getState().show(input);
}
