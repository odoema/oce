/*
 * OCE in-app manual: the ONE place to edit when the app changes.
 *
 * help.html renders everything here. tests/manual.test.js keeps it honest:
 *   - `version` must equal the app version (apps-script/00_Config.gs, package.json, web/index.html).
 *   - `whatsNew` must have an entry for that version.
 *   - every dashboard tab (index.html #nav data-view) must be covered by a chapter (`covers`).
 *   - every label in `mockScreens` and every chapter `ui` label must still exist in web/index.html,
 *     so renaming a button in the dashboard fails CI until the manual is updated.
 *   - `settings` must list exactly the keys of OCE_DEFAULT_SETTINGS, with the same defaults.
 * See docs/manual.md for how to update it.
 */
window.OCE_MANUAL = {
  version: '2.2.0',
  updated: '2026-11-24',

  whatsNew: {
    '2.2.0': [
      'Finding websites is now free: OCE reads Wikipedia lists and Wikidata. No search key, no account, no payment.',
      'Meet the OCE assistant: click "Ask OCE" (bottom right) and it walks you through finding contacts, reviewing them, writing a campaign or importing a list, one friendly question at a time.',
      'This interactive guide, built into the dashboard (the Help link in the sidebar).',
      'Missions start from up to 20 websites instead of 10.'
    ],
    '2.1.0': [
      'OCE reads each website\'s sitemap to find contact pages faster.',
      'Pages that ask not to be indexed are skipped; their details are never stored.'
    ],
    '2.0.0': [
      'Rebuilt engine: polite crawler, review step, consent rules, safe sending with unsubscribe links.'
    ]
  },

  journey: [
    { id: 'missions', icon: '🔎', title: 'Find', blurb: 'Type who you want. OCE finds their websites.' },
    { id: 'missions', icon: '🕸️', title: 'Collect', blurb: 'OCE visits contact pages and picks up emails and phones.' },
    { id: 'review', icon: '✅', title: 'Review', blurb: 'You approve who may be contacted, and why.' },
    { id: 'campaigns', icon: '✍️', title: 'Write', blurb: 'One email, personalised for each person.' },
    { id: 'campaigns', icon: '🚀', title: 'Send', blurb: 'Office hours only, daily limits, unsubscribe link in every email.' }
  ],

  /* Small fake screens used by the animated walkthroughs. Labels must match the dashboard exactly. */
  mockScreens: {
    assistant: { title: 'Ask OCE', items: [
      { kind: 'button', label: 'Find new contacts', primary: true },
      { kind: 'button', label: 'Review what I found' },
      { kind: 'button', label: 'Write a campaign' },
      { kind: 'button', label: 'Import my own list' },
      { kind: 'input', label: 'Your answer' }
    ] },
    settings: { title: 'Settings', items: [
      { kind: 'input', label: 'Web app URL (/exec)' },
      { kind: 'input', label: 'API key', secret: true },
      { kind: 'button', label: 'Save & connect', primary: true },
      { kind: 'button', label: 'Forget on this device' }
    ] },
    missions: { title: 'Missions', items: [
      { kind: 'input', label: 'What are you looking for?' },
      { kind: 'button', label: 'Preview sources first' },
      { kind: 'button', label: 'Start mission', primary: true },
      { kind: 'button', label: 'Collect now' },
      { kind: 'progress', label: 'Progress' }
    ] },
    review: { title: 'Review', items: [
      { kind: 'rows', label: 'Contact' },
      { kind: 'select', label: 'Basis: consent obtained' },
      { kind: 'button', label: 'Approve', primary: true },
      { kind: 'button', label: 'Reject' },
      { kind: 'button', label: 'Do not contact' },
      { kind: 'button', label: 'Export CSV' }
    ] },
    contacts: { title: 'Contacts', items: [
      { kind: 'rows', label: 'Eligible' },
      { kind: 'input', label: 'Import contacts (CSV)' },
      { kind: 'button', label: 'Import', primary: true }
    ] },
    campaigns: { title: 'Campaigns', items: [
      { kind: 'button', label: 'New campaign', primary: true },
      { kind: 'input', label: 'Subject' },
      { kind: 'button', label: 'Preview' },
      { kind: 'button', label: 'Send test to me' },
      { kind: 'button', label: 'Activate', primary: true },
      { kind: 'button', label: 'Run now' }
    ] }
  },

  chapters: [
    {
      id: 'assistant', icon: '💬', title: 'Let the assistant guide you', tagline: 'Answer a few questions; it does the clicking.',
      covers: ['overview'], open: 'overview',
      ui: ['Ask OCE', 'Let OCE guide you', 'How am I doing?', 'Ask a question'],
      steps: [
        { title: 'Open it', text: 'Click "Ask OCE" at the bottom right of any page, or a button on Overview.', mock: { screen: 'assistant' } },
        { title: 'Pick what you want', text: 'Find contacts, review them, write a campaign, import a list, or just ask.', mock: { screen: 'assistant', click: 'Find new contacts' } },
        { title: 'Answer in your own words', text: 'Tap a suggestion or type. It checks your answer and explains what happens next.', mock: { screen: 'assistant', type: { into: 'Your answer', text: 'Hotels in Kampala, Uganda' } } },
        { title: 'It does the work', text: 'It starts the mission, shows contacts one by one, drafts the email and previews it, using the same safe rules.', mock: { screen: 'assistant', click: 'Review what I found' } }
      ],
      tips: ['Menu (top of the chat) always takes you back to the start.', 'You can type things like "find NGOs in Kenya" or "how do unsubscribes work?".', 'It never sends anything without you choosing Activate, and practice mode stays on until you go live.']
    },
    {
      id: 'connect', icon: '🔌', title: 'Connect the dashboard', tagline: 'Once per browser. Takes a minute.',
      covers: ['settings', 'overview'], open: 'settings',
      ui: ['Web app URL (/exec)', 'Save & connect', 'Forget on this device'],
      steps: [
        { title: 'Open Settings', text: 'Click Settings in the green sidebar.', mock: { screen: 'settings' } },
        { title: 'Paste the web app address', text: 'It ends in /exec. You got it when OCE was set up.', mock: { screen: 'settings', type: { into: 'Web app URL (/exec)', text: 'https://script.google.com/macros/s/…/exec' } } },
        { title: 'Paste your API key', text: 'Treat it like a password. Forgot it? Run oceShowApiKey in the Apps Script editor.', mock: { screen: 'settings', type: { into: 'API key', text: '••••••••••••••••' } } },
        { title: 'Save & connect', text: 'The sidebar dot turns green and Overview fills with your numbers.', mock: { screen: 'settings', click: 'Save & connect' } }
      ],
      tips: ['On a shared computer, click "Forget on this device" when you are done.']
    },
    {
      id: 'missions', icon: '🔎', title: 'Find contacts', tagline: 'A mission is one search job: "find me X".',
      covers: ['missions'], open: 'missions',
      ui: ['What are you looking for?', 'Start mission', 'Preview sources first', 'Collect now', 'Extra starting URLs (optional, one per line)', 'Page budget', 'Link depth', 'Inspect a single page', 'Scan'],
      steps: [
        { title: 'Say who you want', text: 'A kind of organisation plus a country works best: "Banks in Uganda".', mock: { screen: 'missions', type: { into: 'What are you looking for?', text: 'Banks in Uganda' } } },
        { title: 'Peek first (optional)', text: 'Preview sources first shows which websites OCE plans to visit.', mock: { screen: 'missions', click: 'Preview sources first' } },
        { title: 'Start the mission', text: 'OCE works in the background every 5 minutes. You can close the page.', mock: { screen: 'missions', click: 'Start mission', progress: true } },
        { title: 'In a hurry?', text: 'Collect now runs a round immediately instead of waiting.', mock: { screen: 'missions', click: 'Collect now', progress: true } }
      ],
      tips: [
        'Niche group? Paste a member directory or association list under Options → Extra starting URLs. It is the most reliable way in.',
        'Inspect a single page: paste one address and click Scan to see what OCE would pick up, without starting a mission.',
        'OCE is polite: it obeys each website\'s robots.txt, waits between pages, and never logs in or bypasses CAPTCHAs.'
      ]
    },
    {
      id: 'review', icon: '✅', title: 'Review what was found', tagline: 'Found is not the same as allowed. You decide.',
      covers: ['review'], open: 'review',
      ui: ['Approve', 'Reject', 'Do not contact', 'Export CSV', 'Min. confidence', 'Evidence'],
      steps: [
        { title: 'Open Review', text: 'The number beside Review is how many contacts are waiting for you.', mock: { screen: 'review' } },
        { title: 'Tick and choose a basis', text: 'Tick the good ones, then pick why you may email them. Not sure? Use the basis helper below.', mock: { screen: 'review', tick: true, click: 'Basis: consent obtained' } },
        { title: 'Approve', text: 'Approved contacts move to your Contacts list.', mock: { screen: 'review', tick: true, click: 'Approve' } },
        { title: 'Reject or block', text: 'Reject what you don\'t want. Do not contact blocks a person forever.', mock: { screen: 'review', tick: true, click: 'Do not contact' } }
      ],
      tips: ['Click Evidence to open the exact page a contact came from.', 'A confidence of 60 or more is usually a real, current contact.']
    },
    {
      id: 'contacts', icon: '📇', title: 'Your contact list', tagline: 'Everyone you may reach, in one place.',
      covers: ['contacts'], open: 'contacts',
      ui: ['Import contacts (CSV)', 'Import', 'Eligible'],
      steps: [
        { title: 'Check who is eligible', text: 'Eligible = yes means OCE may email them now. No always comes with a reason.', mock: { screen: 'contacts' } },
        { title: 'Bring your own list', text: 'Save a sheet as CSV with a header row (email, name, company, consent…), then Import.', mock: { screen: 'contacts', click: 'Import' } }
      ],
      tips: ['Only rows with consent = yes can be emailed. Others are kept but never mailed.', 'Add a tag such as expo-2026 to target that group later.', 'Unsubscribes are automatic and permanent.']
    },
    {
      id: 'campaigns', icon: '✍️', title: 'Write and send a campaign', tagline: 'Practice mode is on until you choose to go live.',
      covers: ['campaigns'], open: 'campaigns',
      ui: ['New campaign', 'Subject', 'Preview', 'Send test to me', 'Activate', 'Run now', 'Daily cap', 'Audience segment'],
      steps: [
        { title: 'Start a campaign', text: 'Pick your audience, write a subject and a short body.', mock: { screen: 'campaigns', click: 'New campaign' } },
        { title: 'Personalise', text: 'Write {{first_name|there}} and each person sees their own name (or "there").', mock: { screen: 'campaigns', type: { into: 'Subject', text: 'Hello {{first_name|there}}' } } },
        { title: 'Look before you leap', text: 'Preview shows the real email. Send test to me puts one in your inbox.', mock: { screen: 'campaigns', click: 'Send test to me' } },
        { title: 'Activate', text: 'OCE sends in small batches on weekdays, 09:00–17:00 Kampala time, skipping public holidays.', mock: { screen: 'campaigns', click: 'Activate' } }
      ],
      tips: ['In practice mode (DRY_RUN) sent emails show "(sim)": nothing leaves Google.', 'Your postal address and an unsubscribe link are added to every email automatically.']
    },
    {
      id: 'golive', icon: '🚀', title: 'Go live (free email sending)', tagline: 'Resend\'s free plan: 3,000 emails a month, 100 a day.',
      covers: ['settings'], open: 'settings',
      ui: ['Engine settings', 'Save settings', 'Secrets status'],
      steps: [],
      tips: ['To stop everything at once, set SEND_ENABLED to FALSE in Settings.']
    }
  ],

  /* Shown in the go-live checklist, in order. */
  goLive: [
    'Sign up at resend.com and verify your email domain (add the DNS records it shows you).',
    'Create a Resend API key and save it in Apps Script → Project Settings → Script Properties as RESEND_API_KEY.',
    'Add OCE_TEST_RECIPIENT there too: your own email address.',
    'In Settings fill DEFAULT_FROM_NAME, DEFAULT_FROM_EMAIL (on your verified domain) and SENDER_POSTAL_ADDRESS.',
    'Set DELIVERY_MODE to TEST, then click Send test to me on a campaign. Check your inbox.',
    'Run oceApproveProduction once in the Apps Script editor.',
    'Set DELIVERY_MODE to PRODUCTION and SEND_ENABLED to TRUE. You are live.'
  ],

  /* Every key of OCE_DEFAULT_SETTINGS, with its default and a plain explanation. */
  settings: [
    { key: 'VERSION', def: '2.2.0', plain: 'Installed version. Set by OCE; do not edit.', group: 'System' },
    { key: 'TIMEZONE', def: 'Africa/Kampala', plain: 'Clock used for sending hours and dates.', group: 'System' },
    { key: 'DEFAULT_COUNTRY_CODE', def: '256', plain: 'Turns 0772… into +256772….', group: 'System' },
    { key: 'CRAWL_ENABLED', def: 'TRUE', plain: 'Master switch for finding and collecting.', group: 'Finding' },
    { key: 'CRAWL_MAX_PAGES', def: '150', plain: 'Most pages one mission visits.', group: 'Finding' },
    { key: 'CRAWL_MAX_DEPTH', def: '2', plain: 'How many clicks away from a starting page OCE goes.', group: 'Finding' },
    { key: 'CRAWL_SAME_SITE', def: 'TRUE', plain: 'Stay on the starting websites; don\'t wander off.', group: 'Finding' },
    { key: 'CRAWL_MAX_PER_DOMAIN', def: '60', plain: 'Most pages from one website per mission.', group: 'Finding' },
    { key: 'CRAWL_PER_HOST_PER_TICK', def: '40', plain: 'Politeness: most visits to one website per round.', group: 'Finding' },
    { key: 'CRAWL_BATCH_SIZE', def: '8', plain: 'Pages fetched at the same time.', group: 'Finding' },
    { key: 'CRAWL_TICK_SECONDS', def: '240', plain: 'How long one background round may run.', group: 'Finding' },
    { key: 'CRAWL_MAX_ATTEMPTS', def: '3', plain: 'Retries for a page that failed.', group: 'Finding' },
    { key: 'RESPECT_ROBOTS', def: 'TRUE', plain: 'Obey websites\' crawling rules. Leave on.', group: 'Finding' },
    { key: 'CRAWL_USE_SITEMAPS', def: 'TRUE', plain: 'Use a site\'s sitemap to find contact pages faster.', group: 'Finding' },
    { key: 'MIN_CANDIDATE_CONFIDENCE', def: '40', plain: 'Contacts scoring below this are marked low quality.', group: 'Finding' },
    { key: 'SEND_ENABLED', def: 'FALSE', plain: 'Master switch for real sending.', group: 'Sending' },
    { key: 'DELIVERY_MODE', def: 'DRY_RUN', plain: 'DRY_RUN = practice, TEST = only test emails, PRODUCTION = real.', group: 'Sending' },
    { key: 'DELIVERY_PROVIDER', def: 'RESEND', plain: 'Who delivers the email. Keep RESEND.', group: 'Sending' },
    { key: 'ALLOW_LEGITIMATE_INTEREST', def: 'FALSE', plain: 'Lets OCE email B2B contacts approved under legitimate interest.', group: 'Sending' },
    { key: 'DAILY_SEND_LIMIT', def: '100', plain: 'Most emails per day, all campaigns together. 100 = Resend free plan.', group: 'Sending' },
    { key: 'SEND_BATCH_SIZE', def: '50', plain: 'Emails sent per batch.', group: 'Sending' },
    { key: 'SEND_HOUR_START', def: '9', plain: 'Sending starts at this hour.', group: 'Sending' },
    { key: 'SEND_HOUR_END', def: '17', plain: 'Sending stops at this hour.', group: 'Sending' },
    { key: 'BLOCK_WEEKENDS', def: 'TRUE', plain: 'No sending on Saturday and Sunday.', group: 'Sending' },
    { key: 'BLOCK_HOLIDAYS', def: 'TRUE', plain: 'No sending on Uganda public holidays.', group: 'Sending' },
    { key: 'DEFAULT_FROM_NAME', def: '', plain: 'Who the email appears to come from.', group: 'Sender' },
    { key: 'DEFAULT_FROM_EMAIL', def: '', plain: 'Your sending address, on your verified domain.', group: 'Sender' },
    { key: 'DEFAULT_REPLY_TO', def: '', plain: 'Where replies go, if different.', group: 'Sender' },
    { key: 'SENDER_POSTAL_ADDRESS', def: '', plain: 'Printed in every email footer. Required by law.', group: 'Sender' },
    { key: 'PUBLIC_WEB_APP_URL', def: '', plain: 'Your /exec address, used in unsubscribe links.', group: 'System' }
  ],

  troubles: [
    { q: 'How do unsubscribes work?', fix: 'Every email has an unsubscribe link (and a one-click unsubscribe header). When someone uses it, OCE blocks that address permanently; no campaign can reach it again.' },
    { q: 'Will OCE email anyone without my approval?', fix: 'No. Found contacts wait in Review until you approve them with a basis, and nothing sends until you activate a campaign. Practice mode (DRY_RUN) stays on until you go live.' },
    { q: 'Does OCE cost anything?', fix: 'No. It runs on your Google account; finding websites uses free Wikipedia and Wikidata; Resend sends up to 100 emails a day free.' },
    { q: 'Where is my data kept?', fix: 'In a Google Sheet in your own Drive, "OCE — Campaign Engine Data". Overview links to it.' },
    { q: 'Dashboard says "Not connected" or "Unauthorized"', fix: 'Settings → paste the web app URL and API key again → Save & connect.' },
    { q: 'A mission found few or no websites', fix: 'Add the country, use a broader word ("Banks", "NGOs"), or paste a directory page under Extra starting URLs.' },
    { q: 'A mission sits at 0%', fix: 'Background work runs every 5 minutes. Wait, or click Collect now.' },
    { q: 'Many pages "blocked" or "skipped"', fix: 'Normal. Those websites ask not to be crawled, and OCE respects that.' },
    { q: 'Review is empty after a mission', fix: 'Those pages published no emails or phones. Try a directory website, or lower Min. confidence.' },
    { q: 'A contact shows Eligible: no', fix: 'It has no basis yet, unsubscribed, or has a bad email. Approve it with a basis, or leave it.' },
    { q: 'Campaign says "Not sent: Outside sending window"', fix: 'Before 09:00, after 17:00, a weekend or a holiday. It sends in the next window by itself.' },
    { q: '"SEND_ENABLED is FALSE" or "RESEND_API_KEY missing"', fix: 'Go-live setup isn\'t finished. Follow the Go live checklist.' },
    { q: 'Sent numbers show "(sim)"', fix: 'Practice mode (DRY_RUN). Expected until you go live.' },
    { q: 'Something looks broken', fix: 'In the Apps Script editor open 41_Setup.gs, choose oceHealthCheck and click Run. The log shows which part is not ok.' }
  ]
};
