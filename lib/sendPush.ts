// lib/sendPush.ts
import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT!,
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
);

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type PushPayload = {
  title: string;
  body: string;
  url: string; // 클릭 시 이동할 경로 (예: "/fault")
};

export async function sendPushToUsers(userIds: string[], payload: PushPayload) {
  if (!userIds || userIds.length === 0) return { sent: 0, failed: 0 };

  const { data: subs, error } = await supabaseAdmin
    .from("push_subscriptions")
    .select("id, user_id, endpoint, p256dh, auth")
    .in("user_id", userIds);

  if (error) {
    console.error("push_subscriptions 조회 실패:", error);
    return { sent: 0, failed: 0, error };
  }
  if (!subs || subs.length === 0) return { sent: 0, failed: 0 };

  const payloadStr = JSON.stringify(payload);
  let sent = 0;
  let failed = 0;
  const deadIds: number[] = [];

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          payloadStr
        );
        sent++;
      } catch (err: any) {
        failed++;
        // 구독이 만료되었거나 삭제된 경우(410, 404) 테이블에서 정리
        if (err?.statusCode === 410 || err?.statusCode === 404) {
          deadIds.push(sub.id);
        } else {
          console.error("push 발송 실패:", sub.id, err?.message);
        }
      }
    })
  );

  if (deadIds.length > 0) {
    await supabaseAdmin.from("push_subscriptions").delete().in("id", deadIds);
  }

  return { sent, failed };
}
