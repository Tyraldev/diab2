import { useState, useEffect, useRef } from "react";

const SK = "diabete-v5";
const DEF = { tMin:0.9, tMax:1.8, ratioIC:10, fc:0.5, ciblePre:1.2, lenteHab:"" };

function useStorage() {
  const [data, setData] = useState(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SK);
      if (raw) { try { setData(JSON.parse(raw)); } catch(e) { setData({ days:{}, cfg:DEF }); } }
      else setData({ days:{}, cfg:DEF });
    } catch(e) { setData({ days:{}, cfg:DEF }); }
    setReady(true);
  }, []);
  const save = (d) => { setData(d); try { localStorage.setItem(SK, JSON.stringify(d)); } catch(e) {} };
  return [data || { days:{}, cfg:DEF }, save, ready];
}

const toISO = (d) => d.toISOString().split("T")[0];
const TODAY = () => toISO(new Date());
const nowTime = () => new Date().toTimeString().slice(0,5);
const prevDay = (iso) => toISO(new Date(new Date(iso+"T12:00:00").getTime()-86400000));
const fmtDay = (s) => new Date(s+"T12:00:00").toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long"});
const fmtShort = (s) => { const d=new Date(s+"T12:00:00"); return { wd:d.toLocaleDateString("fr-FR",{weekday:"short"}).slice(0,3), day:d.getDate() }; };
const f2b64 = (f) => new Promise((r,j)=>{ const fr=new FileReader(); fr.onload=()=>r(fr.result); fr.onerror=j; fr.readAsDataURL(f); });

const MEALS = [
  { id:"breakfast", label:"Petit-dejeuner", tag:"Matin", color:"#d97706" },
  { id:"lunch",     label:"Dejeuner",        tag:"Midi",  color:"#16a34a" },
  { id:"dinner",    label:"Diner",            tag:"Soir",  color:"#0284c7" },
];

const C = {
  bg:"#f7f3ef", card:"#fff", border:"#e8e0d8", text:"#2d2416", muted:"#8b7355",
  red:"#dc2626", green:"#16a34a", orange:"#d97706", blue:"#0284c7", purple:"#7c3aed"
};

function glyColor(v,cfg) {
  if(!v) return C.muted;
  const n=parseFloat(v), mn=(cfg||DEF).tMin, mx=(cfg||DEF).tMax;
  if(n<0.7) return C.red;
  if(n>=mn&&n<=mx) return C.green;
  if(n<=mx+0.3) return C.orange;
  return C.red;
}
function glyLabel(v,cfg) {
  if(!v) return "";
  const n=parseFloat(v), mn=(cfg||DEF).tMin, mx=(cfg||DEF).tMax;
  if(n<0.7) return "Hypo";
  if(n>=mn&&n<=mx) return "Dans la cible";
  if(n<mn) return "En dessous";
  if(n<=mx+0.3) return "Acceptable";
  return "Au-dessus";
}
function getClosestGly(curve,timeStr) {
  if(!curve||!curve.length) return null;
  const [h,m]=timeStr.split(":").map(Number); const tMin=h*60+m;
  let best=null,bestDiff=Infinity;
  curve.forEach(p=>{ const [ph,pm]=p.time.split(":").map(Number); const diff=Math.abs(ph*60+pm-tMin); if(diff<bestDiff&&diff<=30){ bestDiff=diff; best=p; } });
  return best;
}

function getHDRS(apiKey) {
  return { "Content-Type":"application/json", "x-api-key":apiKey, "anthropic-version":"2023-06-01", "anthropic-dangerous-direct-browser-access":"true" };
}

//    LOCAL CARB DATABASE (g glucides per portion)                              
// Base d'aliments courants - glucides pour la portion indiquee
const FOOD_DB = [
  // Feculents
  { kw:["pain","baguette","tartine"], unit:"tranche", g:15, def:2, label:"pain" },
  { kw:["pain complet","pain de mie"], unit:"tranche", g:12, def:2, label:"pain complet" },
  { kw:["pates","spaghetti","macaroni","penne","tagliatelle"], unit:"portion", g:50, def:1, label:"pates (cuites ~150g)" },
  { kw:["riz"], unit:"portion", g:45, def:1, label:"riz (cuit ~150g)" },
  { kw:["pomme de terre","patate","puree"], unit:"portion", g:30, def:1, label:"pommes de terre" },
  { kw:["frites"], unit:"portion", g:45, def:1, label:"frites (~150g)" },
  { kw:["semoule","couscous","boulgour","quinoa"], unit:"portion", g:45, def:1, label:"semoule/couscous" },
  { kw:["lentilles","haricots","pois chiches","flageolets"], unit:"portion", g:30, def:1, label:"legumineuses" },
  { kw:["cereales","muesli","corn flakes"], unit:"bol", g:30, def:1, label:"cereales" },
  { kw:["avoine","flocons"], unit:"portion", g:25, def:1, label:"flocons avoine" },
  // Viennoiserie / sucre
  { kw:["croissant"], unit:"piece", g:25, def:1, label:"croissant" },
  { kw:["pain au chocolat","chocolatine"], unit:"piece", g:30, def:1, label:"pain au chocolat" },
  { kw:["biscuit","cookie","gateau sec"], unit:"piece", g:8, def:2, label:"biscuit" },
  { kw:["gateau","part de gateau"], unit:"part", g:35, def:1, label:"gateau" },
  { kw:["sucre","morceau de sucre"], unit:"morceau", g:5, def:1, label:"sucre" },
  { kw:["confiture","miel"], unit:"cuillere", g:12, def:1, label:"confiture/miel" },
  { kw:["nutella","pate a tartiner"], unit:"cuillere", g:10, def:1, label:"pate a tartiner" },
  { kw:["chocolat"], unit:"carre", g:5, def:2, label:"chocolat" },
  // Fruits
  { kw:["pomme"], unit:"piece", g:20, def:1, label:"pomme" },
  { kw:["banane"], unit:"piece", g:25, def:1, label:"banane" },
  { kw:["orange"], unit:"piece", g:15, def:1, label:"orange" },
  { kw:["poire"], unit:"piece", g:20, def:1, label:"poire" },
  { kw:["raisin"], unit:"portion", g:25, def:1, label:"raisin (~150g)" },
  { kw:["fraise","framboise","fruits rouges"], unit:"portion", g:10, def:1, label:"fruits rouges" },
  { kw:["kiwi","clementine","mandarine"], unit:"piece", g:10, def:1, label:"petit fruit" },
  { kw:["jus de fruit","jus d orange","jus"], unit:"verre", g:25, def:1, label:"jus de fruit" },
  // Produits laitiers
  { kw:["yaourt","yogourt"], unit:"pot", g:10, def:1, label:"yaourt" },
  { kw:["yaourt sucre","yaourt aux fruits"], unit:"pot", g:18, def:1, label:"yaourt sucre" },
  { kw:["lait"], unit:"verre", g:12, def:1, label:"lait" },
  { kw:["fromage blanc"], unit:"portion", g:8, def:1, label:"fromage blanc" },
  // Boissons sucrees
  { kw:["soda","coca","limonade","sirop"], unit:"verre", g:25, def:1, label:"boisson sucree" },
  // Plats
  { kw:["pizza"], unit:"part", g:30, def:2, label:"pizza" },
  { kw:["sandwich"], unit:"piece", g:50, def:1, label:"sandwich" },
  { kw:["burger","hamburger"], unit:"piece", g:40, def:1, label:"burger" },
  { kw:["quiche","tarte salee"], unit:"part", g:25, def:1, label:"quiche" },
  { kw:["soupe","potage"], unit:"bol", g:15, def:1, label:"soupe" },
];

const NUM_WORDS = { un:1, une:1, deux:2, trois:3, quatre:4, cinq:5, six:6, sept:7, huit:8, demi:0.5, "1/2":0.5 };

function estimateCarbsLocal(text) {
  const t = " " + text.toLowerCase().replace(/[,;]/g," ").replace(/\s+/g," ") + " ";
  const items = [];
  const used = new Set();

  // Check for explicit grams: "100g de riz", "50 g pates"
  const gramMatches = [...t.matchAll(/(\d+)\s*(?:g|gr|grammes?)\b/g)];

  FOOD_DB.forEach((food, fi) => {
    if (used.has(fi)) return;
    for (const kw of food.kw) {
      const idx = t.indexOf(" " + kw);
      if (idx === -1) continue;
      // Find quantity before the keyword
      const before = t.slice(Math.max(0, idx - 25), idx + 1);
      let qty = food.def;
      // numeric quantity
      const numM = before.match(/(\d+(?:[.,]\d+)?)\s*$/);
      if (numM) qty = parseFloat(numM[1].replace(",", "."));
      else {
        // word quantity
        for (const [w, n] of Object.entries(NUM_WORDS)) {
          if (before.includes(" " + w + " ")) { qty = n; break; }
        }
      }
      // explicit grams override (e.g. "100g de pates")
      const gM = before.match(/(\d+)\s*(?:g|gr|grammes?)\b/);
      let carbs;
      if (gM && (food.unit === "portion" || food.unit === "g")) {
        // estimate from raw weight - use g value as per-100g rough
        const grams = parseFloat(gM[1]);
        carbs = Math.round(food.g * (grams / 100) * (food.unit === "portion" ? (100/150) : 1));
        items.push({ name: food.label + " (" + grams + "g)", glucides: carbs });
      } else {
        carbs = Math.round(food.g * qty);
        const qtyLabel = qty !== food.def || qty !== 1 ? qty + " " + food.unit + (qty > 1 ? "s" : "") + " " : "";
        items.push({ name: qtyLabel + food.label, glucides: carbs });
      }
      used.add(fi);
      break;
    }
  });

  const total = items.reduce((s, it) => s + it.glucides, 0);
  return { total, items, found: items.length > 0 };
}

function parseJSON(txt) {
  if(!txt) return {};
  try {
    let s = txt.trim();
    // strip markdown fences without using backtick characters
    const fence = String.fromCharCode(96,96,96);
    if(s.startsWith(fence+"json")) { const nl=s.indexOf("\n"); if(nl>-1) s=s.slice(nl+1); }
    else if(s.startsWith(fence)) { const nl=s.indexOf("\n"); if(nl>-1) s=s.slice(nl+1); }
    if(s.endsWith(fence)) { const nl=s.lastIndexOf("\n"); if(nl>-1) s=s.slice(0,nl); }
    s=s.trim();
    const a=s.indexOf("{"), b=s.lastIndexOf("}");
    if(a===-1||b===-1) return {};
    let j=s.slice(a,b+1);
    try { return JSON.parse(j); } catch(_) {}
    // replace smart quotes
    j=j.replace(/[\u2018\u2019]/g,"\u0027").replace(/[\u201c\u201d]/g,"\u0022");
    try { return JSON.parse(j); } catch(_) {}
    // strip non-latin chars
    j=j.replace(/[^\t\n\r\x20-\x7e\xc0-\xff]/g," ");
    try { return JSON.parse(j); } catch(_) {}
    // fallback extraction
    const o={resume:"",observations:[],correlations:[],recommandations:[],score_equilibre:5,conseils_dosage:[]};
    const m1=j.match(/"resume"\s*:\s*"([^"]*)"/); if(m1) o.resume=m1[1];
    const m2=j.match(/"score_equilibre"\s*:\s*(\d+)/); if(m2) o.score_equilibre=parseInt(m2[1]);
    const mr=j.match(/"recommandations"\s*:\s*\[([^\]]*)\]/s);
    if(mr){ const ri=mr[1].match(/"([^"]+)"/g); if(ri) o.recommandations=ri.map(x=>x.replace(/"/g,"")); }
    return o;
  } catch(_) {
    return {resume:"Format incorrect. Relancez.",observations:[],correlations:[],recommandations:[],score_equilibre:5,conseils_dosage:[]};
  }
}

async function aiGlucides(desc, apiKey) {
  const prompt = "Tu es un dieteticien expert. Estime les glucides de ce repas: " + desc +
    "\n\nReponds UNIQUEMENT avec un objet JSON valide, sans texte avant ni apres, sans balises markdown. " +
    "Format exact: {\"total\": nombre_grammes, \"confidence\": \"haute ou moyenne ou approximative\", " +
    "\"items\": [{\"name\": \"aliment\", \"glucides\": nombre}], \"conseil\": \"court conseil\"}";
  let res;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: getHDRS(apiKey),
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 1000,
        messages: [{ role: "user", content: prompt }]
      })
    });
  } catch(e) { throw new Error("Connexion impossible: " + e.message); }
  if (!res.ok) {
    let msg = "";
    try { const ed = await res.json(); msg = (ed.error && ed.error.message) || ""; } catch(_) {}
    throw new Error("Erreur API " + res.status + (msg ? " - " + msg : ""));
  }
  let d;
  try { d = await res.json(); } catch(e) { throw new Error("Reponse illisible"); }
  const txt = ((d.content && d.content.find(c => c.type === "text")) || {}).text || "{}";
  const result = parseJSON(txt);
  if (!result || !result.total) throw new Error("Reponse IA vide. Reessayez.");
  return result;
}

async function aiAnalyse(dayCtx,cfg,apiKey) {
  const lines=["Parametres: cible "+cfg.tMin+"-"+cfg.tMax+" g/L, ratio IC: 1UI/"+cfg.ratioIC+"g, FC: "+cfg.fc+" g/L par UI"];
  lines.push("Journee: "+dayCtx.label);
  MEALS.forEach(m=>{
    const meal=dayCtx.meals&&dayCtx.meals[m.id];
    if(!meal) return;
    const b=(parseFloat(meal.insulineRapide||0)+parseFloat(meal.bolusCorrection||0));
    const gp=meal.glyManuelle||meal.glycemieAuto;
    lines.push(m.label+" "+meal.time+":"
      +(meal.desc?" desc:"+meal.desc:"")
      +(meal.glucides?" glucides:"+meal.glucides+"g":"")
      +(gp?" gly_pre:"+gp+" g/L":"")
      +(b>0?" bolus_injecte:"+b.toFixed(1)+" UI":"")
      +(meal.doseSuggeree?" dose_suggeree:"+meal.doseSuggeree+" UI":""));
  });
  if(dayCtx.insulins&&dayCtx.insulins.length>0) {
    dayCtx.insulins.filter(i=>i.type==="lente").forEach(i=>lines.push("Lente "+i.time+": "+i.units+" UI"));
  }
  if(dayCtx.dexcomCurve&&dayCtx.dexcomCurve.length>0) {
    const vals=dayCtx.dexcomCurve.map(p=>parseFloat(p.value));
    const avg=(vals.reduce((s,v)=>s+v,0)/vals.length).toFixed(2);
    const tir=Math.round(vals.filter(v=>v>=cfg.tMin&&v<=cfg.tMax).length/vals.length*100);
    lines.push("Courbe Dexcom: moy="+avg+" g/L, tir="+tir+"%");
  }
  const ctx=lines.join("\n");
  const instr="JSON brut valide uniquement. Champs: resume, observations:[{heure,type,texte}], correlations:[{texte}], recommandations:[string], score_equilibre:1-10, conseils_dosage:[{repas,gly_pre,glucides,dose_injectee,dose_ideale,ecart,explication}]";
  const fullPrompt = "Tu es un diabetologue bienveillant. Glycemies dans la cible = bien. Encourage les progres.\n\n" + ctx + "\n\n" + instr;
  let res;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: getHDRS(apiKey),
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 1000,
        messages: [{ role: "user", content: fullPrompt }]
      })
    });
  } catch(e) { throw new Error("Connexion impossible: " + e.message); }
  if (!res.ok) {
    let msg = "";
    try { const ed = await res.json(); msg = (ed.error && ed.error.message) || ""; } catch(_) {}
    throw new Error("Erreur API " + res.status + (msg ? " - " + msg : ""));
  }
  let d;
  try { d = await res.json(); } catch(e) { throw new Error("Reponse illisible"); }
  return parseJSON(((d.content&&d.content.find(c=>c.type==="text"))||{}).text||"{}");
}

function parseDexcomCSV(text) {
  text=text.replace(/^\uFEFF/,"").replace(/\r\n/g,"\n").replace(/\r/g,"\n");
  const rows=text.split("\n").filter(r=>r.trim().length>0);
  if(rows.length<2) return {error:"Fichier vide."};
  const sample=rows.slice(0,10).join("\n");
  const delim=(sample.split(";").length>sample.split(",").length)?";":","  ;
  function split(line) {
    const res=[]; let cur="",inq=false;
    for(let i=0;i<line.length;i++) {
      const c=line[i];
      if(c==='"'){inq=!inq;continue;}
      if(c===delim&&!inq){res.push(cur.trim());cur="";continue;}
      cur+=c;
    }
    res.push(cur.trim()); return res;
  }
  const tsKw=["timestamp","horodatage","date","heure","time"];
  const gluKw=["glucose","glyc"];
  let hdr=-1;
  for(let i=0;i<Math.min(rows.length,30);i++) {
    const lo=rows[i].toLowerCase();
    if(tsKw.some(k=>lo.includes(k))&&gluKw.some(k=>lo.includes(k))){hdr=i;break;}
    if(lo.includes("mg/dl")||lo.includes("mmol")){hdr=i;break;}
  }
  if(hdr===-1) {
    const anyDate=/\d{2}[\-\/]\d{2}[\-\/]\d{2,4}|\d{4}[\-\/]\d{2}[\-\/]\d{2}/;
    for(let i=0;i<rows.length-1;i++) {
      if(anyDate.test(rows[i+1])&&!anyDate.test(rows[i])){hdr=i;break;}
    }
  }
  if(hdr===-1) return {error:"En-tete non trouve. Apercu: "+rows.slice(0,3).map(r=>r.slice(0,60)).join(" | ")};
  const hdrs=split(rows[hdr]).map(h=>h.toLowerCase().replace(/['"]/g,"").trim());
  let tsi=hdrs.findIndex(h=>tsKw.some(k=>h.includes(k)));
  let gli=hdrs.findIndex(h=>gluKw.some(k=>h.includes(k)));
  let evi=hdrs.findIndex(h=>h.includes("event")||h.includes("evenement")||h.includes("type d"));
  if(tsi===-1||gli===-1) {
    const anyDate2=/\d{2}[\-\/]\d{2}[\-\/]\d{2,4}|\d{4}[\-\/]\d{2}[\-\/]\d{2}/;
    for(let i=hdr+1;i<Math.min(hdr+15,rows.length);i++) {
      const cols=split(rows[i]);
      if(tsi===-1){const ti=cols.findIndex(c=>anyDate2.test(c));if(ti>=0)tsi=ti;}
      if(gli===-1&&tsi>=0){const gi=cols.findIndex((c,ci)=>{const n=parseFloat(c.replace(",","."));return !isNaN(n)&&n>1&&n<500&&ci!==tsi;});if(gi>=0)gli=gi;}
      if(tsi>=0&&gli>=0)break;
    }
  }
  if(tsi===-1||gli===-1) return {error:"Colonnes non trouvees. En-tetes: "+hdrs.join(" | ").slice(0,150)};
  const gh=hdrs[gli]||"";
  let unit=gh.includes("mmol")?"mmol":"mgdl";
  const samples=[];
  for(let i=hdr+1;i<Math.min(hdr+30,rows.length);i++) {
    const c=split(rows[i]);if(c.length<=gli)continue;
    const v=parseFloat(c[gli].replace(",","."));
    if(!isNaN(v)&&v>0){samples.push(v);if(samples.length>=8)break;}
  }
  if(samples.length>0) {
    const avg=samples.reduce((s,v)=>s+v,0)/samples.length;
    if(avg>20)unit="mgdl"; else if(avg>2)unit="mmol"; else unit="gl";
  }
  function toGL(raw) {
    const v=parseFloat(raw.replace(",","."));
    if(isNaN(v))return null;
    if(unit==="mgdl")return (v/100).toFixed(2);
    if(unit==="mmol")return (v*0.018).toFixed(2);
    return v.toFixed(2);
  }
  function parseDate(ts) {
    ts=ts.trim();
    let m=ts.match(/^(\d{4})[\-\/](\d{2})[\-\/](\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/);
    if(m) return new Date(m[1]+"-"+m[2]+"-"+m[3]+"T"+(m[4]||"12")+":"+(m[5]||"00")+":"+(m[6]||"00"));
    m=ts.match(/^(\d{2})[\-\/](\d{2})[\-\/](\d{4})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/);
    if(m) return new Date(m[3]+"-"+m[2]+"-"+m[1]+"T"+(m[4]||"12")+":"+(m[5]||"00")+":"+(m[6]||"00"));
    return null;
  }
  const byDay={};
  const anyDate3=/\d{2}[\-\/]\d{2}[\-\/]\d{2,4}|\d{4}[\-\/]\d{2}[\-\/]\d{2}/;
  for(let i=hdr+1;i<rows.length;i++) {
    const row=rows[i].trim();if(!row)continue;
    const cols=split(row);
    if(cols.length<=Math.max(tsi,gli))continue;
    const ts=cols[tsi]?cols[tsi].replace(/['"]/g,""):"";
    if(!ts||!anyDate3.test(ts))continue;
    const rawGlu=cols[gli]?cols[gli].replace(/['"]/g,"").trim():"";
    if(!rawGlu||/low|high|faible|eleve/i.test(rawGlu))continue;
    if(evi>=0&&evi<cols.length&&cols[evi]) {
      const ev=cols[evi].toLowerCase().replace(/['"]/g,"").trim();
      if(ev&&ev!=="egv"&&!ev.includes("glucose")&&!ev.includes("glyc")&&ev!=="")continue;
    }
    const gl=toGL(rawGlu);if(!gl)continue;
    const gf=parseFloat(gl);if(gf<0.3||gf>5.5)continue;
    const dt=parseDate(ts);if(!dt||isNaN(dt.getTime()))continue;
    const dk=toISO(dt),tm=dt.toTimeString().slice(0,5);
    if(!byDay[dk])byDay[dk]=[];
    byDay[dk].push({time:tm,value:gl,ts:dt.toISOString()});
  }
  if(Object.keys(byDay).length===0) return {error:"Aucune valeur extraite. Delimiteur: "+delim+", Unite: "+unit+", Lignes: "+rows.length};
  return byDay;
}

function Pill({color,children}){return <span style={{background:"rgba(0,0,0,0.06)",color,border:"1px solid "+color,borderRadius:20,padding:"2px 10px",fontSize:11,fontWeight:700}}>{children}</span>;}
function PBtn({onClick,color,children,disabled,full,small}){return <button onClick={onClick} disabled={disabled} style={{width:full?"100%":"auto",padding:small?"6px 12px":"10px 18px",background:disabled?"#ccc":color,color:"white",border:"none",borderRadius:10,fontWeight:700,fontSize:small?12:14,cursor:disabled?"not-allowed":"pointer",fontFamily:"inherit"}}>{children}</button>;}
function OBtn({onClick,color,children,small}){return <button onClick={onClick} style={{padding:small?"5px 12px":"8px 16px",background:"transparent",color,border:"2px solid "+color,borderRadius:8,fontWeight:700,fontSize:small?12:13,cursor:"pointer",fontFamily:"inherit"}}>{children}</button>;}
function Lbl({children}){return <label style={{display:"block",color:C.muted,fontSize:11,fontWeight:700,marginBottom:4,textTransform:"uppercase",letterSpacing:0.5}}>{children}</label>;}
function TInput({value,onChange,placeholder,type,step,min}){return <input type={type||"text"} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} step={step} min={min} style={{width:"100%",padding:"9px 12px",border:"1.5px solid "+C.border,borderRadius:8,fontSize:14,color:C.text,fontFamily:"inherit",outline:"none",boxSizing:"border-box",background:"white"}}/>;}
function TTime({value,onChange}){return <input type="time" value={value} onChange={e=>onChange(e.target.value)} style={{padding:"9px 12px",border:"1.5px solid "+C.border,borderRadius:8,fontSize:14,color:C.text,fontFamily:"inherit"}}/>;}

function DayCurve({pts,insulins,meals,cfg,width,height}){
  if(!pts||pts.length<2) return null;
  const mn=(cfg||DEF).tMin, mx=(cfg||DEF).tMax;
  const vals=pts.map(p=>parseFloat(p.value));
  const times=pts.map(p=>{const [h,m]=p.time.split(":").map(Number);return h*60+m;});
  const minT=Math.min(...times),maxT=Math.max(...times);
  const minV=0.4,maxV=Math.max(3.2,Math.max(...vals)+0.3);
  const pL=32,pR=8,pT=10,pB=24;
  const W=width-pL-pR,H=height-pT-pB;
  const tx=t=>pL+((t-minT)/(maxT-minT||1))*W;
  const ty=v=>pT+(1-(v-minV)/(maxV-minV))*H;
  const ptStr=pts.map((_,i)=>tx(times[i])+","+ty(vals[i])).join(" ");
  const hours=[];
  for(let h=0;h<=23;h++) if(h*60>=minT&&h*60<=maxT) hours.push(h);
  const iMarkers=(insulins||[]).map(ins=>{
    const [ih,im]=ins.time.split(":").map(Number),it=ih*60+im;
    if(it<minT||it>maxT)return null;
    return {x:tx(it),col:ins.type==="lente"?C.blue:C.red,lbl:ins.units+"UI "+(ins.type==="lente"?"L":"R")};
  }).filter(Boolean);
  const mMarkers=(meals?Object.entries(meals):[]).map(([mid,meal])=>{
    if(!meal)return null;
    const [mh,mm]=meal.time.split(":").map(Number),mt=mh*60+mm;
    if(mt<minT||mt>maxT)return null;
    const mDef=MEALS.find(m=>m.id===mid);
    return {x:tx(mt),col:mDef?mDef.color:C.orange,lbl:meal.glucides?meal.glucides+"g":""};
  }).filter(Boolean);
  return (<svg width={width} height={height} style={{display:"block"}}>
    <rect x={pL} y={ty(mx)} width={W} height={Math.abs(ty(mn)-ty(mx))} fill="rgba(22,163,74,0.08)"/>
    {[0.7,mn,mx,2.0].map(v=>(<g key={v}>
      <line x1={pL} y1={ty(v)} x2={pL+W} y2={ty(v)} stroke={v===mn||v===mx?"#16a34a55":"#e5e7eb"} strokeWidth={v===mn||v===mx?"1.5":"1"} strokeDasharray="3,3"/>
      <text x={pL-4} y={ty(v)+4} textAnchor="end" fontSize="9" fill="#9ca3af">{v}</text>
    </g>))}
    {hours.filter((_,i)=>i%3===0).map(h=>(<g key={h}>
      <line x1={tx(h*60)} y1={pT+H} x2={tx(h*60)} y2={pT+H+4} stroke="#d1d5db" strokeWidth="1"/>
      <text x={tx(h*60)} y={pT+H+14} textAnchor="middle" fontSize="8" fill="#9ca3af">{h+"h"}</text>
    </g>))}
    <polyline points={ptStr} fill="none" stroke={C.blue} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round"/>
    {pts.filter((_,i)=>i%6===0).map((_,i)=>{const ri=i*6;const v=vals[ri];const col=v<0.7?C.red:v>=(cfg||DEF).tMin&&v<=(cfg||DEF).tMax?C.green:v<=(cfg||DEF).tMax+0.3?C.orange:C.red;return <circle key={ri} cx={tx(times[ri])} cy={ty(v)} r="2" fill={col}/>;  })}
    {mMarkers.map((m,i)=><g key={"m"+i}>
      <polygon points={m.x+","+(pT+H-2)+" "+(m.x-5)+","+(pT+H-10)+" "+(m.x+5)+","+(pT+H-10)} fill={m.col} opacity="0.8"/>
      {m.lbl&&<text x={m.x} y={pT+H-12} textAnchor="middle" fontSize="8" fill={m.col} fontWeight="bold">{m.lbl}</text>}
    </g>)}
    {iMarkers.map((m,i)=><g key={"i"+i}>
      <line x1={m.x} y1={pT} x2={m.x} y2={pT+H} stroke={m.col} strokeWidth="1.5" strokeDasharray="3,2" opacity="0.7"/>
      <text x={m.x+3} y={pT+10} fontSize="8" fill={m.col} fontWeight="bold">{m.lbl}</text>
    </g>)}
  </svg>);
}

function GlucidesAI({initDesc,onAccept,apiKey}){
  const [desc,setDesc]=useState(initDesc||"");
  const [res,setRes]=useState(null);
  const [aiRes,setAiRes]=useState(null);
  const [loading,setLoading]=useState(false);
  const [err,setErr]=useState(null);
  // Local estimation - instant, no API
  const estimate=()=>{
    if(!desc.trim())return;
    setErr(null);setAiRes(null);
    const r=estimateCarbsLocal(desc);
    if(!r.found){setRes({total:0,items:[],found:false});setErr("Aucun aliment reconnu. Essayez avec des mots simples (pain, pates, riz, pomme...) ou saisissez les glucides manuellement.");return;}
    setRes(r);
  };
  // Optional AI enhancement
  const enhance=async()=>{
    if(!desc.trim())return;
    setLoading(true);setErr(null);
    if(!apiKey){setErr("Cle API manquante - ajoutez-la dans Mes parametres");setLoading(false);return;}
    try{setAiRes(await aiGlucides(desc,apiKey));}
    catch(e){setErr("IA indisponible ("+e.message+"). L estimation locale reste valable.");}
    finally{setLoading(false);}
  };
  const active=aiRes||res;
  const cc=aiRes?C.green:C.blue;
  return(<div style={{background:"#fff7ed",border:"1.5px solid "+C.orange,borderRadius:12,padding:16,marginTop:10}}>
    <div style={{fontWeight:700,color:C.orange,fontSize:13,marginBottom:8}}>Estimation des glucides</div>
    <textarea value={desc} onChange={e=>setDesc(e.target.value)} placeholder="Ex: 2 tranches de pain, 1 banane, 1 yaourt..." rows={2}
      style={{width:"100%",padding:"9px 12px",border:"1.5px solid "+C.border,borderRadius:8,fontSize:13,fontFamily:"inherit",resize:"vertical",boxSizing:"border-box",marginBottom:8}}/>
    <div style={{display:"flex",gap:8}}>
      <PBtn onClick={estimate} disabled={!desc.trim()} color={C.blue} full small>Estimer</PBtn>
      <button onClick={enhance} disabled={loading||!desc.trim()} style={{padding:"6px 12px",background:"white",color:C.orange,border:"1.5px solid "+C.orange,borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit",whiteSpace:"nowrap"}}>{loading?"...":"+ IA"}</button>
    </div>
    {err&&<div style={{background:"#fffbeb",border:"1px solid #fcd34d",borderRadius:8,padding:"8px 10px",marginTop:8,fontSize:12,color:"#92400e"}}>{err}</div>}
    {active&&active.found!==false&&(<div style={{marginTop:10,background:"white",borderRadius:10,border:"1px solid "+C.border,overflow:"hidden"}}>
      <div style={{background:cc,padding:"8px 12px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span style={{color:"white",fontWeight:800,fontSize:18}}>{active.total+"g"}</span>
        <span style={{color:"white",fontSize:11}}>{aiRes?"estimation IA":"estimation locale"}</span>
      </div>
      <div style={{padding:"10px 12px"}}>
        {active.items&&active.items.map((it,i)=><div key={i} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",borderBottom:"1px solid "+C.border,fontSize:12}}><span>{it.name}</span><span style={{fontWeight:700,color:C.blue}}>{it.glucides+"g"}</span></div>)}
        {aiRes&&aiRes.conseil&&<div style={{marginTop:8,fontSize:12,color:C.orange}}>{aiRes.conseil}</div>}
        <div style={{marginTop:10}}><PBtn onClick={()=>onAccept(active.total)} color={C.green} full small>{"Utiliser "+active.total+"g"}</PBtn></div>
        <div style={{marginTop:6,fontSize:10,color:C.muted,textAlign:"center"}}>Estimation indicative - ajustez selon votre experience</div>
      </div>
    </div>)}
  </div>);
}

function MealBlock({meal,saved,onSave,onDelete,cfg,curve,apiKey}){
  const [open,setOpen]=useState(false);
  const [time,setTime]=useState((saved&&saved.time)||nowTime());
  const [desc,setDesc]=useState((saved&&saved.desc)||"");
  const [glucides,setGlucides]=useState((saved&&saved.glucides)||"");
  const [glyMan,setGlyMan]=useState((saved&&saved.glyManuelle)||"");
  const [insulR,setInsulR]=useState((saved&&saved.insulineRapide)||"");
  const [bolus,setBolus]=useState((saved&&saved.bolusCorrection)||"");
  const [photo,setPhoto]=useState((saved&&saved.photo)||null);
  const [showAI,setShowAI]=useState(false);
  const ref=useRef();
  const glyAuto=curve?getClosestGly(curve,time):null;
  const glyEff=glyMan?parseFloat(glyMan):(glyAuto?parseFloat(glyAuto.value):null);
  const suggest=(cfg&&(glucides||glyEff))?()=>{
    const g=parseFloat(glucides)||0;
    const br=g>0?(g/cfg.ratioIC):0;
    const bc=glyEff&&glyEff>cfg.ciblePre?((glyEff-cfg.ciblePre)/cfg.fc):0;
    return {br:br.toFixed(1),bc:bc.toFixed(1),total:(br+bc).toFixed(1)};
  }:null;
  const sug=suggest?suggest():null;
  const totB=(parseFloat(insulR)||0)+(parseFloat(bolus)||0);
  const save=()=>{
    onSave({time,desc,glucides,glyManuelle:glyMan,insulineRapide:insulR,bolusCorrection:bolus,photo,
      glycemieAuto:glyAuto?glyAuto.value:null,
      glyEffective:glyEff?glyEff.toFixed(2):null,
      doseSuggeree:sug?sug.total:null});
    setOpen(false);
  };
  return(<div style={{borderRadius:14,border:"1.5px solid "+(saved?meal.color:C.border),background:saved?"rgba(0,0,0,0.01)":"white",marginBottom:10}}>
    <div onClick={()=>setOpen(!open)} style={{padding:"14px 16px",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
      <div style={{display:"flex",alignItems:"center",gap:10}}>
        <span style={{background:meal.color,color:"white",borderRadius:8,padding:"4px 10px",fontSize:12,fontWeight:700}}>{meal.tag}</span>
        <div>
          <div style={{fontWeight:700,color:C.text,fontSize:15}}>{meal.label}</div>
          {saved
            ?<div style={{fontSize:12,color:C.muted}}>
                {saved.time}
                {saved.desc?" - "+saved.desc.slice(0,28)+(saved.desc.length>28?"...":""):""} 
                {saved.glucides&&<span style={{marginLeft:4,color:meal.color,fontWeight:700}}>{saved.glucides+"g"}</span>}
                {(saved.glyEffective||saved.glyManuelle||saved.glycemieAuto)&&<span style={{marginLeft:4,color:glyColor(saved.glyEffective||saved.glyManuelle||saved.glycemieAuto,cfg),fontWeight:700}}>{(saved.glyEffective||saved.glyManuelle||saved.glycemieAuto)+" g/L"}</span>}
                {totB>0&&<span style={{marginLeft:4,color:C.red,fontWeight:700}}>{totB.toFixed(1)+" UI"}</span>}
              </div>
            :<div style={{fontSize:12,color:C.muted}}>Appuyer pour saisir</div>}
        </div>
      </div>
      <div style={{display:"flex",alignItems:"center",gap:8}}>
        {saved&&<Pill color={meal.color}>OK</Pill>}
        <span style={{color:C.muted}}>{open?"^":"v"}</span>
      </div>
    </div>
    {open&&(<div style={{padding:"4px 16px 16px",borderTop:"1px solid "+C.border}}>
      <div style={{display:"grid",gridTemplateColumns:"110px 1fr",gap:12,marginBottom:14,alignItems:"end"}}>
        <div><Lbl>Heure</Lbl><TTime value={time} onChange={setTime}/></div>
        <div><Lbl>Description</Lbl><TInput value={desc} onChange={setDesc} placeholder={meal.label+"..."}/></div>
      </div>
      <div style={{background:"#faf5ff",border:"1.5px solid #c4b5fd",borderRadius:10,padding:"12px 14px",marginBottom:12}}>
        <div style={{fontWeight:700,color:C.purple,fontSize:12,marginBottom:8,textTransform:"uppercase"}}>Glycemie pre-prandiale</div>
        {glyAuto&&!glyMan&&(<div style={{background:glyColor(glyAuto.value,cfg)+"11",border:"1px solid "+glyColor(glyAuto.value,cfg),borderRadius:8,padding:"7px 12px",marginBottom:8,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span style={{fontSize:12,color:C.muted}}>{"Dexcom a "+glyAuto.time}</span>
          <span style={{fontWeight:800,color:glyColor(glyAuto.value,cfg),fontSize:14}}>{glyAuto.value+" g/L - "+glyLabel(glyAuto.value,cfg)}</span>
        </div>)}
        {!curve&&<div style={{fontSize:12,color:C.orange,marginBottom:8}}>Pas de courbe Dexcom - saisie manuelle</div>}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,alignItems:"end"}}>
          <div>
            <Lbl>{glyAuto?"Valeur manuelle (override)":"Valeur manuelle (g/L)"}</Lbl>
            <TInput type="number" value={glyMan} onChange={setGlyMan} placeholder={glyAuto?glyAuto.value+" (Dexcom)":"ex: 1.40"} min="0" step="0.01"/>
          </div>
          <div>{glyEff&&<div style={{padding:"9px 12px",background:glyColor(glyEff.toFixed(2),cfg)+"22",border:"1.5px solid "+glyColor(glyEff.toFixed(2),cfg),borderRadius:8,textAlign:"center"}}>
            <div style={{fontSize:10,color:C.muted}}>{glyMan?"Manuelle":"Dexcom"}</div>
            <div style={{fontWeight:800,color:glyColor(glyEff.toFixed(2),cfg),fontSize:14}}>{glyEff.toFixed(2)+" g/L"}</div>
            <div style={{fontSize:10,color:glyColor(glyEff.toFixed(2),cfg)}}>{glyLabel(glyEff.toFixed(2),cfg)}</div>
          </div>}</div>
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 50px",gap:10,alignItems:"end",marginBottom:4}}>
        <div><Lbl>Glucides (g)</Lbl><TInput type="number" value={glucides} onChange={setGlucides} placeholder="0" min="0"/></div>
        <button onClick={()=>setShowAI(!showAI)} style={{padding:"9px 10px",background:showAI?"#fff7ed":"white",color:C.orange,border:"1.5px solid "+C.orange,borderRadius:8,cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"inherit",width:"100%"}}>IA</button>
      </div>
      {showAI&&<GlucidesAI initDesc={desc} onAccept={v=>{setGlucides(String(v));setShowAI(false);}} apiKey={apiKey}/>}
      {sug&&(<div style={{background:"#fef2f2",border:"1.5px solid #fca5a5",borderRadius:10,padding:"12px 14px",marginTop:12}}>
        <div style={{fontWeight:700,color:C.red,fontSize:12,marginBottom:8,textTransform:"uppercase"}}>Dose suggeree</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6,marginBottom:8}}>
          {[["Bolus repas",sug.br+" UI"],["Correction",sug.bc+" UI"],["Total",sug.total+" UI"]].map(([l,v])=>(<div key={l} style={{textAlign:"center",background:"white",borderRadius:6,padding:"6px 4px"}}><div style={{fontSize:10,color:C.muted}}>{l}</div><div style={{fontWeight:800,color:C.red,fontSize:14}}>{v}</div></div>))}
        </div>
        {glyEff&&<div style={{fontSize:11,color:C.muted,marginBottom:8}}>{"Calc: "+(glucides?glucides+"g / "+cfg.ratioIC+" = "+sug.br+" UI":""  )+(parseFloat(sug.bc)>0?" + ("+glyEff.toFixed(2)+"-"+cfg.ciblePre+") / "+cfg.fc+" = "+sug.bc+" UI":"")}</div>}
        <button onClick={()=>{setInsulR(sug.br);setBolus(sug.bc);}} style={{width:"100%",padding:"6px",background:C.red,color:"white",border:"none",borderRadius:6,fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>Utiliser cette dose</button>
      </div>)}
      <div style={{marginTop:10,display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:6}}>
        <div><Lbl>Bolus repas (UI)</Lbl><TInput type="number" value={insulR} onChange={setInsulR} placeholder="0" min="0" step="0.5"/></div>
        <div><Lbl>Bolus correction (UI)</Lbl><TInput type="number" value={bolus} onChange={setBolus} placeholder="0" min="0" step="0.5"/></div>
      </div>
      {totB>0&&<div style={{background:"#fee2e2",borderRadius:8,padding:"6px 10px",fontSize:13,color:C.red,fontWeight:700,marginBottom:10}}>{"Total injecte: "+totB.toFixed(1)+" UI"}</div>}
      <div style={{marginTop:10}}>
        <Lbl>Photo du repas</Lbl>
        {photo
          ?<div><img src={photo} alt="" style={{maxHeight:130,maxWidth:"100%",borderRadius:8,border:"1px solid "+C.border,display:"block",cursor:"pointer"}} onClick={()=>ref.current.click()}/><button onClick={()=>setPhoto(null)} style={{fontSize:11,color:C.muted,background:"none",border:"none",cursor:"pointer",marginTop:4}}>Supprimer</button></div>
          :<div onClick={()=>ref.current.click()} style={{border:"2px dashed "+C.border,borderRadius:10,padding:"12px",cursor:"pointer",textAlign:"center",background:"#fafaf8",fontSize:13,color:C.muted}}>Ajouter une photo</div>}
        <input ref={ref} type="file" accept="image/*" style={{display:"none"}} onChange={async e=>{if(e.target.files[0])setPhoto(await f2b64(e.target.files[0]));}}  />
      </div>
      <div style={{display:"flex",gap:8,marginTop:12}}>
        <PBtn onClick={save} color={meal.color} full>Enregistrer</PBtn>
        {saved&&<OBtn onClick={()=>{onDelete();setOpen(false);}} color={C.red} small>Sup.</OBtn>}
      </div>
    </div>)}
  </div>);
}

function ConfigPanel({cfg,onSave,allData}){
  const [open,setOpen]=useState(false);
  const [tMin,setTMin]=useState(String(cfg.tMin));
  const [tMax,setTMax]=useState(String(cfg.tMax));
  const [ratio,setRatio]=useState(String(cfg.ratioIC));
  const [fc,setFc]=useState(String(cfg.fc));
  const [cible,setCible]=useState(String(cfg.ciblePre));
  const [lente,setLente]=useState(String(cfg.lenteHab||""));
  const [lenteHeure,setLenteHeure]=useState(String(cfg.lenteHeure||"22:00"));
  const [lenteNom,setLenteNom]=useState(String(cfg.lenteNom||""));
  const [apiKeyInput,setApiKeyInput]=useState(String(cfg.apiKey||""));
  const [rcResult,setRcResult]=useState(null);
  const [rcLoading,setRcLoading]=useState(false);
  const save=()=>{onSave({tMin:parseFloat(tMin)||0.9,tMax:parseFloat(tMax)||1.8,ratioIC:parseFloat(ratio)||10,fc:parseFloat(fc)||0.5,ciblePre:parseFloat(cible)||1.2,lenteHab:lente,lenteHeure,lenteNom,apiKey:apiKeyInput});setOpen(false);};
  const recalc=async()=>{
    setRcLoading(true);setRcResult(null);
    const pts=[];
    Object.entries(allData.days||{}).forEach(([dk,day])=>{
      const curve=day.dexcomCurve;if(!curve)return;
      MEALS.forEach(m=>{
        const meal=day.meals&&day.meals[m.id];
        if(!meal||!meal.glucides)return;
        const gp=meal.glyManuelle?parseFloat(meal.glyManuelle):(meal.glycemieAuto?parseFloat(meal.glycemieAuto):null);
        const di=(parseFloat(meal.insulineRapide||0)+parseFloat(meal.bolusCorrection||0));
        if(!gp||!di)return;
        const [mh,mm]=meal.time.split(":").map(Number);
        const tgt1=mh*60+mm+60,tgt2=mh*60+mm+120;
        const post=curve.filter(p=>{const [ph,pm]=p.time.split(":").map(Number);const t=ph*60+pm;return t>=tgt1&&t<=tgt2;});
        if(!post.length)return;
        const avgPost=post.reduce((s,p)=>s+parseFloat(p.value),0)/post.length;
        pts.push({g:parseFloat(meal.glucides),gp,di,gpost:avgPost,d:dk,r:m.label});
      });
    });
    if(pts.length<3){setRcResult({ok:false,msg:"Pas assez de donnees ("+pts.length+" repas avec Dexcom). Minimum 3 requis."});setRcLoading(false);return;}
    try {
      const prompt="Donnees repas (glucides g, gly_pre g/L, dose_injectee UI, gly_post_1-2h g/L):\n"
        +pts.map(p=>p.d+" "+p.r+": glucides="+p.g+"g, gly_pre="+p.gp+" g/L, dose="+p.di+" UI, gly_post="+p.gpost.toFixed(2)+" g/L").join("\n")
        +"\n\nParametres actuels: ratioIC="+ratio+", fc="+fc+", ciblePre="+cible
        +"\n\nCalcule les parametres optimaux. JSON uniquement: {ratioIC:number,fc:number,ciblePre:number,note:string,fiabilite:string}";
      const res=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:getHDRS(cfg.apiKey||""),
        body:JSON.stringify({model:"claude-sonnet-4-5",max_tokens:1000,
          messages:[{role:"user",content:"Tu es un expert en insulinotherapie. Calcule les parametres depuis ces donnees reelles. Reponds en JSON uniquement.\n\n"+prompt}]})});
      const d=await res.json();
      const r=parseJSON(((d.content&&d.content.find(c=>c.type==="text"))||{}).text||"{}");
      if(r.ratioIC)setRcResult({...r,ok:true,count:pts.length});
      else setRcResult({ok:false,msg:"Calcul impossible."});
    } catch(e){setRcResult({ok:false,msg:"Erreur: "+e.message});}
    setRcLoading(false);
  };
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
      </div><span style={{color:C.muted}}>{open?"^":"v"}</span>
    </div>
    {open&&(<div style={{padding:"4px 16px 16px",borderTop:"1px solid "+C.border}}>
      <div style={{marginBottom:12}}>
        <div style={{fontWeight:700,fontSize:13,marginBottom:8}}>Fourchette glycemique cible (g/L)</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <div><Lbl>Minimum</Lbl><TInput type="number" value={tMin} onChange={setTMin} placeholder="0.9" step="0.1"/></div>
          <div><Lbl>Maximum</Lbl><TInput type="number" value={tMax} onChange={setTMax} placeholder="1.8" step="0.1"/></div>
        </div>
      </div>
      <div style={{marginBottom:12}}>
        <div style={{fontWeight:700,fontSize:13,marginBottom:8}}>Insuline rapide</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
          <div><Lbl>Ratio IC (g/UI)</Lbl><TInput type="number" value={ratio} onChange={setRatio} placeholder="10" step="1" min="1"/><div style={{fontSize:10,color:C.muted,marginTop:2}}>{"1 UI pour "+ratio+"g"}</div></div>
          <div><Lbl>Facteur correction (g/L par UI)</Lbl><TInput type="number" value={fc} onChange={setFc} placeholder="0.5" step="0.05" min="0.1"/><div style={{fontSize:10,color:C.muted,marginTop:2}}>{"1 UI baisse de "+fc+" g/L"}</div></div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <div><Lbl>Cible pre-repas (g/L)</Lbl><TInput type="number" value={cible} onChange={setCible} placeholder="1.2" step="0.1"/></div>
          <div></div>
        </div>
        <div style={{marginTop:12,background:"#eff6ff",borderRadius:10,padding:"12px 14px"}}>
          <div style={{fontWeight:700,color:C.blue,fontSize:12,marginBottom:10,textTransform:"uppercase"}}>Insuline lente - dose fixe quotidienne</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:6}}>
            <div><Lbl>Dose (UI)</Lbl><TInput type="number" value={lente} onChange={setLente} placeholder="ex: 20" step="0.5"/></div>
            <div><Lbl>Heure habituelle</Lbl><TTime value={lenteHeure} onChange={setLenteHeure}/></div>
            <div><Lbl>Nom (ex: Lantus)</Lbl><TInput value={lenteNom} onChange={setLenteNom} placeholder="Lantus..."/></div>
          </div>
          <div style={{fontSize:11,color:C.muted}}>Pre-remplie chaque jour. Modifiez seulement si votre dose change.</div>
        </div>
        <div style={{marginTop:12}}>
          <Lbl>Cle API Anthropic (optionnel, pour l IA)</Lbl>
          <input type="password" value={apiKeyInput} onChange={e=>setApiKeyInput(e.target.value)} placeholder="sk-ant-..."
            style={{width:"100%",padding:"9px 12px",border:"1.5px solid "+(apiKeyInput?"#86efac":C.border),borderRadius:8,fontSize:14,fontFamily:"inherit",boxSizing:"border-box"}}/>
          <div style={{fontSize:10,color:C.muted,marginTop:4}}>console.anthropic.com - stockee uniquement sur votre appareil. Sans cle, l estimation et l analyse locales fonctionnent quand meme.</div>
        </div>
      </div>
      <div style={{background:"#f0fdf4",border:"1px solid #86efac",borderRadius:8,padding:"10px 12px",marginBottom:12,fontSize:12}}>
        <strong style={{color:C.green}}>Exemple: </strong>{"repas "+exG+"g, glyc. "+exGp.toFixed(1)+" g/L - bolus: "+exBR+" UI + correction: "+exBC+" UI = "+(parseFloat(exBR)+parseFloat(exBC)).toFixed(1)+" UI"}
      </div>
      <div style={{display:"flex",gap:8,marginBottom:12}}>
        <PBtn onClick={save} color={C.green} full>Enregistrer</PBtn>
        <OBtn onClick={recalc} color={C.blue} small>{rcLoading?"Calcul...":"Recalculer"}</OBtn>
      </div>
      {rcResult&&(<div style={{background:rcResult.ok?"#f0fdf4":"#fef2f2",border:"1px solid "+(rcResult.ok?"#86efac":"#fca5a5"),borderRadius:8,padding:"12px 14px"}}>
        {rcResult.ok?(<>
          <div style={{fontWeight:700,color:C.green,marginBottom:8}}>{"Calcul sur "+rcResult.count+" repas"}</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:8}}>
            {[["Ratio IC","1UI/"+rcResult.ratioIC+"g"],["Facteur corr.",rcResult.fc+" g/L"],["Cible pre",(rcResult.ciblePre||cible)+" g/L"]].map(([l,v])=>(<div key={l} style={{textAlign:"center",background:"white",borderRadius:6,padding:"6px"}}><div style={{fontSize:10,color:C.muted}}>{l}</div><div style={{fontWeight:800,color:C.green,fontSize:13}}>{v}</div></div>))}
          </div>
          {rcResult.note&&<div style={{fontSize:12,color:C.muted,marginBottom:8}}>{rcResult.note}</div>}
          <PBtn onClick={()=>{setRatio(String(rcResult.ratioIC));setFc(String(rcResult.fc));if(rcResult.ciblePre)setCible(String(rcResult.ciblePre));}} color={C.green} full small>Appliquer</PBtn>
        </>):<div style={{color:C.red,fontSize:13}}>{rcResult.msg}</div>}
      </div>)}
    </div>)}
  </div>);
}

function ClarityImporter({allData,saveAll}){
  const [open,setOpen]=useState(false);
  const [parsed,setParsed]=useState(null);
  const [status,setStatus]=useState(null);
  const [imported,setImported]=useState(false);
  const ref=useRef();
  const handleFile=file=>{
    setStatus(null);setParsed(null);setImported(false);
    const reader=new FileReader();
    reader.onload=e=>{
      const result=parseDexcomCSV(e.target.result);
      if(!result){setStatus({type:"error",msg:"Format non reconnu."});return;}
      if(result.error){setStatus({type:"error",msg:result.error});return;}
      const dc=Object.keys(result).length,pc=Object.values(result).reduce((s,a)=>s+a.length,0);
      setParsed(result);
      setStatus({type:"ok",msg:pc+" mesures sur "+dc+" jour"+(dc>1?"s":"")+"."});
    };
    reader.readAsText(file);
  };
  const doImport=()=>{
    if(!parsed)return;
    const nd={...(allData.days||{})};
    Object.entries(parsed).forEach(([dk,pts])=>{nd[dk]={...(nd[dk]||{}),dexcomCurve:pts};});
    saveAll({...allData,days:nd});
    setImported(true);
    setStatus({type:"success",msg:"Import OK - "+Object.keys(parsed).length+" jour"+(Object.keys(parsed).length>1?"s":"")+" mis a jour."});
  };
  return(<div style={{borderRadius:14,border:"1.5px solid "+C.blue,background:"#eff6ff",marginBottom:12}}>
    <div onClick={()=>setOpen(!open)} style={{padding:"14px 16px",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
      <div style={{display:"flex",alignItems:"center",gap:10}}>
        <span style={{background:C.blue,color:"white",borderRadius:8,padding:"4px 10px",fontSize:12,fontWeight:700}}>CSV</span>
        <div><div style={{fontWeight:700,color:C.text,fontSize:15}}>Importer Dexcom Clarity</div>
          <div style={{fontSize:12,color:C.muted}}>{imported?"Import OK":"clarity.dexcom.com - Export CSV"}</div>
        </div>
      </div><span style={{color:C.muted}}>{open?"^":"v"}</span>
    </div>
    {open&&(<div style={{padding:"4px 16px 16px",borderTop:"1px solid #bfdbfe"}}>
      <div style={{background:"#dbeafe",borderRadius:8,padding:"10px 12px",marginBottom:12,fontSize:12,color:C.blue}}>
        <strong>Export Dexcom Clarity:</strong> clarity.dexcom.com - Rapports - icone export - Telecharger CSV
      </div>
      <div onClick={()=>ref.current.click()} style={{border:"2px dashed "+(parsed?C.green:"#93c5fd"),borderRadius:10,padding:"16px",cursor:"pointer",textAlign:"center",background:parsed?"#f0fdf4":"white",marginBottom:10}}>
        <div style={{fontWeight:700,color:parsed?C.green:C.blue,fontSize:13}}>{parsed?"Fichier charge - cliquer pour changer":"Cliquer pour selectionner le CSV"}</div>
        <div style={{fontSize:11,color:C.muted,marginTop:2}}>.csv</div>
      </div>
      <input ref={ref} type="file" accept=".csv,text/csv" style={{display:"none"}} onChange={e=>{if(e.target.files[0])handleFile(e.target.files[0]);}}/>
      {status&&<div style={{padding:"8px 12px",borderRadius:8,marginBottom:10,fontSize:13,background:status.type==="error"?"#fef2f2":status.type==="success"?"#f0fdf4":"#f0f9ff",color:status.type==="error"?C.red:status.type==="success"?C.green:C.blue,border:"1px solid "+(status.type==="error"?"#fca5a5":status.type==="success"?"#86efac":"#93c5fd")}}>{status.msg}</div>}
      {parsed&&!imported&&(<div style={{marginBottom:10}}>
        {Object.entries(parsed).sort((a,b)=>a[0].localeCompare(b[0])).map(([dk,pts])=>{
          const vals=pts.map(p=>parseFloat(p.value));
          const avg=(vals.reduce((s,v)=>s+v,0)/vals.length).toFixed(2);
          return(<div key={dk} style={{background:"white",borderRadius:8,border:"1px solid "+C.border,padding:"8px 12px",marginBottom:6,display:"flex",justifyContent:"space-between"}}>
            <span style={{fontSize:13,fontWeight:600,textTransform:"capitalize"}}>{fmtDay(dk)}</span>
            <span style={{fontSize:12,color:C.blue,fontWeight:700}}>{pts.length+" pts | moy: "+avg+" g/L"}</span>
          </div>);
        })}
        <button onClick={doImport} style={{width:"100%",padding:"12px",background:C.blue,color:"white",border:"none",borderRadius:10,fontWeight:700,fontSize:14,cursor:"pointer",fontFamily:"inherit",marginTop:4}}>{"Importer "+Object.keys(parsed).length+" jour"+(Object.keys(parsed).length>1?"s":"")}</button>
      </div>)}
    </div>)}
  </div>);
}

//    LOCAL DAY ANALYSIS (no AI needed)                                         
function analyseLocal(dayData, cfg) {
  const curve = dayData.dexcomCurve || [];
  const correctifs = dayData.correctifs || [];
  const meals = dayData.meals || {};
  const insulins = dayData.insulins || [];
  const obs = [];
  const conseils = [];
  const recos = [];

  // Collect meals in chronological order with their pre-prandial glycemia
  const mealList = MEALS
    .map(m => ({ def: m, data: meals[m.id] }))
    .filter(x => x.data)
    .map(x => {
      const d = x.data;
      const glyPre = parseFloat(d.glyManuelle || d.glycemieAuto || d.glyEffective) || null;
      return {
        label: x.def.label,
        time: d.time,
        tMin: (() => { const [h, mm] = (d.time || "12:00").split(":").map(Number); return h * 60 + mm; })(),
        glyPre,
        glucides: parseFloat(d.glucides) || 0,
        doseInj: parseFloat(d.insulineRapide || 0) + parseFloat(d.bolusCorrection || 0),
      };
    })
    .sort((a, b) => a.tMin - b.tMin);

  //    Score from pre-prandial glycemias (the values we actually have)          
  const allGly = mealList.map(m => m.glyPre).filter(v => v);
  let score = 5, resume = "";

  if (allGly.length > 0) {
    const inTarget = allGly.filter(v => v >= cfg.tMin && v <= cfg.tMax).length;
    const pct = Math.round(inTarget / allGly.length * 100);
    const avg = allGly.reduce((s, v) => s + v, 0) / allGly.length;
    score = Math.round(Math.min(10, Math.max(1, pct / 10)));
    resume = "Sur " + allGly.length + " glycemie" + (allGly.length > 1 ? "s" : "") + " pre-prandiale" + (allGly.length > 1 ? "s" : "") + " (moyenne " + avg.toFixed(2) + " g/L), " + inTarget + " sur " + allGly.length + " " + (inTarget > 1 ? "sont" : "est") + " dans votre cible. ";
    if (pct >= 70) resume += "Bon controle avant les repas.";
    else if (avg > cfg.tMax) resume += "Les valeurs sont globalement au-dessus de la cible.";
    else if (avg < cfg.tMin) resume += "Les valeurs sont plutot basses, attention aux hypos.";
    else resume += "Controle perfectible.";
  } else {
    resume = "Renseignez la glycemie avant chaque repas pour obtenir l analyse de vos doses.";
  }

  //    Bonus: refine with Dexcom curve if available                             
  if (curve.length > 0) {
    const vals = curve.map(p => parseFloat(p.value));
    const cAvg = vals.reduce((s, v) => s + v, 0) / vals.length;
    const tir = Math.round(vals.filter(v => v >= cfg.tMin && v <= cfg.tMax).length / vals.length * 100);
    score = Math.round(Math.min(10, Math.max(1, tir / 10)));
    resume = "Courbe Dexcom: moyenne " + cAvg.toFixed(2) + " g/L, " + tir + "% du temps dans la cible. " + (tir >= 70 ? "Bon equilibre." : "Equilibre perfectible.");
    const below = vals.filter(v => v < 0.7).length / vals.length * 100;
    if (below > 1) obs.push({ heure: "", type: "hypo", texte: "Hypoglycemies detectees (" + Math.round(below) + "% sous 0.70 g/L)." });
  }

  //    Per-meal dose analysis                                                   
  mealList.forEach((meal, idx) => {
    if (!meal.glucides) return;
    const glyPre = meal.glyPre;
    const bolusRepas = meal.glucides / cfg.ratioIC;
    const bolusCorr = (glyPre && glyPre > cfg.ciblePre) ? (glyPre - cfg.ciblePre) / cfg.fc : 0;
    const doseIdeale = bolusRepas + bolusCorr;
    const ecart = meal.doseInj > 0 ? Math.round((meal.doseInj - doseIdeale) * 10) / 10 : 0;

    let explication = "Pour " + meal.glucides + "g de glucides, bolus repas theorique de " + bolusRepas.toFixed(1) + " UI";
    if (bolusCorr > 0) explication += " + " + bolusCorr.toFixed(1) + " UI de correction (glycemie " + glyPre.toFixed(2) + " au-dessus de la cible " + cfg.ciblePre + ")";
    explication += " = dose ideale " + doseIdeale.toFixed(1) + " UI. ";
    if (meal.doseInj > 0) {
      if (Math.abs(ecart) < 1) explication += "Votre dose (" + meal.doseInj.toFixed(1) + " UI) etait bien ajustee.";
      else if (ecart > 0) explication += "Vous avez injecte " + ecart + " UI de plus que le theorique.";
      else explication += "Vous avez injecte " + Math.abs(ecart) + " UI de moins que le theorique.";
    }

    // Use NEXT meal's pre-prandial glycemia as a proxy for the response
    const next = mealList[idx + 1];
    if (next && next.glyPre) {
      const gapH = Math.round((next.tMin - meal.tMin) / 60 * 10) / 10;
      explication += " Au repas suivant (" + gapH + "h apres), glycemie de " + next.glyPre.toFixed(2) + " g/L";
      if (next.glyPre > cfg.tMax + 0.2) explication += " : reste elevee, la dose ou la couverture etait insuffisante.";
      else if (next.glyPre < cfg.tMin) explication += " : descendue sous la cible, surveiller le risque d hypo.";
      else explication += " : retour dans la cible, bonne gestion.";
    }

    conseils.push({
      repas: meal.label,
      gly_pre: glyPre ? glyPre.toFixed(2) : "",
      glucides: meal.glucides,
      dose_injectee: meal.doseInj > 0 ? meal.doseInj.toFixed(1) : "0",
      dose_ideale: doseIdeale.toFixed(1),
      ecart: ecart,
      explication: explication,
    });
  });

  //    Observations on pre-meal trend                                           
  const highPre = mealList.filter(m => m.glyPre && m.glyPre > cfg.tMax);
  if (highPre.length >= 2) {
    obs.push({ heure: "", type: "hyper", texte: highPre.length + " glycemies pre-repas au-dessus de la cible. Les doses precedentes (ou l insuline lente) meritent attention." });
  }
  const firstMeal = mealList[0];
  if (firstMeal && firstMeal.glyPre) {
    if (firstMeal.glyPre > cfg.tMax) obs.push({ heure: firstMeal.time, type: "info", texte: "Glycemie elevee au premier repas (" + firstMeal.glyPre.toFixed(2) + " g/L) : peut indiquer une insuline lente du soir insuffisante." });
    else if (firstMeal.glyPre >= cfg.tMin && firstMeal.glyPre <= cfg.tMax) obs.push({ heure: firstMeal.time, type: "ok", texte: "Bon reveil glycemique (" + firstMeal.glyPre.toFixed(2) + " g/L) : insuline lente bien dosee." });
  }

  //    Recommendations                                                          
  const ecarts = conseils.map(c => c.ecart).filter(e => Math.abs(e) >= 1);
  if (ecarts.length >= 2) {
    const avgEcart = ecarts.reduce((s, e) => s + e, 0) / ecarts.length;
    if (avgEcart < -1) recos.push("Vos doses semblent regulierement insuffisantes. Un ratio insuline/glucides plus fort (moins de " + cfg.ratioIC + "g par UI) pourrait aider - a valider avec votre medecin.");
    else if (avgEcart > 1) recos.push("Vos doses semblent regulierement fortes. Un ratio plus faible reduirait le risque d hypoglycemie.");
  }
  if (highPre.length >= 2) recos.push("Glycemies pre-repas souvent hautes : verifiez avec votre medecin si l insuline lente est suffisante.");
  if (recos.length === 0 && conseils.length > 0) recos.push("Continuez a renseigner glycemies et doses : l adaptation des ratios s affinera avec les jours.");

  return { resume, observations: obs, correlations: [], recommandations: recos, score_equilibre: score, conseils_dosage: conseils };
}

function ScreenshotPanel({ value, onChange }){
  const ref=useRef();
  return(<div style={{borderRadius:14,border:"1.5px solid "+(value?C.green:"#fcd34d"),background:value?"#f0fdf4":"#fffbeb",marginBottom:10,padding:"14px 16px"}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:value?10:0}}>
      <div style={{display:"flex",alignItems:"center",gap:10}}>
        <span style={{background:value?C.green:C.orange,color:"white",borderRadius:8,padding:"4px 10px",fontSize:12,fontWeight:700}}>Photo</span>
        <div>
          <div style={{fontWeight:700,color:C.text,fontSize:15}}>Capture courbe Dexcom</div>
          <div style={{fontSize:12,color:C.muted}}>{value?"Capture enregistree":"Capturez votre courbe 24h depuis l app Dexcom"}</div>
        </div>
      </div>
      <label style={{cursor:"pointer",fontSize:12,color:"white",fontWeight:700,background:value?C.green:C.orange,borderRadius:8,padding:"6px 12px"}}>
        {value?"Changer":"Importer"}
        <input ref={ref} type="file" accept="image/*" style={{display:"none"}} onChange={async e=>{if(e.target.files[0])onChange(await f2b64(e.target.files[0]));}}/>
      </label>
    </div>
    {value&&<div><img src={value} alt="" style={{width:"100%",borderRadius:8,border:"1px solid "+C.border,display:"block"}}/>
      <button onClick={()=>onChange(null)} style={{fontSize:11,color:C.muted,background:"none",border:"none",cursor:"pointer",marginTop:6}}>Supprimer la capture</button>
    </div>}
  </div>);
}

function AnalysePanel({dayData,dayLabel,cfg,apiKey}){
  const [open,setOpen]=useState(false);
  const [result,setResult]=useState(null);
  const [loading,setLoading]=useState(false);
  const [err,setErr]=useState(null);
  const hasData=(dayData.meals&&Object.keys(dayData.meals).length>0)||(dayData.insulins&&dayData.insulins.length>0)||(dayData.dexcomCurve&&dayData.dexcomCurve.length>0);
  const run=()=>{
    setErr(null);
    const r=analyseLocal(dayData,cfg);
    setResult(r);
  };
  const enhanceAI=async()=>{
    setLoading(true);setErr(null);
    if(!apiKey){setErr("Cle API manquante - ajoutez-la dans Mes parametres");setLoading(false);return;}
    try{const r=await aiAnalyse({...dayData,label:dayLabel},cfg,apiKey);setResult({...r,_ai:true});}
    catch(e){setErr("IA indisponible ("+e.message+"). L analyse locale ci-dessus reste valable.");}
    finally{setLoading(false);}
  };
  const sc=s=>s>=8?C.green:s>=5?C.orange:C.red;
  return(<div style={{borderRadius:14,border:"1.5px solid "+C.purple,background:"#faf5ff",marginBottom:10}}>
    <div onClick={()=>setOpen(!open)} style={{padding:"14px 16px",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
      <div style={{display:"flex",alignItems:"center",gap:10}}>
        <span style={{background:C.purple,color:"white",borderRadius:8,padding:"4px 10px",fontSize:12,fontWeight:700}}>IA</span>
        <div><div style={{fontWeight:700,color:C.text,fontSize:15}}>Analyse de la veille</div>
          <div style={{fontSize:12,color:C.muted}}>{result?"Score: "+result.score_equilibre+"/10":dayLabel}</div>
        </div>
      </div>
      <div style={{display:"flex",alignItems:"center",gap:8}}>
        {result&&<span style={{fontWeight:800,fontSize:16,color:sc(result.score_equilibre)}}>{result.score_equilibre+"/10"}</span>}
        <span style={{color:C.muted}}>{open?"^":"v"}</span>
      </div>
    </div>
    {open&&(<div style={{padding:"4px 16px 16px",borderTop:"1px solid #ede9fe"}}>
      {!hasData&&<p style={{color:C.muted,fontSize:13,marginBottom:12}}>{"Aucune donnee pour le "+dayLabel}</p>}
      {!result&&(<div style={{marginBottom:12}}>
        <p style={{fontSize:13,color:C.text,marginBottom:10}}>{"Analyse croisee repas/insuline/Dexcom du "+dayLabel}</p>
        <PBtn onClick={run} disabled={loading||!hasData} color={C.purple} full>{loading?"Analyse en cours...":"Lancer l analyse"}</PBtn>
        {err&&<div style={{background:"#fef2f2",border:"1.5px solid #fca5a5",borderRadius:8,padding:"10px 12px",marginTop:10,fontSize:13,color:C.red}}><strong>Erreur:</strong> {err}<br/><button onClick={()=>{setErr(null);run();}} style={{marginTop:8,fontSize:12,color:C.red,background:"none",border:"1px solid #fca5a5",borderRadius:6,padding:"4px 10px",cursor:"pointer",fontFamily:"inherit"}}>Reessayer</button></div>}
      </div>)}
      {result&&(<div>
        <div style={{background:"white",borderRadius:10,padding:14,marginBottom:12,border:"1px solid "+C.border}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
            <span style={{fontWeight:700,fontSize:14}}>Resume</span>
            <div style={{background:sc(result.score_equilibre),borderRadius:8,padding:"4px 12px"}}><div style={{color:"white",fontWeight:800,fontSize:18}}>{result.score_equilibre+"/10"}</div></div>
          </div>
          <p style={{fontSize:13,color:C.text,lineHeight:1.5}}>{result.resume}</p>
        </div>
        {result.conseils_dosage&&result.conseils_dosage.length>0&&(<div style={{marginBottom:12}}>
          <div style={{fontSize:11,fontWeight:700,color:C.red,textTransform:"uppercase",marginBottom:8}}>Analyse des doses</div>
          {result.conseils_dosage.map((d,i)=>{
            const ecart=parseFloat(d.ecart)||0;
            const dc=Math.abs(ecart)<1?C.green:Math.abs(ecart)<3?C.orange:C.red;
            return(<div key={i} style={{background:"white",borderRadius:10,border:"1.5px solid "+dc,padding:"12px 14px",marginBottom:8}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                <span style={{fontWeight:700}}>{d.repas}</span>
                <span style={{background:dc,color:"white",borderRadius:6,padding:"2px 10px",fontSize:12,fontWeight:700}}>{ecart===0?"OK":ecart>0?"+"+ecart+" UI":Math.abs(ecart)+" UI manquantes"}</span>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:6}}>
                {[["Glyc. avant",d.gly_pre,C.purple],["Glucides",(d.glucides||"---")+"g",C.orange],["Injecte",(d.dose_injectee||"---")+" UI",C.red]].map(([l,v,col])=>(<div key={l} style={{textAlign:"center",background:col+"11",borderRadius:8,padding:"6px 4px"}}><div style={{fontSize:10,color:C.muted}}>{l}</div><div style={{fontSize:13,fontWeight:700,color:col}}>{v}</div></div>))}
              </div>
              <div style={{display:"flex",justifyContent:"space-between",background:dc+"11",borderRadius:8,padding:"6px 12px",marginBottom:4}}>
                <span style={{fontSize:12,color:C.muted}}>Dose ideale</span>
                <span style={{fontWeight:800,color:dc,fontSize:15}}>{(d.dose_ideale||"?")+" UI"}</span>
              </div>
              {d.explication&&<p style={{fontSize:12,color:C.muted,margin:0,lineHeight:1.5,marginTop:4}}>{d.explication}</p>}
            </div>);
          })}
        </div>)}
        {result.recommandations&&result.recommandations.length>0&&(<div style={{marginBottom:12}}>
          <div style={{fontSize:11,fontWeight:700,color:C.muted,textTransform:"uppercase",marginBottom:8}}>Recommandations</div>
          {result.recommandations.map((r,i)=><div key={i} style={{padding:"8px 12px",background:"#f0fdf4",borderRadius:8,marginBottom:6,borderLeft:"3px solid "+C.green,fontSize:13}}>{r}</div>)}
        </div>)}
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <OBtn onClick={()=>setResult(null)} color={C.purple} small>Relancer</OBtn>
          {!result._ai&&<button onClick={enhanceAI} disabled={loading} style={{padding:"5px 12px",background:"white",color:C.orange,border:"2px solid "+C.orange,borderRadius:8,fontWeight:700,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>{loading?"...":"Enrichir avec IA"}</button>}
          {result._ai&&<span style={{fontSize:11,color:C.green,fontWeight:700}}>Analyse IA</span>}
        </div>
        {err&&<div style={{background:"#fffbeb",border:"1px solid #fcd34d",borderRadius:8,padding:"8px 10px",marginTop:8,fontSize:12,color:"#92400e"}}>{err}</div>}
      </div>)}
    </div>)}
  </div>);
}

function buildReport(allData,from,to){
  const days=[]; const d=new Date(from+"T12:00:00"),end=new Date(to+"T12:00:00");
  while(d<=end){days.push(toISO(d));d.setDate(d.getDate()+1);}
  const cfg=allData.cfg||DEF;
  const apiKey=cfg.apiKey||"";
  const allG=days.flatMap(day=>((allData.days[day]&&allData.days[day].dexcomCurve)||[]).map(p=>parseFloat(p.value)));
  const avgG=allG.length?(allG.reduce((s,v)=>s+v,0)/allG.length).toFixed(2):"N/A";
  const tir=allG.length?Math.round(allG.filter(v=>v>=cfg.tMin&&v<=cfg.tMax).length/allG.length*100):null;
  const css="*{margin:0;padding:0;box-sizing:border-box}body{font-family:Segoe UI,sans-serif;background:#f8f9fa;color:#2d3748;font-size:13px}"+
    ".hdr{background:linear-gradient(135deg,#1a365d,#2b6cb0);color:white;padding:32px 40px}"+
    ".hdr h1{font-size:24px;font-weight:800;margin-bottom:6px}"+
    ".sum{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;padding:24px 40px;background:white;border-bottom:2px solid #e2e8f0}"+
    ".sbox{text-align:center;padding:14px;background:#f7fafc;border-radius:10px}"+
    ".sbox .v{font-size:24px;font-weight:800;color:#2b6cb0}.sbox .l{font-size:11px;color:#718096;margin-top:4px;text-transform:uppercase}"+
    ".day{padding:20px 40px;border-bottom:2px solid #edf2f7}"+
    ".dh{background:#ebf8ff;border-left:4px solid #2b6cb0;padding:10px 14px;border-radius:0 8px 8px 0;margin-bottom:14px}"+
    ".dh h2{font-size:15px;color:#1a365d;font-weight:800;text-transform:capitalize}"+
    ".card{background:white;border-radius:8px;padding:12px;border:1px solid #e2e8f0;margin-bottom:6px;font-size:13px}"+
    ".card img{max-width:220px;border-radius:6px;margin-top:8px;border:1px solid #e2e8f0;display:block}"+
    ".b{display:inline-block;padding:2px 9px;border-radius:10px;font-size:11px;font-weight:700;margin-right:4px}"+
    ".ftr{padding:20px 40px;text-align:center;color:#a0aec0;font-size:11px;border-top:1px solid #e2e8f0}"+
    "@media print{body{background:white}.day{page-break-inside:avoid}}";
  let body="";
  body+='<div class="hdr"><h1>Rapport Diabete - Dexcom ONE+</h1>';
  body+='<p>'+fmtDay(from)+" au "+fmtDay(to)+'</p>';
  body+='<p style="margin-top:4px;opacity:.7">Genere le '+new Date().toLocaleDateString("fr-FR")+'</p></div>';
  body+='<div class="sum">';
  body+='<div class="sbox"><div class="v">'+days.length+'</div><div class="l">Jours</div></div>';
  body+='<div class="sbox"><div class="v">'+avgG+(avgG!=="N/A"?" g/L":"")+'</div><div class="l">Glycemie moy.</div></div>';
  body+='<div class="sbox"><div class="v">'+( tir!==null?tir+"%":"N/A")+'</div><div class="l">Temps cible</div></div>';
  body+='<div class="sbox"><div class="v">'+cfg.tMin+"-"+cfg.tMax+" g/L"+'</div><div class="l">Fourchette</div></div></div>';
  days.forEach(day=>{
    const dd=allData.days[day]||{};
    body+='<div class="day"><div class="dh"><h2>'+fmtDay(day)+'</h2></div>';
    if(dd.screenshot)body+='<div style="margin-bottom:12px"><div style="font-size:11px;color:#718096;font-weight:700;text-transform:uppercase;margin-bottom:6px">Courbe 24h</div><img src="'+dd.screenshot+'" style="width:100%;border-radius:8px;border:1px solid #e2e8f0"/></div>';
    MEALS.forEach(m=>{
      const meal=dd.meals&&dd.meals[m.id];if(!meal)return;
      const b=(parseFloat(meal.insulineRapide||0)+parseFloat(meal.bolusCorrection||0));
      const glyRep=meal.glyEffective||meal.glyManuelle||meal.glycemieAuto;
      body+='<div class="card">';
      body+='<span class="b" style="background:'+m.color+'22;color:'+m.color+'">'+m.tag+'</span>'+meal.time+" - "+(meal.desc||"---");
      if(meal.glucides)body+=' <span class="b" style="background:#fffff0;color:#b7791f">'+meal.glucides+'g</span>';
      if(glyRep)body+=' <span class="b" style="background:#faf5ff;color:#553c9a">glyc: '+glyRep+' g/L</span>';
      if(b>0)body+=' <span class="b" style="background:#fff5f5;color:#c53030">'+b.toFixed(1)+' UI</span>';
      if(meal.doseSuggeree)body+=' <span class="b" style="background:#f0fff4;color:#276749">suggere: '+meal.doseSuggeree+' UI</span>';
      if(meal.photo)body+='<img src="'+meal.photo+'"/>';
      body+='</div>';
    });
    const lentes=(dd.insulins||[]).filter(i=>i.type==="lente");
    if(lentes.length>0){
      body+='<div class="card"><span class="b" style="background:#ebf8ff;color:#2b6cb0">Lente</span>';
      lentes.forEach(i=>{body+=i.time+" - "+i.units+" UI ";});
      body+='</div>';
    }
    body+='</div>';
  });
  body+='<div class="ftr">Document medical confidentiel - DiabeteTracker</div>';
  return "<!DOCTYPE html><html lang='fr'><head><meta charset='UTF-8'><title>Rapport</title><style>"+css+"</style></head><body>"+body+"</body></html>";
}


//    ADAPTIVE LEARNING                                                         
// Analyse the previous day's glycemic responses and suggest ratio updates
function computeAdaptive(allData, cfg) {
  const days = Object.keys(allData.days || {}).sort().slice(-7); // last 7 days
  const points = [];

  days.forEach(dk => {
    const day = allData.days[dk];
    const curve = day.dexcomCurve;
    if (!curve || curve.length === 0) return;

    MEALS.forEach(m => {
      const meal = day.meals && day.meals[m.id];
      if (!meal || !meal.glucides) return;
      const glyPre = parseFloat(meal.glyManuelle || meal.glycemieAuto);
      const doseInj = parseFloat(meal.insulineRapide || 0) + parseFloat(meal.bolusCorrection || 0);
      if (!glyPre || !doseInj || doseInj < 0.5) return;

      // Find Dexcom values 90-150 min after meal (peak absorption window)
      const [mh, mm] = meal.time.split(":").map(Number);
      const t1 = mh * 60 + mm + 90, t2 = mh * 60 + mm + 150;
      const post = curve.filter(p => {
        const [ph, pm] = p.time.split(":").map(Number);
        const t = ph * 60 + pm;
        return t >= t1 && t <= t2;
      });
      if (post.length === 0) return;
      const glyPost = post.reduce((s, p) => s + parseFloat(p.value), 0) / post.length;

      points.push({ dk, repas: m.label, glyPre, glucides: parseFloat(meal.glucides), doseInj, glyPost });
    });
  });

  if (points.length < 2) return null;

  //    Simple adaptive formulas                                               
  // For each meal: what dose WOULD have brought glyPost to ciblePre?
  // Effect of 1 UI rapid = lowers glucose by fc g/L (after absorbing carbs)
  // glyPost = glyPre - doseInj*fc + glucides/ratioIC_factor
  // Ideal: glyPost_target = cfg.ciblePre
  // => doseIdeal = doseInj + (glyPost - cfg.ciblePre) / cfg.fc

  const icEstimates = []; // estimated ratio IC from each meal
  const fcEstimates = []; // estimated correction factor

  points.forEach(p => {
    const delta = p.glyPre - p.glyPost; // how much did gly drop
    const carbEffect = p.glucides / cfg.ratioIC; // expected rise from carbs (in UI equiv)
    // Net effect of insulin: delta = doseInj * fc - carbRise
    // fc_est = (delta + carbEffect * fc) / doseInj  <-- circular, so use simpler:
    // If glyPre was at target (within 0.1), the correction bolus was 0
    // so all insulin was for carbs: ratioIC_est = glucides / doseInj
    const corrBolus = Math.max(0, (p.glyPre - cfg.ciblePre) / cfg.fc);
    const mealBolus = p.doseInj - corrBolus;
    if (mealBolus > 0.5 && p.glucides > 10) {
      const icEst = p.glucides / mealBolus;
      // Weight by how close post-meal was to target
      const quality = Math.max(0.1, 1 - Math.abs(p.glyPost - cfg.ciblePre));
      icEstimates.push({ v: icEst, w: quality, glyPost: p.glyPost, repas: p.repas, dk: p.dk });
    }
    // For fc: only use correction boluses
    if (corrBolus > 0.3) {
      const expectedDrop = corrBolus * cfg.fc;
      const actualDrop = p.glyPre - p.glyPost;
      // actualDrop includes carb effect too, so subtract expected carb rise
      const expectedCarbRise = (p.glucides / cfg.ratioIC) * cfg.fc; // rough
      const netDrop = actualDrop + expectedCarbRise;
      if (netDrop > 0) fcEstimates.push({ v: netDrop / corrBolus, w: 0.5 });
    }
  });

  if (icEstimates.length === 0) return null;

  // Weighted average with 70% weight on new data, 30% on current config
  const wSum = icEstimates.reduce((s, e) => s + e.w, 0);
  const icNew = icEstimates.reduce((s, e) => s + e.v * e.w, 0) / wSum;
  // Smooth: 60% new + 40% old
  const icSmoothed = Math.round((icNew * 0.6 + cfg.ratioIC * 0.4) * 2) / 2;
  const icChange = icSmoothed - cfg.ratioIC;

  let fcNew = cfg.fc;
  if (fcEstimates.length > 0) {
    const fwSum = fcEstimates.reduce((s, e) => s + e.w, 0);
    const fcRaw = fcEstimates.reduce((s, e) => s + e.v * e.w, 0) / fwSum;
    fcNew = Math.round((fcRaw * 0.5 + cfg.fc * 0.5) * 100) / 100;
  }
  const fcChange = Math.round((fcNew - cfg.fc) * 100) / 100;

  // Only suggest if change is meaningful
  if (Math.abs(icChange) < 0.5 && Math.abs(fcChange) < 0.05) return null;

  // Assess overall post-meal performance
  const avgPost = points.reduce((s, p) => s + p.glyPost, 0) / points.length;
  const pctInTarget = points.filter(p => p.glyPost >= cfg.tMin && p.glyPost <= cfg.tMax).length / points.length * 100;

  let assessment = "";
  if (avgPost > cfg.tMax + 0.2) assessment = "Vos glycemies post-prandiates sont globalement au-dessus de la cible. La dose pourrait etre insuffisante.";
  else if (avgPost < cfg.tMin) assessment = "Vos glycemies post-prandiales sont sous la cible. La dose pourrait etre trop forte.";
  else assessment = "Vos glycemies post-prandiales sont dans une zone acceptable.";

  return {
    ratioIC: icSmoothed,
    fc: Math.round(fcNew * 100) / 100,
    icChange: Math.round(icChange * 10) / 10,
    fcChange,
    points: points.length,
    pctInTarget: Math.round(pctInTarget),
    assessment,
  };
}

function AdaptiveBanner({ allData, cfg, onApply }) {
  const [suggestion, setSuggestion] = useState(null);
  const [dismissed, setDismissed] = useState(false);
  const [applied, setApplied] = useState(false);

  useEffect(() => {
    if (!allData || !cfg) return;
    const result = computeAdaptive(allData, cfg);
    setSuggestion(result);
  }, [allData && JSON.stringify(allData.cfg)]);

  if (!suggestion || dismissed || applied) return null;

  const icDir = suggestion.icChange > 0 ? "augmente" : "reduit";
  const fcDir = suggestion.fcChange > 0 ? "augmente" : "reduit";

  return (
    <div style={{ borderRadius: 12, border: "2px solid " + C.orange, background: "#fffbeb", padding: "14px 16px", marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ background: C.orange, color: "white", borderRadius: 8, padding: "3px 8px", fontSize: 11, fontWeight: 700 }}>ADAPTATIF</span>
          <span style={{ fontWeight: 700, color: C.orange, fontSize: 14 }}>Mise a jour des ratios suggeree</span>
        </div>
        <button onClick={() => setDismissed(true)} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 16 }}>x</button>
      </div>
      <p style={{ fontSize: 12, color: C.muted, marginBottom: 10, lineHeight: 1.5 }}>{suggestion.assessment}</p>
      <p style={{ fontSize: 11, color: C.muted, marginBottom: 12 }}>{"Analyse sur " + suggestion.points + " repas avec courbe Dexcom - " + suggestion.pctInTarget + "% post-prandiaux dans la cible."}</p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
        {[
          ["Ratio IC actuel", cfg.ratioIC + "g/UI", suggestion.ratioIC + "g/UI", suggestion.icChange],
          ["Facteur correction", cfg.fc + " g/L", suggestion.fc + " g/L", suggestion.fcChange],
        ].map(([label, current, proposed, change]) => (
          <div key={label} style={{ background: "white", borderRadius: 10, padding: "10px 12px", border: "1px solid " + C.border }}>
            <div style={{ fontSize: 10, color: C.muted, marginBottom: 4, textTransform: "uppercase" }}>{label}</div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 10, color: C.muted }}>Actuel</div>
                <div style={{ fontWeight: 700, fontSize: 14, color: C.text }}>{current}</div>
              </div>
              <span style={{ color: C.orange, fontSize: 16 }}> </span>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 10, color: C.muted }}>Suggere</div>
                <div style={{ fontWeight: 800, fontSize: 14, color: parseFloat(change) !== 0 ? C.orange : C.green }}>{proposed}</div>
              </div>
            </div>
            {parseFloat(change) !== 0 && (
              <div style={{ fontSize: 10, color: parseFloat(change) > 0 ? C.orange : C.blue, textAlign: "center", marginTop: 4, fontWeight: 600 }}>
                {parseFloat(change) > 0 ? "+" : ""}{change} ({parseFloat(change) > 0 ? "augmente" : "reduit"})
              </div>
            )}
          </div>
        ))}
      </div>
      <div style={{ background: "#fef3c7", borderRadius: 8, padding: "8px 10px", marginBottom: 12, fontSize: 11, color: "#92400e" }}>
        Ces suggestions sont basees sur vos reponses glycemiques recentes. Discutez toujours de tout changement avec votre medecin avant de modifier vos doses.
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <PBtn onClick={() => { onApply({ ...cfg, ratioIC: suggestion.ratioIC, fc: suggestion.fc }); setApplied(true); }} color={C.green} full>
          Appliquer ces ratios
        </PBtn>
        <OBtn onClick={() => setDismissed(true)} color={C.muted} small>Ignorer</OBtn>
      </div>
    </div>
  );
}




//    EXPORT / IMPORT JSON                                                       

function CorrectifBlock({ entries, onAdd, onDelete, cfg }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("bolus");
  const [time, setTime] = useState(nowTime());
  const [gly, setGly] = useState("");
  const [units, setUnits] = useState("");
  const [glucides, setGlucides] = useState("");
  const [note, setNote] = useState("");
  const TYPES = [
    { id:"bolus",     label:"Bolus correctif",  color:C.red,    icon:"Bolus" },
    { id:"resucrage", label:"Resucrage",         color:C.orange, icon:"Sucre" },
    { id:"extra",     label:"Extra / collation", color:C.purple, icon:"Extra" },
  ];
  const typeDef = TYPES.find(t => t.id === type) || TYPES[0];
  const corrSuggested = (() => {
    if (!gly || !cfg) return null;
    const n = parseFloat(gly);
    if (isNaN(n) || n <= cfg.ciblePre) return null;
    return ((n - cfg.ciblePre) / cfg.fc).toFixed(1);
  })();
  const add = () => {
    if (!time) return;
    if (type === "bolus" && !units) return;
    if ((type === "resucrage" || type === "extra") && !glucides) return;
    onAdd({ id:Date.now()+"", type, time, gly, units, glucides, note });
    setGly(""); setUnits(""); setGlucides(""); setNote("");
    // Stay open so user can add another
  };
  const sorted = [...entries].sort((a,b) => a.time.localeCompare(b.time));
  return (
    <div style={{borderRadius:14,border:"1.5px solid "+(entries.length>0?C.red:C.border),background:entries.length>0?"#fff5f5":"white",marginBottom:10}}>
      <div onClick={()=>setOpen(!open)} style={{padding:"14px 16px",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <span style={{background:C.red,color:"white",borderRadius:8,padding:"4px 10px",fontSize:12,fontWeight:700}}>+/-</span>
          <div>
            <div style={{fontWeight:700,color:C.text,fontSize:15}}>Correctifs / Extra</div>
            <div style={{fontSize:12,color:C.muted}}>{entries.length===0?"Bolus correctifs, resucrage, extras":entries.length+" evenement"+(entries.length>1?"s":"")}</div>
          </div>
        </div>
        <span style={{color:C.muted}}>{open?"^":"v"}</span>
      </div>
      {open&&(<div style={{padding:"4px 16px 16px",borderTop:"1px solid #fee2e2"}}>
        {sorted.map(e=>{
          const td=TYPES.find(t=>t.id===e.type)||TYPES[0];
          return(<div key={e.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 10px",background:"white",borderRadius:8,marginBottom:6,border:"1px solid "+td.color+"44"}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <span style={{background:td.color,color:"white",borderRadius:6,padding:"2px 8px",fontSize:11,fontWeight:700}}>{td.icon}</span>
              <div>
                <span style={{fontSize:13,fontWeight:600}}>{e.time}</span>
                {e.gly&&<span style={{marginLeft:6,fontSize:12,color:glyColor(e.gly,cfg),fontWeight:700}}>{"glyc. "+e.gly+" g/L"}</span>}
                {e.units&&<span style={{marginLeft:6,fontSize:12,color:C.red,fontWeight:700}}>{e.units+" UI"}</span>}
                {e.glucides&&<span style={{marginLeft:6,fontSize:12,color:C.orange,fontWeight:700}}>{e.glucides+"g"}</span>}
                {e.note&&<span style={{marginLeft:6,fontSize:11,color:C.muted}}>{e.note}</span>}
              </div>
            </div>
            <button onClick={()=>onDelete(e.id)} style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:16}}>x</button>
          </div>);
        })}
        <div style={{background:"white",borderRadius:10,padding:14,border:"1px solid "+C.border,marginTop:6}}>
          <div style={{display:"flex",gap:6,marginBottom:12}}>
            {TYPES.map(t=>(<button key={t.id} onClick={()=>setType(t.id)} style={{flex:1,padding:"7px 4px",border:"2px solid "+(type===t.id?t.color:C.border),borderRadius:8,background:type===t.id?t.color:"transparent",color:type===t.id?"white":C.muted,cursor:"pointer",fontWeight:700,fontSize:11,fontFamily:"inherit"}}>{t.label}</button>))}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"100px 1fr",gap:10,marginBottom:10}}>
            <div><Lbl>Heure</Lbl><TTime value={time} onChange={setTime}/></div>
            <div><Lbl>Glycemie (g/L)</Lbl><TInput type="number" value={gly} onChange={setGly} placeholder="ex: 2.10" min="0" step="0.01"/></div>
          </div>
          {gly&&(<div style={{padding:"8px 12px",background:glyColor(gly,cfg)+"11",border:"1px solid "+glyColor(gly,cfg),borderRadius:8,marginBottom:10,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span style={{fontSize:12,color:glyColor(gly,cfg),fontWeight:700}}>{glyLabel(gly,cfg)}</span>
            {corrSuggested&&type==="bolus"&&(<span style={{fontSize:12,color:C.red}}>{"Correction suggeree: "}<strong>{corrSuggested+" UI"}</strong><button onClick={()=>setUnits(corrSuggested)} style={{marginLeft:8,padding:"2px 8px",background:C.red,color:"white",border:"none",borderRadius:6,fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>Utiliser</button></span>)}
            {type==="resucrage"&&gly&&parseFloat(gly)<cfg.tMin&&(<span style={{fontSize:12,color:C.orange}}>Regle des 15g : 3 sucres ou 1 jus de fruit</span>)}
          </div>)}
          {type==="bolus"&&(<div style={{marginBottom:10}}><Lbl>Dose injectee (UI)</Lbl><TInput type="number" value={units} onChange={setUnits} placeholder="ex: 4" min="0" step="0.5"/></div>)}
          {(type==="resucrage"||type==="extra")&&(<div style={{marginBottom:10}}><Lbl>{type==="resucrage"?"Glucides ingeres (g)":"Glucides (g)"}</Lbl><TInput type="number" value={glucides} onChange={setGlucides} placeholder={type==="resucrage"?"ex: 15 (3 sucres)":"ex: 20"} min="0" step="1"/></div>)}
          <div style={{marginBottom:10}}><Lbl>Note</Lbl><TInput value={note} onChange={setNote} placeholder="Ex: reveil 3h30 en hyper..."/></div>
          <PBtn onClick={add} disabled={type==="bolus"?!units:!glucides} color={typeDef.color} full>{"Ajouter "+typeDef.label}</PBtn>
        </div>
      </div>)}
    </div>
  );
}

function ExportImport({ allData, saveAll }) {
  const [importing, setImporting] = useState(false);
  const [msg, setMsg] = useState(null);
  const ref = useRef();

  const doExport = () => {
    const json = JSON.stringify(allData, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "diabetetracker-" + toISO(new Date()) + ".json";
    a.click();
    URL.revokeObjectURL(url);
    setMsg({ type: "ok", txt: "Donnees exportees ! Importez ce fichier sur votre autre appareil." });
  };

  const doImport = (file) => {
    setImporting(true); setMsg(null);
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const imported = JSON.parse(e.target.result);
        // Merge: keep existing days, add imported days, imported cfg wins
        const mergedDays = { ...(allData.days || {}), ...(imported.days || {}) };
        const merged = { ...allData, ...imported, days: mergedDays };
        saveAll(merged);
        const dc = Object.keys(imported.days || {}).length;
        setMsg({ type: "ok", txt: "Import reussi ! " + dc + " jour" + (dc > 1 ? "s" : "") + " fusionnes avec vos donnees existantes." });
      } catch(e) {
        setMsg({ type: "err", txt: "Fichier invalide : " + e.message });
      }
      setImporting(false);
    };
    reader.readAsText(file);
  };

  return (
    <div style={{ borderRadius: 14, border: "1.5px solid " + C.border, background: "white", marginBottom: 12 }}>
      <div style={{ padding: "14px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <span style={{ background: C.muted, color: "white", borderRadius: 8, padding: "4px 10px", fontSize: 12, fontWeight: 700 }}>Sync</span>
          <div>
            <div style={{ fontWeight: 700, color: C.text, fontSize: 15 }}>Export / Import donnees</div>
            <div style={{ fontSize: 12, color: C.muted }}>Transferer les donnees entre PC et iPhone</div>
          </div>
        </div>
        <div style={{ background: "#f0f9ff", borderRadius: 8, padding: "10px 12px", marginBottom: 12, fontSize: 12, color: C.blue }}>
          <strong>Comment synchroniser PC et iPhone :</strong><br />
          1. Sur PC : importez le CSV Dexcom, puis cliquez Exporter<br />
          2. Envoyez le fichier .json sur votre iPhone (AirDrop, email, iCloud...)<br />
          3. Sur iPhone : cliquez Importer et selectionnez le fichier<br />
          Les donnees existantes sont conservees et fusionnees.
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <PBtn onClick={doExport} color={C.blue} full>Exporter mes donnees (.json)</PBtn>
          <button onClick={() => ref.current.click()} disabled={importing}
            style={{ padding: "10px 14px", background: "white", color: C.green, border: "2px solid " + C.green, borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>
            {importing ? "..." : "Importer"}
          </button>
          <input ref={ref} type="file" accept=".json,application/json" style={{ display: "none" }}
            onChange={e => { if (e.target.files[0]) doImport(e.target.files[0]); }} />
        </div>
        {msg && (
          <div style={{ marginTop: 10, padding: "8px 12px", borderRadius: 8, fontSize: 13,
            background: msg.type === "ok" ? "#f0fdf4" : "#fef2f2",
            color: msg.type === "ok" ? C.green : C.red,
            border: "1px solid " + (msg.type === "ok" ? "#86efac" : "#fca5a5") }}>
            {msg.txt}
          </div>
        )}
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

  if(!ready)return(<div style={{background:C.bg,minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"Segoe UI,sans-serif"}}><div style={{textAlign:"center",color:C.muted}}><div style={{fontSize:28,marginBottom:8}}>Chargement...</div><div style={{fontSize:13}}>Recuperation de vos donnees</div></div></div>);

  const cfg=allData.cfg||DEF;
  const apiKey=cfg.apiKey||"";
  const day=(allData.days&&allData.days[activeDay])||{};
  const upDay=patch=>saveAll({...allData,days:{...allData.days,[activeDay]:{...day,...patch}}});
  const yday=prevDay(activeDay);
  const ydayData=(allData.days&&allData.days[yday])||{};
  const weekDays=Array.from({length:7},(_,i)=>{const d=new Date(rFrom+"T12:00:00");d.setDate(d.getDate()+i);return toISO(d);});

  return(<div style={{background:C.bg,minHeight:"100vh",fontFamily:"Segoe UI,system-ui,sans-serif",color:C.text}}>
    <div style={{background:"white",borderBottom:"2px solid "+C.border,padding:"14px 16px",position:"sticky",top:0,zIndex:100,boxShadow:"0 2px 8px rgba(0,0,0,0.04)"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div><h1 style={{fontSize:18,fontWeight:800,color:C.red,margin:0}}>DiabeteTracker</h1><p style={{color:C.muted,fontSize:11,margin:0}}>Dexcom ONE+</p></div>
        <div style={{display:"flex",gap:6}}>
          {[["journal","Journal"],["report","Rapport"]].map(([k,l])=>(<button key={k} onClick={()=>setTab(k)} style={{padding:"7px 14px",borderRadius:8,border:"2px solid "+(tab===k?C.red:C.border),background:tab===k?C.red:"white",color:tab===k?"white":C.muted,fontWeight:700,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>{l}</button>))}
        </div>
      </div>
    </div>

    {tab==="journal"&&(<div style={{padding:"16px 14px 40px"}}>
      <div style={{display:"flex",gap:6,overflowX:"auto",paddingBottom:8,marginBottom:14}}>
        {weekDays.map(d=>{
          const {wd,day:dn}=fmtShort(d);const isA=d===activeDay;const isT=d===TODAY();
          const hC=!!(allData.days&&allData.days[d]&&allData.days[d].dexcomCurve);
          const hM=!!(allData.days&&allData.days[d]&&allData.days[d].meals&&Object.keys(allData.days[d].meals).length>0);
          return(<button key={d} onClick={()=>setActiveDay(d)} style={{flexShrink:0,minWidth:50,padding:"8px 10px",borderRadius:12,cursor:"pointer",textAlign:"center",border:"2px solid "+(isA?C.red:C.border),background:isA?"#fff5f5":"white"}}>
            <div style={{fontSize:10,color:isA?C.red:C.muted,fontWeight:700,textTransform:"uppercase"}}>{wd}</div>
            <div style={{fontSize:18,fontWeight:800,color:isA?C.red:C.text,lineHeight:1.3}}>{dn}</div>
            <div style={{fontSize:9,color:hC?C.blue:hM?C.green:C.muted}}>{isT?"auj.":hC?"dex":hM?"ok":"-"}</div>
          </button>);
        })}
      </div>
      <h2 style={{fontSize:15,fontWeight:700,color:C.text,marginBottom:12,textTransform:"capitalize"}}>{fmtDay(activeDay)}</h2>
      {day.dexcomCurve&&day.dexcomCurve.length>0?(<div style={{background:"white",border:"1.5px solid #93c5fd",borderRadius:12,padding:"12px 14px",marginBottom:12}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
          <span style={{fontWeight:700,fontSize:13,color:C.blue}}>Courbe Dexcom</span>
          <span style={{fontSize:11,color:C.muted}}>{day.dexcomCurve.length+" pts"}</span>
        </div>
        <DayCurve pts={day.dexcomCurve} insulins={day.insulins||[]} meals={day.meals} cfg={cfg} width={340} height={110}/>
        {(()=>{
          const vals=day.dexcomCurve.map(p=>parseFloat(p.value));
          const avg=(vals.reduce((s,v)=>s+v,0)/vals.length).toFixed(2);
          const tir=Math.round(vals.filter(v=>v>=cfg.tMin&&v<=cfg.tMax).length/vals.length*100);
          const above=Math.round(vals.filter(v=>v>cfg.tMax).length/vals.length*100);
          return(<div style={{display:"flex",gap:8,marginTop:8}}>
            {[["Moyenne",avg+" g/L",C.blue],["Temps cible",tir+"%",tir>=70?C.green:C.orange],["Au-dessus",above+"%",above>20?C.red:C.green]].map(([l,v,col])=>(<div key={l} style={{flex:1,textAlign:"center",background:col+"11",borderRadius:8,padding:"5px 4px"}}><div style={{fontSize:10,color:C.muted}}>{l}</div><div style={{fontSize:13,fontWeight:700,color:col}}>{v}</div></div>))}
          </div>);
        })()}
      </div>):(<div style={{background:"#eff6ff",border:"1.5px dashed #93c5fd",borderRadius:12,padding:"14px 16px",marginBottom:12,textAlign:"center"}}>
        <div style={{fontSize:13,color:C.blue,fontWeight:600}}>Aucune courbe Dexcom - importez le CSV</div>
      </div>)}
      <AdaptiveBanner allData={allData} cfg={cfg} onApply={newCfg=>saveAll({...allData,cfg:newCfg})}/>
      <AdaptiveBanner allData={allData} cfg={cfg} onApply={newCfg=>saveAll({...allData,cfg:newCfg})}/>
      <ConfigPanel cfg={cfg} onSave={c=>saveAll({...allData,cfg:c})} allData={allData}/>
      <ClarityImporter allData={allData} saveAll={saveAll}/>
      <ScreenshotPanel value={day.screenshot||null} onChange={img=>upDay({screenshot:img})}/>
      <AnalysePanel dayData={ydayData} dayLabel={fmtDay(yday)} cfg={cfg} apiKey={apiKey}/>
      {MEALS.map(m=>(<MealBlock key={m.id} meal={m}
        saved={(day.meals&&day.meals[m.id])||null}
        onSave={data=>upDay({meals:{...(day.meals||{}),[m.id]:data}})}
        onDelete={()=>{const ms={...(day.meals||{})};delete ms[m.id];upDay({meals:ms});}}
        cfg={cfg} curve={day.dexcomCurve||null} apiKey={apiKey}/>))}
      <CorrectifBlock
        entries={day.correctifs||[]}
        onAdd={e=>upDay({correctifs:[...(day.correctifs||[]),e]})}
        onDelete={id=>upDay({correctifs:(day.correctifs||[]).filter(x=>x.id!==id)})}
        cfg={cfg}
      />
    </div>)}

    {tab==="report"&&(<div style={{padding:16,paddingBottom:40}}>
      <div style={{background:"white",border:"1.5px solid "+C.border,borderRadius:14,padding:20,marginBottom:16}}>
        <h2 style={{color:C.red,margin:"0 0 16px",fontSize:16,fontWeight:800}}>Rapport medical</h2>
        <ExportImport allData={allData} saveAll={saveAll}/>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:16}}>
          <div><Lbl>Du</Lbl><input type="date" value={rFrom} onChange={e=>{setRFrom(e.target.value);setReportHtml(null);}} style={{width:"100%",padding:"9px 12px",border:"1.5px solid "+C.border,borderRadius:8,fontSize:14,fontFamily:"inherit",color:C.text}}/></div>
          <div><Lbl>Au</Lbl><input type="date" value={rTo} onChange={e=>{setRTo(e.target.value);setReportHtml(null);}} style={{width:"100%",padding:"9px 12px",border:"1.5px solid "+C.border,borderRadius:8,fontSize:14,fontFamily:"inherit",color:C.text}}/></div>
        </div>
        <PBtn onClick={()=>setReportHtml(buildReport(allData,rFrom,rTo))} color={C.red} full>Generer le rapport</PBtn>
        {reportHtml&&<div style={{marginTop:12,fontSize:11,color:C.muted,textAlign:"center"}}>Clic droit puis Imprimer pour PDF</div>}
      </div>
      {reportHtml&&(<div style={{borderRadius:14,overflow:"hidden",border:"1.5px solid "+C.border}}>
        <iframe srcDoc={reportHtml} style={{width:"100%",height:"80vh",border:"none",display:"block"}} title="Rapport"/>
      </div>)}
    </div>)}
  </div>);
}
