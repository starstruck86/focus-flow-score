/**
 * ReviewModeContext — temporary public review mode for QA.
 *
 * Set REVIEW_MODE = true  → bypass auth, use demo data, guard destructive actions.
 * Set REVIEW_MODE = false → normal production behaviour.
 *
 * To revert: flip the flag below and delete this file + ReviewModeBanner.
 */

import { createContext, useContext, ReactNode } from 'react';
import { toast } from 'sonner';

// ──────────────────────── MASTER SWITCH ────────────────────────
export const REVIEW_MODE = true;
// ───────────────────────────────────────────────────────────────

interface ReviewModeContextType {
  isReviewMode: boolean;
  /** Call before any destructive mutation. Returns true if blocked. */
  guardDestructive: (actionLabel?: string) => boolean;
}

const ReviewModeContext = createContext<ReviewModeContextType>({
  isReviewMode: false,
  guardDestructive: () => false,
});

export function ReviewModeProvider({ children }: { children: ReactNode }) {
  const guardDestructive = (actionLabel?: string): boolean => {
    if (!REVIEW_MODE) return false;
    toast.info(
      `"${actionLabel ?? 'This action'}" is disabled in Public Review Mode`,
      { duration: 3000 },
    );
    return true; // blocked
  };

  return (
    <ReviewModeContext.Provider value={{ isReviewMode: REVIEW_MODE, guardDestructive }}>
      {children}
    </ReviewModeContext.Provider>
  );
}

export function useReviewMode() {
  return useContext(ReviewModeContext);
}
