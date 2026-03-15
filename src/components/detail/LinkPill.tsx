import { Link2 } from 'lucide-react';

interface LinkPillProps {
  label: string;
  url?: string;
}

export function LinkPill({ label, url }: LinkPillProps) {
  if (!url) return null;
  const href = url.startsWith('http') ? url : `https://${url}`;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
      onClick={e => e.stopPropagation()}>
      <Link2 className="h-3 w-3" />{label}
    </a>
  );
}
