import { useState, useEffect, useRef } from "react";

const SK = "diabete-v5";
const VERSION = "v2.6";
const DEF = { tMin:0.9, tMax:1.8, ratioIC:10, fc:0.5, ciblePre:1.2, lenteHab:"", lenteHeure:"22:00", lenteNom:"" };
const MEALS = [
  { id:"breakfast", label:"Petit-dejeuner", tag:"Matin",  color:"#d97706" },
  { id:"lunch",     label:"Dejeuner",       tag:"Midi",   color:"#16a34a" },
  { id:"dinner",    label:"Diner",           tag:"Soir",   color:"#0284c7" },
];
const C = {
  bg:"#f7f3ef", card:"#fff", border:"#e8e0d8", text:"#2d2416", muted:"#8b7355",
  red:"#dc2626", green:"#16a34a", orange:"#d97706", blue:"#0284c7", purple:"#7c3aed"
};
function getHDRS(k){return{"Content-Type":"application/json","x-api-key":k,"anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"};}

function useStorage(){
  const [data,setData]=useState(null);
  const [ready,setReady]=useState(false);
  useEffect(()=>{
    try{
      const raw=localStorage.getItem(SK);
      if(raw){try{setData(JSON.parse(raw));}catch(e){setData({days:{},cfg:DEF});}}
      else setData({days:{},cfg:DEF});
    }catch(e){setData({days:{},cfg:DEF});}
    setReady(true);
  },[]);
  const save=(d)=>{setData(d);try{localStorage.setItem(SK,JSON.stringify(d));}catch(e){}};
  return [data||{days:{},cfg:DEF},save,ready];
}

const toISO=d=>d.toISOString().split("T")[0];
const TODAY=()=>toISO(new Date());
const nowTime=()=>new Date().toTimeString().slice(0,5);
const prevDay=iso=>toISO(new Date(new Date(iso+"T12:00:00").getTime()-86400000));
const fmtDay=s=>new Date(s+"T12:00:00").toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long"});
const fmtShort=s=>{const d=new Date(s+"T12:00:00");return{wd:d.toLocaleDateString("fr-FR",{weekday:"short"}).slice(0,3),day:d.getDate()};};
const f2b64=f=>new Promise((r,j)=>{const fr=new FileReader();fr.onload=()=>r(fr.result);fr.onerror=j;fr.readAsDataURL(f);});
// Compresse une image: redimensionne a max 800px et qualite JPEG 0.75 pour reduire les tokens IA
const compressImg=(file,maxSize)=>new Promise((resolve,reject)=>{
  const max=maxSize||800;
  const reader=new FileReader();
  reader.onload=e=>{
    const img=new Image();
    img.onload=()=>{
      let w=img.width,h=img.height;
      if(w>h && w>max){h=Math.round(h*max/w);w=max;}
      else if(h>=w && h>max){w=Math.round(w*max/h);h=max;}
      const canvas=document.createElement("canvas");
      canvas.width=w;canvas.height=h;
      const ctx=canvas.getContext("2d");
      ctx.drawImage(img,0,0,w,h);
      resolve(canvas.toDataURL("image/jpeg",0.75));
    };
    img.onerror=reject;
    img.src=e.target.result;
  };
  reader.onerror=reject;
  reader.readAsDataURL(file);
});
function glyColor(v,cfg){if(!v)return C.muted;const n=parseFloat(v),mn=(cfg||DEF).tMin,mx=(cfg||DEF).tMax;if(n<0.7)return C.red;if(n>=mn&&n<=mx)return C.green;if(n<=mx+0.3)return C.orange;return C.red;}
function glyLabel(v,cfg){if(!v)return "";const n=parseFloat(v),mn=(cfg||DEF).tMin,mx=(cfg||DEF).tMax;if(n<0.7)return "Hypo";if(n>=mn&&n<=mx)return "Dans la cible";if(n<mn)return "En dessous";if(n<=mx+0.3)return "Acceptable";return "Au-dessus";}

// Normalise la glycemie: 140 -> 1.40, 90 -> 0.90, 1.40 reste 1.40
function normalizeGly(raw) {
  if (raw === "" || raw === null || raw === undefined) return "";
  let s = String(raw).replace(",", ".").trim();
  let n = parseFloat(s);
  if (isNaN(n)) return raw;
  // Si > 20, c'est forcement en mg/dL (ex: 140) -> diviser par 100
  if (n > 20) return (n / 100).toFixed(2);
  return s;
}

function getClosestGly(curve,timeStr){if(!curve||!curve.length)return null;const[h,m]=timeStr.split(":").map(Number);const tMin=h*60+m;let best=null,bestDiff=Infinity;curve.forEach(p=>{const[ph,pm]=p.time.split(":").map(Number);const diff=Math.abs(ph*60+pm-tMin);if(diff<bestDiff&&diff<=30){bestDiff=diff;best=p;}});return best;}

function parseJSON(txt){
  if(!txt)return {};
  let s=txt.trim();
  const fence=String.fromCharCode(96,96,96);
  if(s.startsWith(fence)){const nl=s.indexOf("\n");if(nl>-1)s=s.slice(nl+1);}
  if(s.endsWith(fence)){const nl=s.lastIndexOf("\n");if(nl>-1)s=s.slice(0,nl);}
  s=s.trim();
  const a=s.indexOf("{");
  if(a===-1)return {resume:"Erreur. Relancez.",score_equilibre:5,recommandations:[]};
  // Essai 1: parsing direct du dernier } 
  try{const b=s.lastIndexOf("}");if(b>a)return JSON.parse(s.slice(a,b+1));}catch(_){}
  // Essai 2: reparer un JSON tronque en fermant les accolades/crochets ouverts
  try{
    let str=s.slice(a);
    let depth=0,inStr=false,esc=false,lastValid=-1;
    for(let i=0;i<str.length;i++){
      const ch=str[i];
      if(esc){esc=false;continue;}
      if(ch==="\\"){esc=true;continue;}
      if(ch==='"')inStr=!inStr;
      if(!inStr){if(ch==="{"||ch==="[")depth++;else if(ch==="}"||ch==="]"){depth--;if(depth===0)lastValid=i;}}
    }
    if(lastValid>0)return JSON.parse(str.slice(0,lastValid+1));
    // Tronque en plein milieu: fermer ce qui est ouvert
    let repaired=str;if(inStr)repaired+='"';
    // Construire la fermeture en respectant le type (array ou object) via une pile
    let stack=[],inStr2=false,esc2=false;
    for(let i=0;i<repaired.length;i++){const ch=repaired[i];if(esc2){esc2=false;continue;}if(ch==="\\"){esc2=true;continue;}if(ch==='"')inStr2=!inStr2;if(!inStr2){if(ch==="{")stack.push("}");else if(ch==="[")stack.push("]");else if(ch==="}"||ch==="]")stack.pop();}}
    // Retirer une virgule tra nante eventuelle
    repaired=repaired.replace(/,\s*$/,"");
    while(stack.length){repaired+=stack.pop();}
    return JSON.parse(repaired);
  }catch(_){return {resume:"Reponse trop longue ou incomplete. Relancez l analyse.",score_equilibre:null,recommandations:[]};}
}

async function aiGlucides(desc,apiKey){
  const prompt="Tu es un dieteticien expert. Estime les glucides: "+desc+". JSON: {total:number,confidence:string,items:[{name:string,glucides:number}],conseil:string}";
  let res;
  try{res=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:getHDRS(apiKey),
    body:JSON.stringify({model:"claude-sonnet-4-5",max_tokens:1000,messages:[{role:"user",content:prompt}]})});}
  catch(e){throw new Error("Connexion impossible: "+e.message);}
  if(!res.ok){let m="";try{const ed=await res.json();m=(ed.error&&ed.error.message)||"";}catch(_){}throw new Error("Erreur API "+res.status+(m?" - "+m:""));}
  let d;try{d=await res.json();}catch(e){throw new Error("Reponse illisible");}
  const r=parseJSON(((d.content&&d.content.find(c=>c.type==="text"))||{}).text||"{}");
  if(!r||!r.total)throw new Error("Reponse incomplete.");
  return r;
}

async function aiGlucidesPhoto(photoB64, desc, apiKey){
  // Extraire le media type et les donnees base64
  let mediaType="image/jpeg", data=photoB64;
  const m=String(photoB64).match(/^data:([^;]+);base64,(.+)$/);
  if(m){ mediaType=m[1]; data=m[2]; }
  const promptText="Tu es un dieteticien expert specialise dans le comptage des glucides pour personnes diabetiques. Analyse cette photo de repas"+(desc?" (contexte fourni par l utilisateur: "+desc+")":"")+". Identifie chaque aliment visible, estime les portions, et calcule les glucides. Sois precis et prudent: en cas de doute sur la portion, donne une fourchette dans le conseil. Reponds UNIQUEMENT en JSON brut valide sans texte autour: {total:number (glucides totaux en grammes),confidence:string (\"haute\"|\"moyenne\"|\"faible\"),items:[{name:string,glucides:number}],conseil:string (remarque sur les portions ou l incertitude)}";
  let res;
  try{
    res=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:getHDRS(apiKey),
      body:JSON.stringify({
        model:"claude-sonnet-4-5",
        max_tokens:1000,
        messages:[{role:"user",content:[
          {type:"image",source:{type:"base64",media_type:mediaType,data:data}},
          {type:"text",text:promptText}
        ]}]
      })});
  }catch(e){throw new Error("Connexion impossible: "+e.message);}
  if(!res.ok){let m2="";try{const ed=await res.json();m2=(ed.error&&ed.error.message)||"";}catch(_){}throw new Error("Erreur API "+res.status+(m2?" - "+m2:""));}
  let d;try{d=await res.json();}catch(e){throw new Error("Reponse illisible");}
  const r=parseJSON(((d.content&&d.content.find(c=>c.type==="text"))||{}).text||"{}");
  if(!r||r.total===undefined)throw new Error("Analyse photo incomplete. Reessayez avec une photo plus nette.");
  return r;
}

async function aiAnalyse(dayCtx,cfg,apiKey,ratios3j,situation){
  const lines=["Parametres: cible "+cfg.tMin+"-"+cfg.tMax+" g/L, ratio IC: 1UI/"+cfg.ratioIC+"g, FC: "+cfg.fc+" g/L/UI"];
  lines.push("Insuline lente: "+(cfg.lenteHab||"non renseignee")+" UI a "+(cfg.lenteHeure||"?"));
  lines.push("Journee: "+dayCtx.label);
  MEALS.forEach(m=>{
    const meal=dayCtx.meals&&dayCtx.meals[m.id];if(!meal)return;
    const gp=meal.glyManuelle||meal.glycemieAuto||meal.glyEffective;
    const di=parseFloat(meal.insulineRapide||0)+parseFloat(meal.bolusCorrection||0);
    const g=parseFloat(meal.glucides)||0;
    const ideal=g>0 ? g/cfg.ratioIC+(gp&&parseFloat(gp)>cfg.ciblePre ? (parseFloat(gp)-cfg.ciblePre)/cfg.fc : 0) : 0;
    lines.push(m.label+"("+meal.time+"): glucides="+g+"g gly_avant="+(gp||"?")+"g/L dose="+di.toFixed(1)+"UI ideal="+ideal.toFixed(1)+"UI");
  });
  const correctifs=dayCtx.correctifs||[];
  if(correctifs.length>0){lines.push("Correctifs:");correctifs.forEach(c=>lines.push(c.type+" "+c.time+": gly="+(c.gly||"?")+" g/L"+(c.units?" bolus="+c.units+"UI":"")+(c.glucides?" resucrage="+c.glucides+"g":"")+(c.note?" "+c.note:"")));  }
  const nightEvts=correctifs.filter(c=>{const h=parseInt((c.time||"12").split(":")[0]);return h>=22||h<=7;});
  const meals=MEALS.map(m=>dayCtx.meals&&dayCtx.meals[m.id]).filter(Boolean).sort((a,b)=>a.time.localeCompare(b.time));
  const firstGly=meals.length>0 ? (meals[0].glyManuelle||meals[0].glycemieAuto||meals[0].glyEffective) : null;
  lines.push("=== NOCTURNE ===");
  nightEvts.forEach(e=>lines.push("Nuit "+e.time+": "+e.type+" gly="+(e.gly||"?")+" g/L"+(e.units?" bolus="+e.units+"UI":"")+(e.glucides?" resucrage="+e.glucides+"g":"")));
  if(firstGly)lines.push("Glycemie lever: "+firstGly+" g/L (indicateur lente)");
  if(dayCtx.dexcomCurve&&dayCtx.dexcomCurve.length>0){
    const vals=dayCtx.dexcomCurve.map(p=>parseFloat(p.value));
    const avg=(vals.reduce((s,v)=>s+v,0)/vals.length).toFixed(2);
    const tir=Math.round(vals.filter(v=>v>=cfg.tMin&&v<=cfg.tMax).length/vals.length*100);
    lines.push("Dexcom: moy="+avg+" g/L tir="+tir+"%");
  }
  // === DONNEES BACKEND (calculs deterministes) ===
  if(ratios3j&&ratios3j.enough){
    lines.push("=== ANALYSE RATIOS SUR 3 JOURS (calcul backend, "+ratios3j.sampleCount+" repas analyses, sport exclu) ===");
    lines.push("Glycemie post-prandiale moyenne (+2h): "+ratios3j.avgPost+" g/L (cible "+ratios3j.ciblePost+")");
    lines.push("Tendance: "+ratios3j.tendance);
    if(ratios3j.icSuggere)lines.push("Ratio IC actuel: 1/"+ratios3j.icActuel+" -> suggere par les donnees: 1/"+ratios3j.icSuggere+" (variation "+(ratios3j.icChange>0?"+":"")+ratios3j.icChange+")");
    if(ratios3j.fcSuggere)lines.push("FC actuel: "+ratios3j.fcActuel+" -> suggere: "+ratios3j.fcSuggere+" (variation "+(ratios3j.fcChange>0?"+":"")+ratios3j.fcChange+")");
  } else if(ratios3j){
    lines.push("=== RATIOS 3J: donnees insuffisantes ("+(ratios3j.sampleCount||0)+" repas exploitables, il en faut au moins 2 sans sport) ===");
  }
  if(situation&&situation.enough){
    lines.push("=== SITUATION ACTUELLE DU PATIENT (7 jours, "+situation.nbMesures+" mesures) ===");
    lines.push("Glycemie moyenne: "+situation.moyenne+" g/L | Variabilite (CV): "+situation.cv+"% | TIR: "+situation.tir+"% | Temps <cible: "+situation.tBelow+"% | Temps >cible: "+situation.tAbove+"%");
    if(situation.schemas&&situation.schemas.length>0){lines.push("Schemas detectes:");situation.schemas.forEach(s=>lines.push("- "+s));}
    if(situation.live&&situation.live.value){
      const ageMin=situation.live.updatedAt?Math.round((Date.now()-situation.live.updatedAt)/60000):null;
      lines.push("GLYCEMIE LIVE MAINTENANT: "+situation.live.value+" g/L "+(situation.live.trend||"")+(ageMin!==null?" (il y a "+ageMin+" min)":""));
    }
    if(situation.correctionLive){
      const cl=situation.correctionLive;
      if(cl.type==="haut")lines.push("ACTION POSSIBLE: glycemie trop haute, bolus de correction calcule = "+cl.bolus+" UI (a valider)"+(cl.alerte?" - "+cl.alerte:""));
      else lines.push("ACTION POSSIBLE: glycemie trop basse, resucrage ~"+cl.resucrage+"g"+(cl.alerte?" - "+cl.alerte:""));
    }
  }
  const instr="\n=== MISSION ===\nTu es un diabetologue expert qui accompagne ce patient diabetique de type 1. La journee analysee peut etre EN COURS (incomplete) - c est normal, analyse ce qui est disponible sans exiger une journee complete.\n\nObjectifs par ordre de priorite:\n1. SITUATION ACTUELLE: commente la glycemie live. Si elle est trop haute, propose clairement le bolus de correction calcule (rappelle le chiffre). Si trop basse, conseille le resucrage. Indique quoi surveiller dans les prochaines heures.\n2. ANALYSE DES REPAS DEJA PRIS: pour chaque repas, compare dose injectee vs ideale. Si la glycemie post-prandiale (sur la courbe ~2h apres) est trop haute, explique que le repas etait soit plus sucre que prevu (glucides sous-estimes), soit l insuline insuffisante. Sois concret.\n3. Utilise les calculs backend (ratios 3j, TIR, schemas) comme base FACTUELLE - commente, ne recalcule pas.\n\nReponds en JSON brut valide: {resume (2-3 phrases sur la journee en cours ou passee),score_equilibre (0-10 ou null si journee trop incomplete),analyse_doses:[{repas,dose_injectee,dose_ideale,ecart,explication}],adaptation_ratios:{ratioIC_actuel,ratioIC_suggere,fc_actuel,fc_suggere,explication},analyse_nocturne:{bilan,suggestion_lente,risque_hypo_nuit},situation_actuelle:{bilan_global,point_immediat (action concrete MAINTENANT, avec le bolus de correction chiffre si gly haute),tendance_a_surveiller},recommandations:[string]}\n\nIMPORTANT: tes suggestions de doses/correction sont indicatives, le patient valide avec son jugement et son medecin. Ne propose jamais de changement brutal de ratio.";
  let res;
  try{res=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:getHDRS(apiKey),
    body:JSON.stringify({model:"claude-sonnet-4-5",max_tokens:2500,messages:[{role:"user",content:lines.join("\n")+instr}]})});}
  catch(e){throw new Error("Connexion impossible: "+e.message);}
  if(!res.ok){let m2="";try{const ed2=await res.json();m2=(ed2.error&&ed2.error.message)||"";}catch(_){}throw new Error("Erreur API "+res.status+(m2?" - "+m2:""));}
  let d2;try{d2=await res.json();}catch(e){throw new Error("Reponse illisible");}
  return parseJSON(((d2.content&&d2.content.find(c=>c.type==="text"))||{}).text||"{}");
}

function parseDexcomCSV(text){
  text=text.replace(/^\uFEFF/,"").replace(/\r\n/g,"\n").replace(/\r/g,"\n");
  const rows=text.split("\n").filter(r=>r.trim().length>0);
  if(rows.length<2)return{error:"Fichier vide."};
  const sample=rows.slice(0,10).join("\n");
  const delim=sample.split(";").length>sample.split(",").length ? ";" : ",";
  const split=line=>{const res=[],cur=[];let inq=false;for(let i=0;i<line.length;i++){const c=line[i];if(c==='"'){inq=!inq;continue;}if(c===delim&&!inq){res.push(cur.join("").trim());cur.length=0;continue;}cur.push(c);}res.push(cur.join("").trim());return res;};
  const tsKw=["timestamp","horodatage","date","heure","time"];
  const gluKw=["glucose","glyc"];
  let hdr=-1;
  for(let i=0;i<Math.min(rows.length,30);i++){const lo=rows[i].toLowerCase();if(tsKw.some(k=>lo.includes(k))&&gluKw.some(k=>lo.includes(k))){hdr=i;break;}if(lo.includes("mg/dl")||lo.includes("mmol")){hdr=i;break;}}
  if(hdr===-1){const dr=/\d{4}[-\/]\d{2}[-\/]\d{2}/;for(let i=0;i<rows.length-1;i++){if(dr.test(rows[i+1])&&!dr.test(rows[i])){hdr=i;break;}}}
  if(hdr===-1)return{error:"En-tete non trouve."};
  const hdrs=split(rows[hdr]).map(h=>h.toLowerCase().replace(/['"]/g,"").trim());
  let tsi=hdrs.findIndex(h=>tsKw.some(k=>h.includes(k)));
  let gli=hdrs.findIndex(h=>gluKw.some(k=>h.includes(k)));
  const evi=hdrs.findIndex(h=>h.includes("event")||h.includes("evenement"));
  if(tsi===-1||gli===-1){
    const dr2=/\d{4}[-\/]\d{2}[-\/]\d{2}/;
    for(let i=hdr+1;i<Math.min(hdr+15,rows.length);i++){
      const c=split(rows[i]);
      if(tsi===-1){const ti=c.findIndex(v=>dr2.test(v));if(ti>=0)tsi=ti;}
      if(gli===-1&&tsi>=0){const gi=c.findIndex((v,ci)=>{const n=parseFloat(v.replace(",","."));return !isNaN(n)&&n>1&&n<500&&ci!==tsi;});if(gi>=0)gli=gi;}
      if(tsi>=0&&gli>=0)break;
    }
  }
  if(tsi===-1||gli===-1)return{error:"Colonnes non trouvees. En-tetes: "+hdrs.join("|").slice(0,150)};
  const gh=hdrs[gli]||"";
  let unit=gh.includes("mmol") ? "mmol" : "mgdl";
  const samples=[];
  for(let i=hdr+1;i<Math.min(hdr+30,rows.length);i++){const c=split(rows[i]);if(c.length<=gli)continue;const v=parseFloat(c[gli].replace(",","."));if(!isNaN(v)&&v>0){samples.push(v);if(samples.length>=8)break;}}
  if(samples.length>0){const avg=samples.reduce((s,v)=>s+v,0)/samples.length;if(avg>20)unit="mgdl";else if(avg>2)unit="mmol";else unit="gl";}
  const toGL=raw=>{const v=parseFloat(raw.replace(",","."));if(isNaN(v))return null;if(unit==="mgdl")return(v/100).toFixed(2);if(unit==="mmol")return(v*0.018).toFixed(2);return v.toFixed(2);};
  const parseDate=ts=>{ts=ts.trim();let m=ts.match(/^(\d{4})[-\/](\d{2})[-\/](\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/);if(m)return new Date(m[1]+"-"+m[2]+"-"+m[3]+"T"+(m[4]||"12")+":"+(m[5]||"00")+":"+(m[6]||"00"));m=ts.match(/^(\d{2})[-\/](\d{2})[-\/](\d{4})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/);if(m)return new Date(m[3]+"-"+m[2]+"-"+m[1]+"T"+(m[4]||"12")+":"+(m[5]||"00")+":"+(m[6]||"00"));return null;};
  const byDay={};
  const dr3=/\d{4}[-\/]\d{2}[-\/]\d{2}|\d{2}[-\/]\d{2}[-\/]\d{4}/;
  for(let i=hdr+1;i<rows.length;i++){
    const row=rows[i].trim();if(!row)continue;
    const cols=split(row);if(cols.length<=Math.max(tsi,gli))continue;
    const ts=cols[tsi] ? cols[tsi].replace(/['"]/g,"") : "";if(!ts||!dr3.test(ts))continue;
    const rawGlu=cols[gli] ? cols[gli].replace(/['"]/g,"").trim() : "";if(!rawGlu||/low|high|faible|eleve/i.test(rawGlu))continue;
    if(evi>=0&&evi<cols.length&&cols[evi]){const ev=cols[evi].toLowerCase().replace(/['"]/g,"").trim();if(ev&&ev!=="egv"&&!ev.includes("glucose")&&!ev.includes("glyc")&&ev!=="")continue;}
    const gl=toGL(rawGlu);if(!gl)continue;const gf=parseFloat(gl);if(gf<0.3||gf>5.5)continue;
    const dt=parseDate(ts);if(!dt||isNaN(dt.getTime()))continue;
    const dk=toISO(dt),tm=dt.toTimeString().slice(0,5);
    if(!byDay[dk])byDay[dk]=[];
    byDay[dk].push({time:tm,value:gl,ts:dt.toISOString()});
  }
  if(Object.keys(byDay).length===0)return{error:"Aucune valeur extraite."};
  return byDay;
}

const FOOD_DB=[
  // Feculents / pain
  {kw:["pain","baguette","tartine"],g:15,def:2,unit:"tranche",label:"pain"},
  {kw:["pain complet","pain de mie","pain de seigle","pain aux cereales"],g:12,def:2,unit:"tranche",label:"pain complet"},
  {kw:["pain grille","biscotte"],g:8,def:2,unit:"piece",label:"biscotte"},
  {kw:["pates","spaghetti","macaroni","penne","tagliatelle","ravioli"],g:50,def:1,unit:"portion",label:"pates cuites"},
  {kw:["riz","risotto"],g:45,def:1,unit:"portion",label:"riz cuit"},
  {kw:["pomme de terre","patate","puree","gratin dauphinois"],g:30,def:1,unit:"portion",label:"pommes de terre"},
  {kw:["frites","pommes noisettes"],g:45,def:1,unit:"portion",label:"frites"},
  {kw:["semoule","couscous","boulgour"],g:45,def:1,unit:"portion",label:"semoule"},
  {kw:["quinoa"],g:40,def:1,unit:"portion",label:"quinoa"},
  {kw:["lentilles","haricots blancs","haricots rouges","pois chiches","flageolets"],g:30,def:1,unit:"portion",label:"legumineuses"},
  {kw:["cereales","muesli","corn flakes","granola"],g:30,def:1,unit:"bol",label:"cereales"},
  {kw:["porridge","flocons avoine"],g:25,def:1,unit:"bol",label:"porridge"},
  {kw:["polenta"],g:35,def:1,unit:"portion",label:"polenta"},
  // Viennoiseries / patisseries
  {kw:["croissant"],g:25,def:1,unit:"piece",label:"croissant"},
  {kw:["pain au chocolat","chocolatine"],g:30,def:1,unit:"piece",label:"pain au chocolat"},
  {kw:["pain aux raisins","chausson"],g:35,def:1,unit:"piece",label:"viennoiserie"},
  {kw:["brioche"],g:25,def:1,unit:"tranche",label:"brioche"},
  {kw:["biscuit","cookie","gateau sec","petit beurre"],g:8,def:2,unit:"piece",label:"biscuit"},
  {kw:["gateau","part de gateau","fondant"],g:35,def:1,unit:"part",label:"gateau"},
  {kw:["tarte","tarte aux pommes","tarte au citron"],g:40,def:1,unit:"part",label:"tarte"},
  {kw:["crepe","galette"],g:20,def:1,unit:"piece",label:"crepe"},
  {kw:["gaufre"],g:25,def:1,unit:"piece",label:"gaufre"},
  {kw:["pancake"],g:15,def:1,unit:"piece",label:"pancake"},
  {kw:["madeleine","financier"],g:12,def:1,unit:"piece",label:"madeleine"},
  {kw:["macaron"],g:10,def:1,unit:"piece",label:"macaron"},
  {kw:["eclair","religieuse"],g:30,def:1,unit:"piece",label:"patisserie"},
  // Sucre / sucreries
  {kw:["sucre","morceau de sucre"],g:5,def:1,unit:"morceau",label:"sucre"},
  {kw:["confiture","miel","pate a tartiner","nutella"],g:12,def:1,unit:"cuillere",label:"confiture"},
  {kw:["chocolat","carre de chocolat"],g:5,def:2,unit:"carre",label:"chocolat"},
  {kw:["bonbon","caramel"],g:5,def:3,unit:"piece",label:"bonbon"},
  {kw:["barre chocolatee","mars","snickers","kinder"],g:25,def:1,unit:"barre",label:"barre chocolatee"},
  {kw:["glace","creme glacee","sorbet"],g:20,def:1,unit:"boule",label:"glace"},
  // Fruits
  {kw:["pomme"],g:20,def:1,unit:"piece",label:"pomme"},
  {kw:["banane"],g:25,def:1,unit:"piece",label:"banane"},
  {kw:["orange","clementine","mandarine"],g:15,def:1,unit:"piece",label:"orange"},
  {kw:["poire"],g:20,def:1,unit:"piece",label:"poire"},
  {kw:["peche","nectarine","abricot"],g:12,def:1,unit:"piece",label:"peche"},
  {kw:["raisin","grappe"],g:25,def:1,unit:"portion",label:"raisin"},
  {kw:["fraise","framboise","myrtille","fruits rouges","mure"],g:10,def:1,unit:"portion",label:"fruits rouges"},
  {kw:["kiwi"],g:10,def:1,unit:"piece",label:"kiwi"},
  {kw:["ananas","mangue"],g:20,def:1,unit:"portion",label:"fruit exotique"},
  {kw:["melon","pasteque"],g:15,def:1,unit:"part",label:"melon"},
  {kw:["cerise"],g:15,def:1,unit:"portion",label:"cerises"},
  {kw:["prune","mirabelle"],g:10,def:2,unit:"piece",label:"prune"},
  {kw:["datte","figue"],g:15,def:2,unit:"piece",label:"datte"},
  {kw:["compote"],g:15,def:1,unit:"pot",label:"compote"},
  // Boissons
  {kw:["jus de fruit","jus d orange","jus de pomme","jus de raisin"],g:25,def:1,unit:"verre",label:"jus de fruit"},
  {kw:["soda","coca","limonade","ice tea","fanta","sprite"],g:25,def:1,unit:"verre",label:"boisson sucree"},
  {kw:["sirop","grenadine","menthe"],g:15,def:1,unit:"verre",label:"sirop"},
  {kw:["biere"],g:12,def:1,unit:"verre",label:"biere"},
  {kw:["vin"],g:3,def:1,unit:"verre",label:"vin"},
  {kw:["smoothie","milkshake"],g:30,def:1,unit:"verre",label:"smoothie"},
  // Laitiers
  {kw:["yaourt","yogourt","yaourt nature"],g:6,def:1,unit:"pot",label:"yaourt nature"},
  {kw:["yaourt aux fruits","yaourt sucre"],g:15,def:1,unit:"pot",label:"yaourt aux fruits"},
  {kw:["lait"],g:10,def:1,unit:"verre",label:"lait"},
  {kw:["fromage blanc","faisselle"],g:6,def:1,unit:"portion",label:"fromage blanc"},
  {kw:["creme dessert","danette","liegeois"],g:20,def:1,unit:"pot",label:"creme dessert"},
  {kw:["riz au lait","semoule au lait"],g:30,def:1,unit:"pot",label:"riz au lait"},
  // Plats
  {kw:["pizza"],g:30,def:2,unit:"part",label:"pizza"},
  {kw:["sandwich","casse-croute"],g:50,def:1,unit:"piece",label:"sandwich"},
  {kw:["burger","hamburger","cheeseburger"],g:40,def:1,unit:"piece",label:"burger"},
  {kw:["quiche","tarte salee"],g:25,def:1,unit:"part",label:"quiche"},
  {kw:["soupe","potage","veloute"],g:15,def:1,unit:"bol",label:"soupe"},
  {kw:["lasagne","gratin"],g:35,def:1,unit:"portion",label:"lasagne"},
  {kw:["hot dog"],g:35,def:1,unit:"piece",label:"hot dog"},
  {kw:["nems","samoussa","beignet"],g:15,def:2,unit:"piece",label:"beignet frit"},
  {kw:["tacos","wrap","kebab","galette"],g:45,def:1,unit:"piece",label:"tacos/wrap"},
  {kw:["sushi","maki"],g:8,def:6,unit:"piece",label:"sushi"},
  {kw:["pates carbonara","gratin de pates"],g:55,def:1,unit:"portion",label:"plat de pates"},
  // Legumes (faible glucide mais comptes)
  {kw:["mais","petits pois"],g:15,def:1,unit:"portion",label:"mais/petits pois"},
  {kw:["carotte","betterave"],g:8,def:1,unit:"portion",label:"carottes"},
  {kw:["soupe de legumes"],g:12,def:1,unit:"bol",label:"soupe legumes"},
];
const NUM_WORDS={un:1,une:1,deux:2,trois:3,quatre:4,cinq:5,six:6,sept:7,huit:8,demi:0.5};
function estimateCarbsLocal(text){
  const t=" "+text.toLowerCase().replace(/[,;]/g," ").replace(/\s+/g," ")+" ";
  const items=[],usedIdx=[];
  for(let fi=0;fi<FOOD_DB.length;fi++){
    if(usedIdx.indexOf(fi)>=0)continue;
    const food=FOOD_DB[fi];
    for(let ki=0;ki<food.kw.length;ki++){
      const kw=food.kw[ki];
      const idx=t.indexOf(" "+kw);
      if(idx===-1)continue;
      const before=t.slice(Math.max(0,idx-25),idx+1);
      let qty=food.def;
      const numM=before.match(/(\d+(?:[.,]\d+)?)\s*$/);
      if(numM)qty=parseFloat(numM[1].replace(",","."));
      else{const wkeys=Object.keys(NUM_WORDS);for(let wi=0;wi<wkeys.length;wi++){if(before.indexOf(" "+wkeys[wi]+" ")>=0){qty=NUM_WORDS[wkeys[wi]];break;}}}
      items.push({name:qty+"x "+food.label,glucides:Math.round(food.g*qty)});
      usedIdx.push(fi);break;
    }
  }
  const total=items.reduce((s,it)=>s+it.glucides,0);
  return{total,items,found:items.length>0};
}

function Pill({color,children}){return <span style={{background:"rgba(0,0,0,0.06)",color,border:"1px solid "+color,borderRadius:20,padding:"2px 10px",fontSize:11,fontWeight:700}}>{children}</span>;}
function PBtn({onClick,color,children,disabled,full,small}){return <button onClick={onClick} disabled={disabled} style={{width:full ? "100%" : "auto",padding:small ? "6px 12px" : "10px 18px",background:disabled ? "#ccc" : color,color:"white",border:"none",borderRadius:10,fontWeight:700,fontSize:small ? 12 : 14,cursor:disabled ? "not-allowed" : "pointer",fontFamily:"inherit"}}>{children}</button>;}
function OBtn({onClick,color,children,small}){return <button onClick={onClick} style={{padding:small ? "5px 12px" : "8px 16px",background:"transparent",color,border:"2px solid "+color,borderRadius:8,fontWeight:700,fontSize:small ? 12 : 13,cursor:"pointer",fontFamily:"inherit"}}>{children}</button>;}
function Lbl({children}){return <label style={{display:"block",color:C.muted,fontSize:11,fontWeight:700,marginBottom:4,textTransform:"uppercase",letterSpacing:0.5}}>{children}</label>;}
function TInput({value,onChange,onBlur,placeholder,type,step,min}){return <input type={type||"text"} value={value} onChange={e=>onChange(e.target.value)} onBlur={onBlur} placeholder={placeholder} step={step} min={min} style={{width:"100%",padding:"9px 12px",border:"1.5px solid "+C.border,borderRadius:8,fontSize:14,color:C.text,fontFamily:"inherit",outline:"none",boxSizing:"border-box",background:"white"}}/>;}
function TTime({value,onChange}){return <input type="time" value={value} onChange={e=>onChange(e.target.value)} style={{padding:"9px 12px",border:"1.5px solid "+C.border,borderRadius:8,fontSize:14,color:C.text,fontFamily:"inherit"}}/>;}

function DayCurve({pts,meals,cfg,width,height,winStart,winEnd}){
  if(!pts||pts.length<1)return null;
  const mn=(cfg||DEF).tMin,mx=(cfg||DEF).tMax;
  // Chaque point a un timestamp absolu (ts) et une heure (time)
  const toMin=p=>{const d=new Date(p.ts);return d.getTime();};
  // Fenetre temporelle: winStart/winEnd sont des timestamps absolus (ms)
  const allTs=pts.map(toMin);
  const wStart = winStart!==undefined ? winStart : Math.min(...allTs);
  const wEnd = winEnd!==undefined ? winEnd : Math.max(...allTs);
  // Filtrer les points dans la fenetre
  const inWin=pts.map((p,i)=>({p,ts:allTs[i],v:parseFloat(p.value)})).filter(x=>x.ts>=wStart&&x.ts<=wEnd&&!isNaN(x.v)&&!isNaN(x.ts)).sort((a,b)=>a.ts-b.ts);
  if(inWin.length<1)return(<div style={{padding:"20px",textAlign:"center",fontSize:12,color:C.muted}}>Aucune donnee sur cette periode</div>);
  const vals=inWin.map(x=>x.v);
  const minV=0.4,maxV=Math.max(3.2,Math.max(...vals)+0.3);
  const pL=32,pR=8,pT=10,pB=24,W=width-pL-pR,H=height-pT-pB;
  const span=(wEnd-wStart)||1;
  const tx=ts=>pL+((ts-wStart)/span)*W;
  const ty=v=>pT+(1-(v-minV)/(maxV-minV))*H;
  const ptStr=inWin.map(x=>tx(x.ts)+","+ty(x.v)).join(" ");
  // Graduations horaires
  const hourMarks=[];
  const startH=new Date(wStart);startH.setMinutes(0,0,0);
  const spanHours=span/3600000;
  const step=spanHours<=4 ? 1 : spanHours<=12 ? 2 : 3;
  for(let t=startH.getTime();t<=wEnd;t+=step*3600000){
    if(t>=wStart){const d=new Date(t);hourMarks.push({ts:t,label:d.getHours()+"h"});}
  }
  // Repas dans la fenetre
  const mM=meals ? Object.entries(meals).map(([mid,meal])=>{if(!meal||!meal.time)return null;
    // Reconstruire le ts du repas a partir de la date des points et l heure du repas
    const ref=new Date(inWin[0].ts);const[mh,mm]=meal.time.split(":").map(Number);
    const md=new Date(ref);md.setHours(mh,mm,0,0);let mts=md.getTime();
    if(mts<wStart)mts+=86400000;if(mts>wEnd)mts-=86400000;
    if(mts<wStart||mts>wEnd)return null;
    const mDef=MEALS.find(m=>m.id===mid);return{x:tx(mts),col:mDef ? mDef.color : C.orange,lbl:meal.glucides ? meal.glucides+"g" : ""};}).filter(Boolean) : [];
  return(<svg width={width} height={height} style={{display:"block"}}>
    <rect x={pL} y={ty(mx)} width={W} height={Math.abs(ty(mn)-ty(mx))} fill="rgba(22,163,74,0.08)"/>
    {[0.7,mn,mx,2.0].map(v=>(<g key={v}><line x1={pL} y1={ty(v)} x2={pL+W} y2={ty(v)} stroke={v===mn||v===mx ? "#16a34a55" : "#e5e7eb"} strokeWidth={v===mn||v===mx ? "1.5" : "1"} strokeDasharray="3,3"/><text x={pL-4} y={ty(v)+4} textAnchor="end" fontSize="9" fill="#9ca3af">{v}</text></g>))}
    {hourMarks.map((hm,i)=>(<g key={i}><line x1={tx(hm.ts)} y1={pT+H} x2={tx(hm.ts)} y2={pT+H+4} stroke="#d1d5db" strokeWidth="1"/><text x={tx(hm.ts)} y={pT+H+14} textAnchor="middle" fontSize="8" fill="#9ca3af">{hm.label}</text></g>))}
    {inWin.length>1&&<polyline points={ptStr} fill="none" stroke={C.blue} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round"/>}
    {inWin.length===1&&<circle cx={tx(inWin[0].ts)} cy={ty(inWin[0].v)} r="3" fill={C.blue}/>}
    {mM.map((m,i)=>(<g key={"m"+i}><polygon points={m.x+","+(pT+H-2)+" "+(m.x-5)+","+(pT+H-10)+" "+(m.x+5)+","+(pT+H-10)} fill={m.col} opacity="0.8"/>{m.lbl&&<text x={m.x} y={pT+H-12} textAnchor="middle" fontSize="8" fill={m.col}>{m.lbl}</text>}</g>))}
  </svg>);
}

function GlucidesAI({initDesc,onAccept,apiKey,photo:mealPhoto}){
  const [desc,setDesc]=useState(initDesc||"");
  const [res,setRes]=useState(null);
  const [aiRes,setAiRes]=useState(null);
  const [loading,setLoading]=useState(false);
  const [err,setErr]=useState(null);
  const [photo,setPhoto]=useState(mealPhoto||null);
  const photoRef=useRef();
  const estimate=()=>{if(!desc.trim())return;setErr(null);setAiRes(null);const r=estimateCarbsLocal(desc);if(!r.found){setRes({total:0,items:[],found:false});setErr("Aucun aliment reconnu. Essayez: pain, pates, riz, banane...");return;}setRes(r);};
  const enhance=async()=>{if(!apiKey){setErr("Cle API manquante. Ajoutez-la dans Parametres.");return;}setLoading(true);setErr(null);try{const r=await aiGlucides(desc,apiKey);setAiRes(r);}catch(e){setErr("IA indisponible ("+e.message+").");}finally{setLoading(false);}};
  const analysePhoto=async()=>{if(!apiKey){setErr("Cle API manquante. Ajoutez-la dans Parametres.");return;}if(!photo){setErr("Ajoutez d abord une photo du repas.");return;}setLoading(true);setErr(null);try{const r=await aiGlucidesPhoto(photo,desc,apiKey);setAiRes(r);}catch(e){setErr("Analyse photo impossible ("+e.message+").");}finally{setLoading(false);}};
  const active=aiRes||res;
  const confColor=c=>c==="haute" ? C.green : c==="faible" ? C.red : C.orange;
  return(<div style={{background:"#fff7ed",border:"1.5px solid "+C.orange,borderRadius:12,padding:16,marginTop:10}}>
    <div style={{fontWeight:700,color:C.orange,fontSize:13,marginBottom:8}}>Estimation des glucides</div>
    <textarea value={desc} onChange={e=>setDesc(e.target.value)} placeholder="Ex: 2 tranches de pain, 1 banane... (optionnel avec photo)" rows={2} style={{width:"100%",padding:"9px 12px",border:"1.5px solid "+C.border,borderRadius:8,fontSize:13,fontFamily:"inherit",resize:"vertical",boxSizing:"border-box",marginBottom:8}}/>
    {/* Zone photo */}
    <div style={{marginBottom:8}}>
      {photo ? (<div style={{position:"relative"}}>
        <img src={photo} alt="" style={{width:"100%",maxHeight:180,objectFit:"cover",borderRadius:8,border:"1.5px solid "+C.orange,display:"block",cursor:"pointer"}} onClick={()=>photoRef.current.click()}/>
        <button onClick={()=>setPhoto(null)} style={{position:"absolute",top:6,right:6,background:"rgba(0,0,0,0.6)",color:"white",border:"none",borderRadius:6,padding:"3px 8px",fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>Retirer</button>
      </div>) : (<div onClick={()=>photoRef.current.click()} style={{border:"2px dashed "+C.orange,borderRadius:10,padding:"14px",cursor:"pointer",textAlign:"center",background:"#fffbeb",fontSize:13,color:C.orange,fontWeight:600}}>Prendre / choisir une photo du repas</div>)}
      <input ref={photoRef} type="file" accept="image/*" capture="environment" style={{display:"none"}} onChange={async e=>{if(e.target.files[0]){setPhoto(await compressImg(e.target.files[0],800));setAiRes(null);}}}/>
    </div>
    {/* Boutons */}
    {photo ? (
      <PBtn onClick={analysePhoto} disabled={loading} color={C.orange} full>{loading ? "Analyse en cours..." : "Analyser la photo avec l IA"}</PBtn>
    ) : (
      <div style={{display:"flex",gap:8}}>
        <PBtn onClick={estimate} disabled={!desc.trim()} color={C.blue} full small>Estimer (local)</PBtn>
        <button onClick={enhance} disabled={loading||!desc.trim()} style={{padding:"6px 12px",background:"white",color:C.orange,border:"1.5px solid "+C.orange,borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit",whiteSpace:"nowrap"}}>{loading ? "..." : "+ IA"}</button>
      </div>
    )}
    {err&&<div style={{background:"#fffbeb",border:"1px solid #fcd34d",borderRadius:8,padding:"8px 10px",marginTop:8,fontSize:12,color:"#92400e"}}>{err}</div>}
    {active&&active.found!==false&&active.total!==undefined&&(<div style={{marginTop:10,background:"white",borderRadius:10,border:"1px solid "+C.border,overflow:"hidden"}}>
      <div style={{background:aiRes ? C.green : C.blue,padding:"8px 12px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span style={{color:"white",fontWeight:800,fontSize:20}}>{active.total+"g"}</span>
        <span style={{color:"white",fontSize:11}}>{aiRes ? (photo ? "IA photo" : "IA") : "local"}{aiRes&&active.confidence ? " - fiabilite "+active.confidence : ""}</span>
      </div>
      <div style={{padding:"10px 12px"}}>
        {active.items&&active.items.map((it,i)=><div key={i} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",borderBottom:"1px solid "+C.border,fontSize:12}}><span>{it.name}</span><span style={{fontWeight:700,color:C.blue}}>{it.glucides+"g"}</span></div>)}
        {active.conseil&&<div style={{marginTop:8,padding:"8px 10px",background:"#f0f9ff",borderRadius:8,fontSize:12,color:C.muted,lineHeight:1.4}}>{active.conseil}</div>}
        <div style={{marginTop:10}}><PBtn onClick={()=>onAccept(active.total)} color={C.green} full small>{"Utiliser "+active.total+"g"}</PBtn></div>
      </div>
    </div>)}
  </div>);
}

function MealBlock({meal,saved,onSave,onDelete,cfg,curve,apiKey,sportProfil}) {
  const [open,setOpen]=useState(false);
  const [time,setTime]=useState((saved&&saved.time)||nowTime());
  const [desc,setDesc]=useState((saved&&saved.desc)||"");
  const [glucides,setGlucides]=useState((saved&&saved.glucides)||"");
  const [glyMan,setGlyMan]=useState((saved&&saved.glyManuelle)||"");
  const [insulR,setInsulR]=useState((saved&&saved.insulineRapide)||"");
  const [bolus,setBolus]=useState((saved&&saved.bolusCorrection)||"");
  const [photo,setPhoto]=useState((saved&&saved.photo)||null);
  const [showAI,setShowAI]=useState(false);
  const [sportPrevu,setSportPrevu]=useState((saved&&saved.sportPrevu)||false);
  const [sportIntensite,setSportIntensite]=useState((saved&&saved.sportIntensite)||"modere");
  const ref=useRef();
  const glyAuto=curve ? getClosestGly(curve,time) : null;
  const glyEff=glyMan ? parseFloat(glyMan) : (glyAuto ? parseFloat(glyAuto.value) : null);
  // Reduction si sport prevu dans les 2h - personnalisee via l historique si dispo
  const sportDefaut={leger:0.20,modere:0.33,intense:0.50};
  const profilInt=sportProfil&&sportProfil[sportIntensite];
  const reducFactor=sportPrevu ? (profilInt ? profilInt.reduc : (sportDefaut[sportIntensite]||0)) : 0;
  const reducPersonnalisee=profilInt&&profilInt.personalized;
  const s=(cfg&&(glucides||glyEff)) ? (()=>{const g=parseFloat(glucides)||0;const brBase=g>0 ? g/cfg.ratioIC : 0;const bc=glyEff&&glyEff>cfg.ciblePre ? (glyEff-cfg.ciblePre)/cfg.fc : 0;const br=brBase*(1-reducFactor);return{br:br.toFixed(1),brBase:brBase.toFixed(1),bc:bc.toFixed(1),total:(br+bc).toFixed(1),reduc:reducFactor};})() : null;
  const totB=(parseFloat(insulR)||0)+(parseFloat(bolus)||0);
  const save=()=>{onSave({time,desc,glucides,glyManuelle:glyMan,insulineRapide:insulR,bolusCorrection:bolus,photo,glycemieAuto:glyAuto ? glyAuto.value : null,glyEffective:glyEff ? glyEff.toFixed(2) : null,doseSuggeree:s ? s.total : null,sportPrevu,sportIntensite:sportPrevu?sportIntensite:null});setOpen(false);};
  return(<div style={{borderRadius:14,border:"1.5px solid "+(saved ? meal.color : C.border),background:"white",marginBottom:10}}>
    <div onClick={()=>setOpen(!open)} style={{padding:"14px 16px",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
      <div style={{display:"flex",alignItems:"center",gap:10}}>
        <span style={{background:meal.color,color:"white",borderRadius:8,padding:"4px 10px",fontSize:12,fontWeight:700}}>{meal.tag}</span>
        <div>
          <div style={{fontWeight:700,color:C.text,fontSize:15}}>{meal.label}</div>
          {saved ? <div style={{fontSize:12,color:C.muted}}>{saved.time}{saved.desc ? " - "+saved.desc.slice(0,28) : ""}{saved.glucides&&<span style={{marginLeft:4,color:meal.color,fontWeight:700}}>{saved.glucides+"g"}</span>}{totB>0&&<span style={{marginLeft:4,color:C.red,fontWeight:700}}>{totB.toFixed(1)+" UI"}</span>}</div> : <div style={{fontSize:12,color:C.muted}}>Appuyer pour saisir</div>}
        </div>
      </div>
      <div style={{display:"flex",alignItems:"center",gap:8}}>{saved&&<Pill color={meal.color}>OK</Pill>}<span style={{color:C.muted}}>{open ? "^" : "v"}</span></div>
    </div>
    {open&&(<div style={{padding:"4px 16px 16px",borderTop:"1px solid "+C.border}}>
      <div style={{display:"grid",gridTemplateColumns:"110px 1fr",gap:12,marginBottom:14,alignItems:"end"}}>
        <div><Lbl>Heure</Lbl><TTime value={time} onChange={setTime}/></div>
        <div><Lbl>Description</Lbl><TInput value={desc} onChange={setDesc} placeholder={meal.label+"..."}/></div>
      </div>
      <div style={{background:"#faf5ff",border:"1.5px solid #c4b5fd",borderRadius:10,padding:"12px 14px",marginBottom:12}}>
        <div style={{fontWeight:700,color:C.purple,fontSize:12,marginBottom:8}}>Glycemie pre-prandiale</div>
        {glyAuto&&!glyMan&&<div style={{background:glyColor(glyAuto.value,cfg)+"11",border:"1px solid "+glyColor(glyAuto.value,cfg),borderRadius:8,padding:"7px 12px",marginBottom:8,display:"flex",justifyContent:"space-between"}}><span style={{fontSize:12,color:C.muted}}>{"Dexcom a "+glyAuto.time}</span><span style={{fontWeight:800,color:glyColor(glyAuto.value,cfg),fontSize:14}}>{glyAuto.value+" g/L"}</span></div>}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,alignItems:"end"}}>
          <div><Lbl>{glyAuto ? "Valeur manuelle (override)" : "Valeur (g/L)"}</Lbl><TInput type="number" value={glyMan} onChange={setGlyMan} onBlur={()=>setGlyMan(normalizeGly(glyMan))} placeholder={glyAuto ? glyAuto.value : "ex: 1.40"} min="0" step="0.01"/></div>
          <div>{glyEff&&<div style={{padding:"9px 12px",background:glyColor(glyEff.toFixed(2),cfg)+"22",border:"1.5px solid "+glyColor(glyEff.toFixed(2),cfg),borderRadius:8,textAlign:"center"}}><div style={{fontSize:10,color:C.muted}}>{glyMan ? "Manuelle" : "Dexcom"}</div><div style={{fontWeight:800,color:glyColor(glyEff.toFixed(2),cfg),fontSize:14}}>{glyEff.toFixed(2)+" g/L"}</div></div>}</div>
        </div>
        <div style={{marginTop:10}}><Lbl>Bolus de correction injecte (UI)</Lbl><TInput type="number" value={bolus} onChange={setBolus} placeholder="0" min="0" step="0.5"/></div>
      </div>
      <div style={{marginBottom:10}}>
        <Lbl>Photo du repas</Lbl>
        {photo ? <div><img src={photo} alt="" style={{maxHeight:160,maxWidth:"100%",borderRadius:8,border:"1px solid "+C.border,display:"block",cursor:"pointer"}} onClick={()=>ref.current.click()}/><button onClick={()=>setPhoto(null)} style={{fontSize:11,color:C.muted,background:"none",border:"none",cursor:"pointer",marginTop:4}}>Supprimer</button></div>
          : <div onClick={()=>ref.current.click()} style={{border:"2px dashed "+C.border,borderRadius:10,padding:"12px",cursor:"pointer",textAlign:"center",background:"#fafaf8",fontSize:13,color:C.muted}}>Ajouter une photo</div>}
        <input ref={ref} type="file" accept="image/*" capture="environment" style={{display:"none"}} onChange={async e=>{if(e.target.files[0])setPhoto(await compressImg(e.target.files[0],800));}}/>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 50px",gap:10,alignItems:"end",marginBottom:4}}>
        <div><Lbl>Glucides (g)</Lbl><TInput type="number" value={glucides} onChange={setGlucides} placeholder="0" min="0"/></div>
        <button onClick={()=>setShowAI(!showAI)} style={{padding:"9px 10px",background:showAI ? "#fff7ed" : "white",color:C.orange,border:"1.5px solid "+C.orange,borderRadius:8,cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"inherit",width:"100%"}}>IA</button>
      </div>
      {showAI&&<GlucidesAI initDesc={desc} onAccept={v=>{setGlucides(String(v));setShowAI(false);}} apiKey={apiKey} photo={photo}/>}
      {/* Sport prevu dans les 2h */}
      <div style={{marginTop:12,background:sportPrevu?"#ecfeff":"#fafaf8",border:"1.5px solid "+(sportPrevu?"#0891b2":C.border),borderRadius:10,padding:"10px 14px"}}>
        <label style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer"}}>
          <input type="checkbox" checked={sportPrevu} onChange={e=>setSportPrevu(e.target.checked)} style={{width:18,height:18,cursor:"pointer",accentColor:"#0891b2"}}/>
          <span style={{fontWeight:700,fontSize:13,color:sportPrevu?"#0891b2":C.text}}>Sport prevu dans les 2h ?</span>
        </label>
        {sportPrevu&&(<div style={{marginTop:10}}>
          <div style={{fontSize:11,color:C.muted,marginBottom:8}}>L intensite reduit le bolus repas pour eviter l hypo a l effort.{reducPersonnalisee?" Reduction personnalisee selon ton historique ("+profilInt.count+" seances, baisse ~"+profilInt.avgDropPerHour+" g/L/h).":""}</div>
          <div style={{display:"flex",gap:6}}>
            {[["leger","Leger"],["modere","Modere"],["intense","Intense"]].map(([k,l])=>{const pf=sportProfil&&sportProfil[k];const pct=pf?Math.round(pf.reduc*100):({leger:20,modere:33,intense:50})[k];return <button key={k} onClick={()=>setSportIntensite(k)} style={{flex:1,padding:"7px 4px",border:"2px solid "+(sportIntensite===k?"#0891b2":C.border),borderRadius:8,background:sportIntensite===k?"#0891b2":"transparent",color:sportIntensite===k?"white":C.muted,cursor:"pointer",fontWeight:700,fontSize:11,fontFamily:"inherit"}}>{l+" -"+pct+"%"}{pf&&pf.personalized?"*":""}</button>;})}
          </div>
        </div>)}
      </div>
      {s&&(<div style={{background:"#fef2f2",border:"1.5px solid #fca5a5",borderRadius:10,padding:"12px 14px",marginTop:12}}>
        <div style={{fontWeight:700,color:C.red,fontSize:12,marginBottom:8,display:"flex",justifyContent:"space-between",alignItems:"center"}}><span>Dose suggeree</span>{s.reduc>0&&<span style={{background:"#0891b2",color:"white",borderRadius:6,padding:"2px 8px",fontSize:10,fontWeight:700}}>{"Sport -"+Math.round(s.reduc*100)+"%"}</span>}</div>
        {s.reduc>0&&<div style={{fontSize:11,color:"#0891b2",marginBottom:8,background:"#ecfeff",borderRadius:6,padding:"6px 8px"}}>{"Bolus repas reduit de "+s.brBase+" a "+s.br+" UI (sport prevu). Surveillez la glycemie pendant et apres l effort."}</div>}
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6,marginBottom:8}}>
          {[["Bolus repas",s.br+" UI"],["Correction",s.bc+" UI"],["Total",s.total+" UI"]].map(([l,v])=><div key={l} style={{textAlign:"center",background:"white",borderRadius:6,padding:"6px 4px"}}><div style={{fontSize:10,color:C.muted}}>{l}</div><div style={{fontWeight:800,color:C.red,fontSize:14}}>{v}</div></div>)}
        </div>
        <button onClick={()=>{setInsulR(s.br);setBolus(s.bc);}} style={{width:"100%",padding:"6px",background:C.red,color:"white",border:"none",borderRadius:6,fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>Utiliser cette dose</button>
      </div>)}
      <div style={{marginTop:10,marginBottom:6}}>
        <div><Lbl>Bolus repas reellement injecte (UI)</Lbl><TInput type="number" value={insulR} onChange={setInsulR} placeholder="0" min="0" step="0.5"/></div>
      </div>
      {totB>0&&<div style={{background:"#fee2e2",borderRadius:8,padding:"6px 10px",fontSize:13,color:C.red,fontWeight:700,marginBottom:10}}>{"Total injecte: "+totB.toFixed(1)+" UI"}</div>}

      <div style={{display:"flex",gap:8,marginTop:12}}>
        <PBtn onClick={save} color={meal.color} full>Enregistrer</PBtn>
        {saved&&<OBtn onClick={()=>{onDelete();setOpen(false);}} color={C.red} small>Sup.</OBtn>}
      </div>
    </div>)}
  </div>);
}

function ActivityBlock({entries,onAdd,onDelete,cfg}){
  const [open,setOpen]=useState(false);
  const [type,setType]=useState("modere");
  const [activite,setActivite]=useState("");
  const [time,setTime]=useState(nowTime());
  const [duree,setDuree]=useState("");
  const [glyAvant,setGlyAvant]=useState("");
  const [note,setNote]=useState("");

  const INTENSITES=[
    {id:"leger",label:"Leger",color:C.green,desc:"marche, yoga, etirements"},
    {id:"modere",label:"Modere",color:C.orange,desc:"velo, natation, jogging"},
    {id:"intense",label:"Intense",color:C.red,desc:"course, HIIT, sport collectif"},
  ];
  const intDef=INTENSITES.find(i=>i.id===type)||INTENSITES[1];

  // Estimation de l'impact glycemique
  const dureeNum=parseFloat(duree)||0;
  const impactFactors={leger:0.15,modere:0.30,intense:0.45};
  const baisseEstimee=dureeNum>0 ? (impactFactors[type]*dureeNum/30).toFixed(2) : null;

  // Conseils selon glycemie avant sport
  let conseil=null;
  if(glyAvant){
    const g=parseFloat(glyAvant);
    if(g<1.0) conseil={type:"danger",txt:"Glycemie basse ! Resucrez-vous (15g) avant de commencer."};
    else if(g<1.5&&type!=="leger") conseil={type:"warn",txt:"Prenez une collation (15-20g) pour eviter l hypo pendant l effort."};
    else if(g>2.5) conseil={type:"warn",txt:"Glycemie elevee. Verifiez les cetones avant un effort intense."};
    else conseil={type:"ok",txt:"Glycemie adaptee pour demarrer l activite."};
  }

  const add=()=>{
    if(!time||!dureeNum)return;
    onAdd({id:Date.now()+"",type,activite,time,duree:dureeNum,glyAvant,baisseEstimee,note});
    setActivite("");setDuree("");setGlyAvant("");setNote("");
  };
  const sorted=[...entries].sort((a,b)=>a.time.localeCompare(b.time));

  return(<div style={{borderRadius:14,border:"1.5px solid "+(entries.length>0 ? "#0891b2" : C.border),background:entries.length>0 ? "#ecfeff" : "white",marginBottom:10}}>
    <div onClick={()=>setOpen(!open)} style={{padding:"14px 16px",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
      <div style={{display:"flex",alignItems:"center",gap:10}}>
        <span style={{background:"#0891b2",color:"white",borderRadius:8,padding:"4px 10px",fontSize:12,fontWeight:700}}>Sport</span>
        <div><div style={{fontWeight:700,color:C.text,fontSize:15}}>Activite physique</div>
          <div style={{fontSize:12,color:C.muted}}>{entries.length===0 ? "Impact sur la glycemie" : entries.length+" activite"+(entries.length>1 ? "s" : "")}</div>
        </div>
      </div><span style={{color:C.muted}}>{open ? "^" : "v"}</span>
    </div>
    {open&&(<div style={{padding:"4px 16px 16px",borderTop:"1px solid #cffafe"}}>
      {sorted.map(e=>{const id=INTENSITES.find(i=>i.id===e.type)||INTENSITES[1];return(<div key={e.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 10px",background:"white",borderRadius:8,marginBottom:6,border:"1px solid "+id.color+"44"}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}><span style={{background:id.color,color:"white",borderRadius:6,padding:"2px 8px",fontSize:11,fontWeight:700}}>{id.label}</span>
          <div><span style={{fontSize:13,fontWeight:600}}>{e.time}</span>{e.activite&&<span style={{marginLeft:6,fontSize:13}}>{e.activite}</span>}<span style={{marginLeft:6,fontSize:12,color:"#0891b2",fontWeight:700}}>{e.duree+" min"}</span>{e.baisseEstimee&&<span style={{marginLeft:6,fontSize:11,color:C.muted}}>{"~ -"+e.baisseEstimee+" g/L"}</span>}{e.note&&<span style={{marginLeft:6,fontSize:11,color:C.muted}}>{e.note}</span>}</div>
        </div><button onClick={()=>onDelete(e.id)} style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:16}}>x</button>
      </div>);})}
      <div style={{background:"white",borderRadius:10,padding:14,border:"1px solid "+C.border,marginTop:6}}>
        <div style={{display:"flex",gap:6,marginBottom:12}}>{INTENSITES.map(i=><button key={i.id} onClick={()=>setType(i.id)} style={{flex:1,padding:"8px 4px",border:"2px solid "+(type===i.id ? i.color : C.border),borderRadius:8,background:type===i.id ? i.color : "transparent",color:type===i.id ? "white" : C.muted,cursor:"pointer",fontWeight:700,fontSize:12,fontFamily:"inherit"}}>{i.label}</button>)}</div>
        <div style={{fontSize:11,color:C.muted,marginBottom:12,textAlign:"center"}}>{intDef.desc}</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
          <div><Lbl>Heure</Lbl><TTime value={time} onChange={setTime}/></div>
          <div><Lbl>Duree (min)</Lbl><TInput type="number" value={duree} onChange={setDuree} placeholder="ex: 45" min="0" step="5"/></div>
        </div>
        <div style={{marginBottom:10}}><Lbl>Activite (optionnel)</Lbl><TInput value={activite} onChange={setActivite} placeholder="ex: velo, natation..."/></div>
        <div style={{marginBottom:10}}><Lbl>Glycemie avant (g/L)</Lbl><TInput type="number" value={glyAvant} onChange={setGlyAvant} onBlur={()=>setGlyAvant(normalizeGly(glyAvant))} placeholder="ex: 1.40" min="0" step="0.01"/></div>
        {conseil&&<div style={{padding:"8px 12px",borderRadius:8,marginBottom:10,fontSize:12,fontWeight:600,background:conseil.type==="danger" ? "#fef2f2" : conseil.type==="warn" ? "#fffbeb" : "#f0fdf4",color:conseil.type==="danger" ? C.red : conseil.type==="warn" ? "#92400e" : C.green,border:"1px solid "+(conseil.type==="danger" ? "#fca5a5" : conseil.type==="warn" ? "#fcd34d" : "#86efac")}}>{conseil.txt}</div>}
        {baisseEstimee&&<div style={{background:"#ecfeff",border:"1px solid #67e8f9",borderRadius:8,padding:"8px 12px",marginBottom:10,fontSize:12,color:"#0891b2"}}>Baisse glycemique estimee: <strong>{"~ -"+baisseEstimee+" g/L"}</strong> (effet pendant et apres l effort). Surveillez le risque d hypo jusqu a plusieurs heures apres.</div>}
        <div style={{marginBottom:10}}><Lbl>Note</Lbl><TInput value={note} onChange={setNote} placeholder="ressenti, hypo pendant..."/></div>
        <PBtn onClick={add} disabled={!dureeNum} color={"#0891b2"} full>Ajouter l activite</PBtn>
      </div>
    </div>)}
  </div>);
}

function CorrectifBlock({entries,onAdd,onDelete,cfg}){
  const [open,setOpen]=useState(false);
  const [type,setType]=useState("bolus");
  const [time,setTime]=useState(nowTime());
  const [gly,setGly]=useState("");
  const [units,setUnits]=useState("");
  const [glucides,setGlucides]=useState("");
  const [note,setNote]=useState("");
  const TYPES=[{id:"bolus",label:"Bolus correctif",color:C.red,icon:"Bolus"},{id:"resucrage",label:"Resucrage",color:C.orange,icon:"Sucre"},{id:"extra",label:"Extra",color:C.purple,icon:"Extra"}];
  const typeDef=TYPES.find(t=>t.id===type)||TYPES[0];
  const corrSug=gly&&cfg ? (parseFloat(gly)>cfg.ciblePre ? ((parseFloat(gly)-cfg.ciblePre)/cfg.fc).toFixed(1) : null) : null;
  const add=()=>{if(!time)return;if(type==="bolus"&&!units)return;if((type==="resucrage"||type==="extra")&&!glucides)return;onAdd({id:Date.now()+"",type,time,gly,units,glucides,note});setGly("");setUnits("");setGlucides("");setNote("");};
  const sorted=[...entries].sort((a,b)=>a.time.localeCompare(b.time));
  return(<div style={{borderRadius:14,border:"1.5px solid "+(entries.length>0 ? C.red : C.border),background:entries.length>0 ? "#fff5f5" : "white",marginBottom:10}}>
    <div onClick={()=>setOpen(!open)} style={{padding:"14px 16px",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
      <div style={{display:"flex",alignItems:"center",gap:10}}>
        <span style={{background:C.red,color:"white",borderRadius:8,padding:"4px 10px",fontSize:12,fontWeight:700}}>+/-</span>
        <div><div style={{fontWeight:700,color:C.text,fontSize:15}}>Correctifs / Extra</div>
          <div style={{fontSize:12,color:C.muted}}>{entries.length===0 ? "Bolus, resucrage, extras" : entries.length+" evenement"+(entries.length>1 ? "s" : "")}</div>
        </div>
      </div><span style={{color:C.muted}}>{open ? "^" : "v"}</span>
    </div>
    {open&&(<div style={{padding:"4px 16px 16px",borderTop:"1px solid #fee2e2"}}>
      {sorted.map(e=>{const td=TYPES.find(t=>t.id===e.type)||TYPES[0];return(<div key={e.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 10px",background:"white",borderRadius:8,marginBottom:6,border:"1px solid "+td.color+"44"}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}><span style={{background:td.color,color:"white",borderRadius:6,padding:"2px 8px",fontSize:11,fontWeight:700}}>{td.icon}</span>
          <div><span style={{fontSize:13,fontWeight:600}}>{e.time}</span>{e.gly&&<span style={{marginLeft:6,fontSize:12,color:glyColor(e.gly,cfg),fontWeight:700}}>{"glyc. "+e.gly+" g/L"}</span>}{e.units&&<span style={{marginLeft:6,fontSize:12,color:C.red,fontWeight:700}}>{e.units+" UI"}</span>}{e.glucides&&<span style={{marginLeft:6,fontSize:12,color:C.orange,fontWeight:700}}>{e.glucides+"g"}</span>}{e.note&&<span style={{marginLeft:6,fontSize:11,color:C.muted}}>{e.note}</span>}</div>
        </div><button onClick={()=>onDelete(e.id)} style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:16}}>x</button>
      </div>);})}
      <div style={{background:"white",borderRadius:10,padding:14,border:"1px solid "+C.border,marginTop:6}}>
        <div style={{display:"flex",gap:6,marginBottom:12}}>{TYPES.map(t=><button key={t.id} onClick={()=>setType(t.id)} style={{flex:1,padding:"7px 4px",border:"2px solid "+(type===t.id ? t.color : C.border),borderRadius:8,background:type===t.id ? t.color : "transparent",color:type===t.id ? "white" : C.muted,cursor:"pointer",fontWeight:700,fontSize:11,fontFamily:"inherit"}}>{t.label}</button>)}</div>
        <div style={{display:"grid",gridTemplateColumns:"100px 1fr",gap:10,marginBottom:10}}>
          <div><Lbl>Heure</Lbl><TTime value={time} onChange={setTime}/></div>
          <div><Lbl>Glycemie (g/L)</Lbl><TInput type="number" value={gly} onChange={setGly} onBlur={()=>setGly(normalizeGly(gly))} placeholder="ex: 2.10" min="0" step="0.01"/></div>
        </div>
        {gly&&<div style={{padding:"8px 12px",background:glyColor(gly,cfg)+"11",border:"1px solid "+glyColor(gly,cfg),borderRadius:8,marginBottom:10,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span style={{fontSize:12,color:glyColor(gly,cfg),fontWeight:700}}>{glyLabel(gly,cfg)}</span>
          {corrSug&&type==="bolus"&&<span style={{fontSize:12,color:C.red}}>{"Correction: "}<strong>{corrSug+" UI"}</strong><button onClick={()=>setUnits(corrSug)} style={{marginLeft:8,padding:"2px 8px",background:C.red,color:"white",border:"none",borderRadius:6,fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>Utiliser</button></span>}
        </div>}
        {type==="bolus"&&<div style={{marginBottom:10}}><Lbl>Dose injectee (UI)</Lbl><TInput type="number" value={units} onChange={setUnits} placeholder="ex: 4" min="0" step="0.5"/></div>}
        {(type==="resucrage"||type==="extra")&&<div style={{marginBottom:10}}><Lbl>{type==="resucrage" ? "Glucides ingeres (g)" : "Glucides (g)"}</Lbl><TInput type="number" value={glucides} onChange={setGlucides} placeholder={type==="resucrage" ? "ex: 15" : "ex: 20"} min="0" step="1"/></div>}
        <div style={{marginBottom:10}}><Lbl>Note</Lbl><TInput value={note} onChange={setNote} placeholder="Ex: reveil 3h30 en hyper..."/></div>
        <PBtn onClick={add} disabled={type==="bolus" ? !units : !glucides} color={typeDef.color} full>{"Ajouter "+typeDef.label}</PBtn>
      </div>
    </div>)}
  </div>);
}


//    LIBREVIEW API                                                              
async function libreLogin(username, password) {
  // Try new API first, then fallback to old
  let r = await fetch("/api/dexcom", {method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({action:"libre_login",username,password})});
  let d = await r.json();
  if(d.error || !d.token) {
    // Fallback to old API
    r = await fetch("/api/dexcom", {method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({action:"libre_login",username,password})});
    d = await r.json();
    if(d.error) throw new Error(d.error);
  }
  return d;
}

async function libreGetConnections(token, accountId) {
  const r = await fetch("/api/dexcom", {method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({action:"libre_connections",token,accountId:accountId||""})});
  const d = await r.json();
  if(d.error) throw new Error(d.error);
  return d.connections || [];
}

async function libreGetReadings(token, patientId, region, accountId) {
  const r = await fetch("/api/dexcom", {method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({action:"libre_readings",token,patientId,region:region||"",accountId:accountId||""})});
  const d = await r.json();
  if(d.error && d.code==="TOKEN_EXPIRED") throw new Error("TOKEN_EXPIRED");
  if(d.error) throw new Error(d.error);
  return d;
}

async function libreGetHistory(token, patientId, region, accountId) {
  const r = await fetch("/api/dexcom", {method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({action:"libre_history",token,patientId,region:region||"",accountId:accountId||""})});
  const d = await r.json();
  if(d.error) throw new Error(d.error);
  return d.readings || [];
}

function groupReadingsByDay(readings) {
  const byDay = {};
  readings.forEach(p => {
    if(!p.ts) return;
    const dk = p.ts.slice(0,10);
    if(!byDay[dk]) byDay[dk] = [];
    byDay[dk].push(p);
  });
  // Trier chaque jour par timestamp et dedupliquer
  Object.keys(byDay).forEach(dk=>{
    const seen={};
    byDay[dk] = byDay[dk]
      .filter(p=>{if(seen[p.ts])return false;seen[p.ts]=1;return true;})
      .sort((a,b)=>a.ts.localeCompare(b.ts));
  });
  return byDay;
}

function LibreLive({allData, saveAll, cfg}) {
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState((allData.libreCreds&&allData.libreCreds.username)||"");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  const intervalRef = useRef(null);

  const creds = allData.libreCreds || null;
  const isConnected = !!(creds && creds.token && creds.patientId);

  const doSync = async(c) => {
    if(!c || !c.token || !c.patientId) return;
    try {
      const data = await libreGetReadings(c.token, c.patientId, c.region, c.accountId);
      const readings = data.readings || [];
      const current = data.current;
      const byDay = groupReadingsByDay(readings);
      const newDays = {...(allData.days||{})};
      Object.keys(byDay).forEach(dk => {
        newDays[dk] = {...(newDays[dk]||{}), dexcomCurve: byDay[dk]};
      });
      // La valeur "current" de l API est la plus fraiche - on l ajoute a la courbe du jour
      let liveGly = current;
      if(current && current.value) {
        const todayKey = TODAY();
        let curve = newDays[todayKey] && newDays[todayKey].dexcomCurve ? [...newDays[todayKey].dexcomCurve] : [];
        // current.ts si fourni par l API, sinon maintenant
        const curTs = current.ts || new Date().toISOString();
        // Eviter doublon: ne pas ajouter si un point existe deja a cette heure
        const exists = curve.some(p=>p.ts===curTs || (p.time===current.time && p.value===current.value));
        if(!exists) {
          curve.push({time:current.time||new Date(curTs).toTimeString().slice(0,5), value:current.value, ts:curTs, trend:current.trend||"->"});
        }
        // Re-trier pour garantir l ordre chronologique
        curve.sort((a,b)=>a.ts.localeCompare(b.ts));
        newDays[todayKey] = {...(newDays[todayKey]||{}), dexcomCurve:curve};
      }
      if(!liveGly && readings.length>0) {
        const last = readings[readings.length-1];
        liveGly = {value:last.value, trend:last.trend, time:last.time};
      }
      saveAll({...allData, days:newDays, libreCreds:c, liveGly:liveGly?{...liveGly,updatedAt:Date.now()}:null});
      setLastSync(new Date());
      setStatus({type:"ok", msg:readings.length+" mesures synchronisees"});
    } catch(e) {
      if(e.message==="TOKEN_EXPIRED") {
        setStatus({type:"error", msg:"Session expiree - reconnectez-vous"});
      } else {
        setStatus({type:"error", msg:"Erreur: "+e.message});
      }
    }
  };

  useEffect(() => {
    const cr = allData.libreCreds;
    if(cr && cr.token && cr.patientId) {
      doSync(cr);
      intervalRef.current = setInterval(() => {
        const latest = allData.libreCreds;
        if(latest && latest.token) doSync(latest);
      }, 5*60*1000);
    }
    return () => { if(intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  const connect = async() => {
    if(!username||!password) return;
    setLoading(true);
    setStatus({type:"info", msg:"Connexion a LibreView..."});
    try {
      const auth = await libreLogin(username, password);
      setStatus({type:"info", msg:"Recherche du capteur..."});

      // ALWAYS get patientId from connections (le compte suiveur voit le patient via la connexion)
      const conns = await libreGetConnections(auth.token, auth.accountId);
      if(!conns || conns.length === 0) {
        throw new Error("Aucun patient suivi. Utilisez le compte LibreLinkUp du PROCHE qui vous suit (ex: compte d Aline), pas votre compte patient.");
      }
      const pid = conns[0].id;
      const patientName = conns[0].name || "";

      const c = {token: auth.token, patientId: pid, username, name: patientName||auth.name||username, region: auth.region||"", accountId: auth.accountId||""};
      // Sync readings
      setStatus({type:"info", msg:"Recuperation des donnees..."});
      await doSync(c);
      saveAll({...allData, libreCreds: c, dexcomOAuth: undefined});
      setOpen(false);

      // Setup auto-refresh
      if(intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = setInterval(() => doSync(c), 5*60*1000);

    } catch(e) {
      setStatus({type:"error", msg:"Erreur: "+e.message});
    }
    setLoading(false);
  };

  const disconnect = () => {
    if(intervalRef.current) clearInterval(intervalRef.current);
    const nd = {...allData};
    delete nd.libreCreds;
    delete nd.liveGly;
    saveAll(nd);
    setStatus(null);
    setLastSync(null);
    setPassword("");
  };

  const todayCurve = allData.days&&allData.days[TODAY()]&&allData.days[TODAY()].dexcomCurve;
  const lastGly = todayCurve&&todayCurve.length>0 ? todayCurve[todayCurve.length-1] : null;

  return(
    <div style={{borderRadius:14,border:"2px solid "+(isConnected ? C.green : "#e040fb"),background:isConnected ? "#f0fdf4" : "#fdf4ff",marginBottom:12}}>
      <div onClick={()=>setOpen(!open)} style={{padding:"14px 16px",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <span style={{background:isConnected ? C.green : "#e040fb",color:"white",borderRadius:8,padding:"4px 10px",fontSize:12,fontWeight:700}}>{isConnected ? "LIVE" : "Libre"}</span>
          <div>
            <div style={{fontWeight:700,color:C.text,fontSize:15}}>FreeStyle Libre - Temps reel</div>
            <div style={{fontSize:12,color:C.muted}}>{isConnected ? (lastGly ? "Derniere: "+lastGly.value+" g/L "+lastGly.trend+(lastSync?" - sync "+lastSync.toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"}):"") : "Connecte") : "Connexion via votre compte LibreView"}</div>
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          {isConnected&&lastGly&&<span style={{fontWeight:800,fontSize:18,color:glyColor(lastGly.value,cfg)}}>{lastGly.value+" g/L"}</span>}
          {isConnected&&<button onClick={e=>{e.stopPropagation();doSync(creds);}} style={{padding:"4px 10px",background:C.green,color:"white",border:"none",borderRadius:6,fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>Sync</button>}
          <span style={{color:C.muted}}>{open ? "^" : "v"}</span>
        </div>
      </div>
      {open&&(<div style={{padding:"4px 16px 16px",borderTop:"1px solid #e9d5ff"}}>
        {!isConnected ? (<div>
          <div style={{background:"#f3e8ff",borderRadius:8,padding:"10px 12px",marginBottom:12,fontSize:12,color:"#7e22ce"}}>
            Utilisez vos identifiants <strong>LibreView</strong> (libreview.com) - les memes que l app FreeStyle LibreLink.
          </div>
          <div style={{marginBottom:10}}><Lbl>Email LibreView</Lbl><TInput value={username} onChange={setUsername} placeholder="votre@email.com"/></div>
          <div style={{marginBottom:12}}>
            <Lbl>Mot de passe</Lbl>
            <input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Mot de passe" style={{width:"100%",padding:"9px 12px",border:"1.5px solid "+C.border,borderRadius:8,fontSize:14,fontFamily:"inherit",boxSizing:"border-box"}}/>
          </div>
          <PBtn onClick={connect} disabled={loading||!username||!password} color={"#e040fb"} full>{loading ? "Connexion..." : "Se connecter a LibreView"}</PBtn>
        </div>) : (<div>
          <div style={{background:"#f0fdf4",border:"1px solid #86efac",borderRadius:8,padding:"10px 12px",marginBottom:12,fontSize:12,color:C.green}}>
            <strong>Connecte : </strong>{creds.name||creds.username}<br/>
            Synchro automatique toutes les 5 minutes.
          </div>
          {lastSync&&<div style={{fontSize:11,color:C.muted,marginBottom:10}}>{"Derniere synchro: "+lastSync.toLocaleString("fr-FR")}</div>}
          <div style={{display:"flex",gap:8}}>
            <PBtn onClick={()=>doSync(creds)} color={C.green} full>Synchroniser maintenant</PBtn>
            <button onClick={async()=>{const cr=allData.libreCreds;if(!cr||!cr.token){setStatus({type:"error",msg:"Pas de connexion Libre active. Reconnectez-vous."});return;}try{const r=await fetch("/api/dexcom",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"libre_debug",token:cr.token,patientId:cr.patientId,region:cr.region,accountId:cr.accountId})});const d=await r.json();setStatus({type:"info",msg:"DEBUG: "+d.connectionCount+" connexions. "+JSON.stringify(d.connectionsData).slice(0,300)});}catch(e){setStatus({type:"error",msg:"Debug err: "+e.message});}}} style={{padding:"8px 14px",background:"#475569",color:"white",border:"none",borderRadius:8,fontWeight:700,fontSize:12,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>Debug</button>
            <button onClick={async()=>{setStatus({type:"info",msg:"Recuperation historique..."});try{const h=await libreGetHistory(creds.token,creds.patientId,creds.region,creds.accountId);const byDay=groupReadingsByDay(h.readings||[]);const newDays={...(allData.days||{})};Object.keys(byDay).forEach(dk=>{newDays[dk]={...(newDays[dk]||{}),dexcomCurve:byDay[dk]};});saveAll({...allData,days:newDays});setStatus({type:"ok",msg:(h.count||0)+" mesures historiques importees"});}catch(e){setStatus({type:"error",msg:"Erreur: "+e.message});}}} style={{padding:"8px 16px",background:"#7e22ce",color:"white",border:"none",borderRadius:8,fontWeight:700,fontSize:12,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>Historique</button>
            <OBtn onClick={disconnect} color={C.red} small>Deconnecter</OBtn>
          </div>
        </div>)}
        {status&&<div style={{marginTop:10,padding:"8px 12px",borderRadius:8,fontSize:13,background:status.type==="error" ? "#fef2f2" : status.type==="ok" ? "#f0fdf4" : "#fdf4ff",color:status.type==="error" ? C.red : status.type==="ok" ? C.green : "#7e22ce",border:"1px solid "+(status.type==="error" ? "#fca5a5" : status.type==="ok" ? "#86efac" : "#e9d5ff")}}>{status.msg}</div>}
      </div>)}
    </div>
  );
}

function ConfigPanel({cfg,onSave,allData}){
  const [open,setOpen]=useState(false);
  const [tMin,setTMin]=useState(String(cfg.tMin));
  const [tMax,setTMax]=useState(String(cfg.tMax));
  const [ratio,setRatio]=useState(String(cfg.ratioIC));
  const [fc,setFc]=useState(String(cfg.fc));
  const [cible,setCible]=useState(String(cfg.ciblePre));
  const [lente,setLente]=useState(String(cfg.lenteHab||""));
  const [lenteH,setLenteH]=useState(String(cfg.lenteHeure||"22:00"));
  const [lenteN,setLenteN]=useState(String(cfg.lenteNom||""));
  const [apiKeyInput,setApiKeyInput]=useState(String(cfg.apiKey||""));
  const [rcResult,setRcResult]=useState(null);
  const [rcLoading,setRcLoading]=useState(false);
  const save=()=>{onSave({tMin:parseFloat(tMin)||0.9,tMax:parseFloat(tMax)||1.8,ratioIC:parseFloat(ratio)||10,fc:parseFloat(fc)||0.5,ciblePre:parseFloat(cible)||1.2,lenteHab:lente,lenteHeure:lenteH,lenteNom:lenteN,apiKey:apiKeyInput});setOpen(false);};
  const exG=80,exGp=parseFloat(tMax)+0.2;
  const exBR=(exG/(parseFloat(ratio)||10)).toFixed(1);
  const exBC=Math.max(0,(exGp-(parseFloat(cible)||1.2))/(parseFloat(fc)||0.5)).toFixed(1);
  return(<div style={{borderRadius:14,border:"1.5px solid "+C.muted,background:"white",marginBottom:12}}>
    <div onClick={()=>setOpen(!open)} style={{padding:"14px 16px",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
      <div style={{display:"flex",alignItems:"center",gap:10}}>
        <span style={{background:C.muted,color:"white",borderRadius:8,padding:"4px 10px",fontSize:12,fontWeight:700}}>Config</span>
        <div><div style={{fontWeight:700,color:C.text,fontSize:15}}>Mes parametres</div>
          <div style={{fontSize:12,color:C.muted}}>{"Cible: "+cfg.tMin+"-"+cfg.tMax+" | 1UI/"+cfg.ratioIC+"g | FC: "+cfg.fc}</div>
        </div>
      </div><span style={{color:C.muted}}>{open ? "^" : "v"}</span>
    </div>
    {open&&(<div style={{padding:"4px 16px 16px",borderTop:"1px solid "+C.border}}>
      <div style={{marginBottom:12}}>
        <div style={{fontWeight:700,fontSize:13,marginBottom:8}}>Fourchette cible (g/L)</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <div><Lbl>Minimum</Lbl><TInput type="number" value={tMin} onChange={setTMin} placeholder="0.9" step="0.1"/></div>
          <div><Lbl>Maximum</Lbl><TInput type="number" value={tMax} onChange={setTMax} placeholder="1.8" step="0.1"/></div>
        </div>
      </div>
      <div style={{marginBottom:12}}>
        <div style={{fontWeight:700,fontSize:13,marginBottom:8}}>Insuline rapide</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
          <div><Lbl>Ratio IC (g/UI)</Lbl><TInput type="number" value={ratio} onChange={setRatio} placeholder="10" step="1" min="1"/></div>
          <div><Lbl>Facteur correction</Lbl><TInput type="number" value={fc} onChange={setFc} placeholder="0.5" step="0.05" min="0.1"/></div>
        </div>
        <div><Lbl>Cible pre-repas (g/L)</Lbl><TInput type="number" value={cible} onChange={setCible} placeholder="1.2" step="0.1"/></div>
      </div>
      <div style={{marginBottom:12,background:"#eff6ff",borderRadius:10,padding:"12px 14px"}}>
        <div style={{fontWeight:700,color:C.blue,fontSize:12,marginBottom:8}}>Insuline lente</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:6}}>
          <div><Lbl>Dose (UI)</Lbl><TInput type="number" value={lente} onChange={setLente} placeholder="ex: 20" step="0.5"/></div>
          <div><Lbl>Heure</Lbl><TTime value={lenteH} onChange={setLenteH}/></div>
          <div><Lbl>Nom</Lbl><TInput value={lenteN} onChange={setLenteN} placeholder="Lantus..."/></div>
        </div>
      </div>
      <div style={{marginBottom:12}}>
        <Lbl>Cle API Anthropic (pour IA)</Lbl>
        <input type="password" value={apiKeyInput} onChange={e=>setApiKeyInput(e.target.value)} placeholder="sk-ant-..." style={{width:"100%",padding:"9px 12px",border:"1.5px solid "+(apiKeyInput ? C.green : C.border),borderRadius:8,fontSize:14,fontFamily:"inherit",boxSizing:"border-box"}}/>
        <div style={{fontSize:10,color:C.muted,marginTop:4}}>console.anthropic.com - stockee uniquement sur votre appareil</div>
      </div>
      <div style={{background:"#f0fdf4",border:"1px solid #86efac",borderRadius:8,padding:"8px 12px",marginBottom:12,fontSize:12}}>
        <strong style={{color:C.green}}>Exemple: </strong>{"repas "+exG+"g, glyc. "+exGp.toFixed(1)+" g/L -> "+exBR+" UI + "+exBC+" UI = "+(parseFloat(exBR)+parseFloat(exBC)).toFixed(1)+" UI"}
      </div>
      <PBtn onClick={save} color={C.green} full>Enregistrer</PBtn>
    </div>)}
  </div>);
}

// -- DEXCOM OFFICIAL API (OAuth) --
async function dexcomExchangeCode(code){
  const r=await fetch("/api/dexcom",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"exchange_code",code})});
  const d=await r.json();
  if(d.error)throw new Error(d.error);
  return d;
}
async function dexcomReadingsAPI(accessToken){
  const r=await fetch("/api/dexcom",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"readings",accessToken})});
  const d=await r.json();
  if(d.error&&d.code==="TOKEN_EXPIRED")throw new Error("TOKEN_EXPIRED");
  if(d.error)throw new Error(d.error);
  return d.readings||[];
}
async function dexcomRefreshAPI(refreshToken){
  const r=await fetch("/api/dexcom",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"refresh",refreshToken})});
  const d=await r.json();
  if(d.error)throw new Error(d.error);
  return d;
}
function dexTrend(t){
  const m={"flat":"->","fortyfiveup":"/->","singleup":"^","doubleup":"^^","fortyfivedown":"\\->","singledown":"v","doubledown":"vv","none":"","notcomputable":"","rateoutofrange":""};
  return m[String(t||"").toLowerCase()]||"->";
}
function egvsToPoints(egvs){
  return egvs.map(e=>{
    const dt=new Date(e.systemTime||e.displayTime);
    if(isNaN(dt))return null;
    const gl=(parseFloat(e.value)/100).toFixed(2);
    return{time:dt.toTimeString().slice(0,5),value:gl,ts:dt.toISOString(),trend:dexTrend(e.trend)};
  }).filter(Boolean).sort((a,b)=>a.ts.localeCompare(b.ts));
}
function groupByDay(points){
  const byDay={};
  points.forEach(p=>{const dk=p.ts.slice(0,10);if(!byDay[dk])byDay[dk]=[];byDay[dk].push(p);});
  return byDay;
}

function DexcomLive({allData,saveAll,cfg}){
  const [open,setOpen]=useState(false);
  const [status,setStatus]=useState(null);
  const [loading,setLoading]=useState(false);
  const [lastSync,setLastSync]=useState(null);
  const intervalRef=useRef(null);

  const creds=allData.dexcomOAuth||null;
  const isConnected=!!(creds&&creds.accessToken);

  const doSync=async(tokens)=>{
    if(!tokens || !tokens.accessToken) return;
    try{
      let tkns=tokens;
      if(tkns.expiresAt&&Date.now()>tkns.expiresAt-60000){
        const refreshed=await dexcomRefreshAPI(tkns.refreshToken);
        tkns={...tkns,...refreshed};
        saveAll({...allData,dexcomOAuth:tkns});
      }
      const egvs=await dexcomReadingsAPI(tkns.accessToken);
      const points=egvsToPoints(egvs);
      const byDay=groupByDay(points);
      const newDays={...(allData.days||{})};
      Object.keys(byDay).forEach(dk=>{newDays[dk]={...(newDays[dk]||{}),dexcomCurve:byDay[dk]};});
      let liveGly=null;
      if(points.length>0){const last=points[points.length-1];liveGly={value:last.value,trend:last.trend||"->",time:last.time,updatedAt:Date.now()};}
      saveAll({...allData,days:newDays,dexcomOAuth:tkns,liveGly});
      setLastSync(new Date());
      setStatus({type:"ok",msg:points.length+" mesures synchronisees"+(points.length===0?" (verifiez debug dans console)":"")});
    }catch(e){
      if(e.message==="TOKEN_EXPIRED"){
        try{const refreshed=await dexcomRefreshAPI(tokens.refreshToken);const tkns={...tokens,...refreshed};saveAll({...allData,dexcomOAuth:tkns});await doSync(tkns);}
        catch(e2){setStatus({type:"error",msg:"Session expiree - reconnectez-vous"});}
      }else{setStatus({type:"error",msg:"Erreur: "+e.message});}
    }
  };

  useEffect(()=>{
    const params=new URLSearchParams(window.location.search);
    const code=params.get("code");
    const error=params.get("error");
    if(error){
      setStatus({type:"error",msg:"Erreur Dexcom: "+error});
      window.history.replaceState({},"","/");
      return;
    }
    if(code){
      window.history.replaceState({},"","/");
      setStatus({type:"info",msg:"Connexion en cours..."});
      dexcomExchangeCode(code).then(tkns=>{
        saveAll({...allData,dexcomOAuth:tkns,libreCreds:undefined});
        setStatus({type:"ok",msg:"Connecte ! Synchronisation en cours..."});
        setTimeout(()=>doSync(tkns),500);
      }).catch(e=>{
        setStatus({type:"error",msg:"Erreur echange: "+e.message});
      });
    }
  },[]);

  useEffect(()=>{
    if(creds&&creds.accessToken){
      doSync(creds);
      intervalRef.current=setInterval(()=>doSync(creds),5*60*1000);
    }
    return()=>{if(intervalRef.current)clearInterval(intervalRef.current);};
  },[]);

  const connect=(e)=>{
    if(e) e.stopPropagation();
    window.location.replace("/api/dexcom-auth");
  };

  const disconnect=()=>{
    if(intervalRef.current)clearInterval(intervalRef.current);
    const nd={...allData};delete nd.dexcomOAuth;delete nd.liveGly;
    saveAll(nd);setStatus(null);setLastSync(null);
  };

  const liveGly=allData.liveGly||null;
  const todayCurve=allData.days&&allData.days[TODAY()]&&allData.days[TODAY()].dexcomCurve;
  const lastGly=liveGly||(todayCurve&&todayCurve.length>0 ? todayCurve[todayCurve.length-1] : null);
  const trendArrow={"flat":"->","fortyfiveup":"/->","singleup":"^","doubleup":"^^","fortyfivedown":"\->","singledown":"v","doubledown":"vv"};

  return(<div style={{borderRadius:14,border:"2px solid "+(isConnected ? C.green : C.blue),background:isConnected ? "#f0fdf4" : "#eff6ff",marginBottom:12}}>
    <div onClick={()=>setOpen(!open)} style={{padding:"14px 16px",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
      <div style={{display:"flex",alignItems:"center",gap:10}}>
        <span style={{background:isConnected ? C.green : C.blue,color:"white",borderRadius:8,padding:"4px 10px",fontSize:12,fontWeight:700}}>{isConnected ? "LIVE" : "Dexcom"}</span>
        <div>
          <div style={{fontWeight:700,color:C.text,fontSize:15}}>Dexcom ONE+ - Temps reel</div>
          <div style={{fontSize:12,color:C.muted}}>{isConnected ? (lastGly ? "Derniere valeur: "+lastGly.value+" g/L "+(trendArrow[lastGly.trend.toLowerCase()]||"")+(lastSync ? " - sync "+lastSync.toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"}) : "") : "Connecte - en attente") : "Connexion via compte Dexcom officiel"}</div>
        </div>
      </div>
      <div style={{display:"flex",alignItems:"center",gap:8}}>
        {isConnected&&lastGly&&<span style={{fontWeight:800,fontSize:18,color:glyColor(lastGly.value,cfg)}}>{lastGly.value+" g/L"}</span>}
        {isConnected&&<button onClick={e=>{e.stopPropagation();doSync(creds);}} style={{padding:"4px 10px",background:C.green,color:"white",border:"none",borderRadius:6,fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>Sync</button>}
        <span style={{color:C.muted}}>{open ? "^" : "v"}</span>
      </div>
    </div>
    {open&&(<div style={{padding:"4px 16px 16px",borderTop:"1px solid "+(isConnected ? "#86efac" : "#bfdbfe")}}>
      {!isConnected ? (<div>
        <div style={{background:"#dbeafe",borderRadius:8,padding:"10px 12px",marginBottom:14,fontSize:12,color:C.blue}}>
          Connexion securisee via le site officiel Dexcom.<br/>
          Vous serez redirige vers Dexcom pour autoriser l acces.
        </div>
        <a href={"https://sandbox-api.dexcom.com/v2/oauth2/login?client_id=imBRNfG7CkjAFA0pbdgrXnxUZlIOvNw6&redirect_uri="+encodeURIComponent("https://diab2-one.vercel.app/")+"&response_type=code&scope=offline_access"} onClick={e=>e.stopPropagation()} style={{display:"block",width:"100%",padding:"10px 18px",background:C.blue,color:"white",border:"none",borderRadius:10,fontWeight:700,fontSize:14,cursor:"pointer",fontFamily:"inherit",textAlign:"center",textDecoration:"none",boxSizing:"border-box"}}>Se connecter avec Dexcom</a>
      </div>) : (<div>
        <div style={{background:"#f0fdf4",border:"1px solid #86efac",borderRadius:8,padding:"10px 12px",marginBottom:12,fontSize:12,color:C.green}}>
          <strong>Connecte a Dexcom ONE+</strong><br/>Synchro automatique toutes les 5 minutes.
        </div>
        {lastSync&&<div style={{fontSize:11,color:C.muted,marginBottom:10}}>{"Derniere synchro: "+lastSync.toLocaleString("fr-FR")}</div>}
        <div style={{display:"flex",gap:8}}>
          <PBtn onClick={()=>doSync(creds)} color={C.green} full>Synchroniser maintenant</PBtn>
            <button onClick={async()=>{const cr=allData.libreCreds;if(!cr||!cr.token){setStatus({type:"error",msg:"Pas de connexion Libre active. Reconnectez-vous."});return;}try{const r=await fetch("/api/dexcom",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"libre_debug",token:cr.token,patientId:cr.patientId,region:cr.region,accountId:cr.accountId})});const d=await r.json();setStatus({type:"info",msg:"DEBUG: "+d.connectionCount+" connexions. "+JSON.stringify(d.connectionsData).slice(0,300)});}catch(e){setStatus({type:"error",msg:"Debug err: "+e.message});}}} style={{padding:"8px 14px",background:"#475569",color:"white",border:"none",borderRadius:8,fontWeight:700,fontSize:12,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>Debug</button>
            <button onClick={async()=>{setStatus({type:"info",msg:"Recuperation historique..."});try{const h=await libreGetHistory(creds.token,creds.patientId,creds.region,creds.accountId);const byDay=groupReadingsByDay(h.readings||[]);const newDays={...(allData.days||{})};Object.keys(byDay).forEach(dk=>{newDays[dk]={...(newDays[dk]||{}),dexcomCurve:byDay[dk]};});saveAll({...allData,days:newDays});setStatus({type:"ok",msg:(h.count||0)+" mesures historiques importees"});}catch(e){setStatus({type:"error",msg:"Erreur: "+e.message});}}} style={{padding:"8px 16px",background:"#7e22ce",color:"white",border:"none",borderRadius:8,fontWeight:700,fontSize:12,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>Historique</button>
          <OBtn onClick={disconnect} color={C.red} small>Deconnecter</OBtn>
        </div>
      </div>)}
      {status&&<div style={{marginTop:10,padding:"8px 12px",borderRadius:8,fontSize:13,background:status.type==="error" ? "#fef2f2" : "#f0fdf4",color:status.type==="error" ? C.red : C.green,border:"1px solid "+(status.type==="error" ? "#fca5a5" : "#86efac")}}>{status.msg}</div>}
    </div>)}
  </div>);
}


function ClarityImporter({allData,saveAll}){
  const [open,setOpen]=useState(false);
  const [parsed,setParsed]=useState(null);
  const [status,setStatus]=useState(null);
  const [imported,setImported]=useState(false);
  const ref=useRef();
  const handleFile=file=>{setStatus(null);setParsed(null);setImported(false);const reader=new FileReader();reader.onload=e=>{const result=parseDexcomCSV(e.target.result);if(!result){setStatus({type:"error",msg:"Format non reconnu."});return;}if(result.error){setStatus({type:"error",msg:result.error});return;}const dc=Object.keys(result).length,pc=Object.values(result).reduce((s,a)=>s+a.length,0);setParsed(result);setStatus({type:"ok",msg:pc+" mesures sur "+dc+" jour"+(dc>1 ? "s" : "")+"."});};reader.readAsText(file);};
  const doImport=()=>{if(!parsed)return;const nd={...allData.days};Object.entries(parsed).forEach(([dk,pts])=>{nd[dk]={...(nd[dk]||{}),dexcomCurve:pts};});saveAll({...allData,days:nd});setImported(true);setStatus({type:"success",msg:"Import OK - "+Object.keys(parsed).length+" jours mis a jour."});};
  return(<div style={{borderRadius:14,border:"1.5px solid "+C.blue,background:"#eff6ff",marginBottom:12}}>
    <div onClick={()=>setOpen(!open)} style={{padding:"14px 16px",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
      <div style={{display:"flex",alignItems:"center",gap:10}}>
        <span style={{background:C.blue,color:"white",borderRadius:8,padding:"4px 10px",fontSize:12,fontWeight:700}}>CSV</span>
        <div><div style={{fontWeight:700,color:C.text,fontSize:15}}>Importer Dexcom Clarity</div>
          <div style={{fontSize:12,color:C.muted}}>{imported ? "Import OK" : "clarity.dexcom.com - Export CSV"}</div>
        </div>
      </div><span style={{color:C.muted}}>{open ? "^" : "v"}</span>
    </div>
    {open&&(<div style={{padding:"4px 16px 16px",borderTop:"1px solid #bfdbfe"}}>
      <div style={{background:"#dbeafe",borderRadius:8,padding:"8px 12px",marginBottom:10,fontSize:12,color:C.blue}}>clarity.dexcom.com - Rapports - icone export - Telecharger CSV</div>
      <div onClick={()=>ref.current.click()} style={{border:"2px dashed "+(parsed ? C.green : "#93c5fd"),borderRadius:10,padding:"16px",cursor:"pointer",textAlign:"center",background:parsed ? "#f0fdf4" : "white",marginBottom:10}}>
        <div style={{fontWeight:700,color:parsed ? C.green : C.blue,fontSize:13}}>{parsed ? "Fichier charge" : "Cliquer pour selectionner le CSV"}</div>
      </div>
      <input ref={ref} type="file" accept=".csv,text/csv" style={{display:"none"}} onChange={e=>{if(e.target.files[0])handleFile(e.target.files[0]);}}/>
      {status&&<div style={{padding:"8px 12px",borderRadius:8,marginBottom:10,fontSize:13,background:status.type==="error" ? "#fef2f2" : status.type==="success" ? "#f0fdf4" : "#f0f9ff",color:status.type==="error" ? C.red : status.type==="success" ? C.green : C.blue}}>{status.msg}</div>}
      {parsed&&!imported&&<button onClick={doImport} style={{width:"100%",padding:"12px",background:C.blue,color:"white",border:"none",borderRadius:10,fontWeight:700,fontSize:14,cursor:"pointer",fontFamily:"inherit"}}>{"Importer "+Object.keys(parsed).length+" jours"}</button>}
    </div>)}
  </div>);
}

function ScreenshotPanel({value,onChange}){
  const ref=useRef();
  return(<div style={{borderRadius:14,border:"1.5px solid "+(value ? C.green : "#fcd34d"),background:value ? "#f0fdf4" : "#fffbeb",marginBottom:10,padding:"14px 16px"}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
      <div style={{display:"flex",alignItems:"center",gap:10}}>
        <span style={{background:value ? C.green : C.orange,color:"white",borderRadius:8,padding:"4px 10px",fontSize:12,fontWeight:700}}>Photo</span>
        <div><div style={{fontWeight:700,color:C.text,fontSize:15}}>Capture courbe Dexcom</div>
          <div style={{fontSize:12,color:C.muted}}>{value ? "Capture enregistree" : "Capturez votre courbe 24h depuis l app Dexcom"}</div>
        </div>
      </div>
      <label style={{cursor:"pointer",fontSize:12,color:"white",fontWeight:700,background:value ? C.green : C.orange,borderRadius:8,padding:"6px 12px"}}>{value ? "Changer" : "Importer"}<input ref={ref} type="file" accept="image/*" style={{display:"none"}} onChange={async e=>{if(e.target.files[0])onChange(await f2b64(e.target.files[0]));}} /></label>
    </div>
    {value&&<div style={{marginTop:10}}><img src={value} alt="" style={{width:"100%",borderRadius:8,border:"1px solid "+C.border,display:"block"}}/><button onClick={()=>onChange(null)} style={{fontSize:11,color:C.muted,background:"none",border:"none",cursor:"pointer",marginTop:6}}>Supprimer</button></div>}
  </div>);
}

// APPRENTISSAGE SPORT: mesure la baisse glycemique reelle par intensite a partir
// des activites enregistrees, pour personnaliser la reduction de bolus preventive.
function sportLearning(allData, cfg){
  const byIntensity = {leger:[], modere:[], intense:[]};
  const days = allData.days || {};
  Object.keys(days).forEach(dk=>{
    const day = days[dk];
    const curve = day.dexcomCurve || [];
    if(!curve.length) return;
    (day.activites||[]).forEach(a=>{
      if(!a.type || !a.duree) return;
      const dureeMin = parseInt(a.duree)||0;
      if(dureeMin<=0) return;
      const [h,m] = (a.time||"12:00").split(":").map(Number);
      const startMin = h*60+m;
      const endMin = startMin + dureeMin + 60;
      const glyAt = targetMin => {
        let best=null, bd=Infinity;
        curve.forEach(p=>{const [ph,pm]=p.time.split(":").map(Number);const pmin=ph*60+pm;const d=Math.abs(pmin-targetMin);if(d<bd&&d<=30){bd=d;best=parseFloat(p.value);}});
        return best;
      };
      const startGly = a.glyAvant ? parseFloat(a.glyAvant) : glyAt(startMin);
      const endGly = glyAt(endMin);
      if(startGly==null || endGly==null || isNaN(startGly) || isNaN(endGly)) return;
      const drop = startGly - endGly;
      const exHours = dureeMin/60;
      const dropPerHour = drop/exHours;
      if(byIntensity[a.type]) byIntensity[a.type].push({drop, dropPerHour, duree:dureeMin});
    });
  });

  const typical = {leger:0.30, modere:0.60, intense:0.90};
  const defaultReduc = {leger:0.20, modere:0.33, intense:0.50};
  const median = arr => {if(!arr.length)return null;const s=[...arr].sort((a,b)=>a-b);const mi=Math.floor(s.length/2);return s.length%2?s[mi]:(s[mi-1]+s[mi])/2;};

  const result = {};
  ["leger","modere","intense"].forEach(k=>{
    const arr = byIntensity[k];
    const drops = arr.map(x=>x.dropPerHour).filter(d=>d>0);
    if(drops.length>=2){
      const med = median(drops);
      let factor = defaultReduc[k] * (med/typical[k]);
      factor = Math.max(0.10, Math.min(0.70, factor));
      result[k] = {count:drops.length, avgDropPerHour:med.toFixed(2), reduc:Math.round(factor*100)/100, personalized:true};
    } else {
      result[k] = {count:arr.length, reduc:defaultReduc[k], personalized:false};
    }
  });
  return result;
}

// ANALYSE BACKEND SUR 3 JOURS: croise gly pre-prandiale -> post-prandiale (+2h)
// pour evaluer ratios IC et facteurs de correction. Exclut les repas avec sport.
function analyseRatios3Jours(allData, cfg, refDayIso){
  const ref = new Date(refDayIso+"T12:00:00");
  const dayKeys = [];
  for(let i=0;i<3;i++){const d=new Date(ref);d.setDate(d.getDate()-i);dayKeys.push(toISO(d));}

  const samples = []; // chaque repas analysable
  dayKeys.forEach(dk=>{
    const day = allData.days && allData.days[dk];
    if(!day) return;
    const curve = day.dexcomCurve || [];
    MEALS.forEach(m=>{
      const meal = day.meals && day.meals[m.id];
      if(!meal) return;
      const glyPre = parseFloat(meal.glyManuelle||meal.glycemieAuto||meal.glyEffective);
      const glucides = parseFloat(meal.glucides)||0;
      const doseInj = (parseFloat(meal.insulineRapide)||0)+(parseFloat(meal.bolusCorrection)||0);
      if(!glyPre || !glucides || doseInj<0.5) return;
      // Sport pendant/apres ce repas = exclu (fausse l analyse des ratios)
      if(meal.sportPrevu) return;
      // Trouver la glycemie post-prandiale a +2h depuis la courbe
      if(!curve.length) return;
      const [h,mm] = meal.time.split(":").map(Number);
      const preMin = h*60+mm;
      const postTarget = preMin+120; // +2h
      // Chercher le point le plus proche de +2h (tolerance 30 min)
      let best=null, bestDiff=Infinity;
      curve.forEach(p=>{
        const [ph,pm]=p.time.split(":").map(Number);
        const pmin=ph*60+pm;
        const diff=Math.abs(pmin-postTarget);
        if(diff<bestDiff && diff<=30){bestDiff=diff;best=p;}
      });
      if(!best) return;
      const glyPost = parseFloat(best.value);
      // Verifier qu il y a eu de l activite sportive enregistree autour (exclusion)
      const sportAutour = (day.activites||[]).some(a=>{
        const [ah,am]=(a.time||"12:00").split(":").map(Number);
        const amin=ah*60+am;
        return amin>=preMin-30 && amin<=postTarget+30;
      });
      if(sportAutour) return;
      samples.push({day:dk, repas:m.label, glyPre, glyPost, glucides, doseInj, deltaGly:glyPost-glyPre});
    });
  });

  if(samples.length<2) return {enough:false, sampleCount:samples.length};

  // Estimation ratio IC: pour les repas ou glyPre etait DANS la cible (peu de correction),
  // on regarde si glyPost revient pres de la cible. Si glyPost trop haut -> ratio trop faible (pas assez d insuline).
  // Methode: ratio ideal = glucides / (doseInj + ajustement pour ramener glyPost a cible)
  const icEstimates = [];
  const fcEstimates = [];
  samples.forEach(s=>{
    // Part correction dans la dose injectee
    const corrPart = s.glyPre>cfg.ciblePre ? (s.glyPre-cfg.ciblePre)/cfg.fc : 0;
    const mealPart = s.doseInj - corrPart;
    if(mealPart>0.5 && s.glucides>10){
      // Ajustement: si glyPost s ecarte de la cible, la dose repas aurait du etre differente
      // ecart de dose necessaire = (glyPost - ciblePost) / fc, avec ciblePost = milieu de cible
      const ciblePost = (cfg.tMin+cfg.tMax)/2;
      const doseAjust = mealPart + (s.glyPost-ciblePost)/cfg.fc;
      if(doseAjust>0.5){
        const icReel = s.glucides/doseAjust;
        // Garde-fou: ignorer valeurs aberrantes
        if(icReel>3 && icReel<40) icEstimates.push(icReel);
      }
    }
    // Estimation FC: sur les repas ou la correction etait significative
    if(corrPart>=1 && s.glucides<20){
      // si glyPost loin de cible, le FC est mal calibre
      const ciblePost = (cfg.tMin+cfg.tMax)/2;
      const baisseObtenue = s.glyPre - s.glyPost;
      if(baisseObtenue>0 && corrPart>0){
        const fcReel = baisseObtenue/corrPart;
        if(fcReel>0.1 && fcReel<1.5) fcEstimates.push(fcReel);
      }
    }
  });

  const median = arr => {if(!arr.length)return null;const s=[...arr].sort((a,b)=>a-b);const m=Math.floor(s.length/2);return s.length%2?s[m]:(s[m-1]+s[m])/2;};

  const icMed = median(icEstimates);
  const fcMed = median(fcEstimates);

  // Lissage: 60% nouvelle estimation, 40% valeur actuelle
  const icSuggere = icMed ? Math.round((icMed*0.6+cfg.ratioIC*0.4)*2)/2 : null;
  const fcSuggere = fcMed ? Math.round((fcMed*0.6+cfg.fc*0.4)*20)/20 : null;

  // Stats post-prandiales
  const postVals = samples.map(s=>s.glyPost);
  const avgPost = postVals.reduce((a,b)=>a+b,0)/postVals.length;
  const ciblePost=(cfg.tMin+cfg.tMax)/2;

  return {
    enough:true,
    sampleCount:samples.length,
    samples,
    icActuel:cfg.ratioIC, icSuggere, icChange: icSuggere ? Math.round((icSuggere-cfg.ratioIC)*10)/10 : 0,
    fcActuel:cfg.fc, fcSuggere, fcChange: fcSuggere ? Math.round((fcSuggere-cfg.fc)*100)/100 : 0,
    avgPost: avgPost.toFixed(2), ciblePost: ciblePost.toFixed(2),
    tendance: avgPost>cfg.tMax ? "Glycemies post-prandiales souvent trop hautes (ratio possiblement trop faible)" : avgPost<cfg.tMin ? "Glycemies post-prandiales souvent trop basses (ratio possiblement trop fort)" : "Glycemies post-prandiales globalement dans la cible"
  };
}

// SITUATION ACTUELLE DU PATIENT: TIR, moyenne, variabilite, schemas recurrents, gly live
function situationActuelle(allData, cfg, refDayIso){
  const ref = new Date(refDayIso+"T12:00:00");
  // Recuperer tous les points sur les 7 derniers jours
  const allPts = [];
  for(let i=0;i<7;i++){
    const d=new Date(ref);d.setDate(d.getDate()-i);
    const dk=toISO(d);
    const day=allData.days&&allData.days[dk];
    if(day&&day.dexcomCurve){day.dexcomCurve.forEach(p=>allPts.push({...p,dayKey:dk}));}
  }

  const live = allData.liveGly||null;

  if(allPts.length<5){
    return {enough:false, live};
  }

  const vals = allPts.map(p=>parseFloat(p.value)).filter(v=>!isNaN(v));
  const n = vals.length;
  const avg = vals.reduce((a,b)=>a+b,0)/n;
  const variance = vals.reduce((a,v)=>a+Math.pow(v-avg,2),0)/n;
  const ecartType = Math.sqrt(variance);
  const cv = (ecartType/avg)*100; // coefficient de variation

  // Time In Range
  const inRange = vals.filter(v=>v>=cfg.tMin&&v<=cfg.tMax).length;
  const below = vals.filter(v=>v<cfg.tMin).length;
  const severeLow = vals.filter(v=>v<0.70).length;
  const above = vals.filter(v=>v>cfg.tMax).length;
  const severeHigh = vals.filter(v=>v>2.50).length;
  const tir = Math.round(inRange/n*100);
  const tBelow = Math.round(below/n*100);
  const tAbove = Math.round(above/n*100);

  // Detection de schemas: hypos nocturnes recurrentes (0h-6h)
  let nightLows=0, nightPts=0;
  allPts.forEach(p=>{
    const h=parseInt(p.time.split(":")[0]);
    if(h>=0&&h<6){nightPts++;if(parseFloat(p.value)<cfg.tMin)nightLows++;}
  });
  const hypoNocturne = nightPts>5 && (nightLows/nightPts)>0.15;

  // Schema: hyperglycemie matinale (phenomene de l aube) 6h-9h
  let dawnHigh=0, dawnPts=0;
  allPts.forEach(p=>{
    const h=parseInt(p.time.split(":")[0]);
    if(h>=6&&h<9){dawnPts++;if(parseFloat(p.value)>cfg.tMax)dawnHigh++;}
  });
  const phenomeneAube = dawnPts>5 && (dawnHigh/dawnPts)>0.4;

  const schemas=[];
  if(hypoNocturne) schemas.push("Hypoglycemies nocturnes recurrentes (0h-6h) - dose de lente possiblement trop forte ou collation du soir a revoir");
  if(phenomeneAube) schemas.push("Hyperglycemie matinale frequente (phenomene de l aube) - besoin accru d insuline au reveil");
  if(severeLow>0) schemas.push(severeLow+" episode(s) d hypoglycemie severe (<0.70 g/L) sur 7 jours");
  if(severeHigh>0) schemas.push(severeHigh+" episode(s) d hyperglycemie severe (>2.50 g/L) sur 7 jours");
  if(cv>36) schemas.push("Variabilite glycemique elevee (CV "+Math.round(cv)+"%) - glycemies en montagnes russes, stabilite a ameliorer");

  // Suggestion de correction immediate si la glycemie live est hors cible
  let correctionLive = null;
  if(live && live.value){
    const lv = parseFloat(live.value);
    if(lv > cfg.tMax){
      const bolusCorr = (lv - cfg.ciblePre)/cfg.fc;
      correctionLive = {type:"haut", valeur:lv, bolus: Math.max(0,bolusCorr).toFixed(1), message:"Glycemie au-dessus de la cible"};
      if(lv > 2.50) correctionLive.alerte = "Hyperglycemie severe - verifiez les cetones";
    } else if(lv < cfg.tMin){
      const resucrage = Math.round((cfg.ciblePre - lv)/cfg.fc * 10);
      correctionLive = {type:"bas", valeur:lv, resucrage: Math.max(10,resucrage), message:"Glycemie sous la cible - resucrage conseille"};
      if(lv < 0.70) correctionLive.alerte = "Hypoglycemie - resucrez-vous immediatement (15g)";
    }
  }

  return {
    enough:true,
    live,
    correctionLive,
    periode:"7 jours",
    nbMesures:n,
    moyenne:avg.toFixed(2),
    ecartType:ecartType.toFixed(2),
    cv:Math.round(cv),
    tir, tBelow, tAbove, severeLow, severeHigh,
    schemas
  };
}

function analyseLocal(dayData,cfg){
  const curve=dayData.dexcomCurve||[],meals=dayData.meals||{},correctifs=dayData.correctifs||[];
  const obs=[],conseils=[],recos=[];
  const mealList=MEALS.map(m=>({def:m,data:meals[m.id]})).filter(x=>x.data).map(x=>{
    const d=x.data,gp=parseFloat(d.glyManuelle||d.glycemieAuto||d.glyEffective)||null;
    const t=d.time.split(":");return{label:x.def.label,time:d.time,tMin:parseInt(t[0])*60+parseInt(t[1]),glyPre:gp,glucides:parseFloat(d.glucides)||0,doseInj:parseFloat(d.insulineRapide||0)+parseFloat(d.bolusCorrection||0)};
  }).sort((a,b)=>a.tMin-b.tMin);
  const allGly=mealList.map(m=>m.glyPre).filter(Boolean);
  let score=5,resume="";
  if(allGly.length>0){
    const inTarget=allGly.filter(v=>v>=cfg.tMin&&v<=cfg.tMax).length;
    const pct=Math.round(inTarget/allGly.length*100);
    const avg=allGly.reduce((s,v)=>s+v,0)/allGly.length;
    score=Math.round(Math.min(10,Math.max(1,pct/10)));
    resume="Sur "+allGly.length+" glycemie"+(allGly.length>1 ? "s" : "")+" pre-prandiale"+(allGly.length>1 ? "s" : "")+" (moy "+avg.toFixed(2)+" g/L), "+pct+"% dans la cible. "+(pct>=70 ? "Bon controle." : avg>cfg.tMax ? "Valeurs globalement au-dessus." : "Controle perfectible.");
  } else resume="Saisissez la glycemie avant chaque repas pour obtenir l analyse.";
  if(curve.length>0){
    const vals=curve.map(p=>parseFloat(p.value));
    const cavg=(vals.reduce((s,v)=>s+v,0)/vals.length).toFixed(2);
    const tir=Math.round(vals.filter(v=>v>=cfg.tMin&&v<=cfg.tMax).length/vals.length*100);
    score=Math.round(Math.min(10,Math.max(1,tir/10)));
    resume="Dexcom: moy "+cavg+" g/L, "+tir+"% dans la cible. "+(tir>=70 ? "Excellent." : "A ameliorer.");
  }
  mealList.forEach((meal,idx)=>{
    if(!meal.glucides)return;
    const bolusR=meal.glucides/cfg.ratioIC;
    const bolusC=meal.glyPre&&meal.glyPre>cfg.ciblePre ? (meal.glyPre-cfg.ciblePre)/cfg.fc : 0;
    const ideal=bolusR+bolusC;
    const ecart=meal.doseInj>0 ? Math.round((meal.doseInj-ideal)*10)/10 : 0;
    let expl="Pour "+meal.glucides+"g: bolus repas "+bolusR.toFixed(1)+" UI"+(bolusC>0 ? " + correction "+bolusC.toFixed(1)+" UI" : "")+" = ideal "+ideal.toFixed(1)+" UI. ";
    if(meal.doseInj>0){if(Math.abs(ecart)<1)expl+="Dose bien ajustee.";else if(ecart>0)expl+="Dose de "+ecart+" UI superieure.";else expl+="Dose de "+Math.abs(ecart)+" UI inferieure.";}
    const next=mealList[idx+1];
    if(next&&next.glyPre){const gap=Math.round((next.tMin-meal.tMin)/60*10)/10;expl+=" Au repas suivant ("+gap+"h): "+next.glyPre.toFixed(2)+" g/L"+(next.glyPre>cfg.tMax+0.2 ? " - eleve, dose insuffisante ?" : next.glyPre<cfg.tMin ? " - trop bas, risque hypo" : "")+". ";}
    conseils.push({repas:meal.label,gly_pre:meal.glyPre ? meal.glyPre.toFixed(2) : "",glucides:meal.glucides,dose_injectee:meal.doseInj>0 ? meal.doseInj.toFixed(1) : "0",dose_ideale:ideal.toFixed(1),ecart,explication:expl});
  });
  const firstMeal=mealList[0];
  if(firstMeal&&firstMeal.glyPre){if(firstMeal.glyPre>cfg.tMax)obs.push({heure:firstMeal.time,type:"info",texte:"Glycemie elevee au lever ("+firstMeal.glyPre.toFixed(2)+" g/L): insuline lente du soir peut-etre insuffisante."});else if(firstMeal.glyPre>=cfg.tMin)obs.push({heure:firstMeal.time,type:"ok",texte:"Bon reveil ("+firstMeal.glyPre.toFixed(2)+" g/L): insuline lente bien dosee."});}
  const resucrages=correctifs.filter(c=>c.type==="resucrage");
  if(resucrages.length>0){const totG=resucrages.reduce((s,r)=>s+(parseFloat(r.glucides)||0),0);obs.push({heure:"",type:"resucrage",texte:resucrages.length+" resucrage"+(resucrages.length>1 ? "s" : "")+" ("+totG+"g). Signe d hypoglycemie."});recos.push("Des resucrages ont ete necessaires. La dose precedente etait peut-etre trop forte.");}
  if(recos.length===0&&conseils.length>0)recos.push("Continuez a noter vos repas et doses.");
  return{resume,observations:obs,correlations:[],recommandations:recos,score_equilibre:score,conseils_dosage:conseils};
}

function AnalysePanel({dayData,dayLabel,cfg,apiKey,allData,refDayIso}) {
  const [open,setOpen]=useState(false);
  const [result,setResult]=useState(null);
  const [loading,setLoading]=useState(false);
  const [err,setErr]=useState(null);
  const ratios3j=allData ? analyseRatios3Jours(allData,cfg,refDayIso||TODAY()) : null;
  const situation=allData ? situationActuelle(allData,cfg,refDayIso||TODAY()) : null;
  const hasSituation=(situation&&situation.enough)||(allData&&allData.liveGly);
  const hasData=(dayData.meals&&Object.keys(dayData.meals).length>0)||(dayData.dexcomCurve&&dayData.dexcomCurve.length>0)||(dayData.correctifs&&dayData.correctifs.length>0)||hasSituation;
  const run=()=>{setErr(null);setResult({...analyseLocal(dayData,cfg),_ratios3j:ratios3j,_situation:situation});};
  const enhance=async()=>{setLoading(true);setErr(null);try{const r=await aiAnalyse({...dayData,label:dayLabel},cfg,apiKey,ratios3j,situation);setResult({...r,_ai:true,_ratios3j:ratios3j,_situation:situation});}catch(e){setErr("IA indisponible ("+e.message+")");}finally{setLoading(false);};};
  const sc=s=>s>=8 ? C.green : s>=5 ? C.orange : C.red;
  return(<div style={{borderRadius:14,border:"1.5px solid "+C.purple,background:"#faf5ff",marginBottom:10}}>
    <div onClick={()=>setOpen(!open)} style={{padding:"14px 16px",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
      <div style={{display:"flex",alignItems:"center",gap:10}}>
        <span style={{background:C.purple,color:"white",borderRadius:8,padding:"4px 10px",fontSize:12,fontWeight:700}}>IA</span>
        <div><div style={{fontWeight:700,color:C.text,fontSize:15}}>Analyse IA</div>
          <div style={{fontSize:12,color:C.muted}}>{result ? "Score: "+result.score_equilibre+"/10" : "Conseils + situation actuelle"}</div>
        </div>
      </div>
      <div style={{display:"flex",alignItems:"center",gap:8}}>{result&&<span style={{fontWeight:800,fontSize:16,color:sc(result.score_equilibre)}}>{result.score_equilibre+"/10"}</span>}<span style={{color:C.muted}}>{open ? "^" : "v"}</span></div>
    </div>
    {open&&(<div style={{padding:"4px 16px 16px",borderTop:"1px solid #ede9fe"}}>
      {!result&&<div style={{marginBottom:12}}><p style={{fontSize:13,color:C.text,marginBottom:10}}>Analyse de la journee passee + point sur ta situation actuelle.</p><PBtn onClick={run} disabled={!hasData} color={C.purple} full>Lancer l analyse</PBtn></div>}
      {err&&<div style={{background:"#fffbeb",border:"1px solid #fcd34d",borderRadius:8,padding:"8px 10px",marginBottom:8,fontSize:12,color:"#92400e"}}>{err}</div>}
      {result&&(<div>
        <div style={{background:"white",borderRadius:10,padding:14,marginBottom:10,border:"1px solid "+C.border}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
            <span style={{fontWeight:700,fontSize:14}}>Resume{result._ai ? " (IA)" : ""}</span>
            <div style={{background:sc(result.score_equilibre||5),borderRadius:8,padding:"4px 12px"}}><div style={{color:"white",fontWeight:800,fontSize:18}}>{(result.score_equilibre||"?")+"/10"}</div></div>
          </div>
          <p style={{fontSize:13,color:C.text,lineHeight:1.5}}>{result.resume}</p>
        </div>
        {result.conseils_dosage&&result.conseils_dosage.length>0&&(<div style={{marginBottom:10}}>
          <div style={{fontSize:11,fontWeight:700,color:C.red,textTransform:"uppercase",marginBottom:8}}>Analyse des doses</div>
          {result.conseils_dosage.map((d,i)=>{const ecart=parseFloat(d.ecart)||0;const dc=Math.abs(ecart)<1 ? C.green : Math.abs(ecart)<2 ? C.orange : C.red;return(<div key={i} style={{background:"white",borderRadius:10,border:"1.5px solid "+dc,padding:"10px 12px",marginBottom:8}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}><span style={{fontWeight:700}}>{d.repas}</span><span style={{background:dc,color:"white",borderRadius:6,padding:"2px 10px",fontSize:12,fontWeight:700}}>{Math.abs(ecart)<0.5 ? "OK" : ecart>0 ? "+"+ecart+" UI" : Math.abs(ecart)+" UI manquantes"}</span></div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6,marginBottom:6}}>{[["Injecte",(d.dose_injectee||"?")+" UI",C.red],["Ideale",(d.dose_ideale||"?")+" UI",dc],["Ecart",(ecart>0 ? "+" : "")+ecart+" UI",dc]].map(([l,v,col])=><div key={l} style={{textAlign:"center",background:col+"11",borderRadius:6,padding:"5px 3px"}}><div style={{fontSize:9,color:C.muted}}>{l}</div><div style={{fontSize:12,fontWeight:700,color:col}}>{v}</div></div>)}</div>
            {d.explication&&<p style={{fontSize:12,color:C.muted,margin:0,lineHeight:1.4}}>{d.explication}</p>}
          </div>);})}
        </div>)}
        {/* SITUATION ACTUELLE */}
        {result._situation&&result._situation.enough&&(<div style={{marginBottom:10,background:"white",borderRadius:10,border:"1.5px solid "+C.blue,padding:14}}>
          <div style={{fontSize:11,fontWeight:700,color:C.blue,textTransform:"uppercase",marginBottom:8}}>Situation actuelle ({result._situation.periode})</div>
          {result._situation.live&&result._situation.live.value&&(<div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10,padding:"8px 10px",background:"#eff6ff",borderRadius:8}}>
            <span style={{fontSize:22,fontWeight:800,color:glyColor(result._situation.live.value,cfg)}}>{result._situation.live.value}</span>
            <span style={{fontSize:12,color:C.muted}}>{"g/L "+(result._situation.live.trend||"")+" maintenant"}</span>
          </div>)}
          {result._situation.correctionLive&&result._situation.correctionLive.type==="haut"&&(<div style={{marginBottom:10,padding:"10px 12px",background:"#fef2f2",border:"1.5px solid #fca5a5",borderRadius:8}}>
            <div style={{fontSize:12,fontWeight:700,color:C.red,marginBottom:4}}>Correction suggeree</div>
            <div style={{fontSize:13,color:C.text}}>{"Bolus de correction: "+result._situation.correctionLive.bolus+" UI pour revenir vers la cible."}</div>
            {result._situation.correctionLive.alerte&&<div style={{fontSize:12,color:C.red,fontWeight:700,marginTop:4}}>{result._situation.correctionLive.alerte}</div>}
            <div style={{fontSize:10,color:C.muted,marginTop:4,fontStyle:"italic"}}>Indicatif - validez selon votre ressenti et l insuline deja active.</div>
          </div>)}
          {result._situation.correctionLive&&result._situation.correctionLive.type==="bas"&&(<div style={{marginBottom:10,padding:"10px 12px",background:"#fffbeb",border:"1.5px solid #fcd34d",borderRadius:8}}>
            <div style={{fontSize:12,fontWeight:700,color:"#92400e",marginBottom:4}}>Resucrage conseille</div>
            <div style={{fontSize:13,color:C.text}}>{"Prenez environ "+result._situation.correctionLive.resucrage+"g de sucre rapide."}</div>
            {result._situation.correctionLive.alerte&&<div style={{fontSize:12,color:C.red,fontWeight:700,marginTop:4}}>{result._situation.correctionLive.alerte}</div>}
          </div>)}
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6,marginBottom:8}}>
            {[["TIR",result._situation.tir+"%",result._situation.tir>=70?C.green:result._situation.tir>=50?C.orange:C.red],["Moyenne",result._situation.moyenne,C.blue],["Variabilite",result._situation.cv+"%",result._situation.cv<=36?C.green:C.orange]].map(([l,v,col])=><div key={l} style={{textAlign:"center",background:col+"11",borderRadius:6,padding:"6px 3px"}}><div style={{fontSize:9,color:C.muted}}>{l}</div><div style={{fontSize:14,fontWeight:800,color:col}}>{v}</div></div>)}
          </div>
          {result.situation_actuelle&&(<div style={{fontSize:12,color:C.text,lineHeight:1.5}}>
            {result.situation_actuelle.bilan_global&&<p style={{margin:"6px 0"}}><strong>Bilan: </strong>{result.situation_actuelle.bilan_global}</p>}
            {result.situation_actuelle.point_immediat&&<p style={{margin:"6px 0",padding:"8px 10px",background:"#eff6ff",borderRadius:8,borderLeft:"3px solid "+C.blue}}><strong>Maintenant: </strong>{result.situation_actuelle.point_immediat}</p>}
            {result.situation_actuelle.tendance_a_surveiller&&<p style={{margin:"6px 0",fontSize:12,color:C.muted}}><strong>A surveiller: </strong>{result.situation_actuelle.tendance_a_surveiller}</p>}
          </div>)}
          {result._situation.schemas&&result._situation.schemas.length>0&&(<div style={{marginTop:8}}>
            {result._situation.schemas.map((s,i)=><div key={i} style={{fontSize:11,color:"#92400e",background:"#fffbeb",borderRadius:6,padding:"6px 8px",marginBottom:4}}>{s}</div>)}
          </div>)}
        </div>)}
        {/* RATIOS 3 JOURS */}
        {result._ratios3j&&result._ratios3j.enough&&(result._ratios3j.icSuggere||result._ratios3j.fcSuggere)&&(<div style={{marginBottom:10,background:"white",borderRadius:10,border:"1.5px solid "+C.purple,padding:14}}>
          <div style={{fontSize:11,fontWeight:700,color:C.purple,textTransform:"uppercase",marginBottom:4}}>Ratios calcules sur 3 jours</div>
          <div style={{fontSize:10,color:C.muted,marginBottom:8}}>{result._ratios3j.sampleCount+" repas analyses (sport exclu) - post-prandial a +2h"}</div>
          {result._ratios3j.icSuggere&&<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 10px",background:"#faf5ff",borderRadius:8,marginBottom:6}}><span style={{fontSize:12}}>Ratio IC</span><span style={{fontSize:13,fontWeight:700}}>{"1/"+result._ratios3j.icActuel+" -> 1/"+result._ratios3j.icSuggere}</span></div>}
          {result._ratios3j.fcSuggere&&<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 10px",background:"#faf5ff",borderRadius:8,marginBottom:6}}><span style={{fontSize:12}}>Facteur correction</span><span style={{fontSize:13,fontWeight:700}}>{result._ratios3j.fcActuel+" -> "+result._ratios3j.fcSuggere}</span></div>}
          <div style={{fontSize:11,color:C.muted,fontStyle:"italic",marginTop:4}}>Indicatif - a valider avec votre medecin avant tout changement.</div>
        </div>)}
        {result.recommandations&&result.recommandations.length>0&&(<div style={{marginBottom:10}}>
          <div style={{fontSize:11,fontWeight:700,color:C.green,textTransform:"uppercase",marginBottom:8}}>Recommandations</div>
          {result.recommandations.map((r,i)=><div key={i} style={{padding:"8px 12px",background:"#f0fdf4",borderRadius:8,marginBottom:6,borderLeft:"3px solid "+C.green,fontSize:13}}>{r}</div>)}
        </div>)}
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <OBtn onClick={()=>setResult(null)} color={C.purple} small>Relancer</OBtn>
          <button onClick={enhance} disabled={loading} style={{padding:"5px 12px",background:"white",color:C.orange,border:"2px solid "+C.orange,borderRadius:8,fontWeight:700,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>{loading ? "..." : "Enrichir avec IA"}</button>
          {result._ai&&<span style={{fontSize:11,color:C.green,fontWeight:700}}>Analyse IA</span>}
        </div>
        {err&&<div style={{background:"#fffbeb",border:"1px solid #fcd34d",borderRadius:8,padding:"8px 10px",marginTop:8,fontSize:12,color:"#92400e"}}>{err}</div>}
      </div>)}
    </div>)}
  </div>);
}

function computeAdaptive(allData,cfg){
  const days=Object.keys(allData.days||{}).sort().slice(-7);
  const points=[];
  days.forEach(dk=>{
    const day=allData.days[dk],curve=day.dexcomCurve;if(!curve||!curve.length)return;
    MEALS.forEach(m=>{
      const meal=day.meals&&day.meals[m.id];if(!meal||!meal.glucides)return;
      const glyPre=parseFloat(meal.glyManuelle||meal.glycemieAuto);
      const doseInj=parseFloat(meal.insulineRapide||0)+parseFloat(meal.bolusCorrection||0);
      if(!glyPre||!doseInj||doseInj<0.5)return;
      const t=meal.time.split(":");const t1=parseInt(t[0])*60+parseInt(t[1])+90,t2=parseInt(t[0])*60+parseInt(t[1])+150;
      const post=curve.filter(p=>{const pt=p.time.split(":");const pmin=parseInt(pt[0])*60+parseInt(pt[1]);return pmin>=t1&&pmin<=t2;});
      if(!post.length)return;
      const glyPost=post.reduce((s,p)=>s+parseFloat(p.value),0)/post.length;
      points.push({glyPre,glucides:parseFloat(meal.glucides),doseInj,glyPost});
    });
  });
  if(points.length<2)return null;
  const icEstimates=points.map(p=>{const corrBolus=Math.max(0,(p.glyPre-cfg.ciblePre)/cfg.fc);const mealBolus=p.doseInj-corrBolus;if(mealBolus<=0.5||p.glucides<=10)return null;return{v:p.glucides/mealBolus,w:Math.max(0.1,1-Math.abs(p.glyPost-cfg.ciblePre))};}).filter(Boolean);
  if(!icEstimates.length)return null;
  const wSum=icEstimates.reduce((s,e)=>s+e.w,0);
  const icNew=icEstimates.reduce((s,e)=>s+e.v*e.w,0)/wSum;
  const icSmoothed=Math.round((icNew*0.6+cfg.ratioIC*0.4)*2)/2;
  if(Math.abs(icSmoothed-cfg.ratioIC)<0.5)return null;
  const avgPost=points.reduce((s,p)=>s+p.glyPost,0)/points.length;
  const pctInTarget=Math.round(points.filter(p=>p.glyPost>=cfg.tMin&&p.glyPost<=cfg.tMax).length/points.length*100);
  return{ratioIC:icSmoothed,icChange:Math.round((icSmoothed-cfg.ratioIC)*10)/10,points:points.length,pctInTarget,assessment:avgPost>cfg.tMax+0.2 ? "Glycemies post-prandiales globalement au-dessus de la cible." : "Glycemies post-prandiales dans la zone acceptable."};
}

function AdaptiveBanner({allData,cfg,onApply}){
  const [suggestion,setSuggestion]=useState(null);
  const [dismissed,setDismissed]=useState(false);
  const [applied,setApplied]=useState(false);
  useEffect(()=>{if(!allData||!cfg)return;setSuggestion(computeAdaptive(allData,cfg));},[]);
  if(!suggestion||dismissed||applied)return null;
  return(<div style={{borderRadius:12,border:"2px solid "+C.orange,background:"#fffbeb",padding:"14px 16px",marginBottom:12}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
      <div style={{display:"flex",alignItems:"center",gap:8}}>
        <span style={{background:C.orange,color:"white",borderRadius:8,padding:"3px 8px",fontSize:11,fontWeight:700}}>ADAPTATIF</span>
        <span style={{fontWeight:700,color:C.orange,fontSize:14}}>Mise a jour du ratio suggeree</span>
      </div>
      <button onClick={()=>setDismissed(true)} style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:16}}>x</button>
    </div>
    <p style={{fontSize:12,color:C.muted,marginBottom:6}}>{suggestion.assessment}</p>
    <p style={{fontSize:11,color:C.muted,marginBottom:10}}>{"Analyse sur "+suggestion.points+" repas - "+suggestion.pctInTarget+"% post-prandiaux dans la cible."}</p>
    <div style={{background:"white",borderRadius:8,padding:"8px 10px",marginBottom:10,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
      <div style={{textAlign:"center"}}><div style={{fontSize:10,color:C.muted}}>Actuel</div><div style={{fontWeight:700,fontSize:14}}>{cfg.ratioIC+"g/UI"}</div></div>
      <span style={{color:C.orange,fontSize:16}}>{"->"}</span>
      <div style={{textAlign:"center"}}><div style={{fontSize:10,color:C.muted}}>Suggere</div><div style={{fontWeight:800,fontSize:14,color:C.orange}}>{suggestion.ratioIC+"g/UI"}</div></div>
    </div>
    <div style={{display:"flex",gap:8}}>
      <PBtn onClick={()=>{onApply({...cfg,ratioIC:suggestion.ratioIC});setApplied(true);}} color={C.green} full>Appliquer</PBtn>
      <OBtn onClick={()=>setDismissed(true)} color={C.muted} small>Ignorer</OBtn>
    </div>
  </div>);
}

function buildReport(allData,from,to){
  const days=[];let d=new Date(from+"T12:00:00"),end=new Date(to+"T12:00:00");
  while(d<=end){days.push(toISO(d));d.setDate(d.getDate()+1);}
  const cfg=allData.cfg||DEF;
  const allG=days.reduce((arr,day)=>arr.concat(((allData.days[day]&&allData.days[day].dexcomCurve)||[]).map(p=>parseFloat(p.value))),[]);
  const avgG=allG.length ? (allG.reduce((s,v)=>s+v,0)/allG.length).toFixed(2) : "N/A";
  const tir=allG.length ? Math.round(allG.filter(v=>v>=cfg.tMin&&v<=cfg.tMax).length/allG.length*100) : null;
  const css="*{margin:0;padding:0;box-sizing:border-box}body{font-family:Segoe UI,sans-serif;background:#f8f9fa;color:#2d3748;font-size:13px}.hdr{background:linear-gradient(135deg,#1a365d,#2b6cb0);color:white;padding:32px 40px}.hdr h1{font-size:24px;font-weight:800}.sum{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;padding:24px 40px;background:white}.sbox{text-align:center;padding:14px;background:#f7fafc;border-radius:10px}.sbox .v{font-size:24px;font-weight:800;color:#2b6cb0}.day{padding:20px 40px;border-bottom:2px solid #edf2f7}.dh{background:#ebf8ff;border-left:4px solid #2b6cb0;padding:10px 14px;border-radius:0 8px 8px 0;margin-bottom:14px}.card{background:white;border-radius:8px;padding:12px;border:1px solid #e2e8f0;margin-bottom:6px}.b{display:inline-block;padding:2px 9px;border-radius:10px;font-size:11px;font-weight:700;margin-right:4px}.ftr{padding:20px 40px;text-align:center;color:#a0aec0;font-size:11px}@media print{.day{page-break-inside:avoid}}";
  let body="";
  body+='<div class="hdr"><h1>Rapport Diabete - Dexcom ONE+</h1><p>'+fmtDay(from)+" au "+fmtDay(to)+'</p></div>';
  body+='<div class="sum"><div class="sbox"><div class="v">'+days.length+'</div><div>Jours</div></div><div class="sbox"><div class="v">'+avgG+(avgG!=="N/A" ? " g/L" : "")+'</div><div>Moy. glycemie</div></div><div class="sbox"><div class="v">'+( tir!==null ? tir+"%" : "N/A")+'</div><div>Temps cible</div></div><div class="sbox"><div class="v">'+cfg.tMin+"-"+cfg.tMax+" g/L"+'</div><div>Cible</div></div></div>';
  days.forEach(day=>{
    const dd=allData.days[day]||{};
    body+='<div class="day"><div class="dh"><h2>'+fmtDay(day)+'</h2></div>';
    if(dd.screenshot)body+='<img src="'+dd.screenshot+'" style="width:100%;border-radius:8px;margin-bottom:12px"/>';
    MEALS.forEach(m=>{const meal=dd.meals&&dd.meals[m.id];if(!meal)return;const b=parseFloat(meal.insulineRapide||0)+parseFloat(meal.bolusCorrection||0);const glyRep=meal.glyEffective||meal.glyManuelle||meal.glycemieAuto;
      body+='<div class="card"><span class="b" style="background:'+m.color+'22;color:'+m.color+'">'+m.tag+'</span>'+meal.time+" - "+(meal.desc||"---");
      if(meal.glucides)body+=' <span class="b" style="background:#fffff0;color:#b7791f">'+meal.glucides+"g</span>";
      if(glyRep)body+=' <span class="b" style="background:#faf5ff;color:#553c9a">glyc: '+glyRep+" g/L</span>";
      if(b>0)body+=' <span class="b" style="background:#fff5f5;color:#c53030">'+b.toFixed(1)+" UI</span>";
      if(meal.photo)body+='<img src="'+meal.photo+'" style="max-width:220px;border-radius:6px;margin-top:8px;display:block"/>';
      body+='</div>';
    });
    const correctifs=dd.correctifs||[];
    if(correctifs.length>0){body+='<div class="card"><strong>Correctifs:</strong> ';correctifs.forEach(c=>{body+=c.type+" "+c.time+(c.gly ? " glyc:"+c.gly : "")+(c.units ? " "+c.units+"UI" : "")+(c.glucides ? " "+c.glucides+"g" : "")+" | ";});body+="</div>";}
    body+='</div>';
  });
  body+='<div class="ftr">DiabeteTracker | '+VERSION+'</div>';
  return "<!DOCTYPE html><html lang='fr'><head><meta charset='UTF-8'><title>Rapport</title><style>"+css+"</style></head><body>"+body+"</body></html>";
}


function GlyBanner({liveGly, cfg}){
  if(!liveGly || !liveGly.value) return null;
  const v = parseFloat(liveGly.value);
  const mn = (cfg||DEF).tMin, mx = (cfg||DEF).tMax;
  // Determine status
  let bg, color, msg, icon;
  if(v < 0.70) {
    bg="#fef2f2"; color=C.red; icon="!"; msg="HYPOGLYCEMIE - Resucrez-vous immediatement (15g de sucre rapide)";
  } else if(v < mn) {
    bg="#fffbeb"; color="#d97706"; icon="v"; msg="En dessous de la cible - surveillez";
  } else if(v <= mx) {
    bg="#f0fdf4"; color=C.green; icon="OK"; msg="Dans la cible";
  } else if(v <= 2.50) {
    bg="#fffbeb"; color="#d97706"; icon="^"; msg="Au-dessus de la cible - hyperglycemie";
  } else {
    bg="#fef2f2"; color=C.red; icon="!!"; msg="HYPERGLYCEMIE SEVERE - Risque d acetonemie. Verifiez les cetones et ajustez l insuline";
  }
  // Time since update
  const mins = liveGly.updatedAt ? Math.round((Date.now()-liveGly.updatedAt)/60000) : null;
  const stale = mins!==null && mins>15;
  return(
    <div style={{background:bg,borderBottom:"1px solid "+color+"33",padding:"10px 16px"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <div style={{display:"flex",alignItems:"baseline",gap:6}}>
            <span style={{fontSize:28,fontWeight:800,color,lineHeight:1}}>{liveGly.value}</span>
            <span style={{fontSize:13,color,fontWeight:600}}>g/L</span>
            {liveGly.trend&&<span style={{fontSize:18,color,fontWeight:700}}>{liveGly.trend}</span>}
          </div>
        </div>
        <div style={{flex:1,textAlign:"right"}}>
          <div style={{fontSize:12,fontWeight:700,color,lineHeight:1.3}}>{msg}</div>
          {mins!==null&&<div style={{fontSize:10,color:stale?C.red:C.muted}}>{stale?"Donnee ancienne ("+mins+" min)":"il y a "+mins+" min"}</div>}
        </div>
      </div>
    </div>
  );
}

export default function App(){
  const [allData,saveAll,ready]=useStorage();
  const [activeDay,setActiveDay]=useState(TODAY());
  const [tab,setTab]=useState("journal");
  const [rFrom,setRFrom]=useState(()=>{const d=new Date();d.setDate(d.getDate()-6);return toISO(d);});
  const [rTo,setRTo]=useState(TODAY());
  const [reportHtml,setReportHtml]=useState(null);
  const [graphView,setGraphView]=useState("today");

  if(!ready)return(<div style={{background:C.bg,minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"Segoe UI,sans-serif"}}><div style={{textAlign:"center",color:C.muted}}><div style={{fontSize:28,marginBottom:8}}>Chargement...</div></div></div>);

  const cfg=allData.cfg||DEF;
  const apiKey=cfg.apiKey||"";
  const day=(allData.days&&allData.days[activeDay])||{};
  const upDay=patch=>{const newDay={...day,...patch};const newDays={...allData.days};newDays[activeDay]=newDay;saveAll({...allData,days:newDays});};
  const yday=prevDay(activeDay);
  const sportProfil=sportLearning(allData,cfg);
  const ydayData=(allData.days&&allData.days[yday])||{};
  const weekDays=Array.from({length:7},(_,i)=>{const d=new Date(rFrom+"T12:00:00");d.setDate(d.getDate()+i);return toISO(d);});

  return(<div style={{background:C.bg,minHeight:"100vh",fontFamily:"Segoe UI,system-ui,sans-serif",color:C.text}}>
    <div style={{background:"white",borderBottom:"2px solid "+C.border,padding:"14px 16px",position:"sticky",top:0,zIndex:100,boxShadow:"0 2px 8px rgba(0,0,0,0.04)"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div><h1 style={{fontSize:18,fontWeight:800,color:C.red,margin:0}}>DiabeteTracker</h1><p style={{color:C.muted,fontSize:11,margin:0}}>{"Dexcom ONE+ | "+VERSION}</p></div>
        <div style={{display:"flex",gap:6}}>{[["journal","Journal"],["report","Rapport"],["params","Parametres"]].map(([k,l])=><button key={k} onClick={()=>setTab(k)} style={{padding:"7px 14px",borderRadius:8,border:"2px solid "+(tab===k ? C.red : C.border),background:tab===k ? C.red : "white",color:tab===k ? "white" : C.muted,fontWeight:700,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>{l}</button>)}</div>
      </div>
      <GlyBanner liveGly={allData.liveGly} cfg={cfg}/>
    </div>

    {tab==="journal"&&(<div style={{padding:"16px 14px 40px"}}>
      <div style={{display:"flex",gap:6,overflowX:"auto",paddingBottom:8,marginBottom:14}}>
        {weekDays.map(d=>{
          const fs=fmtShort(d);const isA=d===activeDay;const isT=d===TODAY();
          const hC=!!(allData.days&&allData.days[d]&&allData.days[d].dexcomCurve);
          const hM=!!(allData.days&&allData.days[d]&&allData.days[d].meals&&Object.keys(allData.days[d].meals).length>0);
          return(<button key={d} onClick={()=>setActiveDay(d)} style={{flexShrink:0,minWidth:50,padding:"8px 10px",borderRadius:12,cursor:"pointer",textAlign:"center",border:"2px solid "+(isA ? C.red : C.border),background:isA ? "#fff5f5" : "white"}}>
            <div style={{fontSize:10,color:isA ? C.red : C.muted,fontWeight:700,textTransform:"uppercase"}}>{fs.wd}</div>
            <div style={{fontSize:18,fontWeight:800,color:isA ? C.red : C.text,lineHeight:1.3}}>{fs.day}</div>
            <div style={{fontSize:9,color:hC ? C.blue : hM ? C.green : C.muted}}>{isT ? "auj." : hC ? "dex" : hM ? "ok" : "-"}</div>
          </button>);
        })}
      </div>
      <h2 style={{fontSize:15,fontWeight:700,color:C.text,marginBottom:12,textTransform:"capitalize"}}>{fmtDay(activeDay)}</h2>
      {day.dexcomCurve&&day.dexcomCurve.length>0 ? (<div style={{background:"white",border:"1.5px solid #93c5fd",borderRadius:12,padding:"12px 14px",marginBottom:12}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}><span style={{fontWeight:700,fontSize:13,color:C.blue}}>{allData.libreCreds ? "Courbe FreeStyle Libre" : allData.dexcomOAuth ? "Courbe Dexcom" : "Courbe glycemie"}</span><span style={{fontSize:11,color:C.muted}}>{day.dexcomCurve.length+" pts"}</span></div>
        <div style={{display:"flex",gap:4,marginBottom:8,flexWrap:"wrap"}}>
          {[["today","Standard"],["full","00h-24h"],["24h","24h glissantes"],["4h","4h glissantes"]].map(([k,l])=><button key={k} onClick={()=>setGraphView(k)} style={{padding:"4px 10px",borderRadius:6,border:"1px solid "+(graphView===k ? C.blue : C.border),background:graphView===k ? C.blue : "white",color:graphView===k ? "white" : C.muted,fontWeight:600,fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>{l}</button>)}
        </div>
        {(()=>{
          const now=new Date();
          const midnight=new Date(now);midnight.setHours(0,0,0,0);
          let ws,we;
          if(graphView==="today"){ws=midnight.getTime();we=now.getTime();}
          else if(graphView==="full"){ws=midnight.getTime();we=midnight.getTime()+86400000;}
          else if(graphView==="24h"){we=now.getTime();ws=we-86400000;}
          else {we=now.getTime();ws=we-4*3600000;}
          // Pour les vues glissantes qui traversent minuit, fusionner hier+aujourd hui
          let pts=day.dexcomCurve||[];
          if(graphView==="24h"||graphView==="4h"){
            const yCurve=(allData.days&&allData.days[yday]&&allData.days[yday].dexcomCurve)||[];
            pts=[...yCurve,...pts];
          }
          return <DayCurve pts={pts} meals={day.meals} cfg={cfg} width={340} height={110} winStart={ws} winEnd={we}/>;
        })()}
        {(()=>{const vals=day.dexcomCurve.map(p=>parseFloat(p.value));const avg=(vals.reduce((s,v)=>s+v,0)/vals.length).toFixed(2);const tir=Math.round(vals.filter(v=>v>=cfg.tMin&&v<=cfg.tMax).length/vals.length*100);const above=Math.round(vals.filter(v=>v>cfg.tMax).length/vals.length*100);return(<div style={{display:"flex",gap:8,marginTop:8}}>{[["Moyenne",avg+" g/L",C.blue],["Temps cible",tir+"%",tir>=70 ? C.green : C.orange],["Au-dessus",above+"%",above>20 ? C.red : C.green]].map(([l,v,col])=><div key={l} style={{flex:1,textAlign:"center",background:col+"11",borderRadius:8,padding:"5px 4px"}}><div style={{fontSize:10,color:C.muted}}>{l}</div><div style={{fontSize:13,fontWeight:700,color:col}}>{v}</div></div>)}</div>);})()} 
      </div>) : (<div style={{background:"#eff6ff",border:"1.5px dashed #93c5fd",borderRadius:12,padding:"14px 16px",marginBottom:12,textAlign:"center"}}><div style={{fontSize:13,color:C.blue,fontWeight:600}}>Aucune courbe - connectez un capteur dans Parametres</div></div>)}
      <AdaptiveBanner allData={allData} cfg={cfg} onApply={nc=>saveAll({...allData,cfg:nc})}/>
      <AnalysePanel dayData={day} dayLabel={fmtDay(activeDay)} cfg={cfg} apiKey={apiKey} allData={allData} refDayIso={activeDay}/>
      {MEALS.map(m=>{const onSave=data=>{const nm={...day.meals||{}};nm[m.id]=data;upDay({meals:nm});};const onDel=()=>{const ms={...day.meals||{}};delete ms[m.id];upDay({meals:ms});};return <MealBlock key={m.id} meal={m} saved={(day.meals&&day.meals[m.id])||null} onSave={onSave} onDelete={onDel} cfg={cfg} curve={day.dexcomCurve||null} apiKey={apiKey} sportProfil={sportProfil}/>;  })}
      <CorrectifBlock entries={day.correctifs||[]} onAdd={e=>upDay({correctifs:[...(day.correctifs||[]),e]})} onDelete={id=>upDay({correctifs:(day.correctifs||[]).filter(x=>x.id!==id)})} cfg={cfg}/>
      <ActivityBlock entries={day.activites||[]} onAdd={e=>upDay({activites:[...(day.activites||[]),e]})} onDelete={id=>upDay({activites:(day.activites||[]).filter(x=>x.id!==id)})} cfg={cfg}/>
    </div>)}

    {tab==="report"&&(<div style={{padding:16,paddingBottom:40}}>
      <div style={{background:"white",border:"1.5px solid "+C.border,borderRadius:14,padding:20,marginBottom:16}}>
        <h2 style={{color:C.red,margin:"0 0 16px",fontSize:16,fontWeight:800}}>Rapport medical</h2>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:16}}>
          <div><Lbl>Du</Lbl><input type="date" value={rFrom} onChange={e=>{setRFrom(e.target.value);setReportHtml(null);}} style={{width:"100%",padding:"9px 12px",border:"1.5px solid "+C.border,borderRadius:8,fontSize:14,fontFamily:"inherit",color:C.text}}/></div>
          <div><Lbl>Au</Lbl><input type="date" value={rTo} onChange={e=>{setRTo(e.target.value);setReportHtml(null);}} style={{width:"100%",padding:"9px 12px",border:"1.5px solid "+C.border,borderRadius:8,fontSize:14,fontFamily:"inherit",color:C.text}}/></div>
        </div>
        <PBtn onClick={()=>setReportHtml(buildReport(allData,rFrom,rTo))} color={C.red} full>Generer le rapport</PBtn>
      </div>
      {reportHtml&&<div style={{borderRadius:14,overflow:"hidden",border:"1.5px solid "+C.border}}><iframe srcDoc={reportHtml} style={{width:"100%",height:"80vh",border:"none",display:"block"}} title="Rapport"/></div>}
    </div>)}

    {tab==="params"&&(<div style={{padding:"16px 14px 40px"}}>
      <h2 style={{fontSize:15,fontWeight:700,color:C.text,marginBottom:16}}>Parametres</h2>
      <LibreLive allData={allData} saveAll={saveAll} cfg={cfg}/>
      <ConfigPanel cfg={cfg} onSave={c=>saveAll({...allData,cfg:{...cfg,...c}})} allData={allData}/>
      <div style={{borderRadius:14,border:"1.5px solid "+C.blue,background:"#eff6ff",marginBottom:12,padding:"14px 16px"}}>
        <div style={{fontWeight:700,color:C.blue,fontSize:15,marginBottom:4}}>Connexion Dexcom</div>
        <DexcomLive allData={allData} saveAll={saveAll} cfg={cfg}/>
      </div>
      <ClarityImporter allData={allData} saveAll={saveAll}/>
    </div>)}
  </div>);
}
