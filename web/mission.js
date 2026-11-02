/* OCE Mission Control V1
 * LEGO block: one plain-language objective -> automatic discovery plan -> live progress.
 * Seeds are generated internally and never required from the operator.
 */
function mission$(id){return document.getElementById(id);}
function missionSetProgress(percent,stage,detail){const p=Math.max(0,Math.min(100,Math.round(percent)));mission$('missionProgressBar').style.width=p+'%';mission$('missionPercent').textContent=p+'%';mission$('missionStage').textContent=stage;mission$('missionDetail').textContent=detail||'';}
function missionShow(text,type){const el=mission$('missionStatus');el.textContent=text;el.className='mission-status '+(type||'');}
async function runMission(){
  const topic=mission$('missionTopic').value.trim();
  if(!topic){missionShow('Tell OCE what you want to find.','error');return;}
  const plan=ocePlanDiscovery(topic,{country:'UG',limit:6});
  const seeds=plan.seeds||[];
  mission$('missionRun').disabled=true;mission$('missionRun').textContent='Running…';
  missionShow('OCE has taken over. You do not need to provide a seed URL.','');missionSetProgress(4,'Understanding the mission','Converting your request into a discovery plan.');
  const discovered=[],seen=new Set();let opened=0,failed=0;
  try{
    missionSetProgress(10,'Selecting discovery sources',`${seeds.length} high-value public sources selected automatically.`);
    for(let i=0;i<seeds.length;i++){
      const seed=seeds[i];missionSetProgress(12+Math.round((i/Math.max(1,seeds.length))*28),'Discovering public sources',`Opening source ${i+1} of ${seeds.length}: ${seed.name}`);
      try{
        const endpoint=`${CONFIG.COLLECTOR_ENDPOINT}?url=${encodeURIComponent(seed.url)}`;const response=await fetch(endpoint,{method:'GET',redirect:'follow',cache:'no-store'});const payload=await response.json().catch(()=>null);
        if(!response.ok||!payload||!payload.ok)throw new Error((payload&&payload.error)||`HTTP ${response.status}`);opened++;
        const links=Array.isArray(payload.result&&payload.result.links)?payload.result.links:[];
        links.forEach(link=>{const url=scoutNormalizeUrl(link&&link.url);const label=String((link&&link.label)||'').trim();if(!url||seen.has(url)||!scoutIsCandidate(url))return;seen.add(url);discovered.push({url,source:seed.url,label,priority:scoutScore(url,topic,label),status:'QUEUED',discovered_at:new Date().toISOString(),depth:1});});
      }catch(_){failed++;}
    }
    missionSetProgress(50,'Expanding discovery',`Found ${discovered.length} candidate public pages from ${opened} accessible sources.`);
    const ranked=discovered.sort((a,b)=>b.priority-a.priority).slice(0,100);missionSetProgress(62,'Ranking sources',`Ranking ${ranked.length} candidate pages against “${topic}”.`);
    if(typeof scoutAddQueue==='function')scoutAddQueue(ranked.slice(0,50));
    missionSetProgress(72,'Discovery complete',`${ranked.length} candidate sources are ready for controlled collection.`);
    missionShow(`Mission discovery complete. ${ranked.length} sources prepared; ${failed} discovery sources were unavailable.`,'success');
  }catch(err){missionSetProgress(0,'Mission stopped',String(err.message||err));missionShow(String(err.message||err),'error');}
  finally{mission$('missionRun').disabled=false;mission$('missionRun').textContent='Start Discovery';}
}
document.addEventListener('DOMContentLoaded',()=>{const b=mission$('missionRun');if(b)b.onclick=runMission;const i=mission$('missionTopic');if(i)i.addEventListener('keydown',e=>{if(e.key==='Enter')runMission();});});
