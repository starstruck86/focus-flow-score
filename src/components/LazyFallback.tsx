export const LazyFallback = ({ text = "Loading…" }: { text?: string }) => (
  <div className="min-h-screen pt-[env(safe-area-inset-top)] flex items-center justify-center bg-background">
    <p className="text-muted-foreground">{text}</p>
  </div>
);

export default LazyFallback;
