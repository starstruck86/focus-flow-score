import { NavLink as RouterNavLink, useLocation } from 'react-router-dom';
import { 
  LayoutDashboard, 
  Users, 
  RefreshCw, 
  CheckSquare, 
  TrendingUp,
  DollarSign,
  Settings,
  Compass,
  LogOut,
  Search,
  MoreHorizontal,
} from 'lucide-react';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { SaveIndicator } from '@/components/SaveIndicator';
import { cn } from '@/lib/utils';
import { FocusTimer } from './FocusTimer';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { GlobalFAB } from '@/components/fab';
import { WorkdayCheckInButton } from '@/components/WorkdayCheckInButton';
import { GlobalSearch } from '@/components/GlobalSearch';
import { ThemeToggle } from '@/components/ThemeToggle';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

const navItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/tasks', label: 'Tasks', icon: CheckSquare },
  { to: '/outreach', label: 'New Logo', icon: Users },
  { to: '/renewals', label: 'Renewals', icon: RefreshCw },
  { to: '/trends', label: 'Trends', icon: TrendingUp },
  { to: '/quota', label: 'Quota', icon: DollarSign },
];

// Mobile bottom tabs — show 5 primary + "More"
const mobileTabItems = [
  { to: '/', label: 'Home', icon: LayoutDashboard },
  { to: '/tasks', label: 'Tasks', icon: CheckSquare },
  { to: '/outreach', label: 'New Logo', icon: Users },
  { to: '/renewals', label: 'Renewals', icon: RefreshCw },
  { to: '/trends', label: 'Trends', icon: TrendingUp },
];

function AppSidebar() {
  const location = useLocation();
  const { user, signOut } = useAuth();
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border hidden md:flex">
      <SidebarContent className="bg-sidebar flex flex-col h-full">
        {/* Logo */}
        <div className={cn("p-4 border-b border-sidebar-border", collapsed && "px-2")}>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <Compass className="h-5 w-5 text-primary" />
            </div>
            {!collapsed && (
              <div className="min-w-0">
                <h1 className="font-display text-sm font-bold text-sidebar-foreground truncate">
                  Quota Compass
                </h1>
                <p className="text-[10px] text-muted-foreground truncate">
                  {user?.email || 'User'}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Navigation */}
        <SidebarGroup className="flex-1 py-2">
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const isActive = location.pathname === item.to;
                return (
                  <SidebarMenuItem key={item.to}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <SidebarMenuButton asChild isActive={isActive}>
                          <RouterNavLink
                            to={item.to}
                            className={cn(
                              'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all',
                              isActive
                                ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                                : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                            )}
                          >
                            <item.icon className="h-5 w-5 shrink-0" />
                            {!collapsed && <span>{item.label}</span>}
                          </RouterNavLink>
                        </SidebarMenuButton>
                      </TooltipTrigger>
                      {collapsed && (
                        <TooltipContent side="right">{item.label}</TooltipContent>
                      )}
                    </Tooltip>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Compact Timer */}
        {!collapsed && (
          <div className="px-4 py-3 border-t border-sidebar-border">
            <FocusTimer compact />
          </div>
        )}

        {/* Settings & Sign Out */}
        <div className={cn("p-2 border-t border-sidebar-border space-y-1", collapsed && "px-1")}>
          <Tooltip>
            <TooltipTrigger asChild>
              <RouterNavLink
                to="/settings"
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all',
                  location.pathname === '/settings'
                    ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                    : 'text-sidebar-foreground hover:bg-sidebar-accent'
                )}
              >
                <Settings className="h-5 w-5 shrink-0" />
                {!collapsed && <span>Settings</span>}
              </RouterNavLink>
            </TooltipTrigger>
            {collapsed && <TooltipContent side="right">Settings</TooltipContent>}
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                className={cn(
                  "w-full justify-start gap-3 px-3 py-2.5 h-auto text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent",
                  collapsed && "justify-center px-0"
                )}
                onClick={signOut}
              >
                <LogOut className="h-5 w-5 shrink-0" />
                {!collapsed && <span>Sign Out</span>}
              </Button>
            </TooltipTrigger>
            {collapsed && <TooltipContent side="right">Sign Out</TooltipContent>}
          </Tooltip>
        </div>
      </SidebarContent>
    </Sidebar>
  );
}

function MobileBottomNav() {
  const location = useLocation();
  
  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-sidebar border-t border-sidebar-border safe-area-bottom">
      <div className="flex items-center justify-around h-14">
        {mobileTabItems.map((item) => {
          const isActive = location.pathname === item.to;
          return (
            <RouterNavLink
              key={item.to}
              to={item.to}
              className={cn(
                'flex flex-col items-center justify-center gap-0.5 flex-1 h-full text-[10px] font-medium transition-colors',
                isActive
                  ? 'text-primary'
                  : 'text-muted-foreground'
              )}
            >
              <item.icon className={cn("h-5 w-5", isActive && "text-primary")} />
              {item.label}
            </RouterNavLink>
          );
        })}
        <RouterNavLink
          to="/quota"
          className={cn(
            'flex flex-col items-center justify-center gap-0.5 flex-1 h-full text-[10px] font-medium transition-colors',
            ['/quota', '/settings'].includes(location.pathname)
              ? 'text-primary'
              : 'text-muted-foreground'
          )}
        >
          <MoreHorizontal className="h-5 w-5" />
          More
        </RouterNavLink>
      </div>
    </nav>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const isMobile = useIsMobile();
  
  return (
    <SidebarProvider defaultOpen={true}>
      <div className="min-h-screen bg-background flex w-full">
        <AppSidebar />

        <div className="flex-1 flex flex-col min-w-0">
          {/* Top bar */}
          <header className="flex items-center justify-between px-4 py-2 border-b border-border/50">
            <div className="flex items-center gap-2">
              {!isMobile && <SidebarTrigger className="text-muted-foreground hover:text-foreground" />}
              {isMobile && (
                <div className="flex items-center gap-2">
                  <Compass className="h-5 w-5 text-primary" />
                  <span className="font-display text-sm font-bold">QC</span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <GlobalSearch />
              <ThemeToggle />
              <WorkdayCheckInButton />
            </div>
          </header>

          {/* Main Content */}
          <main className={cn("flex-1 overflow-auto", isMobile && "pb-16")}>
            {children}
          </main>
        </div>
      </div>
      
      {/* Mobile Bottom Nav */}
      <MobileBottomNav />
      
      {/* Floating Action Button */}
      <GlobalFAB position={isMobile ? "bottom-right" : "bottom-left"} />
    </SidebarProvider>
  );
}
