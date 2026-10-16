/**
 * ShiftUp — Service Worker push eklentisi.
 *
 * Ana service worker (/sw.js — src/app/sw.js/route.ts) bu dosyayı `importScripts('/sw-push.js')` ile yükler.
 * Düz JS (modül değil); yalnızca push ile ilgili olayları dinler:
 *   push                  → bildirimi göster, açık sekmelere PUSH_RECEIVED gönder, rozeti güncelle
 *   notificationclick     → açık uygulama penceresini öne getirip hedef sayfaya git (yoksa yeni pencere)
 *   pushsubscriptionchange→ aboneliği yenile ve sunucuya kaydet (en iyi çaba)
 *
 * Push gövdesi (send-push Edge Function):
 *   { title, body, url, tag, notificationId, type, unreadCount }
 */

;(function () {
  var DEFAULT_URL = '/notifications'
  var ICON = '/icon-192.png'

  /** Yalnızca aynı origin'deki göreli yollar (açık yönlendirme önlemi) */
  function safePath(value) {
    if (typeof value !== 'string' || value.charAt(0) !== '/' || value.charAt(1) === '/' || value.charAt(1) === '\\') {
      return DEFAULT_URL
    }
    try {
      var u = new URL(value, self.location.origin)
      if (u.origin !== self.location.origin) return DEFAULT_URL
      return u.pathname + u.search + u.hash
    } catch {
      return DEFAULT_URL
    }
  }

  function readPayload(event) {
    if (!event.data) return {}
    try {
      var data = event.data.json()
      return data && typeof data === 'object' ? data : {}
    } catch {
      try {
        return { body: event.data.text() }
      } catch {
        return {}
      }
    }
  }

  /** Uygulama ikonu rozeti (destekleyen tarayıcılarda) */
  function updateBadge(count) {
    var nav = self.navigator
    if (!nav || typeof nav.setAppBadge !== 'function') return Promise.resolve()
    try {
      if (typeof count === 'number') {
        return (count > 0 ? nav.setAppBadge(count) : nav.clearAppBadge()).catch(function () {})
      }
      // Sayı bilinmiyorsa yalnızca "yeni var" işareti
      return nav.setAppBadge().catch(function () {})
    } catch {
      return Promise.resolve()
    }
  }

  function postToClients(message) {
    return self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(function (list) {
        list.forEach(function (client) {
          try {
            client.postMessage(message)
          } catch {
            /* sessiz */
          }
        })
      })
      .catch(function () {})
  }

  self.addEventListener('push', function (event) {
    var data = readPayload(event)
    var title = typeof data.title === 'string' && data.title ? data.title : 'ShiftUp'
    var options = {
      body: typeof data.body === 'string' ? data.body : '',
      icon: ICON,
      badge: ICON,
      lang: 'tr',
      timestamp: Date.now(),
      data: {
        url: safePath(data.url),
        notificationId: typeof data.notificationId === 'string' ? data.notificationId : null,
        type: typeof data.type === 'string' ? data.type : null,
      },
    }
    if (typeof data.tag === 'string' && data.tag) {
      options.tag = data.tag
      // Aynı etiketli bildirim güncellenince yeniden titreşim/ses
      options.renotify = true
    }

    event.waitUntil(
      Promise.all([
        self.registration.showNotification(title, options),
        postToClients({ type: 'PUSH_RECEIVED', notificationId: options.data.notificationId }),
        updateBadge(data.unreadCount),
      ])
    )
  })

  self.addEventListener('notificationclick', function (event) {
    event.notification.close()
    var data = event.notification.data || {}
    var path = safePath(data.url)
    var target = new URL(path, self.location.origin).href

    // Tıklanan bildirimi okundu işaretle (oturum çerezi varsa; en iyi çaba)
    var markRead =
      typeof data.notificationId === 'string'
        ? fetch('/api/notifications/read', {
            method: 'PATCH',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ notification_id: data.notificationId }),
          }).catch(function () {})
        : Promise.resolve()

    var focus = self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(function (list) {
        var client = null
        for (var i = 0; i < list.length; i++) {
          try {
            if (new URL(list[i].url).origin === self.location.origin) {
              client = list[i]
              if (list[i].focused) break
            }
          } catch {
            /* geçersiz url */
          }
        }
        if (!client) return self.clients.openWindow(target)
        return client
          .focus()
          .then(function (focused) {
            var c = focused || client
            if (typeof c.navigate === 'function') return c.navigate(target)
            return null
          })
          .catch(function () {
            // navigate yalnızca bu SW'nin kontrol ettiği pencerelerde çalışır
            return self.clients.openWindow(target)
          })
      })

    event.waitUntil(Promise.all([markRead, focus]))
  })

  function urlBase64ToUint8Array(base64) {
    var padding = '='.repeat((4 - (base64.length % 4)) % 4)
    var raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'))
    var out = new Uint8Array(raw.length)
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
    return out
  }

  /** Eski aboneliğin anahtarı, yoksa sunucudaki VAPID açık anahtarı */
  function resolveServerKey(oldSub) {
    var key = oldSub && oldSub.options && oldSub.options.applicationServerKey
    if (key) return Promise.resolve(key)
    return fetch('/api/push/config', { credentials: 'same-origin' })
      .then(function (res) {
        return res.ok ? res.json() : null
      })
      .then(function (cfg) {
        return cfg && cfg.enabled && cfg.publicKey ? urlBase64ToUint8Array(cfg.publicKey) : null
      })
  }

  self.addEventListener('pushsubscriptionchange', function (event) {
    var oldSub = event.oldSubscription || null
    var work = Promise.resolve(event.newSubscription || null)
      .then(function (newSub) {
        if (newSub) return newSub
        return resolveServerKey(oldSub).then(function (key) {
          if (!key) return null
          return self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
        })
      })
      .then(function (newSub) {
        if (!newSub) return null
        return fetch('/api/push/subscription', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newSub.toJSON()),
        }).then(function () {
          return newSub
        })
      })
      .then(function (newSub) {
        if (!oldSub || !oldSub.endpoint) return null
        if (newSub && newSub.endpoint === oldSub.endpoint) return null
        return fetch('/api/push/subscription', {
          method: 'DELETE',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: oldSub.endpoint }),
        })
      })
      .catch(function () {
        /* en iyi çaba: uygulama açıldığında istemci aboneliği yeniden kaydeder */
      })
    event.waitUntil(work)
  })
})()
