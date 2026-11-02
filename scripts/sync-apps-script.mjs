import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { google } from 'googleapis';

const SCRIPT_ID = process.env.OCE_APPS_SCRIPT_ID;
const DEPLOYMENT_ID = process.env.OCE_APPS_SCRIPT_DEPLOYMENT_ID;
const CLASPRC_JSON = process.env.CLASPRC_JSON;
const COMMIT_SHA = process.env.GITHUB_SHA || 'unknown';
const SOURCE_DIR = path.resolve('apps-script');

function fail(message) { throw new Error(message); }
if (!SCRIPT_ID) fail('OCE_APPS_SCRIPT_ID is required.');
if (!DEPLOYMENT_ID) fail('OCE_APPS_SCRIPT_DEPLOYMENT_ID is required.');
if (!CLASPRC_JSON) fail('CLASPRC_JSON is required.');

let claspStore;
try { claspStore = JSON.parse(CLASPRC_JSON); }
catch (error) { fail(`CLASPRC_JSON is not valid JSON: ${error.message}`); }

function getOAuthCredentials(store) {
  const candidates = [];
  const add = (value, settings = {}) => {
    if (value && typeof value === 'object') candidates.push({ ...settings, ...value });
  };
  add(store);
  add(store?.token, store?.oauth2ClientSettings || {});
  if (store?.tokens && typeof store.tokens === 'object') Object.values(store.tokens).forEach((credential) => add(credential));
  for (const candidate of candidates) {
    const clientId = candidate.client_id || candidate.clientId;
    const clientSecret = candidate.client_secret || candidate.clientSecret;
    const refreshToken = candidate.refresh_token || candidate.refreshToken;
    if (clientId && clientSecret && refreshToken) return { clientId, clientSecret, refreshToken };
  }
  fail('CLASPRC_JSON does not contain a usable clasp OAuth credential.');
}

const oauth = getOAuthCredentials(claspStore);
if (!fs.existsSync(SOURCE_DIR)) fail(`Apps Script source directory not found: ${SOURCE_DIR}`);

function readSourceFiles() {
  const entries = fs.readdirSync(SOURCE_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name === 'appsscript.json' || /\.(gs|js|html)$/i.test(name));
  if (!entries.includes('appsscript.json')) fail('apps-script/appsscript.json is required.');
  entries.sort((a, b) => a === 'appsscript.json' ? -1 : b === 'appsscript.json' ? 1 : a.localeCompare(b));

  return entries.map((filename) => {
    const source = fs.readFileSync(path.join(SOURCE_DIR, filename), 'utf8');
    if (!source.trim()) fail(`Source file is empty: ${filename}`);
    if (filename === 'appsscript.json') {
      try { JSON.parse(source); } catch (error) { fail(`Invalid Apps Script manifest JSON: ${error.message}`); }
      return { name: 'appsscript', type: 'JSON', driveType: 'json', source };
    }
    const extension = path.extname(filename).toLowerCase();
    const html = extension === '.html';
    return {
      name: path.basename(filename, extension),
      type: html ? 'HTML' : 'SERVER_JS',
      driveType: html ? 'html' : 'server_js',
      source,
    };
  });
}

function apiErrorSummary(error) {
  const data = error?.response?.data;
  if (!data) return '';
  try { return JSON.stringify(data); } catch (_) { return String(data); }
}

async function exportDriveProject(auth) {
  const tokenResponse = await auth.getAccessToken();
  const accessToken = typeof tokenResponse === 'string' ? tokenResponse : tokenResponse?.token;
  if (!accessToken) fail('Could not obtain an OAuth access token for Drive import/export.');

  const exportUrl = `https://script.google.com/feeds/download/export?id=${encodeURIComponent(SCRIPT_ID)}&format=json`;
  const response = await fetch(exportUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
    redirect: 'follow',
  });

  const text = await response.text();
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      fail('Drive Apps Script import/export authorization is missing. Re-authorize the GitHub CLASPRC_JSON credential with the drive.scripts scope, then rerun.');
    }
    fail(`Drive Apps Script export failed (${response.status}): ${text.slice(0, 500)}`);
  }

  let exported;
  try { exported = JSON.parse(text); }
  catch (error) { fail(`Drive Apps Script export returned invalid JSON: ${error.message}`); }
  if (!Array.isArray(exported.files)) fail('Drive Apps Script export did not return a files array.');
  return exported.files;
}

async function importViaDrive(auth, localFiles) {
  const script = google.script({ version: 'v1', auth });
  const project = await script.projects.get({ scriptId: SCRIPT_ID });
  if (project.data?.parentId) {
    fail(`Apps Script project is container-bound (parentId ${project.data.parentId}); Drive import/export fallback is only supported for standalone projects.`);
  }

  console.log('Using Google Drive Apps Script import/export fallback.');
  console.log('Exporting the existing project so existing internal file IDs are preserved...');
  const remoteFiles = await exportDriveProject(auth);
  const byName = new Map(remoteFiles.map((file) => [file.name, file]));

  const files = localFiles.map((file) => {
    const remote = byName.get(file.name);
    const item = {
      name: file.name,
      type: file.driveType,
      source: file.source,
    };
    if (remote?.id) item.id = remote.id;
    return item;
  });

  const drive = google.drive({ version: 'v2', auth });
  await drive.files.update({
    fileId: SCRIPT_ID,
    media: {
      mimeType: 'application/vnd.google-apps.script+json',
      body: JSON.stringify({ files }),
    },
  });

  console.log(`Drive import completed. Synced ${files.length} files.`);
}

async function main() {
  const localFiles = readSourceFiles();
  console.log(`Prepared ${localFiles.length} Apps Script files.`);
  console.log(`Source set: ${localFiles.map((file) => `${file.name}:${file.type}`).join(', ')}`);

  const auth = new google.auth.OAuth2(oauth.clientId, oauth.clientSecret);
  auth.setCredentials({ refresh_token: oauth.refreshToken });
  const script = google.script({ version: 'v1', auth });

  let synced = false;
  try {
    console.log(`Attempting Apps Script API updateContent for ${SCRIPT_ID}...`);
    const updated = await script.projects.updateContent({ scriptId: SCRIPT_ID, requestBody: { files: localFiles.map(({ name, type, source }) => ({ name, type, source })) } });
    if (!updated.data || updated.data.scriptId !== SCRIPT_ID) fail('Apps Script updateContent returned an unexpected project response.');
    console.log('Apps Script API updateContent succeeded.');
    synced = true;
  } catch (error) {
    console.warn(`Apps Script API updateContent failed: ${apiErrorSummary(error)}`);
    if (error?.response?.status !== 400) throw error;
    await importViaDrive(auth, localFiles);
    synced = true;
  }

  if (!synced) fail('Apps Script source synchronization did not complete.');

  const version = await script.projects.versions.create({
    scriptId: SCRIPT_ID,
    requestBody: { description: `GitHub ${COMMIT_SHA.slice(0, 12)} — OCE automated sync` },
  });
  const versionNumber = version.data?.versionNumber;
  if (!versionNumber) fail('Apps Script version creation did not return a version number.');
  console.log(`Created Apps Script version ${versionNumber}.`);

  const deployment = await script.projects.deployments.get({ scriptId: SCRIPT_ID, deploymentId: DEPLOYMENT_ID });
  const currentConfig = deployment.data?.deploymentConfig;
  if (!currentConfig) fail('Existing OCE deployment has no deploymentConfig.');

  await script.projects.deployments.update({
    scriptId: SCRIPT_ID,
    deploymentId: DEPLOYMENT_ID,
    requestBody: {
      deploymentConfig: {
        scriptId: SCRIPT_ID,
        versionNumber,
        manifestFileName: currentConfig.manifestFileName || 'appsscript',
        description: currentConfig.description || 'OCE Collector Gateway',
      },
    },
  });

  console.log(`Updated existing deployment ${DEPLOYMENT_ID} to version ${versionNumber}.`);
  console.log('OCE Apps Script synchronization completed successfully.');
}

main().catch((error) => {
  const status = error?.response?.status || error?.code || 'unknown';
  const reason = error?.response?.data?.error?.status || '';
  const message = error?.response?.data?.error?.message || error?.message || String(error);
  console.error(`OCE Apps Script sync failed (${status}${reason ? ` ${reason}` : ''}): ${message}`);
  process.exit(1);
});
