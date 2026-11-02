/* OCE School Discovery Seeds V1.0
 * Objective-specific public seed expansion for school/education missions.
 * These are discovery sources, not claimed school records. The Queue Worker
 * must collect them and follow public links before school entities are counted.
 */

const OCE_SCHOOL_SEEDS = [
  {name:'Uganda Ministry of Education and Sports — Schools & Institutions',url:'https://www.education.go.ug/schools-institutions/',priority:99},
  {name:'Uganda Ministry of Education and Sports — Private Schools & Institutions',url:'https://www.education.go.ug/private-schools-institutions/',priority:98},
  {name:'eSchool Uganda — Find Schools',url:'https://eschool.ug/find-schools/',priority:96},
  {name:'EduUganda Education Directory',url:'https://www.eduuganda.ug/',priority:95},
  {name:'SchoolsUganda National School Directory',url:'https://www.schoolsuganda.com/school_listing',priority:94},
  {name:'Schoolnet Africa — Uganda Schools Directory',url:'https://schoolnet.africa/ug/all-schools/',priority:93},
  {name:'996CO Uganda School Census Directory',url:'https://996co.com/uga/',priority:92},
  {name:'SchoolPay Uganda — Enrolled Schools',url:'https://www.schoolpay.co.ug/site/schools-and-channels',priority:90},
  {name:'SchoolsUganda — District Directory',url:'https://schoolsuganda.com/districts',priority:89},
  {name:'SchoolGuide Uganda Institutions',url:'https://schoolguide.co.ug/institutions',priority:88}
];

function isSchoolMission_(topic) {
  return /\b(school|schools|education|educational|nursery|primary|secondary|kindergarten|college|university|institution|institutions|academy|academies)\b/i.test(String(topic || ''));
}

function seedSchoolSourcesForMission_(missionId, topic) {
  const id = String(missionId || '').trim();
  const objective = String(topic || '').trim();
  if (!id || !isSchoolMission_(objective)) return {applicable:false,seeded:0,total:0};

  let seeded = 0;
  OCE_SCHOOL_SEEDS.forEach(function(seed) {
    try {
      const result = registerAndQueueMissionSource({
        url:seed.url,
        source_type:'SCHOOL_DISCOVERY_SEED',
        topic:objective,
        label:seed.name,
        priority:seed.priority,
        provenance:'SCHOOL_DISCOVERY|mission_id='+id,
        notes:'Objective-specific school discovery seed'
      }, id);
      if (result && result.status === 'QUEUED') seeded += 1;
    } catch (err) {
      Logger.log('School seed failure: '+seed.url+' — '+err.message);
    }
  });

  syncMissionSeedCounts_(id);
  return {applicable:true,seeded:seeded,total:OCE_SCHOOL_SEEDS.length};
}

function syncMissionSeedCounts_(missionId) {
  const ss = getOceSpreadsheet_();
  const runs = ss.getSheetByName('SCOUT_RUNS');
  const queue = ss.getSheetByName('SOURCE_QUEUE');
  if (!runs || !queue || runs.getLastRow() < 2 || queue.getLastRow() < 2) return;

  const rows = runs.getRange(2,1,runs.getLastRow()-1,13).getValues();
  const index = rows.findIndex(function(r){ return String(r[0] || '') === String(missionId || ''); });
  if (index < 0) return;

  const queueRows = queue.getRange(2,1,queue.getLastRow()-1,11).getValues();
  const missionRows = queueRows.filter(function(r){ return String(r[10] || '').indexOf('mission_id='+missionId) !== -1; });
  const queued = missionRows.filter(function(r){ return String(r[4] || '').toUpperCase() === 'QUEUED'; }).length;
  const completed = missionRows.filter(function(r){ return String(r[4] || '').toUpperCase() === 'COMPLETED'; }).length;
  const failed = missionRows.filter(function(r){ return String(r[4] || '').toUpperCase() === 'FAILED'; }).length;
  const discovered = missionRows.length;

  const rowNumber = index + 2;
  runs.getRange(rowNumber,4).setValue(discovered);
  runs.getRange(rowNumber,5).setValue(discovered);
  runs.getRange(rowNumber,6).setValue(queued);
  runs.getRange(rowNumber,7).setValue(failed);
}
