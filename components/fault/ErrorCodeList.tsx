// components/fault/ErrorCodeList.tsx
'use client';

interface ErrorCodeListProps {
  codes: string[];
  reportedCodes?: string[];
  onChange: (codes: string[]) => void;
  disabled?: boolean;
  max?: number;
}

export default function ErrorCodeList({
  codes,
  reportedCodes = [],
  onChange,
  disabled = false,
  max = 10,
}: ErrorCodeListProps) {
  const updateAt = (idx: number, v: string) => {
    const next = [...codes];
    next[idx] = v;
    onChange(next);
  };
  const removeAt = (idx: number) => onChange(codes.filter((_, i) => i !== idx));
  const addRow = () => {
    if (codes.length >= max) return;
    onChange([...codes, '']);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-bold text-gray-800">에러 코드</span>
          <span className="text-xs text-gray-400">제어반 표시 코드</span>
        </div>
        <span className="text-xs font-semibold text-gray-400">{codes.length}/{max}</span>
      </div>

      {reportedCodes.length > 0 && (
        <div className="text-[11px] text-indigo-500 bg-indigo-50 rounded-md px-2 py-1.5 mb-2">
          📌 접수 시 신고된 코드가 자동 입력됐어요. 필요시 수정하세요.
        </div>
      )}

      <div className="space-y-1.5">
        {codes.map((code, idx) => {
          const isReported = reportedCodes.includes(code) && code.trim() !== '';
          return (
            <div key={idx} className="flex items-center gap-2">
              <span className="w-5 h-5 flex-shrink-0 flex items-center justify-center rounded-full bg-gray-100 text-gray-500 text-[11px] font-bold">
                {idx + 1}
              </span>
              <input
                value={code}
                onChange={(e) => updateAt(idx, e.target.value)}
                readOnly={disabled}
                placeholder="예: E-21"
                className={`flex-1 px-3 py-1.5 border rounded-lg text-sm font-mono outline-none ${
                  disabled ? 'bg-gray-50 text-gray-500' : 'focus:border-blue-400'
                }`}
              />
              {isReported && (
                <span className="text-[10px] font-bold text-green-600 bg-green-50 border border-green-200 px-1.5 py-0.5 rounded-full flex-shrink-0">
                  접수
                </span>
              )}
              {!disabled && (
                <button type="button" onClick={() => removeAt(idx)} className="text-gray-300 hover:text-gray-500 flex-shrink-0">
                  ✕
                </button>
              )}
            </div>
          );
        })}
        {codes.length === 0 && (
          <div className="text-xs text-gray-400 py-1">등록된 에러코드가 없습니다</div>
        )}
      </div>

      {!disabled && codes.length < max && (
        <button
          type="button"
          onClick={addRow}
          className="w-full mt-2 py-2 border-2 border-dashed border-gray-300 rounded-lg text-xs font-semibold text-gray-400 hover:border-gray-400 hover:text-gray-500"
        >
          + 현장에서 확인한 코드 추가
        </button>
      )}
    </div>
  );
}
