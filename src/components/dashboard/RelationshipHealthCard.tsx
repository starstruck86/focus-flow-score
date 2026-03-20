import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Users, TrendingUp, AlertTriangle } from 'lucide-react';
import { useStore } from '@/store/useStore';
import { cn } from '@/lib/utils';
import { differenceInDays } from 'date-fns';

export function RelationshipHealthCard({ accountId }: { accountId: string }) {
  const { contacts } = useStore();

  const health = useMemo(() => {
    const acctContacts = contacts.filter(c => c.accountId === accountId);
    const total = acctContacts.length;
    if (total === 0) return null;

    const now = new Date();
    const engaged = acctContacts.filter(c => c.lastTouchDate && differenceInDays(now, new Date(c.lastTouchDate)) < 30);
    const champions = acctContacts.filter(c => c.buyerRole === 'champion' || c.influenceLevel === 'high');
    const multiThreaded = new Set(acctContacts.map(c => c.department).filter(Boolean)).size >= 2;

    const score = Math.min(100, Math.round(
      (engaged.length / Math.max(total, 1)) * 40 +
      (champions.length > 0 ? 25 : 0) +
      (multiThreaded ? 20 : 0) +
      Math.min(15, total * 3)
    ));

    const status = score >= 70 ? 'strong' : score >= 40 ? 'developing' : 'weak';

    return {
      score,
      status,
      totalContacts: total,
      engagedContacts: engaged.length,
      champions: champions.length,
      multiThreaded,
      departments: new Set(acctContacts.map(c => c.department).filter(Boolean)).size,
    };
  }, [contacts, accountId]);

  if (!health) {
    return (
      <Card className="border-border/50 bg-card/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            Relationship Health
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">Add contacts to see relationship health.</p>
        </CardContent>
      </Card>
    );
  }

  const statusColor = health.status === 'strong' ? 'text-status-green' : health.status === 'developing' ? 'text-status-yellow' : 'text-status-red';

  return (
    <Card className="border-border/50 bg-card/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" />
          Relationship Health
          <Badge variant="outline" className={cn("text-[10px] ml-auto", statusColor)}>
            {health.score}/100
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {/* Score bar */}
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className={cn("h-full rounded-full transition-all",
                health.status === 'strong' ? "bg-status-green" : health.status === 'developing' ? "bg-status-yellow" : "bg-status-red"
              )}
              style={{ width: `${health.score}%` }}
            />
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground">Contacts:</span>
              <span className="font-medium">{health.engagedContacts}/{health.totalContacts} engaged</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground">Champions:</span>
              <span className={cn("font-medium", health.champions === 0 && "text-status-red")}>{health.champions}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground">Departments:</span>
              <span className="font-medium">{health.departments}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground">Multi-thread:</span>
              {health.multiThreaded
                ? <TrendingUp className="h-3 w-3 text-status-green" />
                : <AlertTriangle className="h-3 w-3 text-status-yellow" />
              }
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
