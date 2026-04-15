/**
 * AppearanceSettings — Theme toggle for light/dark mode.
 * Uses next-themes ThemeProvider already configured in App.tsx.
 */
import { useTheme } from 'next-themes';
import { Sun, Moon, Monitor, Palette } from 'lucide-react';
import { cn } from '@/lib/utils';

const THEME_OPTIONS = [
  { value: 'dark', label: 'Dark', icon: Moon, description: 'Optimized for low-light environments' },
  { value: 'light', label: 'Light', icon: Sun, description: 'High contrast for bright environments' },
  { value: 'system', label: 'System', icon: Monitor, description: 'Follow your OS preference' },
] as const;

export function AppearanceSettings() {
  const { theme, setTheme } = useTheme();

  return (
    <>
      <div className="metric-card">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Palette className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h3 className="font-semibold">Appearance</h3>
            <p className="text-sm text-muted-foreground">Theme and display settings</p>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground/80 mb-3">Theme</p>
          <div className="grid grid-cols-3 gap-2">
            {THEME_OPTIONS.map(opt => {
              const active = theme === opt.value;
              return (
                <button
                  key={opt.value}
                  onClick={() => setTheme(opt.value)}
                  className={cn(
                    'flex flex-col items-center gap-2 p-4 rounded-lg border transition-all duration-150 text-center',
                    active
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-border/50 bg-card hover:border-border hover:bg-muted/30 text-muted-foreground'
                  )}
                >
                  <opt.icon className={cn('h-5 w-5', active ? 'text-primary' : 'text-muted-foreground')} />
                  <span className="text-sm font-medium">{opt.label}</span>
                  <span className="text-[10px] text-muted-foreground leading-tight">{opt.description}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
