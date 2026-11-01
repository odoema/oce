/** OCE V1.2 delivery contract.
 * Provider credentials stay outside the repository and spreadsheet.
 */
function oceDeliveryMode_(){
  const s=readSettings_();
  return String(s.DELIVERY_MODE||'DRY_RUN').toUpperCase();
}

function oceDeliverySafetyCheck_(email){
  const mode=oceDeliveryMode_();
  const recipient=normalizeEmail_(email);
  if(mode==='DRY_RUN') return {ok:true,mode:mode};
  if(mode==='TEST'){
    const testRecipient=normalizeEmail_(PropertiesService.getScriptProperties().getProperty('OCE_TEST_RECIPIENT')||'');
    if(!testRecipient) throw Error('TEST mode requires OCE_TEST_RECIPIENT in Script Properties.');
    return {ok:recipient===testRecipient,mode:mode,reason:recipient===testRecipient?'':'TEST_RECIPIENT_ONLY'};
  }
  if(mode==='PRODUCTION'){
    const s=readSettings_();
    if(String(s.ALLOW_PRODUCTION||'FALSE').toUpperCase()!=='TRUE') throw Error('Production delivery is locked.');
    if(String(s.SEND_ENABLED||'FALSE').toUpperCase()!=='TRUE') throw Error('Global sending switch is OFF.');
    return {ok:true,mode:mode};
  }
  throw Error('Unknown DELIVERY_MODE: '+mode);
}

function oceBuildDeliveryRequest_(campaign,queueId,email){
  return {
    campaign_id:String(campaign[0]),
    subject:String(campaign[2]),
    body_html:String(campaign[3]),
    recipient:normalizeEmail_(email),
    idempotency_key:String(queueId)
  };
}

function oceDeliveryAdapterStatus(){
  const s=readSettings_();
  return {
    version:String(s.VERSION||OCE.VERSION),
    delivery_mode:oceDeliveryMode_(),
    send_enabled:String(s.SEND_ENABLED||'FALSE'),
    allow_production:String(s.ALLOW_PRODUCTION||'FALSE'),
    endpoint_configured:Boolean(PropertiesService.getScriptProperties().getProperty('OCE_DELIVERY_ENDPOINT')),
    test_recipient_configured:Boolean(PropertiesService.getScriptProperties().getProperty('OCE_TEST_RECIPIENT'))
  };
}
