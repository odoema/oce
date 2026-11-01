const OCE={VERSION:'1.3.0',TIMEZONE:'Africa/Kampala',DEFAULT_BATCH_SIZE:250,SHEETS:{CONTACTS:'CONTACTS',IMPORT:'IMPORT',SEGMENTS:'SEGMENTS',CAMPAIGNS:'CAMPAIGNS',QUEUE:'QUEUE',HOLIDAYS:'HOLIDAYS',LOG:'SEND_LOG',SETTINGS:'SETTINGS',DASHBOARD:'DASHBOARD',SUPPRESSION:'SUPPRESSION'}};

function onOpen(){SpreadsheetApp.getUi().createMenu('OCE').addItem('Initialize / Repair Workbook','setupOCE').addItem('Setup Import Engine','setupImportEngine').addItem('Normalize & Import Contacts','normalizeAndImportContacts').addItem('Validate Contacts','validateContacts').addItem('Build Campaign Queue','buildCampaignQueue').addItem('Refresh Dashboard','refreshDashboard').addSeparator().addItem('PAUSE Sending','pauseSending').addItem('RESUME Sending','resumeSending').addItem('Install Hourly Scheduler','installScheduler').addItem('Remove OCE Triggers','removeOCETriggers').addToUi()}

function setupOCE(){
 const ss=SpreadsheetApp.getActive(), schemas={
 CONTACTS:['contact_id','first_name','last_name','email','phone','date_of_birth','gender','profession','organization','country','location','source','source_url','collected_at','consent_status','consent_date','consent_source','status','unsubscribe_at','suppression_reason','last_sent_at','notes'],
 IMPORT:['first_name','last_name','email','phone','date_of_birth','gender','profession','organization','country','location','source','source_url','collected_at','consent_status','consent_date','consent_source','notes'],
 SEGMENTS:['segment_id','segment_name','field','operator','value','active','notes'],
 CAMPAIGNS:['campaign_id','campaign_name','subject','body_html','segment_id','status','batch_size','start_date','end_date','holiday_policy','created_at'],
 QUEUE:['queue_id','campaign_id','contact_id','email','batch_no','status','queued_at','sent_at','error'],
 HOLIDAYS:['date','country','holiday','type','send_allowed'],
 SEND_LOG:['timestamp','campaign_id','contact_id','email','result','message'],
 SETTINGS:['key','value','description'],DASHBOARD:['metric','value'],
 SUPPRESSION:['email','reason','date','source']};
 Object.entries(schemas).forEach(([n,h])=>{let s=ss.getSheetByName(n)||ss.insertSheet(n);if(s.getLastRow()===0)s.getRange(1,1,1,h.length).setValues([h]);s.setFrozenRows(1);s.getRange(1,1,1,h.length).setFontWeight('bold');s.autoResizeColumns(1,h.length)});
 seedSettings_();seedHolidays_();refreshDashboard();SpreadsheetApp.getUi().alert('OCE V1.3 initialized.')
}

function seedSettings_(){
 const s=SpreadsheetApp.getActive().getSheetByName(OCE.SHEETS.SETTINGS), rows=s.getLastRow()>1?s.getRange(2,1,s.getLastRow()-1,2).getValues():[], keys=new Set(rows.map(r=>r[0]));
 [['VERSION','1.3.0','OCE version'],['BATCH_SIZE','250','Maximum campaign batch size'],['SEND_ENABLED','FALSE','Global sending safety switch'],['SEND_HOUR_START','9','Local sending window start'],['SEND_HOUR_END','17','Local sending window end'],['TIMEZONE','Africa/Kampala','Timezone'],['BLOCK_WEEKENDS','TRUE','Pause Saturday and Sunday'],['BLOCK_HOLIDAYS','TRUE','Pause configured holidays'],['SOURCE_COLLECTION_ENABLED','FALSE','Controlled source collection switch']].filter(r=>!keys.has(r[0])).forEach(r=>s.appendRow(r))
}

function seedHolidays_(){
 const s=SpreadsheetApp.getActive().getSheetByName(OCE.SHEETS.HOLIDAYS);if(s.getLastRow()>1)return;
 [['2026-01-01','UG','New Year’s Day','national','NO'],['2026-01-26','UG','NRM Liberation Day','national','NO'],['2026-02-16','UG','Archbishop Janani Luwum Day','national','NO'],['2026-03-08','UG','International Women’s Day','international','NO'],['2026-04-03','UG','Good Friday','national','NO'],['2026-04-06','UG','Easter Monday','national','NO'],['2026-05-01','UG','Labour Day','national','NO'],['2026-06-03','UG','Martyrs Day','national','NO'],['2026-06-09','UG','National Heroes Day','national','NO'],['2026-12-25','UG','Christmas Day','national','NO'],['2026-12-26','UG','Boxing Day','national','NO']].forEach(r=>s.appendRow(r))
}

function normalizeAndImportContacts(){
 const ss=SpreadsheetApp.getActive(),imp=ss.getSheetByName(OCE.SHEETS.IMPORT),con=ss.getSheetByName(OCE.SHEETS.CONTACTS);if(imp.getLastRow()<2)throw Error('IMPORT is empty.');
 const imports=imp.getRange(2,1,imp.getLastRow()-1,17).getValues(),existing=con.getLastRow()>1?con.getRange(2,1,con.getLastRow()-1,22).getValues():[],map=new Map(),sup=getSuppressionSet_();
 existing.forEach((r,i)=>{let e=normalizeEmail_(r[3]);if(e)map.set(e,i+2)});
 let added=0,updated=0,skipped=0;
 imports.forEach(r=>{let email=normalizeEmail_(r[2]),consent=String(r[13]||'').trim().toUpperCase();if(!email||!isValidEmail_(email)||consent!=='YES'||sup.has(email)){skipped++;return}
 let rec=[Utilities.getUuid(),clean_(r[0]),clean_(r[1]),email,normalizePhone_(r[3]),clean_(r[4]),clean_(r[5]),clean_(r[6]),clean_(r[7]),clean_(r[8]),clean_(r[9]),clean_(r[10]),clean_(r[11]),r[12]||new Date(),'YES',r[14]||'',clean_(r[15]),'ACTIVE','','','','',clean_(r[16])];
 let row=map.get(email);if(row){let old=con.getRange(row,1,1,22).getValues()[0];rec[0]=old[0];rec[17]=old[17]||'ACTIVE';rec[18]=old[18];rec[20]=old[20];con.getRange(row,1,1,22).setValues([rec]);updated++}else{con.appendRow(rec);map.set(email,con.getLastRow());added++}});
 refreshDashboard();SpreadsheetApp.getUi().alert(`Import complete.\nAdded: ${added}\nUpdated: ${updated}\nSkipped: ${skipped}`)
}

function validateContacts(){
 const s=ssheet_(OCE.SHEETS.CONTACTS);if(s.getLastRow()<2)return;
 const rows=s.getRange(2,1,s.getLastRow()-1,22).getValues(),seen=new Set();
 rows.forEach(r=>{r[3]=normalizeEmail_(r[3]);r[4]=normalizePhone_(r[4]);let e=r[3],dup=e&&seen.has(e);if(e)seen.add(e);if(!e||!isValidEmail_(e))r[17]='INVALID';else if(dup)r[17]='DUPLICATE';else if(String(r[14]).toUpperCase()!=='YES')r[17]='NO_CONSENT';else if(String(r[17]).toUpperCase()!=='UNSUBSCRIBED')r[17]='ACTIVE'});
 s.getRange(2,1,rows.length,22).setValues(rows);refreshDashboard()
}

function buildCampaignQueue(){
 const settings=readSettings_();if(settings.SEND_ENABLED!=='TRUE')throw Error('Sending is OFF. Keep it OFF while testing.');
 const ss=SpreadsheetApp.getActive(),ca=ss.getSheetByName(OCE.SHEETS.CAMPAIGNS),co=ss.getSheetByName(OCE.SHEETS.CONTACTS),q=ss.getSheetByName(OCE.SHEETS.QUEUE);
 const cr=ca.getLastRow()>1?ca.getRange(2,1,ca.getLastRow()-1,11).getValues():[],campaign=cr.find(r=>String(r[5]).toUpperCase()==='ACTIVE');if(!campaign)throw Error('No ACTIVE campaign found.');
 const id=campaign[0],segment=campaign[4],size=Number(campaign[6])||Number(settings.BATCH_SIZE)||250,existing=q.getLastRow()>1?q.getRange(2,1,q.getLastRow()-1,9).getValues():[],queued=new Set(existing.filter(r=>r[1]===id).map(r=>r[2]));
 const rows=co.getLastRow()>1?co.getRange(2,1,co.getLastRow()-1,22).getValues():[],seg=segment?getSegment_(segment):null;
 const eligible=rows.filter(r=>r[0]&&r[3]&&String(r[14]).toUpperCase()==='YES'&&String(r[17]).toUpperCase()==='ACTIVE'&&!queued.has(r[0])&&(!seg||matchesSegment_(r,seg)));
 const out=eligible.map((r,i)=>[Utilities.getUuid(),id,r[0],r[3],Math.floor(i/size)+1,'PENDING',new Date(),'','']);if(out.length)q.getRange(q.getLastRow()+1,1,out.length,9).setValues(out);refreshDashboard()
}

function refreshDashboard(){
 const ss=SpreadsheetApp.getActive(),s=ss.getSheetByName(OCE.SHEETS.DASHBOARD),c=ss.getSheetByName(OCE.SHEETS.CONTACTS),q=ss.getSheetByName(OCE.SHEETS.QUEUE),l=ss.getSheetByName(OCE.SHEETS.LOG);if(!s)return;
 const cr=c.getLastRow()>1?c.getRange(2,1,c.getLastRow()-1,22).getValues():[],qr=q.getLastRow()>1?q.getRange(2,1,q.getLastRow()-1,9).getValues():[],lr=l.getLastRow()>1?l.getRange(2,1,l.getLastRow()-1,6).getValues():[];
 const m=[['OCE Version','1.3.0'],['Contacts',cr.length],['Active Contacts',cr.filter(r=>r[17]==='ACTIVE').length],['Consent YES',cr.filter(r=>String(r[14]).toUpperCase()==='YES').length],['Unsubscribed',cr.filter(r=>String(r[17]).toUpperCase()==='UNSUBSCRIBED').length],['Invalid',cr.filter(r=>String(r[17]).toUpperCase()==='INVALID').length],['Queued',qr.length],['Pending',qr.filter(r=>r[5]==='PENDING').length],['Sent',lr.filter(r=>r[4]==='SENT').length],['Errors',lr.filter(r=>r[4]==='ERROR').length]];
 s.clearContents();s.getRange(1,1,1,2).setValues([['Metric','Value']]).setFontWeight('bold');s.getRange(2,1,m.length,2).setValues(m);s.autoResizeColumns(1,2)
}

function pauseSending(){setSetting_('SEND_ENABLED','FALSE');SpreadsheetApp.getUi().alert('Sending paused.')}
function resumeSending(){setSetting_('SEND_ENABLED','TRUE');SpreadsheetApp.getUi().alert('Sending enabled. Verify campaign and queue first.')}
function installScheduler(){removeOCETriggers();ScriptApp.newTrigger('schedulerTick_').timeBased().everyHours(1).create();SpreadsheetApp.getUi().alert('Hourly scheduler installed.')}
function schedulerTick_(){const s=readSettings_();if(s.SEND_ENABLED!=='TRUE'||!withinWindow_(s)||blockedToday_(s))return;/* Delivery adapter intentionally disabled in V1.1/V1.2. */}
function removeOCETriggers(){ScriptApp.getProjectTriggers().forEach(t=>{if(t.getHandlerFunction()==='schedulerTick_')ScriptApp.deleteTrigger(t)})}

function getSegment_(id){const s=ssheet_(OCE.SHEETS.SEGMENTS);if(!s||s.getLastRow()<2)return null;const r=s.getRange(2,1,s.getLastRow()-1,7).getValues().find(x=>x[0]===id&&String(x[5]).toUpperCase()==='TRUE');return r?{field:r[2],operator:r[3],value:String(r[4])}:null}
function matchesSegment_(r,s){const m={first_name:r[1],last_name:r[2],email:r[3],phone:r[4],date_of_birth:r[5],gender:r[6],profession:r[7],organization:r[8],country:r[9],location:r[10],source:r[11]},a=String(m[s.field]||'').toLowerCase(),v=String(s.value||'').toLowerCase();if(s.operator==='=')return a===v;if(s.operator==='contains')return a.includes(v);if(s.operator==='starts_with')return a.startsWith(v);return false}
function getSuppressionSet_(){const s=ssheet_(OCE.SHEETS.SUPPRESSION),set=new Set();if(!s||s.getLastRow()<2)return set;s.getRange(2,1,s.getLastRow()-1,1).getValues().forEach(r=>{let e=normalizeEmail_(r[0]);if(e)set.add(e)});return set}
function readSettings_(){const s=ssheet_(OCE.SHEETS.SETTINGS),o={};if(!s||s.getLastRow()<2)return o;s.getRange(2,1,s.getLastRow()-1,2).getValues().forEach(r=>{if(r[0])o[r[0]]=String(r[1])});return o}
function setSetting_(k,v){const s=ssheet_(OCE.SHEETS.SETTINGS),r=s.getLastRow()>1?s.getRange(2,1,s.getLastRow()-1,2).getValues():[],i=r.findIndex(x=>x[0]===k);if(i<0)s.appendRow([k,v,'']);else s.getRange(i+2,2).setValue(v)}
function normalizeEmail_(v){return String(v||'').trim().toLowerCase()}
function isValidEmail_(e){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)}
function normalizePhone_(v){let s=String(v||'').trim().replace(/[^\d+]/g,'');if(s.startsWith('00'))s='+'+s.slice(2);if(/^07\d{8}$/.test(s))s='+256'+s.slice(1);return s}
function clean_(v){return String(v||'').trim().replace(/\s+/g,' ')}
function withinWindow_(s){const h=Number(Utilities.formatDate(new Date(),s.TIMEZONE||OCE.TIMEZONE,'H'));return h>=Number(s.SEND_HOUR_START||9)&&h<Number(s.SEND_HOUR_END||17)}
function blockedToday_(s){const tz=s.TIMEZONE||OCE.TIMEZONE,d=Number(Utilities.formatDate(new Date(),tz,'u'));if(s.BLOCK_WEEKENDS==='TRUE'&&(d===6||d===7))return true;if(s.BLOCK_HOLIDAYS!=='TRUE')return false;const today=Utilities.formatDate(new Date(),tz,'yyyy-MM-dd'),h=ssheet_(OCE.SHEETS.HOLIDAYS);return h&&h.getLastRow()>1&&h.getRange(2,1,h.getLastRow()-1,5).getValues().some(r=>String(r[0]).slice(0,10)===today&&String(r[4]).toUpperCase()==='NO')}
function ssheet_(name){const s=SpreadsheetApp.getActive().getSheetByName(name);if(!s)throw Error('Missing sheet: '+name);return s}
