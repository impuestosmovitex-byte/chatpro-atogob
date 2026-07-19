self.addEventListener("push", (event) => {
  let payload = {
    title: "ChatPro",
    body: "Tienes una nueva notificación.",
    url: "/",
    tag: "chatpro-notification",
  };

  if (event.data) {
    try {
      payload = { ...payload, ...event.data.json() };
    } catch {
      payload.body = event.data.text() || payload.body;
    }
  }

  const options = {
    body: payload.body,
    icon: "/icons/chatpro-192.png",
    badge: "/icons/chatpro-192.png",
    tag: payload.tag,
    renotify: true,
    data: {
      url: payload.url || "/",
    },
  };

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(payload.title || "ChatPro", options),
      typeof self.registration.setAppBadge === "function"
        ? self.registration.setAppBadge(1)
        : Promise.resolve(),
    ]),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = new URL(
    event.notification.data?.url || "/",
    self.location.origin,
  ).href;

  event.waitUntil(
    self.clients
      .matchAll({
        type: "window",
        includeUncontrolled: true,
      })
      .then(async (windowClients) => {
        for (const client of windowClients) {
          if ("navigate" in client) {
            await client.navigate(targetUrl);
          }

          if ("focus" in client) {
            return client.focus();
          }
        }

        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }

        return undefined;
      }),
  );
});
