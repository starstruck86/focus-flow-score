import { useState, useEffect } from 'react';
import { Bell, BellOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { requestNotificationPermission, scheduleCheckInReminder, scheduleFirstCallReminder } from '@/lib/notifications';
import { toast } from 'sonner';

export function NotificationSettings() {
  const [permission, setPermission] = useState<NotificationPermission>(
    typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'default'
  );
  const [checkInEnabled, setCheckInEnabled] = useState(() => {
    return localStorage.getItem('qc-notif-checkin') === 'true';
  });
  const [firstCallEnabled, setFirstCallEnabled] = useState(() => {
    return localStorage.getItem('qc-notif-firstcall') === 'true';
  });

  const handleEnable = async () => {
    const granted = await requestNotificationPermission();
    setPermission(granted ? 'granted' : 'denied');
    if (granted) {
      toast.success('Notifications enabled!');
    } else {
      toast.error('Notification permission denied');
    }
  };

  useEffect(() => {
    localStorage.setItem('qc-notif-checkin', String(checkInEnabled));
    if (checkInEnabled && permission === 'granted') {
      scheduleCheckInReminder('16:30');
    }
  }, [checkInEnabled, permission]);

  useEffect(() => {
    localStorage.setItem('qc-notif-firstcall', String(firstCallEnabled));
    if (firstCallEnabled && permission === 'granted') {
      scheduleFirstCallReminder();
    }
  }, [firstCallEnabled, permission]);

  const isSupported = typeof window !== 'undefined' && 'Notification' in window;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Bell className="h-4 w-4" />
          Notifications
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!isSupported ? (
          <p className="text-sm text-muted-foreground">
            Push notifications are not supported in this browser.
          </p>
        ) : permission === 'denied' ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <BellOff className="h-4 w-4" />
            Notifications blocked. Enable in your browser settings.
          </div>
        ) : permission !== 'granted' ? (
          <Button size="sm" onClick={handleEnable} className="gap-2">
            <Bell className="h-4 w-4" />
            Enable Notifications
          </Button>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm">EOD Check-in Reminder (4:30 PM)</Label>
              <Switch checked={checkInEnabled} onCheckedChange={setCheckInEnabled} />
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-sm">First Call Reminder (9:15 AM)</Label>
              <Switch checked={firstCallEnabled} onCheckedChange={setFirstCallEnabled} />
            </div>
            <p className="text-[10px] text-muted-foreground">
              Notifications only fire while the app is open or installed as a PWA.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
