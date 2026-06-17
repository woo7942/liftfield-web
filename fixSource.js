const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const serviceAccount = require('C:/Users/porsh/serviceAccountKey.json');


initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

async function fixSource() {
  const sitesSnap = await db
    .collection('companies')
    .doc('HucdBzzXqi8PHNEJgtTI')
    .collection('sites')
    .get();

  const batch = db.batch();
  let count = 0;

  for (const siteDoc of sitesSnap.docs) {
    const data = siteDoc.data();
    if (!data.source || data.source !== 'member') {
      batch.update(siteDoc.ref, { source: 'member' });
      count++;
    }
  }

  await batch.commit();
  console.log(`✅ ${count}개 현장 source → 'member' 수정 완료!`);
}

fixSource();
