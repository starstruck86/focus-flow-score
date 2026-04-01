import { Badge } from '@/components/ui/badge';
import { BookOpen } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  who: string | null | undefined;
  framework: string | null | undefined;
  size?: 'sm' | 'default';
  className?: string;
}

export function FrameworkBadge({ who, framework, size = 'sm', className }: Props) {
  if (!who && !framework) return null;

  const label = [framework, who].filter(Boolean).join(' — ');

  return (
    <Badge
      variant="outline"
      className={cn(
        'font-normal gap-1 border-primary/30 text-primary bg-primary/5',
        size === 'sm' ? 'text-[9px] px-1.5 py-0' : 'text-[10px] px-2 py-0.5',
        className,
      )}
    >
      <BookOpen className={size === 'sm' ? 'h-2.5 w-2.5' : 'h-3 w-3'} />
      {label}
    </Badge>
  );
}
