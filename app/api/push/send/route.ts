// app/api/push/send/route.ts
import { NextRequest, NextResponse } from "next/server";
import { sendPushToUsers } from "@/lib/sendPush";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { userIds, title, body: message, url } = body as {
      userIds: string[];
      title: string;
      body: string;
      url: string;
    };

    if (!userIds || userIds.length === 0 || !title || !message || !url) {
      return NextResponse.json({ error: "필수 파라미터 누락" }, { status: 400 });
    }

    const result = await sendPushToUsers(userIds, {
      title,
      body: message,
      url,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    console.error("push send route error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
