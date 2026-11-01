-- ============================================================
-- push_subscriptions: son gönderim hatası (teşhis).
--
-- send-push, push servisi (FCM / APNs / Mozilla) isteği reddettiğinde durum kodunu ve yanıtın
-- başını buraya yazar; başarılı gönderimde temizler. /push-debug sayfası "bu cihaza neden
-- ulaşmıyor" sorusunu bu kolonlarla yanıtlar. 404/410 alan abonelik zaten silinir.
--
-- İdempotent: tekrar çalıştırılabilir.
-- ============================================================

ALTER TABLE public.push_subscriptions
  ADD COLUMN IF NOT EXISTS last_error    TEXT,
  ADD COLUMN IF NOT EXISTS last_error_at TIMESTAMPTZ;
