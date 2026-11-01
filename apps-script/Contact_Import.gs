/** OCE V1.3 Contact Import Engine
 * Controlled ingestion layer. Web scraping is intentionally not enabled here.
 * Sources must be authorized and provide an export/API/Google Sheet/CSV.
 * New records default to consent_status=NO and therefore cannot be queued for marketing.
 */

function setupImportEngine(){
  const ss=SpreadsheetApp.getActive();
  const schemas={
    SOURCE_CONFIG:['source_id','source_name','source_type','source_reference','allowed','last_run','last_result','notes'],
    IMPORT_RUNS:['run_id','source_id','started_at','finished_at','status','records_found','records_imported','records_skipped','message']
  };
  Object.entries(schemas).forEach(([n,h])=>{
    const sh=ss.getSheetByName(n)||ss.insertSheet(n);
    if(sh.getLastRow()===0)sh.getRange(1,1,1,h.length).setValues([h]);
    sh.setFrozenRows(1);sh.getRange(1,1,1,h.length).setFontWeight('bold');
  });
  SpreadsheetApp.getUi().alert('OCE import engine initialized.');
}

function importCsvText(csvText,sourceName,sourceReference){
  if(!csvText)throw Error('CSV content is empty.');
  const rows=Utilities.parseCsv(String(csvText));
  if(rows.length<2)throw Error('CSV must contain a header row and data.');
  const headers=rows[0].map(normalizeImportHeader_);
  const records=rows.slice(1).map(r=>mapImportRow_(headers,r)).filter(r=>r.email);
  return writeImportRecords_(records,sourceName||'CSV',sourceReference||'');
}

function importFromGoogleSheet(sourceSpreadsheetId,sourceSheetName,sourceName){
  if(!sourceSpreadsheetId)throw Error('Spreadsheet ID is required.');
  const source=SpreadsheetApp.openById(sourceSpreadsheetId);
  const sh=source.getSheetByName(sourceSheetName);
  if(!sh)throw Error('Source sheet not found: '+sourceSheetName);
  const values=sh.getDataRange().getValues();
  if(values.length<2)throw Error('Source sheet has no data rows.');
  const headers=values[0].map(normalizeImportHeader_);
  const records=values.slice(1).map(r=>mapImportRow_(headers,r)).filter(r=>r.email);
  return writeImportRecords_(records,sourceName||source.getName(),sourceSpreadsheetId+'#'+sourceSheetName);
}

function writeImportRecords_(records,sourceName,sourceReference){
  const sh=SpreadsheetApp.getActive().getSheetByName(OCE.SHEETS.IMPORT);
  if(!sh)throw Error('Run Initialize / Repair Workbook first.');
  const existing=sh.getLastRow()>1?sh.getRange(2,1,sh.getLastRow()-1,17).getValues():[];
  const seen=new Set(existing.map(r=>normalizeEmail_(r[2])).filter(Boolean));
  const out=[];let skipped=0;
  records.forEach(r=>{
    const email=normalizeEmail_(r.email);
    if(!email||!isValidEmail_(email)||seen.has(email)){skipped++;return;}
    seen.add(email);
    out.push([
      clean_(r.first_name),clean_(r.last_name),email,normalizePhone_(r.phone),clean_(r.date_of_birth),
      clean_(r.gender),clean_(r.profession),clean_(r.organization),clean_(r.country),clean_(r.location),
      clean_(r.source||sourceName),sourceReference,new Date(),String(r.consent_status||'NO').toUpperCase(),
      r.consent_date||'',clean_(r.consent_source),clean_(r.notes)
    ]);
  });
  if(out.length)sh.getRange(sh.getLastRow()+1,1,out.length,17).setValues(out);
  return {records_found:records.length,records_imported:out.length,records_skipped:skipped};
}

function normalizeImportHeader_(h){return String(h||'').toLowerCase().trim().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'')}
function mapImportRow_(headers,row){
  const o={};headers.forEach((h,i)=>o[h]=row[i]);
  return {
    first_name:o.first_name||o.firstname||o.given_name||o.name||'',
    last_name:o.last_name||o.lastname||o.surname||'',
    email:o.email||o.email_address||'',
    phone:o.phone||o.mobile||o.telephone||'',
    date_of_birth:o.date_of_birth||o.dob||'',
    gender:o.gender||'',profession:o.profession||o.job_title||o.occupation||'',
    organization:o.organization||o.company||o.employer||'',country:o.country||'',location:o.location||'',
    consent_status:o.consent_status||o.consent||'NO',consent_date:o.consent_date||'',
    consent_source:o.consent_source||'',notes:o.notes||''
  };
}

function addSourceConfig(sourceId,sourceName,sourceType,sourceReference,allowed,notes){
  const sh=SpreadsheetApp.getActive().getSheetByName('SOURCE_CONFIG');
  if(!sh)throw Error('Run setupImportEngine first.');
  sh.appendRow([sourceId,sourceName,sourceType,sourceReference,String(allowed).toUpperCase()==='TRUE',new Date(),'CONFIGURED',notes||'']);
}
