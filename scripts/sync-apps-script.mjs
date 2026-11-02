import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { google } from 'googleapis';

const SCRIPT_ID = process.env.OCE_APPS_SCRIPT_ID;
const CONFIGURED_DEPLOYMENT_ID = process.env.OCE_APPS_SCRIPT_DEPLOYMENT_ID || '';
const CLASPRC_JSON = process.env.CLASPRC_JSON;
const COMMIT_SHA = process.env.GITHUB_SHA || 'unknown';
const SOURCE_DIR = path.resolve('apps-script');

function fail(message) { throw new Error(message); }
if (!SCRIPT_ID) fail('OCE_APPS_SCRIPT_ID is required.');
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

function apiErrorSummary(error) {
  const data = error?.response?.data;
  if (!data) return error?.message || String(error);
  try { return JSON.stringify(data); } catch (_) { return String(data); }
}

function deploymentUrl(deployment) {
  const entryPoints = deployment?.entryPoints || [];
  const web = entryPoints.find((entry) => entry.entryPointType === 'WEB_APP' && entry.webApp?.url);
  return web?.webApp?.url || '';
}

function isWebDeployment(deployment) {
  return Boolean(deploymentUrl(deployment));
}

async function listAllDeployments(script) {
  const deployments = [];
  let pageToken;
  do {
    const response = await script.projects.deployments.list({
      scriptId: SCRIPT_ID,
      pageSize: 50,
      ...(pageToken ? { pageToken } : {}),
    });
    deployments.push(...(response.data?.deployments || []));
    pageToken = response.data?.nextPageToken;
  } while (pageToken);
  return deployments;
}

async function getOrCreateWebDeployment(script, versionNumber) {
  const deployments = await listAllDeployments(script);
  console.log(`Found ${deployments.length} Apps Script deployment(s).`);

  let selected = null;

  if (CONFIGURED_DEPLOYMENT_ID) {
    selected = deployments.find((item) => item.deploymentId === CONFIGURED_DEPLOYMENT_ID) || null;
    if (selected) console.log(`Configured deployment ${CONFIGURED_DEPLOYMENT_ID} is valid.`);
    else console.log(`Configured deployment ${CONFIGURED_DEPLOYMENT_ID} is not present; selecting a valid OCE deployment instead.`);
  }

  if (!selected) {
    selected = deployments.find((item) => isWebDeployment(item) && /oce|collector gateway/i.test(item.deploymentConfig?.description || '')) || null;
  }

  if (!selected) {
    selected = deployments.find((item) => isWebDeployment(item)) || null;
  }

  if (selected) {
    const currentConfig = selected.deploymentConfig || {};
    await script.projects.deployments.update({
      scriptId: SCRIPT_ID,
      deploymentId: selected.deploymentId,
      requestBody: {
        deploymentConfig: {
          scriptId: SCRIPT_ID,
          versionNumber,
          manifestFileName: currentConfig.manifestFileName || 'appsscript',
          description: currentConfig.description || 'OCE Collector Gateway',
        },
      },
    });
    const refreshed = await script.projects.deployments.get({
      scriptId: SCRIPT_ID,
      deploymentId: selected.deploymentId,
    });
    const url = deploymentUrl(refreshed.data);
    if (!url) fail(`Deployment ${selected.deploymentId} updated but no web-app URL was returned.`);
    return { id: selected.deploymentId, url, created: false };
  }

  console.log('No existing web deployment found; creating the OCE web deployment.');
  const created = await script.projects.deployments.create({
    scriptId: SCRIPT_ID,
    requestBody: {
      scriptId: SCRIPT_ID,
      versionNumber,
      manifestFileName: 'appsscript',
      description: 'OCE Collector Gateway',
    },
  });
  const createdUrl = deploymentUrl(created.data);
  if (!created.data?.deploymentId) fail('Apps Script deployment creation did not return a deployment ID.');
  if (!createdUrl) fail(`Created deployment ${created.data.deploymentId} but no web-app URL was returned. Check appsscript.json webapp settings.`);
  return { id: created.data.deploymentId, url: createdUrl, created: true };
}

async function main() {
  const files = readSourceFiles();
  console.log(`Prepared ${files.length} Apps Script files.`);
  console.log(`Source set: ${files.map((file) => `${file.name}:${file.type}`).join(', ')}`);

  const auth = new google.auth.OAuth2(oauth.clientId, oauth.clientSecret);
  auth.setCredentials({ refresh_token: oauth.refreshToken });
  const script = google.script({ version: 'v1', auth });

  console.log(`Updating Apps Script project ${SCRIPT_ID} through Apps Script API...`);
  try {
    const current = await script.projects.getContent({ scriptId: SCRIPT_ID });
    if (!current.data || current.data.scriptId !== SCRIPT_ID) fail('Apps Script getContent returned an unexpected project response.');
    console.log(`Remote Apps Script project is readable (${current.data.files?.length || 0} files).`);

    const updated = await script.projects.updateContent({
      scriptId: SCRIPT_ID,
      requestBody: { files },
    });
    if (!updated.data || updated.data.scriptId !== SCRIPT_ID) fail('Apps Script updateContent returned an unexpected project response.');
    console.log('Apps Script HEAD content updated successfully.');
  } catch (error) {
    console.error(`Apps Script API response: ${apiErrorSummary(error)}`);
    throw error;
  }

  const version = await script.projects.versions.create({
    scriptId: SCRIPT_ID,
    requestBody: { description: `GitHub ${COMMIT_SHA.slice(0, 12)} — OCE automated sync` },
  });
  const versionNumber = version.data?.versionNumber;
  if (!versionNumber) fail('Apps Script version creation did not return a version number.');
  console.log(`Created Apps Script version ${versionNumber}.`);

  const deployment = await getOrCreateWebDeployment(script, versionNumber);
  console.log(`${deployment.created ? 'Created' : 'Updated'} OCE web deployment ${deployment.id} at version ${versionNumber}.`);
  console.log(`OCE web app URL: ${deployment.url}`);

  if (process.env.GITHUB_ENV) {
    fs.appendFileSync(process.env.GITHUB_ENV, `OCE_EFFECTIVE_DEPLOYMENT_ID=${deployment.id}\nOCE_EFFECTIVE_WEB_APP_URL=${deployment.url}\n`);
  }

  console.log('OCE Apps Script synchronization completed successfully.');
}

main().catch((error) => {
  const status = error?.response?.status || error?.code || 'unknown';
  const reason = error?.response?.data?.error?.status || '';
  const message = error?.response?.data?.error?.message || error?.message || String(error);
  console.error(`OCE Apps Script sync failed (${status}${reason ? ` ${reason}` : ''}): ${message}`);
  process.exit(1);
});
