const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const serviceAccount = require('./serviceAccountKey.json');

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

async function fixSiteIds() {
  const companiesSnap = await db.collection('companies').get();
  
  for (const companyDoc of companiesSnap.docs) {
    const sitesSnap = await db
      .collection('companies')
      .doc(companyDoc.id)
      .collection('sites')
      .get();
    
    for (const siteDoc of sitesSnap.docs) {
      const elevsSnap = await db
        .collection('companies')
        .doc(companyDoc.id)
        .collection('sites')
        .doc(siteDoc.id)
        .collection('elevators')
        .get();
      
      const batch = db.batch();
      let count = 0;
      
      for (const elevDoc of elevsSnap.docs) {
        if (elevDoc.data().siteId !== siteDoc.id) {
          batch.update(elevDoc.ref, { siteId: siteDoc.id });
          count++;
        }
      }
      
      if (count > 0) {
        await batch.commit();
        console.log(`✅ ${siteDoc.data().siteName}: ${count}개 siteId 수정`);
      }
    }
  }
  
  console.log('🎉 완료!');
}

fixSiteIds();
