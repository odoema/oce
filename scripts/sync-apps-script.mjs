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

  if (store?.tokens && typeof store.tokens === 'object') {
    Object.values(store.tokens).forEach((credential) => add(credential));
  }

  for (const candidate of candidates) {
    const clientId = candidate.client_id || candidate.clientId;
    const clientSecret = candidate.client_secret || candidate.clientSecret;
    const refreshToken = candidate.refresh_token || candidate.refreshToken;
    if (clientId && clientSecret && refreshToken) {
      return { clientId, clientSecret, refreshToken };
    }
  }

  fail('CLASPRC_JSON does not contain a usable clasp OAuth credential. Expected a V3 token entry or legacy token + oauth2ClientSettings.');
}

const oauth = getOAuthCredentials(claspStore);

if (!fs.existsSync(SOURCE_DIR)) fail(`Apps Script source directory not found: ${SOURCE_DIR}`);

function readSourceFiles() {
  const entries = fs.readdirSync(SOURCE_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name === 'appsscript.json' || /\.(gs|js|html)$/i.test(name))
    .sort((a, b) => {
      if (a === 'appsscript.json') return 1;
      if (b === 'appsscript.json') return -1;
      return a.localeCompare(b);
    });

  if (!entries.includes('appsscript.json')) fail('apps-script/appsscript.json is required.');

  const files = entries.map((filename) => {
    const source = fs.readFileSync(path.join(SOURCE_DIR, filename), 'utf8');
    if (!source.trim()) fail(`Source file is empty: ${filename}`);
    if (filename === 'appsscript.json') {
      try { JSON.parse(source); } catch (error) { fail(`Invalid Apps Script manifest JSON: ${error.message}`); }
      return { name: 'appsscript', type: 'JSON', source };
    }
    const extension = path.extname(filename).toLowerCase();
    return {
      name: path.basename(filename, extension),
      type: extension === '.html' ? 'HTML' : 'SERVER_JS',
      source,
    };
  });

  const names = files.map((file) => file.name);
  const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
  if (duplicates.length) fail(`Duplicate Apps Script file names: ${[...new Set(duplicates)].join(', ')}`);
  return files;
}

async function main() {
  const files = readSourceFiles();
  console.log(`Prepared ${files.length} Apps Script files.`);
  console.log(`Source set: ${files.map((file) => `${file.name}:${file.type}`).join(', ')}`);

  const auth = new google.auth.OAuth2(oauth.clientId, oauth.clientSecret);
  auth.setCredentials({ refresh_token: oauth.refreshToken });
  const script = google.script({ version: 'v1', auth });

  console.log(`Updating Apps Script project ${SCRIPT_ID} via projects.updateContent...`);
  const updated = await script.projects.updateContent({ scriptId: SCRIPT_ID, requestBody: { files } });
  if (!updated.data || updated.data.scriptId !== SCRIPT_ID) fail('Apps Script updateContent returned an unexpected project response.');
  console.log('Apps Script HEAD content updated successfully.');

  const version = await script.projects.versions.create({
    scriptId: SCRIPT_ID,
    requestBody: { description: `GitHub ${COMMIT_SHA.slice(0, 12)} — direct API sync` },
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
  console.log('Direct Apps Script API sync completed successfully.');
}

main().catch((error) => {
  const status = error?.response?.status || error?.code || 'unknown';
  const reason = error?.response?.data?.error?.status || '';
  const message = error?.response?.data?.error?.message || error?.message || String(error);
  console.error(`Apps Script API sync failed (${status}${reason ? ` ${reason}` : ''}): ${message}`);
  process.exit(1);
});
