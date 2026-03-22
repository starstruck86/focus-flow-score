import { REVIEW_MODE } from '@/contexts/ReviewModeContext';
import { Eye } from 'lucide-react';

export function ReviewModeBanner() {
  if (!REVIEW_MODE) return null;

  return (
    <div
      data-testid="review-mode-banner"
      className="sticky top-0 z-[60] flex items-center justify-center gap-2 bg-amber-500 text-amber-950 text-xs font-semibold py-1.5 px-4 select-none"
    >
      <Eye className="h-3.5 w-3.5" />
      Public Review Mode — destructive actions are disabled
    </div>
  );
}
