import { ExternalLink } from 'lucide-react';
import { RUST_BUSTER_LINKS } from '@/lib/rustBusterLinks';

export function RustBusterQuickLinks() {
  return (
    <div className="mt-2 py-2 px-2.5 rounded-md bg-muted/40 border border-border/30 space-y-1.5">
      <div className="flex items-center gap-4 flex-wrap">
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Leads:</span>
        <div className="flex items-center gap-1.5 flex-wrap">
          {RUST_BUSTER_LINKS.leads.map(link => (
            <a
              key={link.label}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md bg-accent/60 hover:bg-accent border border-border/40 text-foreground transition-colors"
            >
              {link.label}
              <ExternalLink className="h-2.5 w-2.5 opacity-50" />
            </a>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-4 flex-wrap">
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Accts:</span>
        <div className="flex items-center gap-1.5 flex-wrap">
          {RUST_BUSTER_LINKS.accounts.map(link => (
            <a
              key={link.label}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md bg-accent/60 hover:bg-accent border border-border/40 text-foreground transition-colors"
            >
              {link.label}
              <ExternalLink className="h-2.5 w-2.5 opacity-50" />
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
