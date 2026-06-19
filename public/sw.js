self.addEventListener('push', function(event) {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'Dynamic';
  const options = {
    body: data.body || 'Time to sharpen the saw.',
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    tag: 'dynamic-daily',
    requireInteraction: false,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  event.waitUntil(clients.openWindow('/'));
});
