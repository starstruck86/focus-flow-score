// Conversion Benchmarks Settings — manual funnel rate configuration
import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useConversionBenchmarks, useUpsertBenchmarks } from '@/hooks/useCoachingEngine';
import { Calculator, Save, RotateCcw, ArrowRight } from 'lucide-react';

const DEFAULTS = {
  dials_to_connect_rate: 0.10,
  connect_to_meeting_rate: 0.25,
  meeting_to_opp_rate: 0.40,
  opp_to_close_rate: 0.25,
  avg_new_logo_arr: 50000,
  avg_renewal_arr: 80000,
  avg_sales_cycle_days: 90,
};

export function ConversionBenchmarksSettings() {
  const { data: saved, isLoading } = useConversionBenchmarks();
  const upsert = useUpsertBenchmarks();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(DEFAULTS);

  useEffect(() => {
    if (saved) {
      setForm({
        dials_to_connect_rate: parseFloat(String(saved.dials_to_connect_rate)) || DEFAULTS.dials_to_connect_rate,
        connect_to_meeting_rate: parseFloat(String(saved.connect_to_meeting_rate)) || DEFAULTS.connect_to_meeting_rate,
        meeting_to_opp_rate: parseFloat(String(saved.meeting_to_opp_rate)) || DEFAULTS.meeting_to_opp_rate,
        opp_to_close_rate: parseFloat(String(saved.opp_to_close_rate)) || DEFAULTS.opp_to_close_rate,
        avg_new_logo_arr: parseFloat(String(saved.avg_new_logo_arr)) || DEFAULTS.avg_new_logo_arr,
        avg_renewal_arr: parseFloat(String(saved.avg_renewal_arr)) || DEFAULTS.avg_renewal_arr,
        avg_sales_cycle_days: parseInt(String(saved.avg_sales_cycle_days)) || DEFAULTS.avg_sales_cycle_days,
      });
    }
  }, [saved]);

  const handleSave = () => {
    upsert.mutate(form);
    setEditing(false);
  };

  // Calculate preview: 100 dials → how many closed deals
  const preview = {
    dials: 100,
    connects: Math.round(100 * form.dials_to_connect_rate),
    meetings: Math.round(100 * form.dials_to_connect_rate * form.connect_to_meeting_rate),
    opps: Math.round(100 * form.dials_to_connect_rate * form.connect_to_meeting_rate * form.meeting_to_opp_rate),
    deals: Math.round(100 * form.dials_to_connect_rate * form.connect_to_meeting_rate * form.meeting_to_opp_rate * form.opp_to_close_rate),
  };

  if (isLoading) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <Calculator className="h-4 w-4" />
              Conversion Benchmarks
            </CardTitle>
            <CardDescription>Your funnel rates power the P-Club Math engine</CardDescription>
          </div>
          {!editing && (
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>Edit</Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Funnel preview */}
        <div className="flex items-center gap-1 text-xs flex-wrap">
          <Badge variant="outline">{preview.dials} dials</Badge>
          <ArrowRight className="h-3 w-3 text-muted-foreground" />
          <Badge variant="outline">{preview.connects} connects</Badge>
          <ArrowRight className="h-3 w-3 text-muted-foreground" />
          <Badge variant="outline">{preview.meetings} meetings</Badge>
          <ArrowRight className="h-3 w-3 text-muted-foreground" />
          <Badge variant="outline">{preview.opps} opps</Badge>
          <ArrowRight className="h-3 w-3 text-muted-foreground" />
          <Badge className="bg-primary/10 text-primary">{preview.deals} deals</Badge>
        </div>

        {editing ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs">Dial → Connect Rate</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    max="1"
                    value={form.dials_to_connect_rate}
                    onChange={e => setForm(f => ({ ...f, dials_to_connect_rate: parseFloat(e.target.value) || 0 }))}
                    className="h-8"
                  />
                  <span className="text-xs text-muted-foreground">{(form.dials_to_connect_rate * 100).toFixed(0)}%</span>
                </div>
              </div>
              <div>
                <Label className="text-xs">Connect → Meeting Rate</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    max="1"
                    value={form.connect_to_meeting_rate}
                    onChange={e => setForm(f => ({ ...f, connect_to_meeting_rate: parseFloat(e.target.value) || 0 }))}
                    className="h-8"
                  />
                  <span className="text-xs text-muted-foreground">{(form.connect_to_meeting_rate * 100).toFixed(0)}%</span>
                </div>
              </div>
              <div>
                <Label className="text-xs">Meeting → Opp Rate</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    max="1"
                    value={form.meeting_to_opp_rate}
                    onChange={e => setForm(f => ({ ...f, meeting_to_opp_rate: parseFloat(e.target.value) || 0 }))}
                    className="h-8"
                  />
                  <span className="text-xs text-muted-foreground">{(form.meeting_to_opp_rate * 100).toFixed(0)}%</span>
                </div>
              </div>
              <div>
                <Label className="text-xs">Opp → Close Rate</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    max="1"
                    value={form.opp_to_close_rate}
                    onChange={e => setForm(f => ({ ...f, opp_to_close_rate: parseFloat(e.target.value) || 0 }))}
                    className="h-8"
                  />
                  <span className="text-xs text-muted-foreground">{(form.opp_to_close_rate * 100).toFixed(0)}%</span>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label className="text-xs">Avg New Logo ARR</Label>
                <Input
                  type="number"
                  value={form.avg_new_logo_arr}
                  onChange={e => setForm(f => ({ ...f, avg_new_logo_arr: parseFloat(e.target.value) || 0 }))}
                  className="h-8"
                />
              </div>
              <div>
                <Label className="text-xs">Avg Renewal ARR</Label>
                <Input
                  type="number"
                  value={form.avg_renewal_arr}
                  onChange={e => setForm(f => ({ ...f, avg_renewal_arr: parseFloat(e.target.value) || 0 }))}
                  className="h-8"
                />
              </div>
              <div>
                <Label className="text-xs">Avg Sales Cycle (days)</Label>
                <Input
                  type="number"
                  value={form.avg_sales_cycle_days}
                  onChange={e => setForm(f => ({ ...f, avg_sales_cycle_days: parseInt(e.target.value) || 0 }))}
                  className="h-8"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleSave} disabled={upsert.isPending}>
                <Save className="h-3.5 w-3.5 mr-1" />
                Save
              </Button>
              <Button size="sm" variant="outline" onClick={() => setForm(DEFAULTS)}>
                <RotateCcw className="h-3.5 w-3.5 mr-1" />
                Reset Defaults
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-muted-foreground text-xs">Dial → Connect</div>
              <div className="font-medium">{(form.dials_to_connect_rate * 100).toFixed(0)}%</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Connect → Meeting</div>
              <div className="font-medium">{(form.connect_to_meeting_rate * 100).toFixed(0)}%</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Meeting → Opp</div>
              <div className="font-medium">{(form.meeting_to_opp_rate * 100).toFixed(0)}%</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Opp → Close</div>
              <div className="font-medium">{(form.opp_to_close_rate * 100).toFixed(0)}%</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Avg Deal Size</div>
              <div className="font-medium">${form.avg_new_logo_arr.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Avg Cycle</div>
              <div className="font-medium">{form.avg_sales_cycle_days} days</div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
