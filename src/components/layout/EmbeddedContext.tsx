/**
 * EmbeddedLayoutContext — signals to <Layout /> that it is rendering inside a
 * hub shell (e.g. /work, /train-hub) and should suppress its own chrome
 * (header, week strip, activity rings, day timeline, breadcrumbs, bottom nav,
 * back-to-today FAB, global FAB). The hub owns those surfaces.
 *
 * Kept: safe-area padding, main content, Dave FAB (Dave is app-global).
 *
 * Usage:
 *   <EmbeddedLayoutProvider>
 *     <SomePage />   // <Layout> inside SomePage becomes chromeless
 *   </EmbeddedLayoutProvider>
 */
import { createContext, useContext, type ReactNode } from 'react';

const Ctx = createContext<boolean>(false);

export function EmbeddedLayoutProvider({ children }: { children: ReactNode }) {
  return <Ctx.Provider value={true}>{children}</Ctx.Provider>;
}

export function useIsEmbeddedLayout(): boolean {
  return useContext(Ctx);
}
