/**
 * OCE — Odoch Campaign Engine v2
 * 00_Config: version, schema, default settings and settings access.
 *
 * Rules for every file in this project:
 *  - Top-level code holds plain literals only (Apps Script file load order is not guaranteed).
 *  - Secrets live in Script Properties, never in the spreadsheet or the repository.
 *  - Operational data lives in one spreadsheet, located by the OCE_SPREADSHEET_ID property.
 */

var OCE = {
  VERSION: '2.2.1',
  NAME: 'OCE — Odoch Campaign Engine',
  SPREADSHEET_NAME: 'OCE — Campaign Engine Data',
  SPREADSHEET_PROPERTY: 'OCE_SPREADSHEET_ID',
  USER_AGENT: 'OCE-PublicCollector/2.0 (+consent-aware; respects robots.txt)',
  TIMEZONE: 'Africa/Kampala'
};

/** Sheet name -> ordered column list. Existing sheets keep extra columns; missing ones are appended. */
var OCE_SCHEMA = {
  SETTINGS: ['key', 'value', 'description'],
  MISSIONS: ['mission_id', 'objective', 'status', 'created_at', 'updated_at', 'completed_at', 'max_pages', 'max_depth',
    'same_site', 'seed_count', 'pages_total', 'pages_done', 'pages_failed', 'pages_skipped', 'candidates_found',
    'progress', 'discovery_via', 'notes'],
  SOURCE_REGISTRY: ['source_id', 'url', 'canonical_url', 'domain', 'source_type', 'topic', 'label', 'priority',
    'discovered_at', 'last_scanned_at', 'last_status', 'http_status', 'scan_count', 'queue_status', 'provenance', 'notes'],
  SOURCE_QUEUE: ['queue_id', 'source_id', 'url', 'priority', 'status', 'queued_at', 'started_at', 'completed_at',
    'attempt_count', 'last_error', 'source', 'mission_id', 'canonical_url', 'domain', 'depth', 'parent_url',
    'next_attempt_at', 'lease_until', 'http_status'],
  SOURCE_RESULTS: ['result_id', 'queue_id', 'source_id', 'url', 'status', 'http_status', 'title', 'description',
    'collected_at', 'collector_version', 'link_count', 'table_count', 'text_length', 'error', 'mission_id',
    'final_url', 'content_type', 'language', 'fetch_ms', 'bytes', 'emails', 'phones', 'organization', 'address',
    'socials', 'candidate_count', 'text_excerpt'],
  CANDIDATES: ['candidate_id', 'dedupe_key', 'email', 'phone', 'person_name', 'role', 'organization', 'website',
    'address', 'country', 'location', 'category', 'confidence', 'sources_count', 'source_urls', 'mission_ids',
    'first_seen_at', 'last_seen_at', 'review_status', 'reviewed_at', 'reviewed_by', 'lawful_basis',
    'consent_status', 'contact_id', 'evidence', 'notes'],
  CONTACTS: ['contact_id', 'email', 'first_name', 'last_name', 'phone', 'organization', 'role', 'country',
    'location', 'category', 'source', 'source_url', 'candidate_id', 'lawful_basis', 'consent_status',
    'consent_date', 'consent_source', 'status', 'created_at', 'updated_at', 'last_sent_at', 'send_count', 'tags', 'notes'],
  SEGMENTS: ['segment_id', 'segment_name', 'field', 'operator', 'value', 'active', 'notes'],
  CAMPAIGNS: ['campaign_id', 'name', 'status', 'segment_id', 'subject', 'preheader', 'body_html', 'body_text',
    'from_name', 'from_email', 'reply_to', 'start_at', 'end_at', 'daily_cap', 'created_at', 'updated_at',
    'queued_count', 'sent_count', 'failed_count', 'suppressed_count', 'last_run_at', 'notes'],
  SEND_QUEUE: ['send_id', 'campaign_id', 'contact_id', 'email', 'status', 'queued_at', 'attempt_count',
    'next_attempt_at', 'sent_at', 'provider_message_id', 'last_error'],
  SEND_LOG: ['timestamp', 'campaign_id', 'contact_id', 'email', 'event', 'provider_message_id', 'detail'],
  SUPPRESSION: ['email', 'reason', 'source', 'created_at'],
  HOLIDAYS: ['date', 'country', 'holiday', 'send_allowed'],
  EVENTS: ['timestamp', 'level', 'component', 'message', 'data']
};

/**
 * Operator-editable settings (stored in the SETTINGS sheet).
 * [key, default, description, editableFromApi]
 */
var OCE_DEFAULT_SETTINGS = [
  ['VERSION', '2.2.1', 'Installed OCE version', false],
  ['TIMEZONE', 'Africa/Kampala', 'IANA timezone used for windows and dates', true],
  ['DEFAULT_COUNTRY_CODE', '256', 'Country calling code used to normalise local phone numbers', true],
  ['CRAWL_ENABLED', 'TRUE', 'Master switch for background collection', true],
  ['CRAWL_MAX_PAGES', '150', 'Default page budget per mission', true],
  ['CRAWL_MAX_DEPTH', '2', 'Default link depth from seed pages', true],
  ['CRAWL_SAME_SITE', 'TRUE', 'Only follow links that stay on the seed site', true],
  ['CRAWL_MAX_PER_DOMAIN', '60', 'Maximum pages collected per domain per mission', true],
  ['CRAWL_PER_HOST_PER_TICK', '40', 'Politeness: maximum fetches to one host in a single tick (requests are also spaced >= 1 s or the robots Crawl-delay)', true],
  ['CRAWL_BATCH_SIZE', '8', 'Parallel fetches per round', true],
  ['CRAWL_TICK_SECONDS', '240', 'Time budget for one background tick (Apps Script limit is 360)', true],
  ['CRAWL_MAX_ATTEMPTS', '3', 'Retries for transient failures', true],
  ['RESPECT_ROBOTS', 'TRUE', 'Honour robots.txt, robots meta tags and X-Robots-Tag (strongly recommended)', true],
  ['CRAWL_USE_SITEMAPS', 'TRUE', 'Seed each mission source with URLs from its sitemap.xml', true],
  ['MIN_CANDIDATE_CONFIDENCE', '40', 'Candidates below this confidence are stored as LOW_QUALITY', true],
  ['SEND_ENABLED', 'FALSE', 'Global delivery switch', true],
  ['DELIVERY_MODE', 'DRY_RUN', 'DRY_RUN, TEST or PRODUCTION', true],
  ['DELIVERY_PROVIDER', 'RESEND', 'RESEND or ENDPOINT', true],
  ['ALLOW_LEGITIMATE_INTEREST', 'FALSE', 'Allow B2B contacts with lawful_basis=LEGITIMATE_INTEREST to receive campaigns', true],
  ['DAILY_SEND_LIMIT', '100', 'Global maximum emails per day (match your provider plan)', true],
  ['SEND_BATCH_SIZE', '50', 'Emails per delivery batch (Resend maximum is 100)', true],
  ['SEND_HOUR_START', '9', 'Local sending window start hour', true],
  ['SEND_HOUR_END', '17', 'Local sending window end hour (exclusive)', true],
  ['BLOCK_WEEKENDS', 'TRUE', 'Do not send on Saturday and Sunday', true],
  ['BLOCK_HOLIDAYS', 'TRUE', 'Do not send on HOLIDAYS rows with send_allowed=NO', true],
  ['DEFAULT_FROM_NAME', '', 'Default sender name', true],
  ['DEFAULT_FROM_EMAIL', '', 'Default verified sender address', true],
  ['DEFAULT_REPLY_TO', '', 'Default reply-to address', true],
  ['SENDER_POSTAL_ADDRESS', '', 'Physical address shown in every marketing footer (legal requirement in many countries)', true],
  ['PUBLIC_WEB_APP_URL', '', 'Deployed web app /exec URL used for unsubscribe links (auto-detected when blank)', true]
];

/** Script Properties used by OCE (never shown in the sheet). */
var OCE_SECRET_KEYS = ['OCE_API_KEY', 'OCE_SIGNING_SECRET', 'OCE_WEBHOOK_KEY', 'RESEND_API_KEY',
  'OCE_DELIVERY_ENDPOINT', 'OCE_DELIVERY_TOKEN', 'OCE_TEST_RECIPIENT', 'OCE_PRODUCTION_APPROVED',
  'OCE_SEARCH_PROVIDER', 'OCE_SEARCH_API_KEY'];

/* ------------------------------------------------------------------ settings */

function oceSettings_() {
  var cache = oceRuntimeCache_();
  if (cache.settings) return cache.settings;
  var out = {};
  OCE_DEFAULT_SETTINGS.forEach(function (row) { out[row[0]] = String(row[1]); });
  var sheet = oceDb_().getSheetByName('SETTINGS');
  if (sheet && sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues().forEach(function (r) {
      if (r[0] !== '' && r[0] !== null) out[String(r[0]).trim()] = String(r[1] === null ? '' : r[1]).trim();
    });
  }
  cache.settings = out;
  return out;
}

function oceSetting_(key, fallback) {
  var value = oceSettings_()[key];
  return value === undefined || value === '' ? (fallback === undefined ? '' : String(fallback)) : value;
}

function oceSettingNumber_(key, fallback) {
  var n = Number(oceSetting_(key, fallback));
  return isFinite(n) ? n : Number(fallback);
}

function oceSettingBool_(key, fallback) {
  return String(oceSetting_(key, fallback ? 'TRUE' : 'FALSE')).toUpperCase() === 'TRUE';
}

function oceSetSetting_(key, value) {
  var meta = OCE_DEFAULT_SETTINGS.filter(function (r) { return r[0] === key; })[0];
  var t = oceTable_('SETTINGS');
  var existing = t.find(function (r) { return r.key === key; });
  if (existing) t.update(existing, { value: String(value) });
  else t.append([{ key: key, value: String(value), description: meta ? meta[2] : '' }]);
  t.flush();
  delete oceRuntimeCache_().settings;
}

function oceEditableSettingKeys_() {
  return OCE_DEFAULT_SETTINGS.filter(function (r) { return r[3]; }).map(function (r) { return r[0]; });
}

/* ------------------------------------------------------------------ secrets */

function oceSecret_(key) {
  return String(PropertiesService.getScriptProperties().getProperty(key) || '');
}

function oceSetSecret_(key, value) {
  if (OCE_SECRET_KEYS.indexOf(key) < 0) throw new Error('Unknown secret key: ' + key);
  var props = PropertiesService.getScriptProperties();
  if (value === null || value === '') props.deleteProperty(key);
  else props.setProperty(key, String(value));
}

/** Generates the API key, signing secret and webhook key on first setup. Never overwrites. */
function oceEnsureSecrets_() {
  var props = PropertiesService.getScriptProperties();
  ['OCE_API_KEY', 'OCE_SIGNING_SECRET', 'OCE_WEBHOOK_KEY'].forEach(function (key) {
    if (!props.getProperty(key)) props.setProperty(key, oceRandomToken_(32));
  });
}

/** Per-execution memo (reset on every Apps Script invocation). */
function oceRuntimeCache_() {
  if (typeof globalThis !== 'undefined') {
    if (!globalThis.__oceRuntime) globalThis.__oceRuntime = {};
    return globalThis.__oceRuntime;
  }
  return {};
}
