'use client';

/**
 * components/fault/FaultResultForm.tsx
 * 고장 처리 결과 입력 (원인 · 처리내용 구체화)
 *
 * DB 컬럼은 그대로(fault_cause / fault_action / fault_note 텍스트) 쓰고,
 * 선택한 항목을 정해진 형식의 문장으로 만들어 넣습니다.
 *   fault_cause : "[제어반] 인버터 · 과전류 트립 / 원인: 노후·수명"
 *   fault_action: "[교체] 인버터 / 교체부품: 인버터 1개 / 결과: 정상 운행 확인"
 *   fault_note  : "후속조치: 견적 필요 · 메모..."
 */

import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

// ─── 원인 분류: 장치(부위) → 부품 → 현상 ───
export const EL_PARTS: Record<string, { parts: string[]; symptoms: string[] }> = {
  '도어(승강장·카)': {
    parts: ['도어 스위치', '도어 센서(세이프티슈·광전관)', '도어 모터', '도어 행거·롤러', '도어 벨트·와이어', '도어 인터록', '실(Sill)·가이드슈', '도어 클로저'],
    symptoms: ['문 안 닫힘', '문 안 열림', '반복 개폐', '닫힘 지연', '소음·마찰', '이물질 끼임', '파손·변형'],
  },
  '제어반': {
    parts: ['인버터', '메인 보드(CPU)', '릴레이·접촉기', '전원 공급장치(SMPS)', '브레이크 회로', '퓨즈·차단기', '통신 보드', '배선·단자'],
    symptoms: ['에러코드 발생', '과전류 트립', '전원 불량', '통신 오류', '접점 소손', '과열', '운행 정지'],
  },
  '권상기·브레이크': {
    parts: ['권상기(모터)', '브레이크 라이닝', '브레이크 코일', '엔코더', '감속기', '시브(도르래)'],
    symptoms: ['착상 불량', '진동·소음', '브레이크 미개방', '미끄러짐', '과열', '누유'],
  },
  '로프·조속기': {
    parts: ['메인 로프', '조속기', '조속기 로프', '비상정지장치', '로프 텐션'],
    symptoms: ['장력 불균형', '마모·소선 단선', '조속기 작동', '비상정지 작동'],
  },
  '카(Car)': {
    parts: ['카 조작반 버튼', '카 조명', '인디케이터', '비상통화장치', '환기팬', '가이드슈·롤러', '하중 감지장치'],
    symptoms: ['버튼 불량', '조명 불량', '표시 불량', '통화 불량', '진동·소음', '과부하 오감지'],
  },
  '승강장': {
    parts: ['승강장 호출 버튼', '홀 인디케이터', '도어 인터록', '소방 스위치'],
    symptoms: ['호출 불량', '표시 불량', '파손'],
  },
  '승강로·피트': {
    parts: ['리미트·파이널 스위치', '착상 센서', '완충기', '피트 스위치', '레일'],
    symptoms: ['센서 오작동', '침수', '이물질', '정렬 불량'],
  },
  '외부 요인': {
    parts: ['정전·한전', '건물 전원(분전반)', '침수·누수', '이용자 과실', '낙뢰'],
    symptoms: ['전원 차단', '복전 후 미기동', '장난·강제 개방', '과적'],
  },
};

export const ES_PARTS: Record<string, { parts: string[]; symptoms: string[] }> = {
  '스텝·체인': { parts: ['스텝', '스텝 체인', '스텝 롤러', '구동 체인'], symptoms: ['소음·진동', '파손', '이탈', '마모'] },
  '핸드레일': { parts: ['핸드레일', '핸드레일 구동롤러', '핸드레일 인입구'], symptoms: ['속도 차이', '정지', '파손', '이물질'] },
  '안전장치': { parts: ['스커트 가드 스위치', '콤 플레이트 스위치', '비상정지 버튼', '역주행 방지장치'], symptoms: ['오작동', '작동(정지)', '파손'] },
  '구동부·제어반': { parts: ['구동 모터', '감속기', '브레이크', '인버터', '제어 보드'], symptoms: ['기동 불량', '과열', '에러코드', '누유'] },
  '외부 요인': { parts: ['정전', '이물질 끼임', '이용자 과실', '침수'], symptoms: ['정지', '복전 후 미기동'] },
};

export const ROOT_CAUSES = ['노후·수명', '마모', '이물질', '조정 불량(틀어짐)', '접촉 불량', '이용자 과실', '외부 충격·파손', '전원 문제', '원인 미상(관찰 필요)'];

export const ACTION_TYPES = ['조정', '청소', '부품 교체', '수리', '리셋·재기동', '점검 후 이상없음', '임시 조치'];
export const RESULTS = ['정상 운행 확인', '임시 운행(재방문 필요)', '운행 중지(부품 대기)'];
export const FOLLOWUPS = ['없음', '견적 필요', '부품 주문', '재방문 예정', '관찰 필요'];

export interface FaultResultValue {
  device: string;
  part: string;
  symptom: string;
  rootCause: string;
  causeMemo: string;
  actions: string[];
  replaced: { name: string; qty: number }[];
  actionMemo: string;
  result: string;
  followup: string;
  note: string;
}

export const emptyResult = (): FaultResultValue => ({
  device: '', part: '', symptom: '', rootCause: '', causeMemo: '',
  actions: [], replaced: [], actionMemo: '', result: RESULTS[0], followup: '없음', note: '',
});

/** 선택값 → DB 저장 문자열 */
export function composeResult(v: FaultResultValue) {
  const causeHead = [v.device && `[${v.device}]`, [v.part, v.symptom].filter(Boolean).join(' · ')].filter(Boolean).join(' ');
  const cause = [
    causeHead,
    v.rootCause && `원인: ${v.rootCause}`,
    v.causeMemo.trim(),
  ].filter(Boolean).join(' / ');

  const parts = v.replaced.filter((p) => p.name.trim());
  const action = [
    v.actions.length ? `[${v.actions.join('·')}]` : '',
    parts.length ? `교체부품: ${parts.map((p) => `${p.name.trim()} ${p.qty}개`).join(', ')}` : '',
    v.actionMemo.trim(),
    v.result && `결과: ${v.result}`,
  ].filter(Boolean).join(' / ');

  const note = [
    v.followup && v.followup !== '없음' ? `후속조치: ${v.followup}` : '',
    v.note.trim(),
  ].filter(Boolean).join(' · ');

  return { fault_cause: cause, fault_action: action, fault_note: note };
}

// ─── UI ───
const chipCls = (on: boolean, tone: 'orange' | 'blue' | 'gray' = 'gray') => {
  const onCls = tone === 'orange' ? 'bg-orange-500 text-white border-orange-500'
    : tone === 'blue' ? 'bg-blue-500 text-white border-blue-500' : 'bg-gray-800 text-white border-gray-800';
  return `px-3 py-1.5 rounded-full text-[13px] font-semibold border transition-colors ${on ? onCls : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'}`;
};

function Step({ n, title, children, hint }: { n: number; title: string; hint?: string; children?: ReactNode }) {
  return (
    <div>
      <div className="flex items-baseline gap-2 mb-2">
        <span className="w-5 h-5 rounded-full bg-gray-900 text-white text-[11px] font-bold flex items-center justify-center shrink-0">{n}</span>
        <span className="text-sm font-bold text-gray-800">{title}</span>
        {hint && <span className="text-xs text-gray-400">{hint}</span>}
      </div>
      <div className="pl-7">{children}</div>
    </div>
  );
}

export default function FaultResultForm({
  escalator, value, onChange,
}: { escalator?: boolean; value: FaultResultValue; onChange: (v: FaultResultValue) => void }) {
  const map = escalator ? ES_PARTS : EL_PARTS;
  const devices = Object.keys(map);
  const cur = value.device ? map[value.device] : null;
  const set = (patch: Partial<FaultResultValue>) => onChange({ ...value, ...patch });
  const [customPart, setCustomPart] = useState('');

  // 부품 교체 선택 시 교체부품 한 줄 기본 생성 (선택한 부품명으로)
  useEffect(() => {
    if (value.actions.includes('부품 교체') && value.replaced.length === 0) {
      set({ replaced: [{ name: value.part || '', qty: 1 }] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.actions]);

  const preview = useMemo(() => composeResult(value), [value]);
  const toggleAction = (a: string) =>
    set({ actions: value.actions.includes(a) ? value.actions.filter((x) => x !== a) : [...value.actions, a] });

  return (
    <div className="space-y-5">
      {/* ── 원인 ── */}
      <div className="rounded-xl border border-orange-100 bg-orange-50/40 p-4 space-y-4">
        <div className="text-sm font-bold text-orange-700">고장 원인</div>

        <Step n={1} title="고장 부위">
          <div className="flex flex-wrap gap-1.5">
            {devices.map((d) => (
              <button key={d} type="button" onClick={() => set({ device: d, part: '', symptom: '' })} className={chipCls(value.device === d, 'orange')}>{d}</button>
            ))}
          </div>
        </Step>

        {cur && (
          <Step n={2} title="부품">
            <div className="flex flex-wrap gap-1.5">
              {cur.parts.map((p) => (
                <button key={p} type="button" onClick={() => set({ part: value.part === p ? '' : p })} className={chipCls(value.part === p, 'orange')}>{p}</button>
              ))}
              <input
                value={customPart}
                onChange={(e) => setCustomPart(e.target.value)}
                onBlur={() => { if (customPart.trim()) { set({ part: customPart.trim() }); setCustomPart(''); } }}
                placeholder="직접 입력"
                className="px-3 py-1.5 rounded-full text-[13px] border border-dashed border-gray-300 w-28 outline-none focus:border-orange-400"
              />
            </div>
          </Step>
        )}

        {cur && (
          <Step n={3} title="현상">
            <div className="flex flex-wrap gap-1.5">
              {cur.symptoms.map((s) => (
                <button key={s} type="button" onClick={() => set({ symptom: value.symptom === s ? '' : s })} className={chipCls(value.symptom === s, 'orange')}>{s}</button>
              ))}
            </div>
          </Step>
        )}

        <Step n={cur ? 4 : 2} title="근본 원인">
          <div className="flex flex-wrap gap-1.5">
            {ROOT_CAUSES.map((r) => (
              <button key={r} type="button" onClick={() => set({ rootCause: value.rootCause === r ? '' : r })} className={chipCls(value.rootCause === r)}>{r}</button>
            ))}
          </div>
          <input
            value={value.causeMemo}
            onChange={(e) => set({ causeMemo: e.target.value })}
            placeholder="원인 상세 (예: 3층 승강장 도어 롤러 마모로 레일 이탈)"
            className="w-full mt-2 px-3 py-2 border rounded-lg text-sm outline-none focus:border-orange-400 bg-white"
          />
        </Step>
      </div>

      {/* ── 처리 ── */}
      <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-4 space-y-4">
        <div className="text-sm font-bold text-blue-700">처리 내용</div>

        <Step n={1} title="조치" hint="여러 개 선택 가능">
          <div className="flex flex-wrap gap-1.5">
            {ACTION_TYPES.map((a) => (
              <button key={a} type="button" onClick={() => toggleAction(a)} className={chipCls(value.actions.includes(a), 'blue')}>{a}</button>
            ))}
          </div>
        </Step>

        {value.actions.includes('부품 교체') && (
          <Step n={2} title="교체 부품">
            <div className="space-y-1.5">
              {value.replaced.map((p, i) => (
                <div key={i} className="flex gap-1.5">
                  <input
                    value={p.name}
                    onChange={(e) => set({ replaced: value.replaced.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })}
                    placeholder="부품명"
                    className="flex-1 min-w-0 px-3 py-2 border rounded-lg text-sm outline-none focus:border-blue-400 bg-white"
                  />
                  <input
                    type="number" min={1}
                    value={p.qty}
                    onChange={(e) => set({ replaced: value.replaced.map((x, j) => (j === i ? { ...x, qty: Math.max(1, Number(e.target.value) || 1) } : x)) })}
                    className="w-16 px-2 py-2 border rounded-lg text-sm text-center bg-white"
                  />
                  <button type="button" onClick={() => set({ replaced: value.replaced.filter((_, j) => j !== i) })} className="px-2 text-gray-400 text-sm">삭제</button>
                </div>
              ))}
              <button type="button" onClick={() => set({ replaced: [...value.replaced, { name: '', qty: 1 }] })} className="text-xs font-semibold text-blue-600">+ 부품 추가</button>
            </div>
          </Step>
        )}

        <Step n={value.actions.includes('부품 교체') ? 3 : 2} title="작업 상세">
          <textarea
            value={value.actionMemo}
            onChange={(e) => set({ actionMemo: e.target.value })}
            rows={2}
            placeholder="예: 도어 롤러 2개 교체 후 레일 간격 조정, 10회 개폐 테스트"
            className="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:border-blue-400 resize-none bg-white"
          />
        </Step>

        <Step n={value.actions.includes('부품 교체') ? 4 : 3} title="처리 결과">
          <div className="flex flex-wrap gap-1.5">
            {RESULTS.map((r) => (
              <button key={r} type="button" onClick={() => set({ result: r })} className={chipCls(value.result === r, 'blue')}>{r}</button>
            ))}
          </div>
        </Step>
      </div>

      {/* ── 후속 ── */}
      <div className="space-y-3">
        <div>
          <div className="text-sm font-bold text-gray-800 mb-2">후속 조치</div>
          <div className="flex flex-wrap gap-1.5">
            {FOLLOWUPS.map((f) => (
              <button key={f} type="button" onClick={() => set({ followup: f })} className={chipCls(value.followup === f)}>{f}</button>
            ))}
          </div>
        </div>
        <textarea
          value={value.note}
          onChange={(e) => set({ note: e.target.value })}
          rows={2}
          placeholder="비고 (관리소 전달사항 등)"
          className="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:border-gray-400 resize-none"
        />
      </div>

      {/* ── 저장될 내용 미리보기 ── */}
      <div className="rounded-xl bg-gray-50 p-3 text-xs text-gray-600 space-y-1">
        <div className="font-bold text-gray-500 mb-1">보고서에 이렇게 저장돼요</div>
        <div><b className="text-gray-800">원인</b> {preview.fault_cause || <span className="text-gray-400">미선택</span>}</div>
        <div><b className="text-gray-800">처리</b> {preview.fault_action || <span className="text-gray-400">미선택</span>}</div>
        {preview.fault_note && <div><b className="text-gray-800">비고</b> {preview.fault_note}</div>}
      </div>
    </div>
  );
}
