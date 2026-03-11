// Push notification utilities
// Web Push API — permission request and basic notification sending

export async function requestNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) {
    console.warn('Push notifications not supported');
    return false;
  }

  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;

  const result = await Notification.requestPermission();
  return result === 'granted';
}

export function sendLocalNotification(title: string, options?: NotificationOptions) {
  if (Notification.permission !== 'granted') return;

  try {
    new Notification(title, {
      icon: '/pwa-192x192.png',
      badge: '/pwa-192x192.png',
      ...options,
    });
  } catch (err) {
    // Service worker fallback for mobile
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: 'SHOW_NOTIFICATION',
        title,
        options,
      });
    }
  }
}

// Schedule check-in reminders
export function scheduleCheckInReminder(reminderTime: string) {
  const [hours, minutes] = reminderTime.split(':').map(Number);
  const now = new Date();
  const target = new Date();
  target.setHours(hours, minutes, 0, 0);

  if (target <= now) {
    target.setDate(target.getDate() + 1);
  }

  const delay = target.getTime() - now.getTime();

  setTimeout(() => {
    sendLocalNotification('Time to check in! 📋', {
      body: 'Log your daily activity before end of day.',
      tag: 'daily-checkin',
    });
  }, delay);
}

// Schedule first call reminder
export function scheduleFirstCallReminder() {
  // Remind at 9:15 AM if no first call logged
  const now = new Date();
  const target = new Date();
  target.setHours(9, 15, 0, 0);

  if (target <= now) return; // Already past

  const delay = target.getTime() - now.getTime();

  setTimeout(() => {
    sendLocalNotification('Make your first call! 📞', {
      body: 'Start your day strong — log your first call.',
      tag: 'first-call',
    });
  }, delay);
}
