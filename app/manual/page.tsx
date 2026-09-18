'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MANUALS_DATA } from '@/lib/manualsData';

export default function ManualPage() {
  const router = useRouter();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const selectedManufacturer = useMemo(
    () => MANUALS_DATA.find((m) => m.key === selectedKey) || null,
    [selectedKey]
  );

  const filteredPhotos = useMemo(() => {
    if (!selectedManufacturer) return [];
    if (!search.trim()) return selectedManufacturer.photos;
    return selectedManufacturer.photos.filter((p) =>
      p.label.toLowerCase().includes(search.trim().toLowerCase())
    );
  }, [selectedManufacturer, search]);

  const getImageSrc = (folder: string, file: string) =>
    `/manuals/${folder}/${encodeURIComponent(file)}`;

  // 1단계: 제조사 선택 화면
  if (!selectedManufacturer) {
    return (
      <div className="p-4 max-w-5xl mx-auto">
        <div className="flex items-center gap-2 mb-4">
          <button
            onClick={() => router.back()}
            className="text-sm text-gray-500 hover:text-gray-800"
          >
            ← 뒤로
          </button>
          <h1 className="text-xl font-bold ml-2">⚡ 안전라인 점퍼 매뉴얼</h1>
        </div>
        <p className="text-sm text-gray-500 mb-4">
          제조사를 선택하면 기종별 점퍼 위치 사진을 확인할 수 있습니다.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {MANUALS_DATA.map((m) => (
            <button
              key={m.key}
              onClick={() => {
                setSelectedKey(m.key);
                setSearch('');
              }}
              className="border rounded-xl p-4 text-center hover:bg-blue-50 hover:border-blue-400 transition"
            >
              <div className="font-semibold">{m.label}</div>
              <div className="text-xs text-gray-400 mt-1">
                {m.photos.length}개 기종
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // 2단계: 기종(사진) 목록 화면
  return (
    <div className="p-4 max-w-5xl mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={() => setSelectedKey(null)}
          className="text-sm text-gray-500 hover:text-gray-800"
        >
          ← 제조사 목록
        </button>
        <h1 className="text-xl font-bold ml-2">{selectedManufacturer.label}</h1>
      </div>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="기종명 검색 (예: VVVF, DY20 등)"
        className="w-full border rounded-lg px-3 py-2 text-sm mb-4"
      />

            <div className="border rounded-xl divide-y overflow-hidden">
        {filteredPhotos.map((p, idx) => (
          <button
            key={p.file}
            onClick={() => setLightboxIndex(idx)}
            className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-blue-50 transition"
          >
            <span className="text-sm font-medium text-gray-800">{p.label}</span>
            <span className="text-gray-400">›</span>
          </button>
        ))}
        {filteredPhotos.length === 0 && (
          <div className="text-center text-sm text-gray-400 py-10">
            검색 결과가 없습니다.
          </div>
        )}
      </div>


      {/* 확대보기 (라이트박스) */}
      {lightboxIndex !== null && filteredPhotos[lightboxIndex] && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex flex-col items-center justify-center p-4"
          onClick={() => setLightboxIndex(null)}
        >
          <div
            className="text-white text-sm mb-2"
            onClick={(e) => e.stopPropagation()}
          >
            {filteredPhotos[lightboxIndex].label}
          </div>
          <img
            src={getImageSrc(selectedManufacturer.key, filteredPhotos[lightboxIndex].file)}
            alt={filteredPhotos[lightboxIndex].label}
            className="max-w-full max-h-[80vh] object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          <div className="flex gap-4 mt-4" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() =>
                setLightboxIndex(
                  (lightboxIndex - 1 + filteredPhotos.length) % filteredPhotos.length
                )
              }
              className="text-white text-2xl px-3"
            >
              ‹
            </button>
            <button
              onClick={() => setLightboxIndex(null)}
              className="text-white text-sm border border-white rounded px-4 py-1"
            >
              닫기
            </button>
            <button
              onClick={() =>
                setLightboxIndex((lightboxIndex + 1) % filteredPhotos.length)
              }
              className="text-white text-2xl px-3"
            >
              ›
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
