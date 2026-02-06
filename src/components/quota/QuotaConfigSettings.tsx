// Quota Configuration Settings Component
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatCurrency, formatPercent, DEFAULT_QUOTA_CONFIG } from '@/lib/commissionCalculations';
import type { QuotaConfig } from '@/types';
import { Settings2, Save, RotateCcw } from 'lucide-react';

interface QuotaConfigSettingsProps {
  config: QuotaConfig;
  onSave: (config: QuotaConfig) => void;
}

export function QuotaConfigSettings({ config, onSave }: QuotaConfigSettingsProps) {
  const [editing, setEditing] = useState(false);
  const [localConfig, setLocalConfig] = useState(config);
  
  const handleSave = () => {
    onSave(localConfig);
    setEditing(false);
  };
  
  const handleReset = () => {
    setLocalConfig(DEFAULT_QUOTA_CONFIG);
  };
  
  if (!editing) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <Settings2 className="h-4 w-4" />
                Quota Configuration
              </CardTitle>
              <CardDescription>FY26 2H Compensation Plan</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              Edit
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-muted-foreground">New ARR Quota</div>
              <div className="font-medium">{formatCurrency(config.newArrQuota)}</div>
            </div>
            <div>
              <div className="text-muted-foreground">New ARR ACR</div>
              <div className="font-medium">{formatPercent(config.newArrAcr, 2)}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Renewal ARR Quota</div>
              <div className="font-medium">{formatCurrency(config.renewalArrQuota)}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Renewal ARR ACR</div>
              <div className="font-medium">{formatPercent(config.renewalArrAcr, 2)}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Period Start</div>
              <div className="font-medium">{new Date(config.fiscalYearStart).toLocaleDateString()}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Period End</div>
              <div className="font-medium">{new Date(config.fiscalYearEnd).toLocaleDateString()}</div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }
  
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Settings2 className="h-4 w-4" />
          Edit Quota Configuration
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Fiscal Period Start</Label>
            <Input
              type="date"
              value={localConfig.fiscalYearStart}
              onChange={(e) => setLocalConfig({ ...localConfig, fiscalYearStart: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>Fiscal Period End</Label>
            <Input
              type="date"
              value={localConfig.fiscalYearEnd}
              onChange={(e) => setLocalConfig({ ...localConfig, fiscalYearEnd: e.target.value })}
            />
          </div>
        </div>
        
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>New ARR Quota ($)</Label>
            <Input
              type="number"
              value={localConfig.newArrQuota}
              onChange={(e) => setLocalConfig({ ...localConfig, newArrQuota: Number(e.target.value) })}
            />
          </div>
          <div className="space-y-2">
            <Label>New ARR ACR (%)</Label>
            <Input
              type="number"
              step="0.01"
              value={(localConfig.newArrAcr * 100).toFixed(2)}
              onChange={(e) => setLocalConfig({ ...localConfig, newArrAcr: Number(e.target.value) / 100 })}
            />
          </div>
        </div>
        
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Renewal ARR Quota ($)</Label>
            <Input
              type="number"
              value={localConfig.renewalArrQuota}
              onChange={(e) => setLocalConfig({ ...localConfig, renewalArrQuota: Number(e.target.value) })}
            />
          </div>
          <div className="space-y-2">
            <Label>Renewal ARR ACR (%)</Label>
            <Input
              type="number"
              step="0.01"
              value={(localConfig.renewalArrAcr * 100).toFixed(2)}
              onChange={(e) => setLocalConfig({ ...localConfig, renewalArrAcr: Number(e.target.value) / 100 })}
            />
          </div>
        </div>
        
        <div className="flex justify-between pt-2">
          <Button variant="ghost" size="sm" onClick={handleReset}>
            <RotateCcw className="h-4 w-4 mr-1" />
            Reset to Defaults
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSave}>
              <Save className="h-4 w-4 mr-1" />
              Save
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
