// components/fault/ChipAccordion.tsx
'use client';

import { useState } from 'react';
import { CHIP_SEP, toggleChipValue, ChipGroups } from '@/lib/fault-taxonomy';
import { FaultIcon } from '@/components/fault/icons';

interface ChipAccordionProps {
  title: string;
  required?: boolean;
  groups: ChipGroups;
  value: string;
  onChange: (value: string) => void;
  accent: 'orange' | 'blue';
}

export default function ChipAccordion({
  title,
  required = false,
  groups,
  value,
  onChange,
  accent,
}: ChipAccordionProps) {
  const entries = Object.entries(groups);
  const selected = value.split(CHIP_SEP).map((s) => s.trim()).filter(Boolean);

  const initialOpen =
    entries.find(([, g]) => g.items.some((i) => selected.includes(i)))?.[0] ?? null;
  const [openGroup, setOpenGroup] = useState<string | null>(initialOpen);

  const theme =
    accent === 'orange'
      ? { pill: 'bg-orange-50 border-orange-400 text-orange-600', chip: 'border-orange-500 text-orange-600' }
      : { pill: 'bg-blue-50 border-blue-400 text-blue-600', chip: 'border-blue-500 text-blue-600' };

  const clearAll = () => onChange('');

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-sm font-bold text-gray-800">{title}</span>
          {required && (
            <span className="text-[10px] font-bold text-rose-500 bg-rose-50 px-1.5 py-0.5 rounded">필수</span>
          )}
          {selected.length > 0 && (
            <span className="text-xs text-gray-400">{selected.length}개 선택</span>
          )}
        </div>
        {selected.length > 0 && (
          <button type="button" onClick={clearAll} className="text-xs text-gray-400 underline underline-offset-2">
            모두 지우기
          </button>
        )}
      </div>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {selected.map((label) => (
            <span
              key={label}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border ${theme.pill}`}
            >
              {label}
              <button
                type="button"
                onClick={() => onChange(toggleChipValue(value, label))}
                className="opacity-60 hover:opacity-100"
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="border rounded-xl overflow-hidden divide-y max-h-56 overflow-y-auto">
        {entries.map(([group, data]) => {
          const IconComp = FaultIcon[data.icon as keyof typeof FaultIcon];
          const selectedInGroup = data.items.filter((i) => selected.includes(i)).length;
          const isOpen = openGroup === group;
          const highlighted = selectedInGroup > 0;
          return (
            <div
              key={group}
              className={highlighted ? 'border-2 border-gray-900 relative z-10 -my-px' : ''}
            >
              <button
                type="button"
                onClick={() => setOpenGroup(isOpen ? null : group)}
                className="w-full flex items-center justify-between px-3 py-2.5 bg-white"
              >
                <span className="flex items-center gap-2 text-gray-700">
                  <IconComp size={16} className="text-gray-500" />
                  <span className="text-sm font-semibold">{group}</span>
                  {selectedInGroup > 0 && (
                    <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-orange-500 text-white text-[10px] font-bold">
                      {selectedInGroup}
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-1 text-xs text-gray-400">
                  {data.items.length}개
                  <span>{isOpen ? '▲' : '▼'}</span>
                </span>
              </button>
              {isOpen && (
                <div className="flex flex-wrap gap-1.5 px-3 pb-3 bg-white">
                  {data.items.map((label) => {
                    const active = selected.includes(label);
                    return (
                      <button
                        key={label}
                        type="button"
                        onClick={() => onChange(toggleChipValue(value, label))}
                        className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs border-2 ${
                          active ? `bg-white font-bold ${theme.chip}` : 'bg-white border-gray-300 text-gray-600 font-medium'
                        }`}
                      >
                        {active && <span>✓</span>}
                        {label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
