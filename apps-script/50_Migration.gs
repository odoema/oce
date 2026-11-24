/**
 * 50_Migration: upgrades a v1 installation in place. Idempotent.
 *
 * v1 kept discovery data in "OCE — Source Intelligence Data" (located by the same OCE_SPREADSHEET_ID
 * property), so v2 reuses that spreadsheet and adds the campaign tables next to it.
 *  - SCOUT_RUNS            -> MISSIONS (mission ids preserved, so queue rows stay linked)
 *  - SOURCE_QUEUE          -> gains mission_id / canonical_url / domain / depth columns (backfilled)
 *  - CONTACT_INTELLIGENCE  -> CANDIDATES (de-duplicated by e-mail / phone / organisation)
 *  - OCE_DATA, SOURCE_RESULTS page_text/tables_json columns are left untouched but no longer written.
 */

function oceMigrateV1_() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('OCE_V2_MIGRATED') === 'TRUE') return { skipped: 'already migrated' };
  var ss = oceDb_();
  var report = { missions: 0, queue_rows: 0, candidates: 0, stuck_reset: 0 };

  var runs = ss.getSheetByName('SCOUT_RUNS');
  if (runs && runs.getLastRow() > 1) {
    var missions = oceTable_('MISSIONS');
    var have = missions.keyed('mission_id');
    var values = runs.getRange(1, 1, runs.getLastRow(), runs.getLastColumn()).getValues();
    var h = values[0].map(String);
    var col = function (name) { return h.indexOf(name); };
    values.slice(1).forEach(function (r) {
      var id = String(r[col('run_id')] || '');
      if (!id || have[id]) return;
      var status = String(r[col('status')] || '').toUpperCase();
      missions.append([{
        mission_id: id, objective: r[col('topic')] || '', created_at: r[col('started_at')] || new Date(), updated_at: new Date(),
        completed_at: r[col('completed_at')] || '', status: /COMPLETED/.test(status) ? status : (/FAILED/.test(status) ? 'FAILED' : 'PAUSED'),
        max_pages: oceSettingNumber_('CRAWL_MAX_PAGES', 150), max_depth: oceSettingNumber_('CRAWL_MAX_DEPTH', 2), same_site: 'TRUE',
        seed_count: r[col('seed_count')] || 0, progress: Number(r[col('progress')] || 0), discovery_via: 'v1',
        notes: 'Migrated from v1 as PAUSED. Resume it to continue with v2 budgets.'
      }]);
      report.missions++;
    });
  }

  var queue = oceTable_('SOURCE_QUEUE');
  queue.all().forEach(function (r) {
    var patch = {};
    if (!r.mission_id) { var mid = oceQueueMissionId_(r); if (mid) patch.mission_id = mid; }
    if (!r.canonical_url && r.url) patch.canonical_url = oceCanonicalUrl_(r.url) || r.url;
    if (!r.domain && r.url) patch.domain = oceHostOf_(r.url);
    if (r.depth === '' || r.depth === undefined) patch.depth = /DISCOVERED/i.test(String(r.source)) ? 1 : 0;
    if (String(r.status).toUpperCase() === 'SCRAPING') { patch.status = 'QUEUED'; report.stuck_reset++; }
    if (Object.keys(patch).length) { queue.update(r, patch); report.queue_rows++; }
  });

  var legacy = ss.getSheetByName('CONTACT_INTELLIGENCE');
  if (legacy && legacy.getLastRow() > 1) {
    var lv = legacy.getRange(1, 1, legacy.getLastRow(), legacy.getLastColumn()).getValues();
    var lh = lv[0].map(String);
    var g = function (r, name) { var i = lh.indexOf(name); return i >= 0 ? r[i] : ''; };
    var confMap = { HIGH: 70, MEDIUM: 50, LOW: 30 };
    var list = lv.slice(1).map(function (r) {
      return {
        email: oceEmailNormalize_(g(r, 'email')), phone: ocePhoneNormalize_(g(r, 'phone')), person_name: g(r, 'person_name'), role: g(r, 'role'),
        organization: g(r, 'organization'), address: g(r, 'address'), country: g(r, 'country'), location: g(r, 'location'), category: g(r, 'category'),
        evidence: g(r, 'evidence'), source_url: g(r, 'source_url'), website: g(r, 'source_url') ? 'https://' + oceHostOf_(g(r, 'source_url')) : '',
        confidence: confMap[String(g(r, 'confidence')).toUpperCase()] || Number(g(r, 'confidence')) || 40
      };
    }).filter(function (c) { return c.email ? oceIsValidEmail_(c.email) : (c.phone || c.organization); });
    report.candidates = oceUpsertCandidates_(list).created;
  }

  oceFlushAll_();
  props.setProperty('OCE_V2_MIGRATED', 'TRUE');
  return report;
}
