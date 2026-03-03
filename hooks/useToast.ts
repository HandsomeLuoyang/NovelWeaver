import { useStore } from '../store';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export const useToast = () => {
  const { addToast, removeToast } = useStore();

  const showToast = (
    message: string,
    type: ToastType = 'info',
    duration = 5000,
    action?: Toast['action']
  ) => {
    const id = Date.now().toString() + Math.random().toString(36);
    addToast({ id, message, type, duration, action });

    if (duration > 0) {
      setTimeout(() => {
        removeToast(id);
      }, duration);
    }

    return id;
  };

  return {
    success: (message: string, action?: Toast['action']) =>
      showToast(message, 'success', 5000, action),
    error: (message: string, action?: Toast['action']) =>
      showToast(message, 'error', 7000, action),
    warning: (message: string, action?: Toast['action']) =>
      showToast(message, 'warning', 5000, action),
    info: (message: string, action?: Toast['action']) =>
      showToast(message, 'info', 4000, action),
    custom: showToast,
    dismiss: removeToast,
  };
};
