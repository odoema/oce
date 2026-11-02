/* OCE Discovery Brain V1
 * LEGO block: plain-language mission -> ranked public discovery seeds.
 *
 * The operator should not need to know what a seed URL is.
 * This block converts a topic into a small, ranked set of legitimate public
 * starting sources. A seed is an internal implementation detail.
 *
 * It never bypasses authentication, CAPTCHA, paywalls or access controls.
 */

const OCE_DISCOVERY_CATALOG = [
  {
    id: 'icpau-firms',
    name: 'ICPAU licensed firms portal',
    url: 'https://icpauportal.com/external_portal/firms',
    country: 'UG',
    keywords: ['auditor', 'auditors', 'audit', 'accountant', 'accountants', 'accounting', 'cpa', 'professional services', 'assurance', 'tax'],
    authority: 99,
    type: 'REGULATORY_REGISTER'
  },
  {
    id: 'icpau',
    name: 'Institute of Certified Public Accountants of Uganda',
    url: 'https://www.icpau.co.ug/accountancy-practice',
    country: 'UG',
    keywords: ['auditor', 'auditors', 'audit', 'accountant', 'accountants', 'accounting', 'cpa', 'assurance', 'tax'],
    authority: 98,
    type: 'PROFESSIONAL_BODY'
  },
  {
    id: 'ira-auditors',
    name: 'Insurance Regulatory Authority — approved auditors',
    url: 'https://ira.go.ug/wp-content/uploads/2026/01/List-of-Approved-Auditors-2026_124902.pdf',
    country: 'UG',
    keywords: ['auditor', 'auditors', 'audit', 'insurance', 'assurance'],
    authority: 97,
    type: 'REGULATORY_LIST'
  },
  {
    id: 'ursb',
    name: 'Uganda Registration Services Bureau',
    url: 'https://ursb.go.ug/search-ursb-registries/',
    country: 'UG',
    keywords: ['business', 'businesses', 'company', 'companies', 'supplier', 'suppliers', 'vendor', 'vendors', 'firm', 'firms', 'organization', 'organisations', 'ngo'],
    authority: 98,
    type: 'BUSINESS_REGISTRY'
  },
  {
    id: 'yellow-uganda',
    name: 'Yellow Uganda business directory',
    url: 'https://www.yellow.ug/',
    country: 'UG',
    keywords: ['business', 'businesses', 'company', 'companies', 'supplier', 'suppliers', 'vendor', 'vendors', 'restaurant', 'hotel', 'retail', 'services', 'directory'],
    authority: 78,
    type: 'BUSINESS_DIRECTORY'
  },
  {
    id: 'startup-uganda',
    name: 'Startup Uganda directory',
    url: 'https://portal.startup.ug/directory',
    country: 'UG',
    keywords: ['startup', 'startups', 'business', 'businesses', 'technology', 'company', 'companies'],
    authority: 82,
    type: 'STARTUP_DIRECTORY'
  },
  {
    id: 'myugandaonline',
    name: 'MyUgandaOnline directory',
    url: 'https://myugandaonline.com/directory.php',
    country: 'UG',
    keywords: ['business', 'businesses', 'company', 'companies', 'supplier', 'vendor', 'directory', 'services'],
    authority: 70,
    type: 'BUSINESS_DIRECTORY'
  },
  {
    id: 'companydata-uganda',
    name: 'CompanyData Uganda directory',
    url: 'https://companydata.com/directory/business-directory-uganda/',
    country: 'UG',
    keywords: ['business', 'businesses', 'company', 'companies', 'firm', 'firms', 'directory'],
    authority: 68,
    type: 'BUSINESS_DIRECTORY'
  }
];

function oceDiscoveryNormalizeText_(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function oceDiscoveryTokens_(topic) {
  return oceDiscoveryNormalizeText_(topic)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 20);
}

function oceDiscoveryScore_(entry, tokens) {
  let score = Number(entry.authority || 0) * 0.45;
  const words = new Set(entry.keywords.map(oceDiscoveryNormalizeText_));

  tokens.forEach(token => {
    if (words.has(token)) score += 28;
    else if ([...words].some(word => word.includes(token) || token.includes(word))) score += 10;
  });

  if (entry.country === 'UG') score += 8;
  return Math.min(99, Math.round(score));
}

/**
 * Convert a plain-language topic into ranked public discovery sources.
 * Seeds remain invisible to the normal operator experience.
 */
function ocePlanDiscovery(topic, options) {
  const tokens = oceDiscoveryTokens_(topic);
  const country = String((options && options.country) || 'UG').toUpperCase();
  const limit = Math.max(1, Math.min(12, Number((options && options.limit) || 6)));

  const ranked = OCE_DISCOVERY_CATALOG
    .filter(entry => !country || entry.country === country || entry.country === 'GLOBAL')
    .map(entry => ({
      ...entry,
      score: oceDiscoveryScore_(entry, tokens),
      discovery_reason: entry.keywords.some(k => tokens.indexOf(k) >= 0)
        ? 'topic match + source authority'
        : 'broad sector discovery source'
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return {
    mode: 'AUTOMATIC',
    topic: String(topic || '').trim(),
    country,
    generated_at: new Date().toISOString(),
    seeds: ranked.map(entry => ({
      id: entry.id,
      name: entry.name,
      url: entry.url,
      score: entry.score,
      source_type: entry.type,
      discovery_reason: entry.discovery_reason
    }))
  };
}
