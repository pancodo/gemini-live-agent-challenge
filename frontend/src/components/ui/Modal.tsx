import * as Dialog from '@radix-ui/react-dialog';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';
import { motion, AnimatePresence } from 'motion/react';
import type { ReactNode } from 'react';

interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}

const MODAL_TRANSITION = { type: 'spring' as const, stiffness: 320, damping: 28 } as const;

export function Modal({ open, onOpenChange, title, description, children, className = '' }: ModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal forceMount>
        <AnimatePresence>
          {open && (
            <>
              <Dialog.Overlay asChild forceMount>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
                />
              </Dialog.Overlay>
              <Dialog.Content asChild forceMount>
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: 8 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.97, y: 4 }}
                  transition={MODAL_TRANSITION}
                  className={`fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-[var(--bg2)] border border-[var(--bg4)] rounded-xl shadow-xl max-h-[85vh] overflow-auto ${className}`}
                >
                  <Dialog.Title className="font-serif text-lg font-normal text-[var(--text)] px-6 pt-5 pb-2">
                    {title}
                  </Dialog.Title>
                  {description ? (
                    <Dialog.Description className="font-sans text-xs text-[var(--muted)] px-6 pb-4">
                      {description}
                    </Dialog.Description>
                  ) : (
                    <VisuallyHidden>
                      <Dialog.Description>{title}</Dialog.Description>
                    </VisuallyHidden>
                  )}
                  {children}
                </motion.div>
              </Dialog.Content>
            </>
          )}
        </AnimatePresence>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
