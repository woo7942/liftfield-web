// scripts/sync-elevators.mjs
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SERVICE_KEY = process.env.ELEVATOR_API_KEY;
const DAILY_CALL_BUDGET = Number(process.env.DAILY_CALL_BUDGET || 9500);
const NUM_OF_ROWS = 100;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// 시도-시군구 목록 (일반구 포함, 세종은 시군구 없이 시 자체로 조회)
const REGIONS = [
  { sido: '서울특별시', sigungus: ['종로구','중구','용산구','성동구','광진구','동대문구','중랑구','성북구','강북구','도봉구','노원구','은평구','서대문구','마포구','양천구','강서구','구로구','금천구','영등포구','동작구','관악구','서초구','강남구','송파구','강동구'] },
  { sido: '부산광역시', sigungus: ['중구','서구','동구','영도구','부산진구','동래구','남구','북구','해운대구','사하구','금정구','강서구','연제구','수영구','사상구','기장군'] },
  { sido: '대구광역시', sigungus: ['중구','동구','서구','남구','북구','수성구','달서구','달성군','군위군'] },
  { sido: '인천광역시', sigungus: ['중구','동구','미추홀구','연수구','남동구','부평구','계양구','서구','강화군','옹진군'] },
  { sido: '광주광역시', sigungus: ['동구','서구','남구','북구','광산구'] },
  { sido: '대전광역시', sigungus: ['동구','중구','서구','유성구','대덕구'] },
  { sido: '울산광역시', sigungus: ['중구','남구','동구','북구','울주군'] },
  { sido: '세종특별자치시', sigungus: ['세종특별자치시'] },
  { sido: '경기도', sigungus: ['수원시 장안구','수원시 권선구','수원시 팔달구','수원시 영통구','성남시 수정구','성남시 중원구','성남시 분당구','의정부시','안양시 만안구','안양시 동안구','부천시','광명시','평택시','동두천시','안산시 상록구','안산시 단원구','고양시 덕양구','고양시 일산동구','고양시 일산서구','과천시','구리시','남양주시','오산시','시흥시','군포시','의왕시','하남시','용인시 처인구','용인시 기흥구','용인시 수지구','파주시','이천시','안성시','김포시','화성시','광주시','양주시','포천시','여주시','연천군','가평군','양평군'] },
  { sido: '강원특별자치도', sigungus: ['춘천시','원주시','강릉시','동해시','태백시','속초시','삼척시','홍천군','횡성군','영월군','평창군','정선군','철원군','화천군','양구군','인제군','고성군','양양군'] },
  { sido: '충청북도', sigungus: ['청주시 상당구','청주시 서원구','청주시 흥덕구','청주시 청원구','충주시','제천시','보은군','옥천군','영동군','증평군','진천군','괴산군','음성군','단양군'] },
  { sido: '충청남도', sigungus: ['천안시 동남구','천안시 서북구','공주시','보령시','아산시','서산시','논산시','계룡시','당진시','금산군','부여군','서천군','청양군','홍성군','예산군','태안군'] },
  { sido: '전북특별자치도', sigungus: ['전주시 완산구','전주시 덕진구','군산시','익산시','정읍시','남원시','김제시','완주군','진안군','무주군','장수군','임실군','순창군','고창군','부안군'] },
  { sido: '전라남도', sigungus: ['목포시','여수시','순천시','나주시','광양시','담양군','곡성군','구례군','고흥군','보성군','화순군','장흥군','강진군','해남군','영암군','무안군','함평군','영광군','장성군','완도군','진도군','신안군'] },
  { sido: '경상북도', sigungus: ['포항시 남구','포항시 북구','경주시','김천시','안동시','구미시','영주시','영천시','상주시','문경시','경산시','의성군','청송군','영양군','영덕군','청도군','고령군','성주군','칠곡군','예천군','봉화군','울진군','울릉군'] },
  { sido: '경상남도', sigungus: ['창원시 의창구','창원시 성산구','창원시 마산합포구','창원시 마산회원구','창원시 진해구','진주시','통영시','사천시','김해시','밀양시','거제시','양산시','의령군','함안군','창녕군','고성군','남해군','하동군','산청군','함양군','거창군','합천군'] },
  { sido: '제주특별자치도', sigungus: ['제주시','서귀포시'] },
];

function parseInstallationPlace(raw) {
  if (!raw) return { dong: null, hogiNo: null };
  const parts = String(raw).split('-');
  if (parts.length >= 2) {
    return { dong: parts[0].trim(), hogiNo: parts[1].trim() };
  }
  return { dong: null, hogiNo: raw.trim() };
}

function extractTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
  return m ? m[1] : null;
}

function parseItems(xml) {
  const items = [];
  const itemBlocks = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  for (const block of itemBlocks) {
    items.push({
      address1: extractTag(block, 'address1'),
      address2: extractTag(block, 'address2'),
      buldNm: extractTag(block, 'buldNm'),
      buldMgtNo1: extractTag(block, 'buldMgtNo1'),
      buldMgtNo2: extractTag(block, 'buldMgtNo2'),
      elevatorNo: extractTag(block, 'elevatorNo'),
      installationPlace: extractTag(block, 'installationPlace'),
      elvtrDivNm: extractTag(block, 'elvtrDivNm'),
      elvtrModel: extractTag(block, 'elvtrModel'),
      manufacturerName: extractTag(block, 'manufacturerName'),
      mntCpnyNm: extractTag(block, 'mntCpnyNm'),
      subcntrCpny: extractTag(block, 'subcntrCpny'),
      liveLoad: extractTag(block, 'liveLoad'),
      ratedSpeed: extractTag(block, 'ratedSpeed'),
      shuttleSection: extractTag(block, 'shuttleSection'),
      elvtrStts: extractTag(block, 'elvtrStts'),
      lastResultNm: extractTag(block, 'lastResultNm'),
      lastInspctDe: extractTag(block, 'lastInspctDe'),
      installationDe: extractTag(block, 'installationDe'),
    });
  }
  const totalCount = Number(extractTag(xml, 'totalCount') || 0);
  return { items, totalCount };
}

async function fetchPage(sido, sigungu, pageNo) {
  const url = new URL('https://apis.data.go.kr/B553664/ElevatorInformationService/getElevatorListM');
  url.searchParams.set('serviceKey', SERVICE_KEY);
  url.searchParams.set('sido', sido);
  url.searchParams.set('sigungu', sigungu);
  url.searchParams.set('numOfRows', String(NUM_OF_ROWS));
  url.searchParams.set('pageNo', String(pageNo));

  const res = await fetch(url.toString());
  const xml = await res.text();
  return parseItems(xml);
}

// 먼저 처리하고 싶은 지역 (원하는 순서대로 나열)
const PRIORITY_REGIONS = [
  { sido: '경기도', sigungu: '고양시 덕양구' },
  { sido: '경기도', sigungu: '고양시 일산동구' },
  { sido: '경기도', sigungu: '고양시 일산서구' },
  { sido: '경기도', sigungu: '파주시' },
];

function buildFlatRegionList() {
  const flat = [];
  for (const r of REGIONS) {
    for (const s of r.sigungus) {
      flat.push({ sido: r.sido, sigungu: s });
    }
  }

  const isPriority = (item) =>
    PRIORITY_REGIONS.some((p) => p.sido === item.sido && p.sigungu === item.sigungu);

  const priorityList = PRIORITY_REGIONS.filter((p) =>
    flat.some((f) => f.sido === p.sido && f.sigungu === p.sigungu)
  );
  const restList = flat.filter((item) => !isPriority(item));

  return [...priorityList, ...restList];
}


async function upsertRows(items, sido, sigungu) {
  if (items.length === 0) return;
  const rows = items
    .filter((it) => it.elevatorNo)
    .map((it) => {
      const { dong, hogiNo } = parseInstallationPlace(it.installationPlace);
      return {
        sido,
        sigungu,
        address1: it.address1,
        address2: it.address2,
        building: it.buldNm,
        build_mgt_no: it.buldMgtNo1 && it.buldMgtNo2 ? `${it.buldMgtNo1}-${it.buldMgtNo2}` : null,
        dong,
        hogi_no: hogiNo,
        installation_place: it.installationPlace,
        elevator_no: it.elevatorNo,
        type: it.elvtrDivNm,
        elvtr_model: it.elvtrModel,
        manufacturer_name: it.manufacturerName,
        mnt_cpny_nm: it.mntCpnyNm,
        subcntr_cpny: it.subcntrCpny,
        live_load: it.liveLoad,
        rated_speed: it.ratedSpeed,
        shuttle_section: it.shuttleSection,
        status: it.elvtrStts,
        last_result_nm: it.lastResultNm,
        exam_date: it.lastInspctDe,
        install_date: it.installationDe,
        synced_at: new Date().toISOString(),
      };
    });

  const { error } = await supabase
    .from('elevator_national_cache')
    .upsert(rows, { onConflict: 'elevator_no' });

  if (error) {
    console.error('upsert 오류:', error.message);
    throw error;
  }
}

async function main() {
  const flatRegions = buildFlatRegionList();
  const today = new Date().toISOString().slice(0, 10);

  const { data: progressRow } = await supabase
    .from('elevator_sync_progress')
    .select('*')
    .eq('id', 1)
    .single();

  let sigunguIndex = progressRow?.sigungu_index || 0;
  let pageNo = progressRow?.page_no || 1;
  let callsUsedToday = progressRow?.last_run_date === today ? (progressRow?.calls_used_today || 0) : 0;

  console.log(`시작: 시군구 인덱스 ${sigunguIndex}, 페이지 ${pageNo}, 오늘 사용한 호출 ${callsUsedToday}건`);

  while (sigunguIndex < flatRegions.length) {
    if (callsUsedToday >= DAILY_CALL_BUDGET) {
      console.log('오늘 호출 예산 소진, 중단하고 다음 실행 때 이어서 진행합니다.');
      break;
    }

    const { sido, sigungu } = flatRegions[sigunguIndex];
    console.log(`[${sigunguIndex + 1}/${flatRegions.length}] ${sido} ${sigungu} - 페이지 ${pageNo}`);

    const { items, totalCount } = await fetchPage(sido, sigungu, pageNo);
    callsUsedToday += 1;

    await upsertRows(items, sido, sigungu);

    const maxPage = Math.ceil(totalCount / NUM_OF_ROWS) || 1;

    if (pageNo >= maxPage) {
      sigunguIndex += 1;
      pageNo = 1;
    } else {
      pageNo += 1;
    }

    await supabase
      .from('elevator_sync_progress')
      .update({
        sigungu_index: sigunguIndex,
        page_no: pageNo,
        last_run_date: today,
        calls_used_today: callsUsedToday,
        updated_at: new Date().toISOString(),
      })
      .eq('id', 1);

    await new Promise((r) => setTimeout(r, 150));
  }

  if (sigunguIndex >= flatRegions.length) {
    console.log('전국 전체 동기화 완료! 처음부터 다시 순회하도록 인덱스를 초기화합니다.');
    await supabase
      .from('elevator_sync_progress')
      .update({ sigungu_index: 0, page_no: 1 })
      .eq('id', 1);
  }

  console.log(`종료: 오늘 총 ${callsUsedToday}건 호출`);
}

main().catch((err) => {
  console.error('동기화 실패:', err);
  process.exit(1);
});
