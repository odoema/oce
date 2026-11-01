function upgradeOCE12(){
  const ss=SpreadsheetApp.getActive(),q=ss.getSheetByName('QUEUE'),l=ss.getSheetByName('SEND_LOG'),s=ss.getSheetByName('SETTINGS');
  if(!q||!l||!s)throw Error('Run Initialize / Repair Workbook first.');
  const qHeaders=q.getRange(1,1,1,Math.max(q.getLastColumn(),9)).getValues()[0];
  ['provider_message_id','attempt_count','last_attempt_at'].forEach(h=>{if(qHeaders.indexOf(h)<0)q.getRange(1,q.getLastColumn()+1).setValue(h)});
  const lHeaders=l.getRange(1,1,1,Math.max(l.getLastColumn(),6)).getValues()[0];
  if(lHeaders.indexOf('provider_message_id')<0)l.getRange(1,l.getLastColumn()+1).setValue('provider_message_id');
  const existing=s.getLastRow()>1?s.getRange(2,1,s.getLastRow()-1,2).getValues():[],keys=new Set(existing.map(r=>String(r[0])));
  [
    ['VERSION','1.2.0','OCE version'],
    ['DELIVERY_MODE','DRY_RUN','DRY_RUN, TEST or PRODUCTION'],
    ['ALLOW_PRODUCTION','FALSE','Production delivery lock; change only after validation'],
    ['REQUIRE_UNSUBSCRIBE','TRUE','Require unsubscribe/suppression controls before production'],
    ['MAX_BATCH_SIZE','250','Hard application batch ceiling']
  ].forEach(r=>{if(!keys.has(r[0]))s.appendRow(r)});
  SpreadsheetApp.getUi().alert('OCE V1.2 migration complete. Delivery remains in DRY_RUN and production is locked.');
}
