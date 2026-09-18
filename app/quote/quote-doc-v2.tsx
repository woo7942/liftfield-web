'use client';

import '../globals-quote-v2.css';
import { RefObject } from 'react';



/**
 * QuoteDocV2 — 견적서 인쇄용 문서 컴포넌트 (Corporate Cobalt)
 *
 * 원본 app/quote/page.tsx의 <div id="quote-document" className="quote-doc">
 * 블록을 이 컴포넌트로 교체합니다.
 *
 * Props는 기존 page.tsx의 selectedQuote/company/rates/include* 를 그대로 넘겨받습니다.
 */

type AnyObj = Record<string, any>;

interface QuoteDocV2Props {
  quote: AnyObj;                     // selectedQuote
  company: AnyObj | null;            // company (Supabase 'companies' row)
  rates: {                           // 편집 폼의 rates (예비 fallback)
    labor_indirect: number;
    overhead: number;
    profit: number;
    vat: number;
  };
  includeIndirectLabor: boolean;
  includeOverhead: boolean;
  includeProfit: boolean;
  printDocRef: RefObject<HTMLDivElement | null>;
}

const won = (n?: number | null) =>
  n == null || isNaN(Number(n)) ? '' : Number(n).toLocaleString('ko-KR');
const fmtDate = (s?: string | null) => (s ? s.slice(0, 10).replaceAll('-', '.') : '');

/** 회사 이니셜 SVG 마름모 (로고 이미지가 없을 때 폴백) */
function LogoFallback({ name }: { name?: string }) {
  const initials =
    (name || 'CO')
      .split(/\s+/)
      .map((w) => w[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() || 'CO';
  return (
    <svg viewBox="0 0 48 48" width="44" height="44">
      <rect x="7" y="7" width="34" height="34" transform="rotate(45 24 24)" fill="#dc2626" />
      <text
        x="24"
        y="29"
        textAnchor="middle"
        fill="#ffffff"
        fontSize="14"
        fontWeight="900"
        fontFamily="Helvetica, Arial, sans-serif"
      >
        {initials}
      </text>
    </svg>
  );
}

/** 원형 붉은 직인 SVG (직인 이미지가 없을 때 폴백) */
function StampFallback({ name }: { name?: string }) {
  // 회사명에서 앞 2글자 + "代表印"
  const short = (name || '').replace(/\s+/g, '').slice(0, 4);
  const line1 = short.slice(0, 2) || '견적';
  const line2 = short.slice(2, 4) || '서장';
  return (
    <svg viewBox="0 0 100 100" width="100%" height="100%">
      <circle cx="50" cy="50" r="47" fill="none" stroke="#b91c1c" strokeWidth="2.5" />
      <circle cx="50" cy="50" r="42" fill="none" stroke="#b91c1c" strokeWidth="1" />
      <text x="50" y="35" textAnchor="middle" fill="#b91c1c" fontSize="12" fontWeight="800" fontFamily="serif">{line1}</text>
      <text x="50" y="52" textAnchor="middle" fill="#b91c1c" fontSize="11" fontWeight="700" fontFamily="serif">{line2}</text>
      <text x="50" y="70" textAnchor="middle" fill="#b91c1c" fontSize="11" fontWeight="800" fontFamily="serif">代表印</text>
    </svg>
  );
}

export default function QuoteDocV2({
  quote,
  company,
  rates,
  includeIndirectLabor,
  includeOverhead,
  includeProfit,
  printDocRef,
}: QuoteDocV2Props) {
  const items = quote?.items || {};
  const breakdown = items.breakdown || {};
  const itemRates = items.rates || rates;
  const materials: AnyObj[] = items.materials || [];
  const labor = items.labor || {};

  // 화면 표시용 오늘 날짜
  const today = new Date();
  const dateStr = `${today.getFullYear()}.${String(today.getMonth() + 1).padStart(2, '0')}.${String(today.getDate()).padStart(2, '0')}`;
  const footerDateStr = `${today.getFullYear()}년 ${today.getMonth() + 1}월 ${today.getDate()}일`;

  // 견적서 총액 (기존 스키마와 동일하게 quote.amount 우선, 없으면 breakdown.total)
  const totalAmount = quote?.amount ?? breakdown.total ?? 0;

  // 수신처 표시
  const clientName = items.client_name || (items.site_name ? `${items.site_name} 귀중` : '');

  // 공사명
  const projectTitle = items.title || quote?.title || '';

  return (
    <div
      className="qv2-doc"
      id="quote-document"
      ref={printDocRef}
      style={{ boxShadow: '0 6px 20px rgba(0,0,0,.08)' }}
    >
      {/* Serial */}
      <div className="qv2-serial">{quote?.doc_no || quote?.id || ''}</div>

      {/* Title */}
      <div className="qv2-title-wrap">
        <h1 className="qv2-title">견 적 서</h1>
      </div>

      {/* Head grid */}
      <div className="qv2-head-grid">
        {/* 좌측: 날짜/수신/문구/견적금액 */}
        <div className="qv2-head-left">
          <div className="qv2-hl-row">
            <span>{dateStr}</span>
          </div>
          <div className="qv2-hl-row qv2-hl-client">
            <span>{clientName}</span>
          </div>
          <div className="qv2-hl-row">
            <span>아래와 같이 견적 합니다.</span>
          </div>
          <div className="qv2-hl-row qv2-hl-amount">
            <span className="qv2-hl-amount-lbl">견적금액 :</span>
            <span className="qv2-hl-amount-val">₩{won(totalAmount)}</span>
            <span className="qv2-hl-amount-unit">원</span>
          </div>
          <div className="qv2-hl-note">※ 상기금액은 부가세 합계금액임.</div>
        </div>

        {/* 우측: 로고+회사명+정보+직인 */}
        <div className="qv2-head-right">
          <div className="qv2-hr-inner">
            <div className="qv2-hr-brand">
              <div className="qv2-hr-logo">
                {company?.logo_image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={company.logo_image_url}
                    alt={company.company_name || ''}
                    style={{ width: 44, height: 44, objectFit: 'contain' }}
                  />
                ) : (
                  <LogoFallback name={company?.company_name} />
                )}
              </div>
              <div className="qv2-hr-name">{company?.company_name || ''}</div>
            </div>
            <div className="qv2-hr-info">
              <div className="qv2-hr-info-row">
                <span className="qv2-hr-info-lbl">대&nbsp;&nbsp;표&nbsp;자</span>
                <span className="qv2-hr-info-sep">:</span>
                <span className="qv2-hr-info-val">{company?.ceo_name || ''}</span>
              </div>
              <div className="qv2-hr-info-row">
                <span className="qv2-hr-info-lbl">사업자등록번호</span>
                <span className="qv2-hr-info-sep">:</span>
                <span className="qv2-hr-info-val">{company?.biz_no || ''}</span>
              </div>
              <div className="qv2-hr-info-row">
                <span className="qv2-hr-info-lbl">보수업등록번호</span>
                <span className="qv2-hr-info-sep">:</span>
                <span className="qv2-hr-info-val">{company?.license_no || ''}</span>
              </div>
              <div className="qv2-hr-info-row qv2-hr-info-addr">
                <span className="qv2-hr-info-val">{company?.address || ''}</span>
              </div>
              <div className="qv2-hr-info-row qv2-hr-info-tel">
                <span className="qv2-hr-tel">☎ {company?.phone || ''}</span>
                {company?.fax && <span className="qv2-hr-fax">[Fax] {company.fax}</span>}
              </div>
            </div>
            <div className="qv2-stamp" aria-hidden="true">
              {company?.stamp_image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={company.stamp_image_url} alt="직인" />
              ) : (
                <StampFallback name={company?.company_name} />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Project title line */}
      <div className="qv2-project-line">
        <span className="qv2-pl-mark">■</span>
        <span className="qv2-pl-lbl">제목 :</span>
        <span className="qv2-pl-val">{projectTitle}</span>
      </div>

      {/* Items table */}
      <table className="qv2-table">
        <colgroup>
          <col style={{ width: '34%' }} />
          <col style={{ width: '7%' }} />
          <col style={{ width: '7%' }} />
          <col style={{ width: '13%' }} />
          <col style={{ width: '15%' }} />
          <col style={{ width: '24%' }} />
        </colgroup>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', paddingLeft: '3mm' }}>품 명 및 규 격</th>
            <th>단위</th>
            <th>수량</th>
            <th>단가</th>
            <th>금액</th>
            <th>비고</th>
          </tr>
        </thead>
        <tbody>
          {/* 1. 자재비 */}
          <tr className="qv2-section-row">
            <td colSpan={6}>1. 자 재 비</td>
          </tr>
          {materials.map((m, i) => (
            <tr key={`mat-${i}`}>
              <td style={{ paddingLeft: '4mm' }}>{m.name}</td>
              <td className="qv2-center">{m.unit}</td>
              <td className="qv2-num">{won(m.qty)}</td>
              <td className="qv2-num">{won(m.unit_price)}</td>
              <td className="qv2-num">{won((m.qty || 0) * (m.unit_price || 0))}</td>
              <td className="qv2-note">{m.note || ''}</td>
            </tr>
          ))}
          <tr className="qv2-subtotal-row">
            <td colSpan={4} style={{ textAlign: 'right', paddingRight: '3mm' }}>자재비 소계</td>
            <td className="qv2-num">{won(breakdown.materialsSubtotal)}</td>
            <td className="qv2-note"></td>
          </tr>

          {/* 2. 인건비 */}
          <tr className="qv2-section-row">
            <td colSpan={6}>2. 인 건 비</td>
          </tr>
          <tr>
            <td style={{ paddingLeft: '4mm' }}>직접 인건비 ({labor.type || ''})</td>
            <td className="qv2-center">인</td>
            <td className="qv2-num">{won(labor.qty)}</td>
            <td className="qv2-num">{won(labor.unit_price)}</td>
            <td className="qv2-num">{won(breakdown.laborDirect)}</td>
            <td className="qv2-note"></td>
          </tr>
          {includeIndirectLabor && (
            <tr>
              <td style={{ paddingLeft: '4mm' }}>간접 노무비</td>
              <td className="qv2-center">%</td>
              <td className="qv2-num">{(itemRates.labor_indirect * 100).toFixed(0)}</td>
              <td className="qv2-num">{won(breakdown.laborDirect)}</td>
              <td className="qv2-num">{won(breakdown.laborIndirect)}</td>
              <td className="qv2-note"></td>
            </tr>
          )}
          <tr className="qv2-subtotal-row">
            <td colSpan={4} style={{ textAlign: 'right', paddingRight: '3mm' }}>인건비 소계</td>
            <td className="qv2-num">{won(breakdown.laborSubtotal)}</td>
            <td className="qv2-note"></td>
          </tr>

          {/* 3. 경비 */}
          {includeOverhead && (
            <>
              <tr className="qv2-section-row">
                <td colSpan={6}>3. 경 비 및 일 반 관 리 비</td>
              </tr>
              <tr>
                <td style={{ paddingLeft: '4mm' }}>경비 및 일반관리비</td>
                <td className="qv2-center">%</td>
                <td className="qv2-num">{(itemRates.overhead * 100).toFixed(0)}</td>
                <td className="qv2-num">{won((breakdown.materialsSubtotal || 0) + (breakdown.laborSubtotal || 0))}</td>
                <td className="qv2-num">{won(breakdown.overhead)}</td>
                <td className="qv2-note"></td>
              </tr>
            </>
          )}

          {/* 4. 기업이윤 */}
          {includeProfit && (
            <>
              <tr className="qv2-section-row">
                <td colSpan={6}>4. 기 업 이 윤</td>
              </tr>
              <tr>
                <td style={{ paddingLeft: '4mm' }}>기업이윤</td>
                <td className="qv2-center">%</td>
                <td className="qv2-num">{(itemRates.profit * 100).toFixed(0)}</td>
                <td className="qv2-num">
                  {won((breakdown.materialsSubtotal || 0) + (breakdown.laborSubtotal || 0) + (breakdown.overhead || 0))}
                </td>
                <td className="qv2-num">{won(breakdown.profit)}</td>
                <td className="qv2-note"></td>
              </tr>
            </>
          )}

          {/* 소계·부가세·합계 */}
          <tr className="qv2-subtotal-row">
            <td colSpan={4} style={{ textAlign: 'right', paddingRight: '3mm' }}>공급가액</td>
            <td className="qv2-num">{won(breakdown.supplyAmount)}</td>
            <td className="qv2-note"></td>
          </tr>
          <tr className="qv2-subtotal-row">
            <td colSpan={4} style={{ textAlign: 'right', paddingRight: '3mm' }}>
              부가가치세 ({(itemRates.vat * 100).toFixed(0)}%)
            </td>
            <td className="qv2-num">{won(breakdown.vat)}</td>
            <td className="qv2-note"></td>
          </tr>
          <tr className="qv2-total-row">
            <td colSpan={4} style={{ textAlign: 'right', paddingRight: '3mm' }}>
              합 계 (백단위 절사)
              <span className="qv2-caption">단위: 원</span>
            </td>
            <td className="qv2-num">{won(totalAmount)}</td>
            <td className="qv2-note"></td>
          </tr>
        </tbody>
      </table>

      {/* Remarks */}
      {items.remarks && <div className="qv2-remarks">{items.remarks}</div>}

      {/* Footer */}
      <div className="qv2-footer">
        <div className="qv2-date">{footerDateStr}</div>
        <div className="qv2-line1">본 견적서는 위 기재된 사항에 따라 성실히 제출합니다.</div>
        <div className="qv2-company">{company?.company_name || ''}</div>
      </div>
    </div>
  );
}
