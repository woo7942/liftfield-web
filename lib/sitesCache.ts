// 예전 대시보드에 있던 함수를 옮겨 둔 파일입니다.
// 새 대시보드는 열 때마다 DB에서 바로 불러오므로 비울 캐시가 없습니다.
// 기존 호출 형태(invalidateSitesCache(companyId))를 그대로 받을 수 있게 매개변수를 둡니다.
export function invalidateSitesCache(companyId?: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    for (const k of Object.keys(sessionStorage)) {
      const key = k.toLowerCase();
      if (key.includes('sites') && (!companyId || k.includes(companyId) || !/[0-9a-f]{8}-/.test(k))) {
        sessionStorage.removeItem(k);
      }
    }
  } catch {}
}
