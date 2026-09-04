(() => {
  "use strict";

  const cfg = window.APP_CONFIG || {};
  const API_URL = String(cfg.API_URL || "").trim();
  const API_KEY = String(cfg.API_KEY || "").trim();
  const POLL_MS = 3000;
  const PHASES = {
    1:{title:"Dick of the Day · nominaties",emoji:"💩"},
    2:{title:"Dick of the Day · finale",emoji:"💩"},
    3:{title:"Sexy Moment · nominaties",emoji:"🔥"},
    4:{title:"Sexy Moment · finale",emoji:"🔥"},
    5:{title:"Man of the Match · nominaties",emoji:"🏆"},
    6:{title:"Man of the Match · finale",emoji:"🏆"},
    7:{title:"Uitreiking",emoji:"🎉"}
  };

  const els={
    matchTitle:document.getElementById("match-title"),matchMeta:document.getElementById("match-meta"),statusPill:document.getElementById("status-pill"),message:document.getElementById("message"),pin:document.getElementById("admin-pin"),phaseOverview:document.getElementById("phase-overview"),previous:document.getElementById("previous-phase"),next:document.getElementById("next-phase"),closeVoting:document.getElementById("close-voting"),phaseNote:document.getElementById("phase-note"),phaseStep:document.getElementById("phase-step"),awardEmoji:document.getElementById("award-emoji"),awardTitle:document.getElementById("award-title"),awardHelp:document.getElementById("award-help"),stats:document.getElementById("live-stats"),form:document.getElementById("admin-vote-form"),options:document.getElementById("award-options"),voteButton:document.getElementById("vote-button")
  };

  let state={data:null,busy:false,posting:false};

  function randomId(prefix){const bytes=new Uint8Array(10);crypto.getRandomValues(bytes);return `${prefix}_${Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("")}`;}
  function browserId(){const key="athena_h2_admin_browser_id_v2";let id=localStorage.getItem(key);if(!id){id=randomId("admin");localStorage.setItem(key,id);}return id;}
  function votedKey(matchId,phase){return `athena_h2_admin_v2_voted_${matchId}_${phase}`;}
  function hasVoted(matchId,phase){return localStorage.getItem(votedKey(matchId,phase))==="1";}
  function markVoted(matchId,phase){localStorage.setItem(votedKey(matchId,phase),"1");}

  async function apiGet(params={},timeoutMs=7000){
    const url=new URL(API_URL);Object.entries({...params,_ts:Date.now()}).forEach(([k,v])=>url.searchParams.set(k,v));
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{const res=await fetch(url,{headers:API_KEY?{apikey:API_KEY}:{},signal:controller.signal,cache:"no-store"});const data=await res.json();if(!res.ok)throw new Error(data?.message||"Backendfout.");return data;}finally{clearTimeout(timer);}
  }

  async function apiPost(payload,timeoutMs=7000){
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{const res=await fetch(API_URL,{method:"POST",headers:{"Content-Type":"application/json",...(API_KEY?{apikey:API_KEY}:{})},body:JSON.stringify(payload),signal:controller.signal});const data=await res.json();if(!res.ok||data?.ok===false)throw new Error(data?.message||"Backendfout.");return data;}finally{clearTimeout(timer);}
  }

  function escapeHtml(value){return String(value).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");}
  function showMessage(text,good=false){els.message.textContent=text;els.message.classList.remove("hidden");els.message.classList.toggle("good-message",good);}
  function clearMessage(){els.message.classList.add("hidden");els.message.classList.remove("good-message");}
  function selectedPlayer(){return document.querySelector('input[name="admin-award"]:checked')?.value||"";}
  function currentDisplayPhase(data){return Number(data?.displayPhase||(data?.match?.status==="closed"?7:data?.phase||1));}

  function renderPhases(data){
    const current=currentDisplayPhase(data);els.phaseOverview.innerHTML="";
    Object.entries(PHASES).forEach(([num,meta])=>{const n=Number(num);const button=document.createElement("button");button.type="button";button.className=`phase-button${n===current?" active":""}${n===7?" ceremony-phase":""}`;button.textContent=`${n}. ${meta.title}`;button.disabled=state.busy||(n===7&&current!==6);button.addEventListener("click",()=>{if(n===7)closeVoting();else setPhase(n);});els.phaseOverview.appendChild(button);});
  }

  function renderOptions(data){
    const old=selectedPlayer();els.options.innerHTML="";if(data.match?.status==="closed")return;
    (data.choices||[]).forEach((name,index)=>{const id=`admin-option-${index}`;const wrap=document.createElement("div");wrap.className="option";wrap.innerHTML=`<input type="radio" id="${id}" name="admin-award" value="${escapeHtml(name)}"><label for="${id}">${escapeHtml(name)}</label>`;els.options.appendChild(wrap);});
    if(old){const match=Array.from(document.querySelectorAll('input[name="admin-award"]')).find(x=>x.value===old);if(match)match.checked=true;}
  }

  function renderStats(data){
    els.stats.innerHTML="";
    if(data.match?.status==="closed"){
      const awards=data.awards||{};
      [["💩 Dick of the Day",awards.dotd],["🔥 Sexy Moment",awards.sexy],["🏆 Man of the Match",awards.motm]].forEach(([label,award])=>{const row=document.createElement("div");row.className="stat-row";row.innerHTML=`<span>${label}<br><strong>${escapeHtml(award?.winner||"-")}</strong></span><strong>${Number(award?.votes||0)} stem${Number(award?.votes||0)===1?"":"men"}</strong>`;els.stats.appendChild(row);});return;
    }
    const stats=Array.isArray(data.choiceStats)?data.choiceStats.slice():[];stats.sort((a,b)=>Number(b.votes||0)-Number(a.votes||0));stats.forEach(row=>{const el=document.createElement("div");el.className="stat-row";el.innerHTML=`<span>${escapeHtml(row.player)}</span><strong>${Number(row.votes||0)} stem${Number(row.votes||0)===1?"":"men"}</strong>`;els.stats.appendChild(el);});if(!stats.length)els.stats.innerHTML='<p class="muted">Nog geen live stand beschikbaar.</p>';
  }

  function updateVoteButton(){const d=state.data;if(!d?.match)return els.voteButton.disabled=true;els.voteButton.disabled=state.posting||d.match.status!=="open"||d.ready===false||!selectedPlayer()||hasVoted(d.match.matchId,d.phase);}

  function render(data){
    state.data=data;const match=data.match;if(!match)return;const displayPhase=currentDisplayPhase(data);
    els.matchTitle.textContent=`${match.home} – ${match.away}`;els.matchMeta.textContent=`${match.date||""}${match.startTime&&match.startTime!=="00:00"?` · ${match.startTime}`:""}${match.venue?` · ${match.venue}`:""}`;
    els.statusPill.className=`pill ${match.status==="open"?"open":match.status==="closed"?"closed":""}`;els.statusPill.textContent=match.status==="closed"?"Uitreiking":(match.status==="open"?`Fase ${data.phase} open`:(match.statusLabel||match.status));
    els.phaseStep.textContent=displayPhase===7?"FASE 7 · UITREIKING":`FASE ${data.phase} VAN 6`;els.awardEmoji.textContent=PHASES[displayPhase]?.emoji||"🏑";els.awardTitle.textContent=PHASES[displayPhase]?.title||data.phaseTitle||"Fase";els.awardHelp.textContent=displayPhase===7?"De stemming is gesloten en de definitieve winnaars staan live.":`Live: ${Number(data.voteCount||0)} stemmen in deze fase.`;
    els.phaseNote.textContent=displayPhase===7?"Uitreiking actief. Klik op fase 6 als je de stemming opnieuw wilt openen.":data.ready===false?data.readyMessage:`Fase ${data.phase} is klaar om te stemmen.`;
    renderPhases(data);renderOptions(data);renderStats(data);els.form.classList.toggle("hidden",displayPhase===7);els.previous.disabled=state.busy||displayPhase<=1;els.next.disabled=state.busy||displayPhase>=7;els.closeVoting.disabled=state.busy||displayPhase!==6;els.closeVoting.classList.toggle("ready",displayPhase===6);const nextSpan=els.next.querySelector("span:first-child");if(nextSpan)nextSpan.textContent=displayPhase===6?"Naar uitreiking":"Volgende fase";updateVoteButton();
  }

  async function refresh(){try{const result=await apiGet({action:"config"});if(result?.ok)render(result);else showMessage(result?.message||"Backend kon niet worden geladen.");}catch(err){showMessage(err.message||"Backend kon niet worden geladen.");}}

  async function setPhase(targetPhase){
    const d=state.data,pin=els.pin.value.trim();if(!d?.match)return;if(!pin)return showMessage("Vul eerst je admin-pincode in.");state.busy=true;renderPhases(d);clearMessage();
    try{const result=await apiPost({action:"adminSetPhase",matchId:d.match.matchId,phase:targetPhase,pin});showMessage(result.message||`Fase ${targetPhase} is geopend.`,true);await refresh();}catch(err){showMessage(err.message||"Fase kon niet worden gewijzigd.");}finally{state.busy=false;if(state.data)render(state.data);}
  }

  async function closeVoting(){
    const d=state.data,pin=els.pin.value.trim();if(!d?.match)return;if(!pin)return showMessage("Vul eerst je admin-pincode in.");if(Number(d.phase)!==6||d.match.status==="closed")return;state.busy=true;clearMessage();
    try{await apiPost({action:"adminSetPhase",matchId:d.match.matchId,phase:7,pin});showMessage("Stemming gesloten. De uitreiking staat nu live op de gewone stemsite.",true);await refresh();}catch(err){showMessage(err.message||"Stemming kon niet worden afgesloten.");}finally{state.busy=false;if(state.data)render(state.data);}
  }

  async function submitVote(event){
    event.preventDefault();const d=state.data,player=selectedPlayer();if(!d?.match||!player||hasVoted(d.match.matchId,d.phase))return;state.posting=true;updateVoteButton();clearMessage();const submissionId=randomId(`admin_phase${d.phase}`);
    try{const result=await apiPost({action:"vote",submissionId,matchId:d.match.matchId,phase:d.phase,browserId:browserId(),player,clientTimestamp:new Date().toISOString()});markVoted(d.match.matchId,d.phase);showMessage(result.message||"Adminstem opgeslagen.",true);await refresh();}catch(err){showMessage(err.message||"Stem kon niet worden opgeslagen.");}finally{state.posting=false;updateVoteButton();}
  }

  els.previous.addEventListener("click",()=>{if(!state.data)return;const current=currentDisplayPhase(state.data);if(current===7)setPhase(6);else setPhase(Math.max(1,current-1));});
  els.next.addEventListener("click",()=>{if(!state.data)return;const current=currentDisplayPhase(state.data);if(current===6)closeVoting();else if(current<6)setPhase(current+1);});
  els.closeVoting.addEventListener("click",closeVoting);els.form.addEventListener("change",updateVoteButton);els.form.addEventListener("submit",submitVote);

  if(!/^https:\/\/[^/]+\.supabase\.co\/functions\/v1\//.test(API_URL)){showMessage("Supabase API ontbreekt in config.js.");}else{refresh();setInterval(refresh,POLL_MS);}
})();
