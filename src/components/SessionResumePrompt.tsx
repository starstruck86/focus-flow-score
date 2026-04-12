/**
 * SessionResumePrompt — Shows a non-intrusive banner when there's
 * an incomplete Dojo or Learn session to resume.
 */

import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { X, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { checkForResumableSessions, type ResumeInfo } from '@/lib/sessionDurability';

export function SessionResumePrompt() {
  const [resumeInfo, setResumeInfo] = useState<ResumeInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    // Don't show on auth or if already on the target page
    if (location.pathname === '/auth') return;
    const info = checkForResumableSessions();
    if (info && !location.pathname.startsWith(info.path.split('?')[0])) {
      setResumeInfo(info);
    }
  }, [location.pathname]);

  if (!resumeInfo || dismissed) return null;

  return (
    <div className="fixed bottom-20 left-4 right-4 z-50 max-w-md mx-auto animate-in slide-in-from-bottom-4 duration-300">
      <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-card p-3 shadow-lg">
        <RotateCcw className="h-4 w-4 text-primary shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">Resume your session</p>
          <p className="text-xs text-muted-foreground truncate">{resumeInfo.label}</p>
        </div>
        <Button
          size="sm"
          className="shrink-0 h-8 text-xs"
          onClick={() => {
            setDismissed(true);
            navigate(resumeInfo.path, { state: resumeInfo.state });
          }}
        >
          Continue
        </Button>
        <button
          onClick={() => setDismissed(true)}
          className="p-1 text-muted-foreground hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
