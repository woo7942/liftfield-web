'use client';

/**
 * components/fault/FaultResultForm.tsx
 * 고장 처리 결과 입력 (간단 버전: 직접 입력)
 * 저장: fault_cause / fault_action / fault_note (기존 컬럼 그대로)
 */

export const RESULTS = ['정상 운행', '부품 대기(운행 중지)'];

export interface FaultResultValue {
  cause: string;
  action: string;
  result: string;
  note: string;
}

export const emptyResult = (): FaultResultValue => ({ cause: '', action: '', result: RESULTS[0], note: '' });

export const isWaitingParts = (v: FaultResultValue) => v.result === RESULTS[1];

export function composeResult(v: FaultResultValue) {
  return {
    fault_cause: v.cause.trim(),
    fault_action: [v.action.trim(), isWaitingParts(v) ? '(부품 대기)' : ''].filter(Boolean).join(' '),
    fault_note: v.note.trim(),
  };
}

export default function FaultResultForm({
  value, onChange,
}: { escalator?: boolean; value: FaultResultValue; onChange: (v: FaultResultValue) => void }) {
  const set = (patch: Partial<FaultResultValue>) => onChange({ ...value, ...patch });
  const box = 'w-full px-3 py-2.5 border rounded-xl text-sm outline-none focus:border-blue-400 resize-none';

  return (
    <div className="space-y-3">
      <div>
        <label className="text-sm font-semibold text-gray-700 mb-1 block">고장 원인 *</label>
        <textarea
          value={value.cause}
          onChange={(e) => set({ cause: e.target.value })}
          rows={2}
          placeholder="예: 3층 승강장 도어 롤러 마모"
          className={box}
        />
      </div>

      <div>
        <label className="text-sm font-semibold text-gray-700 mb-1 block">처리 내용 *</label>
        <textarea
          value={value.action}
          onChange={(e) => set({ action: e.target.value })}
          rows={3}
          placeholder="예: 도어 롤러 2개 교체 후 개폐 테스트, 정상 확인"
          className={box}
        />
      </div>

      <div>
        <label className="text-sm font-semibold text-gray-700 mb-1 block">처리 결과</label>
        <div className="flex gap-2">
          {RESULTS.map((r) => {
            const on = value.result === r;
            return (
              <button key={r} type="button" onClick={() => set({ result: r })}
                className={`flex-1 py-2 rounded-xl text-sm font-semibold border ${
                  on ? (r === RESULTS[0] ? 'bg-green-500 border-green-500 text-white' : 'bg-amber-500 border-amber-500 text-white')
                     : 'bg-white border-gray-200 text-gray-600'}`}>
                {r}
              </button>
            );
          })}
        </div>
        {isWaitingParts(value) && (
          <p className="text-xs text-amber-600 mt-1">부품 대기로 저장하면 '처리중'으로 남아요. 부품 교체 후 다시 결과를 등록하세요.</p>
        )}
      </div>

      <div>
        <label className="text-sm font-semibold text-gray-700 mb-1 block">비고</label>
        <textarea
          value={value.note}
          onChange={(e) => set({ note: e.target.value })}
          rows={2}
          placeholder="특이사항, 관리소 전달사항 등"
          className={box}
        />
      </div>
    </div>
  );
}
