const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const serviceAccount = require('./serviceAccountKey.json');

initializeApp({
  credential: cert(serviceAccount),
});

const db = getFirestore();

const NEW_COMPANY_ID = 'HucdBzzXqi8PHNEJgtTI';

async function check() {
  console.log('🔍 새 경로 호기 데이터 확인...');

  const sitesSnap = await db
    .collection('companies')
    .doc(NEW_COMPANY_ID)
    .collection('sites')
    .get();

  console.log(`📋 총 ${sitesSnap.docs.length}개 현장`);

  let totalElevators = 0;

  for (const siteDoc of sitesSnap.docs) {
    const elevatorsSnap = await db
      .collection('companies')
      .doc(NEW_COMPANY_ID)
      .collection('sites')
      .doc(siteDoc.id)
      .collection('elevators')
      .get();

    totalElevators += elevatorsSnap.docs.length;
  }

  console.log(`🏗️ 총 호기: ${totalElevators}대`);
  process.exit(0);
}

check().catch((e) => {
  console.error('❌ 오류:', e);
  process.exit(1);
});
