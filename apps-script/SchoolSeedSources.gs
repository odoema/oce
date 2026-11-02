/* OCE Mission Discovery Brain V2.0
 * Generic objective -> public web discovery.
 * This is deliberately NOT school-specific. Any mission objective can use it:
 * schools, hospitals, NGOs, companies, universities, churches, associations,
 * manufacturers, suppliers, government institutions, professional firms, etc.
 *
 * The brain uses public Bing web-search RSS results only to discover candidate
 * public URLs. OCE then treats those URLs as ordinary public collection sources;
 * it does not bypass login, CAPTCHA, paywalls, robots/access controls, or other
 * restrictions. Search results are candidates, not verified entity records.
 */

const OCE_DISCOVERY = {
  VERSION:'2.0.0',
  MAX_RESULTS:60,
  MAX_QUERIES:8,
  SEARCH_HOST:'https://www.bing.com/search?q=',
  COUNTRY_TERMS:['Uganda','Ugandan'],
  DIRECTORY_TERMS:['directory','list','register','registry','database','institutions','organizations','organisations','association','members','companies','providers','facilities'],
  DOMAIN_BONUS:{'go.ug':30,'org.ug':26,'ac.ug':24,'co.ug':20,'ug':18},
  BLOCKED_HOSTS:['bing.com','microsoft.com']
};

function seedSchoolSourcesForMission_(missionId, topic) {
  return discoverPublicSourcesForMission_(missionId, topic);
}

function discoverPublicSourcesForMission_(missionId, topic) {
  const id = String(missionId || '').trim();
  const objective = String(topic || '').trim();
  if (!id || !objective) return {applicable:false,seeded:0,total:0,queries:0,search_errors:0};

  const queries = buildMissionDiscoveryQueries_(objective);
  const candidates = [];
  let searchErrors = 0;

  queries.forEach(function(query) {
    try {
      const found = bingDiscoverUrls_(query);
      found.forEach(function(item) { candidates.push(item); });
    } catch (err) {
      searchErrors += 1;
      Logger.log('Discovery search failure: '+query+' — '+err.message);
    }
  });

  const ranked = rankMissionDiscoveryCandidates_(candidates, objective).slice(0, OCE_DISCOVERY.MAX_RESULTS);
  let seeded = 0;
  ranked.forEach(function(candidate) {
    try {
      const result = registerAndQueueMissionSource({
        url:candidate.url,
        source_type:'WEB_DISCOVERY_SEED',
        topic:objective,
        label:candidate.title || candidate.url,
        priority:candidate.priority,
        provenance:'WEB_DISCOVERY_BRAIN|mission_id='+id+'|query='+candidate.query,
        notes:'Dynamically discovered public source; search result is a candidate, not a verified entity record.'
      }, id);
      if (result && result.status === 'QUEUED') seeded += 1;
    } catch (err) {
      Logger.log('Dynamic discovery seed failure: '+candidate.url+' — '+err.message);
    }
  });

  syncMissionSeedCounts_(id);
  return {
    applicable:true,
    seeded:seeded,
    candidates:ranked.length,
    total:ranked.length,
    queries:queries.length,
    search_errors:searchErrors,
    engine:'Bing public web search RSS',
    version:OCE_DISCOVERY.VERSION
  };
}

function buildMissionDiscoveryQueries_(topic) {
  const clean = String(topic || '').replace(/\s+/g,' ').trim();
  const lower = clean.toLowerCase();
  const queries = [];

  function add(q) {
    q = String(q || '').replace(/\s+/g,' ').trim();
    if (q && queries.indexOf(q) < 0 && queries.length < OCE_DISCOVERY.MAX_QUERIES) queries.push(q);
  }

  add(clean + ' Uganda directory');
  add(clean + ' Uganda list');
  add(clean + ' Uganda register OR registry');
  add(clean + ' Uganda database OR directory');
  add(clean + ' Uganda institutions OR organizations');
  add(clean + ' Uganda association OR members');
  add(clean + ' Uganda public institutions site:go.ug');
  add(clean + ' Uganda organizations site:org.ug');

  if (/\buganda\b/i.test(lower) === false) {
    add(clean + ' Uganda');
  }
  return queries.slice(0,OCE_DISCOVERY.MAX_QUERIES);
}

function bingDiscoverUrls_(query) {
  const url = OCE_DISCOVERY.SEARCH_HOST + encodeURIComponent(query) + '&format=rss&setlang=en-US';
  const response = UrlFetchApp.fetch(url, {
    method:'get',
    muteHttpExceptions:true,
    followRedirects:true,
    headers:{'User-Agent':'OCE-Public-Discovery/2.0'}
  });
  const code = response.getResponseCode();
  if (code < 200 || code >= 400) throw Error('Search returned HTTP '+code);

  const xml = response.getContentText();
  const document = XmlService.parse(xml);
  const root = document.getRootElement();
  const channel = root.getChild('channel');
  if (!channel) return [];

  const items = channel.getChildren('item') || [];
  const results = [];
  items.forEach(function(item) {
    const title = childText_(item,'title');
    const link = childText_(item,'link');
    const description = childText_(item,'description');
    if (!link || !/^https?:\/\//i.test(link)) return;
    if (isBlockedDiscoveryHost_(link)) return;
    results.push({url:normalizeDiscoveryUrl_(link),title:title,description:description,query:query});
  });
  return results;
}

function rankMissionDiscoveryCandidates_(items, objective) {
  const seen = {};
  const ranked = [];
  const normalizedObjective = String(objective || '').toLowerCase();

  items.forEach(function(item) {
    const url = normalizeDiscoveryUrl_(item.url);
    if (!url || seen[url]) return;
    seen[url] = true;

    const host = discoveryHost_(url);
    const haystack = (String(item.title||'')+' '+String(item.description||'')+' '+url).toLowerCase();
    let score = 45;

    Object.keys(OCE_DISCOVERY.DOMAIN_BONUS).some(function(suffix) {
      if (host === suffix || host.endsWith('.'+suffix)) {
        score += OCE_DISCOVERY.DOMAIN_BONUS[suffix];
        return true;
      }
      return false;
    });

    OCE_DISCOVERY.DIRECTORY_TERMS.forEach(function(term) {
      if (haystack.indexOf(term) >= 0) score += 5;
    });

    const topicWords = normalizedObjective.split(/[^a-z0-9]+/).filter(function(word){return word.length >= 4;}).slice(0,12);
    topicWords.forEach(function(word) {
      if (haystack.indexOf(word) >= 0) score += 6;
    });

    if (/uganda|ugandan/.test(haystack)) score += 8;
    if (/facebook|instagram|youtube|tiktok|linkedin/.test(host)) score -= 25;
    if (/\.pdf($|[?#])/.test(url)) score -= 3;

    ranked.push({url:url,title:item.title || url,description:item.description || '',query:item.query,priority:Math.max(1,Math.min(99,Math.round(score)))});
  });

  return ranked.sort(function(a,b){
    if (b.priority !== a.priority) return b.priority-a.priority;
    return String(a.url).localeCompare(String(b.url));
  });
}

function normalizeDiscoveryUrl_(value) {
  let url = String(value || '').trim();
  if (!url) return '';
  url = url.replace(/&amp;/g,'&');
  const hash = url.indexOf('#');
  if (hash >= 0) url = url.substring(0,hash);
  return url.replace(/\/$/,'');
}

function discoveryHost_(url) {
  const match = String(url || '').match(/^https?:\/\/([^\/?#]+)/i);
  return match ? match[1].toLowerCase().replace(/^www\./,'').replace(/:\d+$/,'') : '';
}

function isBlockedDiscoveryHost_(url) {
  const host = discoveryHost_(url);
  return OCE_DISCOVERY.BLOCKED_HOSTS.some(function(blocked){
    return host === blocked || host.endsWith('.'+blocked);
  });
}

function childText_(parent, name) {
  const child = parent.getChild(name);
  return child ? String(child.getText() || '').trim() : '';
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
