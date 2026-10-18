import { useSyncExternalStore } from "react";

export interface Toast {
  id: number;
  message: string;
  action?: { label: string; run: () => void };
  tone?: "default" | "success" | "error";
  duration?: number;
}

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function toast(t: Omit<Toast, "id">): number {
  const id = nextId++;
  // Keep at most three on screen.
  toasts = [...toasts.slice(-2), { ...t, id }];
  emit();
  setTimeout(() => dismiss(id), t.duration ?? 5000);
  return id;
}

export function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => toasts,
  );
}
