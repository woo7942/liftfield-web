import { NextRequest, NextResponse } from 'next/server';

const SERVICE_KEY = '4c4e8677cc42223329b997aee1cbc0dffa8cd337ecb0e8c47364825dc2c76577';

const BASE_URL = 'https://apis.data.go.kr/B553664/ElevatorInspectsafeService';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type'); // 'history' | 'fail'
  const elevatorNo = searchParams.get('elevator_no');
  const failCd = searchParams.get('fail_cd');

  let targetUrl = '';

  if (type === 'history') {
    if (!elevatorNo) {
      return NextResponse.json({ error: 'elevator_no is required' }, { status: 400 });
    }
    targetUrl = `${BASE_URL}/getInspectsafeList?serviceKey=${SERVICE_KEY}&elevator_no=${elevatorNo}&numOfRows=50&pageNo=1`;
  } else if (type === 'fail') {
    if (!failCd) {
      return NextResponse.json({ error: 'fail_cd is required' }, { status: 400 });
    }
    targetUrl = `${BASE_URL}/getInspectFailList?serviceKey=${SERVICE_KEY}&fail_cd=${failCd}&numOfRows=50&pageNo=1`;
  } else {
    return NextResponse.json({ error: 'invalid type' }, { status: 400 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000); // 15초 타임아웃

  try {
    const res = await fetch(targetUrl, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) {
      return NextResponse.json(
        { error: `공공데이터 API 오류 (status: ${res.status})` },
        { status: res.status }
      );
    }

    const text = await res.text();
    return new NextResponse(text, {
      status: 200,
      headers: { 'Content-Type': 'application/xml; charset=utf-8' },
    });
  } catch (err: any) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      return NextResponse.json({ error: '공공데이터 API 응답 시간 초과(15초)' }, { status: 504 });
    }
    return NextResponse.json({ error: `요청 실패: ${err.message}` }, { status: 500 });
  }
}
