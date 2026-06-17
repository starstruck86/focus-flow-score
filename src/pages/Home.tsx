import { useNavigate } from 'react-router-dom';
import { Swords, Briefcase, Target, Mic, BookOpen, CheckSquare, Users, RefreshCw, Crosshair, ArrowRight } from 'lucide-react';
import { useAppMode } from '@/hooks/useAppMode';
import { useKiProficiency } from '@/hooks/useKiProficiency';
import { cn } from '@/lib/utils';

export default function Home() {
  const navigate = useNavigate();
  const { mode, isTrain } = useAppMode();
  const { data: proficiency } = useKiProficiency();

  const enterTrain = () => {
    try { localStorage.setItem('qc_app_mode', 'train'); } catch {}
    navigate('/dojo');
  };

  const enterWork = () => {
    try { localStorage.setItem('qc_app_mode', 'work'); } catch {}
    navigate('/tasks');
  };

  const totalReps = proficiency?.total_reps ?? 0;
  const librarySize = proficiency?.total_ki_library ?? 0;
  const weakest = proficiency?.weakest?.label ?? null;

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 gap-4">
      {/* App wordmark */}
      <div className="mb-2 text-center">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Quota CoPilot</p>
      </div>

      {/* Train card */}
      <button
        onClick={enterTrain}
        className={cn(
          'w-full max-w-sm rounded-2xl p-6 text-left transition-all duration-200 active:scale-[0.98]',
          'bg-gradient-to-br from-primary/20 via-primary/10 to-background',
          'border-2 hover:border-primary/60',
          isTrain ? 'border-primary/50 shadow-lg shadow-primary/10' : 'border-border/60'
        )}
      >
        <div className="flex items-start justify-between mb-4">
          <div className="h-12 w-12 rounded-xl bg-primary/15 flex items-center justify-center">
            <Swords className="h-6 w-6 text-primary" />
          </div>
          {isTrain && (
            <span className="text-[10px] font-bold uppercase tracking-wider text-primary bg-primary/10 px-2 py-0.5 rounded-full">
              Last used
            </span>
          )}
        </div>

        <h2 className="text-xl font-bold text-foreground mb-1">Train</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Practice · Drill · Improve
        </p>

        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Target className="h-3.5 w-3.5" />
            {librarySize > 0 ? `${librarySize.toLocaleString()} KIs` : 'KI Library'}
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Swords className="h-3.5 w-3.5" />
            {totalReps > 0 ? `${totalReps} reps` : 'Start drilling'}
          </div>
          {weakest && totalReps > 0 && (
            <div className="flex items-center gap-1.5 text-[11px] text-amber-500">
              <Target className="h-3.5 w-3.5" />
              Focus: {weakest}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {[
            { icon: Swords, label: 'Dojo' },
            { icon: Target, label: 'Skills' },
            { icon: Mic, label: 'Coach' },
            { icon: BookOpen, label: 'Library' },
          ].map(({ icon: Icon, label }) => (
            <span key={label} className="flex items-center gap-1 text-[11px] text-muted-foreground bg-muted/50 rounded-md px-2 py-0.5">
              <Icon className="h-3 w-3" />{label}
            </span>
          ))}
        </div>

        <div className="flex items-center gap-1 mt-4 text-xs font-semibold text-primary">
          Enter Train mode <ArrowRight className="h-3.5 w-3.5" />
        </div>
      </button>

      {/* Work card */}
      <button
        onClick={enterWork}
        className={cn(
          'w-full max-w-sm rounded-2xl p-6 text-left transition-all duration-200 active:scale-[0.98]',
          'bg-gradient-to-br from-blue-500/10 via-blue-500/5 to-background',
          'border-2 hover:border-blue-500/60',
          !isTrain ? 'border-blue-500/50 shadow-lg shadow-blue-500/10' : 'border-border/60'
        )}
      >
        <div className="flex items-start justify-between mb-4">
          <div className="h-12 w-12 rounded-xl bg-blue-500/15 flex items-center justify-center">
            <Briefcase className="h-6 w-6 text-blue-500" />
          </div>
          {!isTrain && (
            <span className="text-[10px] font-bold uppercase tracking-wider text-blue-500 bg-blue-500/10 px-2 py-0.5 rounded-full">
              Last used
            </span>
          )}
        </div>

        <h2 className="text-xl font-bold text-foreground mb-1">Work</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Execute · Manage · Close
        </p>

        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <CheckSquare className="h-3.5 w-3.5" />
            Tasks & pipeline
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <RefreshCw className="h-3.5 w-3.5" />
            Renewals
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {[
            { icon: CheckSquare, label: 'Tasks' },
            { icon: Users, label: 'Outreach' },
            { icon: RefreshCw, label: 'Renewals' },
            { icon: Crosshair, label: 'Strategy' },
          ].map(({ icon: Icon, label }) => (
            <span key={label} className="flex items-center gap-1 text-[11px] text-muted-foreground bg-muted/50 rounded-md px-2 py-0.5">
              <Icon className="h-3 w-3" />{label}
            </span>
          ))}
        </div>

        <div className="flex items-center gap-1 mt-4 text-xs font-semibold text-blue-500">
          Enter Work mode <ArrowRight className="h-3.5 w-3.5" />
        </div>
      </button>
    </div>
  );
}
