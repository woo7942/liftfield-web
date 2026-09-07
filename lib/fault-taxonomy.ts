// lib/fault-taxonomy.ts
export const isEscalatorType = (t?: string | null): boolean =>
  !!t && (t.includes('에스컬레이터') || t.includes('무빙워크'));

export interface ChipGroupData {
  icon: string; // FaultIcon 키
  items: string[];
}
export type ChipGroups = Record<string, ChipGroupData>;

export const ELEVATOR_CAUSE_GROUPS: ChipGroups = {
  '전기·전원': { icon: 'bolt', items: ['정전·전원 차단', '배선 접촉불량·단선', '누전'] },
  '제어반': { icon: 'cpu', items: ['제어반(인버터) 에러', '기판 소손', '통신·신호 오류'] },
  '도어': { icon: 'door', items: ['도어 개폐 불량', '도어 스위치 불량', '도어 레일 이물질 끼임', '도어 벨트 마모·이탈'] },
  '권상기·모터': { icon: 'gear', items: ['권상기 이상음', '메인모터 과열', '브레이크 라이닝 마모', '브레이크 미개방(작동불량)'] },
  '로프·안전장치': { icon: 'link', items: ['로프 장력 불균형', '로프 마모·소선단선', '조속기(과속조절기) 작동', '리미트·안전스위치 오동작', '완충기 이상'] },
  '조작반·표시': { icon: 'circleDot', items: ['버튼·조작반 고장', '층수표시기 오류', '인터폰 불량'] },
  '기타': { icon: 'chat', items: ['정지위치 불량(착상오차)', '승강로 이물질 끼임', '진동·소음 발생', '노후 부품열화', '사용자 과실(비정상 사용)', '원인불명', '기타'] },
};

export const ESCALATOR_CAUSE_GROUPS: ChipGroups = {
  '스텝·디딤판': { icon: 'gear', items: ['스텝 변형·파손', '스텝체인 장력불량(늘어짐)', '스텝 롤러 마모', '스텝 정렬 불량'] },
  '핸드레일': { icon: 'link', items: ['핸드레일 이탈', '핸드레일 속도불일치', '핸드레일 마모·손상', '핸드레일 급정지'] },
  '구동부': { icon: 'cpu', items: ['구동체인 이상', '감속기 소음·마모', '메인브레이크 이상', '전동기 과열'] },
  '콤플레이트·스커트': { icon: 'door', items: ['콤플레이트 파손', '스커트가드 마찰·간섭', '안전브러시(스커트 디플렉터) 이탈'] },
  '안전장치': { icon: 'bolt', items: ['비상정지스위치 작동', '인렛가드 안전스위치 작동', '역행방지장치 작동'] },
  '전기·제어': { icon: 'cpu', items: ['제어반 오류', '릴레이 불량', '정전·전원차단'] },
  '기타': { icon: 'chat', items: ['이물질 끼임', '소음·진동', '노후 부품열화', '원인불명', '기타'] },
};

// 처리 내용 (스크린샷 기준 4개 카테고리, "조치·수리"만 문구 확인됨 / 나머지는 임의 문구)
export const ACTION_GROUPS: ChipGroups = {
  '점검·확인': { icon: 'search', items: ['증상 재현 확인', '작동 테스트', '외관 육안 점검', '이상음·진동 확인'] },
  '조치·수리': { icon: 'wrench', items: ['조정·재조임', '청소·이물질 제거', '부품 교체', '배선·접속 정비', '급유·윤활'] },
  '보류·후속': { icon: 'package', items: ['부품 주문 후 재방문 예정', '제조사·외주업체 A/S 요청', '임시조치 후 모니터링'] },
  '종결·안내': { icon: 'phone', items: ['고객 안내 후 종료', '이상없음 확인 종료', '재발방지 교육 안내'] },
};

export const CHIP_SEP = ' · ';

export const toggleChipValue = (current: string, label: string): string => {
  const parts = current.split(CHIP_SEP).map((p) => p.trim()).filter(Boolean);
  const idx = parts.indexOf(label);
  if (idx >= 0) parts.splice(idx, 1);
  else parts.push(label);
  return parts.join(CHIP_SEP);
};
