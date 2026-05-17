import { useState, useEffect, useRef } from "react";
import {
  collection, doc, onSnapshot, setDoc, updateDoc,
  addDoc, query, orderBy, arrayUnion, serverTimestamp,
} from "firebase/firestore";
import {
  ref as storageRef, uploadString, getDownloadURL,
} from "firebase/storage";
import { db, storage } from "./firebase";

const WORKOUT_TYPES = ["Lift","Run","HIIT","Sports","Swim","Bike","Yoga","Other"];
const TYPE_COLORS: Record<string,string> = {
  Lift:"#f97316", Run:"#22c55e", HIIT:"#ec4899", Sports:"#eab308",
  Swim:"#3b82f6", Bike:"#a855f7", Yoga:"#10b981", Other:"#64748b",
};
const rankColors = ["#f59e0b","#94a3b8","#cd7f32"];
const rankLabels = ["1st","2nd","3rd"];

const todayStr  = () => new Date().toISOString().slice(0,10);
const getWeekKey = () => {
  const d = new Date(), day = d.getDay();
  return new Date(new Date().setDate(d.getDate()-day+(day===0?-6:1))).toISOString().slice(0,10);
};
const loadTheme = () => {
  try { return localStorage.getItem("dsp_theme") === "light" ? false : true; }
  catch { return true; }
};
const saveTheme = (v: boolean) => {
  try { localStorage.setItem("dsp_theme", v ? "dark" : "light"); } catch {}
};

interface Member {
  id: string; name: string; phone?: string;
  totalWorkouts: number; streak: number;
  logDates: string[]; restDates: string[];
  lastRestWeek: string; photoUrl?: string;
}
interface FeedItem {
  id: string; memberName: string; type: string;
  customType?: string; notes?: string; photoUrl?: string;
  date: string; day: string; time: string;
}

function getTheme(dark: boolean) {
  return dark ? {
    bg:"#0f1117", surface:"#1a1d27", border:"#2a2d3e", text:"#f1f5f9",
    textSub:"#94a3b8", textMuted:"#475569", accent:"#6366f1", green:"#22c55e",
    red:"#f87171", blue:"#60a5fa", card:"#151821", inputBg:"#1a1d27",
    shadow:"0 4px 24px rgba(0,0,0,0.4)", shadowSm:"0 2px 8px rgba(0,0,0,0.3)",
    headerBg:"rgba(15,17,23,0.95)", pill:"#2a2d3e",
  } : {
    bg:"#f8f7f4", surface:"#ffffff", border:"#e8e5df", text:"#1a1a1a",
    textSub:"#6b7280", textMuted:"#9ca3af", accent:"#5b5ef7", green:"#16a34a",
    red:"#dc2626", blue:"#2563eb", card:"#ffffff", inputBg:"#fafaf9",
    shadow:"0 4px 24px rgba(0,0,0,0.06)", shadowSm:"0 2px 8px rgba(0,0,0,0.04)",
    headerBg:"rgba(248,247,244,0.95)", pill:"#f1f0ed",
  };
}
type Theme = ReturnType<typeof getTheme>;

function Lightbox({ src, onClose }: { src: string | null; onClose: () => void }) {
  useEffect(() => {
    const fn = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [onClose]);
  if (!src) return null;
  return (
    <div onClick={onClose} style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.92)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:16 }}>
      <img src={src} alt="" style={{ maxWidth:"100%",maxHeight:"88vh",borderRadius:16,objectFit:"contain" }} />
      <button onClick={onClose} style={{ position:"absolute",top:20,right:20,background:"rgba(255,255,255,0.15)",border:"none",color:"#fff",fontSize:20,width:40,height:40,borderRadius:"50%",cursor:"pointer" }}>×</button>
    </div>
  );
}

function Spinner({ t }: { t: Theme }) {
  return (
    <div style={{ display:"flex",alignItems:"center",justifyContent:"center",minHeight:"60vh",flexDirection:"column",gap:16 }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div style={{ width:40,height:40,border:`3px solid ${t.border}`,borderTop:`3px solid ${t.accent}`,borderRadius:"50%",animation:"spin 0.8s linear infinite" }} />
      <div style={{ color:t.textMuted,fontSize:13 }}>Connecting to database...</div>
    </div>
  );
}

function FeedCard({ item, onPhotoClick, t }: { item: FeedItem; onPhotoClick: (s:string)=>void; t: Theme }) {
  const color = TYPE_COLORS[item.type] || "#6366f1";
  return (
    <div style={{ background:t.card,border:`1px solid ${t.border}`,borderRadius:18,marginBottom:16,overflow:"hidden",boxShadow:t.shadowSm }}>
      {item.photoUrl && (
        <div onClick={() => onPhotoClick(item.photoUrl!)} style={{ cursor:"zoom-in" }}>
          <img src={item.photoUrl} alt="workout" style={{ width:"100%",maxHeight:300,objectFit:"cover",display:"block" }} />
        </div>
      )}
      <div style={{ padding:"16px 18px" }}>
        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start" }}>
          <div style={{ display:"flex",alignItems:"center",gap:10 }}>
            <div style={{ width:38,height:38,borderRadius:"50%",background:color+"20",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:800,color,flexShrink:0 }}>
              {(item.customType||item.type).charAt(0)}
            </div>
            <div>
              <div style={{ fontWeight:700,fontSize:15,color:t.text }}>{item.memberName}</div>
              <span style={{ background:color+"18",color,borderRadius:20,padding:"2px 10px",fontSize:11,fontWeight:600 }}>{item.customType||item.type}</span>
            </div>
          </div>
          <div style={{ fontSize:11,color:t.textMuted,textAlign:"right",flexShrink:0,marginLeft:8 }}>
            <div>{item.day}</div><div>{item.time}</div>
          </div>
        </div>
        {item.notes && <p style={{ margin:"10px 0 0",fontSize:13,color:t.textSub,lineHeight:1.6 }}>{item.notes}</p>}
      </div>
    </div>
  );
}

function ProfileView({ member, feedItems, onPhotoClick, onBack, t }: {
  member: Member; feedItems: FeedItem[]; onPhotoClick: (s:string)=>void; onBack: ()=>void; t: Theme;
}) {
  const [filter, setFilter] = useState("All");
  const myFeed     = feedItems.filter(f => f.memberName === member.name);
  const filtered   = filter === "All" ? myFeed : myFeed.filter(f => f.type === filter);
  const usedTypes  = [...new Set(myFeed.map(f => f.type))];
  const photoItems = myFeed.filter(f => f.photoUrl);
  const weeksMap: Record<string,number> = {};
  myFeed.forEach(f => {
    if (!f.date) return;
    const d = new Date(f.date), day = d.getDay();
    const wk = new Date(new Date(f.date).setDate(d.getDate()-day+(day===0?-6:1))).toISOString().slice(0,10);
    weeksMap[wk] = (weeksMap[wk]||0)+1;
  });
  const weeks = Object.keys(weeksMap).sort().slice(-8);
  const maxWk = Math.max(...weeks.map(w=>weeksMap[w]),1);
  return (
    <div>
      <button onClick={onBack} style={{ display:"flex",alignItems:"center",gap:6,background:"none",border:`1px solid ${t.border}`,color:t.textSub,fontFamily:"inherit",fontSize:13,cursor:"pointer",marginBottom:20,padding:"8px 14px",borderRadius:10,fontWeight:500 }}>← Back</button>
      <div style={{ background:`linear-gradient(135deg,${t.accent}18,${t.surface})`,border:`1px solid ${t.border}`,borderRadius:20,padding:"22px 20px",marginBottom:18,boxShadow:t.shadow }}>
        <div style={{ display:"flex",alignItems:"center",gap:14,marginBottom:18 }}>
          {member.photoUrl ? <img src={member.photoUrl} alt="" style={{ width:56,height:56,borderRadius:"50%",objectFit:"cover",border:`2px solid ${t.border}` }} />
            : <div style={{ width:56,height:56,borderRadius:"50%",background:`linear-gradient(135deg,${t.accent},#818cf8)`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,fontWeight:800,color:"#fff",flexShrink:0 }}>{member.name.charAt(0)}</div>}
          <div>
            <div style={{ fontWeight:800,fontSize:20,color:t.text }}>{member.name}</div>
            <div style={{ fontSize:12,color:t.textMuted,marginTop:2 }}>DSP Summer '26</div>
          </div>
        </div>
        <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10 }}>
          {([
            { label:"Workouts", val:member.totalWorkouts||0, color:t.accent },
            { label:"Day Streak", val:member.streak||0, color:"#f97316" },
            { label:"Photos", val:photoItems.length, color:t.green },
          ] as {label:string;val:number;color:string}[]).map(s => (
            <div key={s.label} style={{ background:t.surface,borderRadius:14,padding:"14px 10px",textAlign:"center",border:`1px solid ${t.border}` }}>
              <div style={{ fontSize:22,fontWeight:800,color:s.color,lineHeight:1.2 }}>{s.val}</div>
              <div style={{ fontSize:10,color:t.textMuted,marginTop:3,fontWeight:600 }}>{s.label.toUpperCase()}</div>
            </div>
          ))}
        </div>
      </div>
      {weeks.length > 0 && (
        <div style={{ background:t.surface,border:`1px solid ${t.border}`,borderRadius:18,padding:"18px",marginBottom:16,boxShadow:t.shadowSm }}>
          <div style={{ fontSize:13,fontWeight:700,color:t.text,marginBottom:14 }}>Weekly Activity</div>
          <div style={{ display:"flex",alignItems:"flex-end",gap:5,height:64 }}>
            {weeks.map(w => {
              const pct = weeksMap[w]/maxWk;
              const label = new Date(w+"T12:00:00").toLocaleDateString([],{month:"short",day:"numeric"});
              return (
                <div key={w} style={{ flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:4 }}>
                  <div style={{ width:"100%",height:Math.max(4,pct*52),background:`linear-gradient(180deg,${t.accent},#818cf8)`,borderRadius:4 }} />
                  <div style={{ fontSize:8,color:t.textMuted,whiteSpace:"nowrap" }}>{label}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {usedTypes.length > 0 && (
        <div style={{ background:t.surface,border:`1px solid ${t.border}`,borderRadius:18,padding:"18px",marginBottom:16,boxShadow:t.shadowSm }}>
          <div style={{ fontSize:13,fontWeight:700,color:t.text,marginBottom:12 }}>Workout Mix</div>
          <div style={{ display:"flex",flexWrap:"wrap",gap:8 }}>
            {usedTypes.map(tp => (
              <div key={tp} style={{ display:"flex",alignItems:"center",gap:6,background:(TYPE_COLORS[tp]||"#6366f1")+"15",borderRadius:10,padding:"8px 14px" }}>
                <span style={{ fontSize:13,color:TYPE_COLORS[tp]||t.accent,fontWeight:700 }}>{tp}</span>
                <span style={{ fontSize:12,color:t.textMuted,fontWeight:500 }}>x{myFeed.filter(f=>f.type===tp).length}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {photoItems.length > 0 && (
        <div style={{ marginBottom:20 }}>
          <div style={{ fontSize:13,fontWeight:700,color:t.text,marginBottom:12 }}>Photo Archive ({photoItems.length})</div>
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:5 }}>
            {photoItems.map((f,i) => (
              <div key={i} onClick={() => onPhotoClick(f.photoUrl!)} style={{ position:"relative",paddingBottom:"100%",overflow:"hidden",borderRadius:12,cursor:"zoom-in",background:t.border }}>
                <img src={f.photoUrl} alt="" style={{ position:"absolute",inset:0,width:"100%",height:"100%",objectFit:"cover" }} />
                <div style={{ position:"absolute",bottom:0,left:0,right:0,background:"linear-gradient(transparent,rgba(0,0,0,0.6))",padding:"12px 6px 5px" }}>
                  <div style={{ fontSize:9,color:"rgba(255,255,255,0.8)",fontWeight:500 }}>{f.day}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div>
        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12 }}>
          <div style={{ fontSize:13,fontWeight:700,color:t.text }}>Workout Log</div>
          <div style={{ display:"flex",gap:5,flexWrap:"wrap" }}>
            {["All",...usedTypes].map(tp => (
              <button key={tp} onClick={()=>setFilter(tp)} style={{ background:filter===tp?t.accent:t.pill,border:"none",color:filter===tp?"#fff":t.textSub,borderRadius:8,padding:"4px 11px",fontFamily:"inherit",fontSize:11,cursor:"pointer",fontWeight:600 }}>{tp}</button>
            ))}
          </div>
        </div>
        {filtered.length===0 ? <div style={{ textAlign:"center",padding:"30px 0",color:t.textMuted,fontSize:13 }}>No workouts yet</div>
          : filtered.map((f,i) => (
            <div key={i} style={{ display:"flex",gap:12,marginBottom:14,alignItems:"flex-start" }}>
              <div style={{ display:"flex",flexDirection:"column",alignItems:"center",flexShrink:0,paddingTop:4 }}>
                <div style={{ width:10,height:10,borderRadius:"50%",background:TYPE_COLORS[f.type]||t.accent }} />
                {i < filtered.length-1 && <div style={{ width:2,flex:1,background:t.border,minHeight:20,marginTop:4 }} />}
              </div>
              <div style={{ flex:1,background:t.surface,border:`1px solid ${t.border}`,borderRadius:14,overflow:"hidden",boxShadow:t.shadowSm }}>
                {f.photoUrl && <img src={f.photoUrl} alt="" onClick={()=>onPhotoClick(f.photoUrl!)} style={{ width:"100%",maxHeight:160,objectFit:"cover",display:"block",cursor:"zoom-in" }} />}
                <div style={{ padding:"12px 14px" }}>
                  <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center" }}>
                    <span style={{ background:(TYPE_COLORS[f.type]||t.accent)+"18",color:TYPE_COLORS[f.type]||t.accent,borderRadius:20,padding:"3px 10px",fontSize:12,fontWeight:600 }}>{f.customType||f.type}</span>
                    <span style={{ fontSize:11,color:t.textMuted }}>{f.day} · {f.time}</span>
                  </div>
                  {f.notes && <p style={{ margin:"8px 0 0",fontSize:12,color:t.textSub,lineHeight:1.6 }}>{f.notes}</p>}
                </div>
              </div>
            </div>
          ))
        }
      </div>
    </div>
  );
}

export default function App() {
  const [dark, setDark]           = useState<boolean>(loadTheme);
  const [tab, setTab]             = useState("leaderboard");
  const [members, setMembers]     = useState<Member[]>([]);
  const [feed, setFeed]           = useState<FeedItem[]>([]);
  const [loading, setLoading]     = useState(true);
  const [lightbox, setLightbox]   = useState<string|null>(null);
  const [profileSelect, setProfileSelect] = useState("");
  const [joinName, setJoinName]   = useState("");
  const [joinPhone, setJoinPhone] = useState("");
  const [joinDone, setJoinDone]   = useState(false);
  const [joinError, setJoinError] = useState("");
  const [logName, setLogName]     = useState("");
  const [logType, setLogType]     = useState("Lift");
  const [logNotes, setLogNotes]   = useState("");
  const [logPhoto, setLogPhoto]   = useState<string|null>(null);
  const [logCustomActivity, setLogCustomActivity] = useState("");
  const [logDone, setLogDone]     = useState(false);
  const [logBusy, setLogBusy]     = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [restName, setRestName]   = useState("");
  const [restDone, setRestDone]   = useState(false);

  const t       = getTheme(dark);
  const today   = todayStr();
  const weekKey = getWeekKey();

  useEffect(() => {
    const unsubMembers = onSnapshot(collection(db,"members"), snap => {
      const data = snap.docs.map(d => ({ id:d.id, ...d.data() } as Member))
        .sort((a,b) => (b.totalWorkouts||0)-(a.totalWorkouts||0));
      setMembers(data); setLoading(false);
    });
    const feedQ = query(collection(db,"feed"), orderBy("createdAt","desc"));
    const unsubFeed = onSnapshot(feedQ, snap => {
      setFeed(snap.docs.map(d => ({ id:d.id, ...d.data() } as FeedItem)));
    });
    return () => { unsubMembers(); unsubFeed(); };
  }, []);

  const toggleTheme = () => setDark(d => { saveTheme(!d); return !d; });

  const handleJoin = async () => {
    const name = joinName.trim(); if (!name) return;
    if (members.find(m => m.name.toLowerCase()===name.toLowerCase())) {
      setJoinError("That name is already taken — try adding your last initial!"); return;
    }
    setJoinError("");
    await setDoc(doc(db,"members",name.toLowerCase().replace(/\s+/g,"-")), {
      name, phone: joinPhone.trim()||"", totalWorkouts:0, streak:0,
      logDates:[], restDates:[], lastRestWeek:"",
    });
    setJoinDone(true); setJoinName(""); setJoinPhone("");
    setTimeout(()=>setJoinDone(false),4000);
  };

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setLogPhoto(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handleLog = async () => {
    if (!logName || logBusy) return;
    setLogBusy(true);
    try {
      const member = members.find(m => m.name===logName);
      if (!member || member.logDates?.includes(today)) { setLogBusy(false); return; }
      let photoUrl = "";
      if (logPhoto) {
        const pRef = storageRef(storage,`workouts/${Date.now()}-${logName.replace(/\s/g,"_")}.jpg`);
        await uploadString(pRef, logPhoto, "data_url");
        photoUrl = await getDownloadURL(pRef);
      }
      const now = new Date();
      await addDoc(collection(db,"feed"), {
        memberName: logName, type: logType,
        customType: logType==="Other" && logCustomActivity.trim() ? logCustomActivity.trim() : "",
        notes: logNotes, photoUrl, date: today,
        day: now.toLocaleDateString([],{weekday:"short",month:"short",day:"numeric"}),
        time: now.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}),
        createdAt: serverTimestamp(),
      });
      await updateDoc(doc(db,"members",member.id), {
        totalWorkouts: (member.totalWorkouts||0)+1,
        streak: (member.streak||0)+1,
        logDates: arrayUnion(today),
        ...(photoUrl && !member.photoUrl ? { photoUrl } : {}),
      });
      setLogDone(true); setLogName(""); setLogType("Lift");
      setLogNotes(""); setLogPhoto(null); setLogCustomActivity("");
      setTimeout(()=>setLogDone(false),3000);
    } catch(err) {
      console.error(err);
      alert("Something went wrong. Check your Firebase config in firebase.ts");
    }
    setLogBusy(false);
  };

  const handleRest = async () => {
    if (!restName) return;
    const member = members.find(m=>m.name===restName); if (!member) return;
    await updateDoc(doc(db,"members",member.id), { restDates: arrayUnion(today), lastRestWeek: weekKey });
    setRestDone(true); setRestName(""); setTimeout(()=>setRestDone(false),3000);
  };

  const notLogged = members.filter(m => !m.logDates?.includes(today) && !m.restDates?.includes(today));
  const eveningMsg = notLogged.length===0
    ? `DSP Workout Log - 9PM Check\nEveryone logged today! Locked in.`
    : `DSP Workout Log - 9PM Check\nStill need to log:\n${notLogged.map(m=>`- ${m.name}`).join("\n")}\n\nLog or claim rest before midnight or your streak resets!`;
  const morningMsg = notLogged.length===0
    ? `DSP Workout Log - Morning Report\nEveryone came through yesterday.\nNew day - keep that streak going!`
    : `DSP Workout Log - Morning Report\nMissed yesterday:\n${notLogged.map(m=>`- ${m.name}`).join("\n")}\n\nNew day, fresh start. Don't let the squad down.`;

  const inp: React.CSSProperties  = { width:"100%",background:t.inputBg,border:`1.5px solid ${t.border}`,color:t.text,borderRadius:12,padding:"13px 16px",fontFamily:"inherit",fontSize:15,boxSizing:"border-box",outline:"none" };
  const lbl: React.CSSProperties  = { fontSize:12,fontWeight:700,color:t.textSub,display:"block",marginBottom:8 };
  const card: React.CSSProperties = { background:t.surface,border:`1px solid ${t.border}`,borderRadius:18,padding:"20px",marginBottom:14,boxShadow:t.shadowSm };
  const TABS = [
    {key:"leaderboard",label:"Leaderboard"},{key:"feed",label:"Feed"},
    {key:"log",label:"Log Workout"},{key:"rest",label:"Rest Day"},
    {key:"profile",label:"My Progress"},{key:"join",label:"Join"},{key:"reports",label:"Reports"},
  ];
  const selectedMember = members.find(m=>m.name===profileSelect);

  return (
    <div style={{ minHeight:"100vh",background:t.bg,fontFamily:"'Nunito','Helvetica Neue',sans-serif",color:t.text,transition:"background 0.3s,color 0.3s",paddingBottom:80 }}>
      <Lightbox src={lightbox} onClose={()=>setLightbox(null)} />
      <div style={{ position:"sticky",top:0,zIndex:100,background:t.headerBg,backdropFilter:"blur(12px)",borderBottom:`1px solid ${t.border}`,padding:"0 16px" }}>
        <div style={{ maxWidth:680,margin:"0 auto" }}>
          <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",padding:"16px 0 4px" }}>
            <div>
              <div style={{ fontSize:20,fontWeight:900,color:t.text,letterSpacing:"-0.5px" }}>DSP Summer<br/>Workout Log</div>
              <div style={{ fontSize:11,color:t.textMuted,marginTop:2,fontWeight:600 }}>{members.length} members · Summer 2026</div>
            </div>
            <button onClick={toggleTheme} style={{ background:t.pill,border:`1px solid ${t.border}`,borderRadius:50,width:52,height:28,cursor:"pointer",position:"relative",transition:"all 0.3s",flexShrink:0 }}>
              <div style={{ position:"absolute",top:3,left:dark?26:3,width:20,height:20,borderRadius:"50%",background:dark?"#f59e0b":"#6366f1",transition:"left 0.3s",display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:800,color:"#fff" }}>{dark?"D":"L"}</div>
            </button>
          </div>
          <div style={{ display:"flex",overflowX:"auto",scrollbarWidth:"none",gap:4,paddingBottom:0 }}>
            {TABS.map(tb => (
              <button key={tb.key} onClick={()=>{setTab(tb.key);if(tb.key!=="profile")setProfileSelect("");}} style={{ background:tab===tb.key?t.accent:"none",border:"none",color:tab===tb.key?"#fff":t.textSub,fontFamily:"inherit",fontSize:12,fontWeight:700,padding:"8px 14px",borderRadius:10,cursor:"pointer",whiteSpace:"nowrap",flexShrink:0,transition:"all 0.2s",marginBottom:8 }}>{tb.label}</button>
            ))}
          </div>
        </div>
      </div>
      <div style={{ maxWidth:680,margin:"0 auto",padding:"20px 16px" }}>
        {loading ? <Spinner t={t} /> : <>
        {tab==="leaderboard" && <>
          <p style={{ fontSize:13,color:t.textSub,marginBottom:18,marginTop:0 }}>Ranked by total workouts. Tap anyone to see their progress.</p>
          {members.length===0
            ? <div style={{ ...card,textAlign:"center",padding:"50px 20px" }}><div style={{ color:t.textSub,fontSize:14,fontWeight:600 }}>No members yet</div><div style={{ color:t.textMuted,fontSize:13,marginTop:4 }}>Head to the Join tab to sign up!</div></div>
            : members.map((m,i) => {
              const loggedToday = m.logDates?.includes(today);
              const restedToday = m.restDates?.includes(today);
              return (
                <div key={m.id} onClick={()=>{setProfileSelect(m.name);setTab("profile");}} style={{ ...card,display:"flex",alignItems:"center",gap:14,cursor:"pointer",padding:"14px 18px",background:i===0?`linear-gradient(135deg,${t.accent}10,${t.surface})`:t.surface,border:i===0?`1.5px solid ${t.accent}40`:`1px solid ${t.border}` }}>
                  <div style={{ fontSize:i<3?16:13,color:rankColors[i]||t.textMuted,fontWeight:800,width:32,textAlign:"center",flexShrink:0 }}>{i<3?rankLabels[i]:i+1}</div>
                  {m.photoUrl ? <img src={m.photoUrl} alt="" style={{ width:44,height:44,borderRadius:"50%",objectFit:"cover",flexShrink:0,border:`2px solid ${t.border}` }} />
                    : <div style={{ width:44,height:44,borderRadius:"50%",background:`linear-gradient(135deg,${t.accent}30,${t.accent}10)`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0,fontWeight:800,color:t.accent }}>{m.name.charAt(0)}</div>}
                  <div style={{ flex:1,minWidth:0 }}>
                    <div style={{ fontWeight:800,fontSize:15,color:t.text }}>{m.name}</div>
                    <div style={{ display:"flex",gap:6,marginTop:5,flexWrap:"wrap" }}>
                      <span style={{ fontSize:12,color:"#f97316",fontWeight:700 }}>{m.streak||0}d streak</span>
                      {loggedToday && <span style={{ background:"#22c55e20",color:"#22c55e",borderRadius:20,padding:"1px 8px",fontSize:11,fontWeight:700 }}>Done</span>}
                      {restedToday && <span style={{ background:"#3b82f620",color:"#3b82f6",borderRadius:20,padding:"1px 8px",fontSize:11,fontWeight:700 }}>Rest</span>}
                      {!loggedToday&&!restedToday && <span style={{ background:"#f8717120",color:"#f87171",borderRadius:20,padding:"1px 8px",fontSize:11,fontWeight:700 }}>Not yet</span>}
                    </div>
                  </div>
                  <div style={{ textAlign:"right",flexShrink:0 }}>
                    <div style={{ fontSize:26,fontWeight:900,color:i===0?t.accent:t.text,lineHeight:1 }}>{m.totalWorkouts||0}</div>
                    <div style={{ fontSize:10,color:t.textMuted,fontWeight:700 }}>WORKOUTS</div>
                  </div>
                </div>
              );
            })}
        </>}
        {tab==="feed" && <>
          <p style={{ fontSize:13,color:t.textSub,marginBottom:18,marginTop:0 }}>Everyone's sessions. Tap any photo to expand.</p>
          {feed.length===0
            ? <div style={{ ...card,textAlign:"center",padding:"50px 20px" }}><div style={{ color:t.textSub,fontSize:14,fontWeight:600 }}>Nothing here yet</div><div style={{ color:t.textMuted,fontSize:13,marginTop:4 }}>Log a workout to be the first to post!</div></div>
            : feed.map(item => <FeedCard key={item.id} item={item} onPhotoClick={setLightbox} t={t} />)}
        </>}
        {tab==="log" && <>
          <p style={{ fontSize:13,color:t.textSub,marginBottom:18,marginTop:0 }}>Log today's session and keep that streak alive.</p>
          {logDone && <div style={{ background:"#22c55e18",border:"1.5px solid #22c55e40",borderRadius:14,padding:"14px 18px",marginBottom:16,color:"#22c55e",fontWeight:700,fontSize:14 }}>Workout logged! Streak updated.</div>}
          <div style={{ display:"flex",flexDirection:"column",gap:18 }}>
            <div style={card}>
              <label style={lbl}>Who are you?</label>
              <select value={logName} onChange={e=>setLogName(e.target.value)} style={{ ...inp,color:logName?t.text:t.textMuted,appearance:"none",cursor:"pointer" } as React.CSSProperties}>
                <option value="">Pick your name...</option>
                {members.map(m => { const done = m.logDates?.includes(today); return <option key={m.id} value={m.name} disabled={done}>{m.name}{done?" (already logged today)":""}</option>; })}
              </select>
            </div>
            <div style={card}>
              <label style={lbl}>What kind of workout?</label>
              <div style={{ display:"flex",flexWrap:"wrap",gap:8 }}>
                {WORKOUT_TYPES.map(tp => (<button key={tp} onClick={()=>setLogType(tp)} style={{ background:logType===tp?(TYPE_COLORS[tp]||t.accent):t.pill,border:"none",color:logType===tp?"#fff":t.textSub,borderRadius:12,padding:"9px 16px",fontFamily:"inherit",fontSize:13,fontWeight:700,cursor:"pointer",transition:"all 0.15s" }}>{tp}</button>))}
              </div>
              {logType==="Other" && (
                <div style={{ marginTop:14 }}>
                  <label style={{ ...lbl,marginBottom:6 }}>What activity?</label>
                  <input value={logCustomActivity} onChange={e=>setLogCustomActivity(e.target.value)} placeholder="e.g. Rock climbing, Pickleball, Boxing..." style={inp} autoFocus />
                </div>
              )}
            </div>
            <div style={card}>
              <label style={lbl}>Add a note (optional)</label>
              <textarea value={logNotes} onChange={e=>setLogNotes(e.target.value)} placeholder="How'd it go? PR? New exercise? Flex a little." rows={3} style={{ ...inp,resize:"vertical" } as React.CSSProperties} />
            </div>
            <div style={card}>
              <label style={lbl}>Upload a photo</label>
              <div onClick={()=>fileRef.current?.click()} style={{ border:`2px dashed ${t.border}`,borderRadius:14,padding:logPhoto?"0":"32px 20px",textAlign:"center",cursor:"pointer",background:t.inputBg,overflow:"hidden" }}>
                {logPhoto ? <img src={logPhoto} alt="preview" style={{ width:"100%",maxHeight:260,objectFit:"cover",display:"block",borderRadius:12 }} />
                  : <><div style={{ fontSize:14,color:t.textSub,fontWeight:600 }}>Tap to add photo proof</div><div style={{ fontSize:12,color:t.textMuted,marginTop:4 }}>JPG, PNG, GIF supported</div></>}
              </div>
              <input ref={fileRef} type="file" accept="image/*" onChange={handlePhotoChange} style={{ display:"none" }} />
              {logPhoto && <button onClick={()=>setLogPhoto(null)} style={{ background:"none",border:"none",color:t.textMuted,fontSize:12,cursor:"pointer",marginTop:8,fontFamily:"inherit" }}>Remove photo</button>}
            </div>
            <button onClick={handleLog} disabled={!logName||logBusy} style={{ background:logName?`linear-gradient(135deg,${t.accent},#818cf8)`:t.pill,border:"none",borderRadius:14,padding:"17px",color:logName?"#fff":t.textMuted,fontFamily:"inherit",fontSize:16,fontWeight:800,cursor:logName?"pointer":"not-allowed",boxShadow:logName?`0 8px 24px ${t.accent}40`:"none",transition:"all 0.2s" }}>
              {logBusy?"Saving...":"Log My Workout"}
            </button>
          </div>
        </>}
        {tab==="rest" && <>
          <p style={{ fontSize:13,color:t.textSub,marginBottom:18,marginTop:0 }}>Everyone needs a rest day. Use it wisely — you only get one per week.</p>
          <div style={{ background:"#f9731615",border:"1.5px solid #f9731640",borderRadius:14,padding:"16px 18px",marginBottom:18 }}>
            <div style={{ fontWeight:800,color:"#f97316",marginBottom:6 }}>The Rules</div>
            <div style={{ fontSize:13,color:t.textSub,lineHeight:1.8 }}>• 1 rest day allowed per week<br/>• Claim it before midnight to protect your streak<br/>• Rest days don't count toward your workout total<br/>• Miss a day without claiming = streak reset to 0</div>
          </div>
          {restDone && <div style={{ background:"#3b82f618",border:"1.5px solid #3b82f640",borderRadius:14,padding:"14px 18px",marginBottom:16,color:"#3b82f6",fontWeight:700,fontSize:14 }}>Rest day claimed! Your streak is safe.</div>}
          <div style={{ display:"flex",flexDirection:"column",gap:16 }}>
            <div style={card}>
              <label style={lbl}>Who's taking a rest day?</label>
              <select value={restName} onChange={e=>setRestName(e.target.value)} style={{ ...inp,color:restName?t.text:t.textMuted,appearance:"none",cursor:"pointer" } as React.CSSProperties}>
                <option value="">Pick your name...</option>
                {members.map(m => { const used = m.lastRestWeek===weekKey||m.restDates?.includes(today); return <option key={m.id} value={m.name} disabled={used}>{m.name}{used?" (rest already used this week)":""}</option>; })}
              </select>
            </div>
            <button onClick={handleRest} disabled={!restName} style={{ background:restName?"linear-gradient(135deg,#1d4ed8,#3b82f6)":t.pill,border:"none",borderRadius:14,padding:"17px",color:restName?"#fff":t.textMuted,fontFamily:"inherit",fontSize:16,fontWeight:800,cursor:restName?"pointer":"not-allowed",transition:"all 0.2s" }}>Claim My Rest Day</button>
          </div>
        </>}
        {tab==="profile" && <>
          {selectedMember ? <ProfileView member={selectedMember} feedItems={feed} onPhotoClick={setLightbox} onBack={()=>setProfileSelect("")} t={t} />
            : <>
              <p style={{ fontSize:13,color:t.textSub,marginBottom:18,marginTop:0 }}>Pick a member to see their full summer recap.</p>
              <div style={{ marginBottom:18 }}>
                <label style={lbl}>Jump to someone's profile</label>
                <select value={profileSelect} onChange={e=>setProfileSelect(e.target.value)} style={{ ...inp,color:profileSelect?t.text:t.textMuted,appearance:"none",cursor:"pointer" } as React.CSSProperties}>
                  <option value="">Choose a member...</option>
                  {members.map(m=><option key={m.id} value={m.name}>{m.name} — {m.totalWorkouts||0} workouts</option>)}
                </select>
              </div>
              <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:12 }}>
                {members.map(m => {
                  const myPhotos = feed.filter(f=>f.memberName===m.name&&f.photoUrl);
                  return (
                    <div key={m.id} onClick={()=>setProfileSelect(m.name)} style={{ background:t.surface,border:`1px solid ${t.border}`,borderRadius:16,overflow:"hidden",cursor:"pointer",boxShadow:t.shadowSm }}>
                      {myPhotos[0] ? <img src={myPhotos[0].photoUrl} alt="" style={{ width:"100%",height:100,objectFit:"cover",display:"block" }} />
                        : <div style={{ width:"100%",height:100,background:`linear-gradient(135deg,${t.accent}20,${t.accent}08)`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:28,color:t.textMuted,fontWeight:800 }}>{m.name.charAt(0)}</div>}
                      <div style={{ padding:"12px" }}>
                        <div style={{ fontWeight:800,fontSize:14,color:t.text }}>{m.name}</div>
                        <div style={{ fontSize:11,color:t.textMuted,marginTop:4 }}>{m.streak||0}d streak · {m.totalWorkouts||0} workouts · {myPhotos.length} photos</div>
                      </div>
                    </div>
                  );
                })}
                {members.length===0 && <div style={{ gridColumn:"1/-1",textAlign:"center",padding:"40px 0",color:t.textMuted,fontSize:13 }}>No members yet — go to Join!</div>}
              </div>
            </>}
        </>}
        {tab==="join" && <>
          <p style={{ fontSize:13,color:t.textSub,marginBottom:18,marginTop:0 }}>Anyone with the link can join. Drop your name and you're on the board.</p>
          {joinDone && <div style={{ background:"#22c55e18",border:"1.5px solid #22c55e40",borderRadius:14,padding:"14px 18px",marginBottom:16,color:"#22c55e",fontWeight:700 }}>You're in! Check the leaderboard.</div>}
          {joinError && <div style={{ background:"#f8717118",border:"1.5px solid #f8717140",borderRadius:14,padding:"14px 18px",marginBottom:16,color:"#f87171",fontWeight:700 }}>{joinError}</div>}
          <div style={{ display:"flex",flexDirection:"column",gap:16 }}>
            <div style={card}>
              <label style={lbl}>Your name</label>
              <input value={joinName} onChange={e=>setJoinName(e.target.value)} placeholder="First name + last initial (e.g. Jake F.)" onKeyDown={e=>e.key==="Enter"&&handleJoin()} style={inp} />
            </div>
            <div style={card}>
              <label style={lbl}>Phone number <span style={{ color:t.textMuted,fontWeight:500 }}>(optional — for daily texts)</span></label>
              <input type="tel" value={joinPhone} onChange={e=>setJoinPhone(e.target.value)} placeholder="+1 (555) 000-0000" style={inp} />
              <p style={{ fontSize:12,color:t.textMuted,margin:"8px 0 0" }}>You'll get a 9pm accountability text + 9am morning report each day.</p>
            </div>
            <button onClick={handleJoin} disabled={!joinName.trim()} style={{ background:joinName.trim()?`linear-gradient(135deg,${t.accent},#818cf8)`:t.pill,border:"none",borderRadius:14,padding:"17px",color:joinName.trim()?"#fff":t.textMuted,fontFamily:"inherit",fontSize:16,fontWeight:800,cursor:joinName.trim()?"pointer":"not-allowed",boxShadow:joinName.trim()?`0 8px 24px ${t.accent}40`:"none",transition:"all 0.2s" }}>Join the Challenge</button>
            <div style={card}>
              <div style={{ fontWeight:800,fontSize:14,color:t.text,marginBottom:14 }}>Current Roster ({members.length})</div>
              {members.length===0 ? <div style={{ color:t.textMuted,fontSize:13,textAlign:"center",padding:"20px 0" }}>No one yet — be the first!</div>
                : members.map((m,i)=>(<div key={m.id} style={{ display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 0",borderBottom:i<members.length-1?`1px solid ${t.border}`:"none" }}><span style={{ fontWeight:700,fontSize:14,color:t.text }}>{m.name}</span><span style={{ fontSize:12,color:t.textSub }}>{m.streak||0}d streak · {m.totalWorkouts||0} workouts</span></div>))}
            </div>
          </div>
        </>}
        {tab==="reports" && <>
          <p style={{ fontSize:13,color:t.textSub,marginBottom:18,marginTop:0 }}>Preview the texts that go out each day to keep everyone accountable.</p>
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:20 }}>
            {([
              { label:"Logged Today", val:members.filter(m=>m.logDates?.includes(today)).length, color:t.green },
              { label:"Resting", val:members.filter(m=>m.restDates?.includes(today)).length, color:t.blue },
              { label:"Not Yet", val:notLogged.length, color:t.red },
            ] as {label:string;val:number;color:string}[]).map(s=>(
              <div key={s.label} style={{ background:t.surface,border:`1px solid ${t.border}`,borderRadius:14,padding:"14px 10px",textAlign:"center",boxShadow:t.shadowSm }}>
                <div style={{ fontSize:24,fontWeight:900,color:s.color,lineHeight:1.2 }}>{s.val}</div>
                <div style={{ fontSize:10,color:t.textMuted,fontWeight:700,marginTop:3 }}>{s.label.toUpperCase()}</div>
              </div>
            ))}
          </div>
          <div style={{ marginBottom:14 }}>
            <div style={{ fontWeight:800,fontSize:14,color:t.text,marginBottom:10 }}>9PM Evening Text</div>
            <div style={{ background:t.surface,border:`1px solid ${t.border}`,borderRadius:14,padding:"16px",boxShadow:t.shadowSm }}>
              <pre style={{ fontFamily:"inherit",fontSize:13,color:t.textSub,whiteSpace:"pre-wrap",lineHeight:1.8,margin:0 }}>{eveningMsg}</pre>
            </div>
          </div>
          <div style={{ marginBottom:8 }}>
            <div style={{ fontWeight:800,fontSize:14,color:t.text,marginBottom:10 }}>9AM Morning Text</div>
            <div style={{ background:t.surface,border:`1px solid ${t.border}`,borderRadius:14,padding:"16px",boxShadow:t.shadowSm }}>
              <pre style={{ fontFamily:"inherit",fontSize:13,color:t.textSub,whiteSpace:"pre-wrap",lineHeight:1.8,margin:0 }}>{morningMsg}</pre>
            </div>
          </div>
        </>}
        </>}
      </div>
      {!loading && members.length>0 && (
        <div style={{ position:"fixed",bottom:0,left:0,right:0,background:t.headerBg,backdropFilter:"blur(12px)",borderTop:`1px solid ${t.border}`,padding:"10px 20px" }}>
          <div style={{ maxWidth:680,margin:"0 auto",display:"flex",justifyContent:"center",gap:40 }}>
            {members.slice(0,3).map((m,i)=>(
              <div key={m.id} onClick={()=>{setProfileSelect(m.name);setTab("profile");}} style={{ textAlign:"center",cursor:"pointer" }}>
                <div style={{ fontSize:10,color:rankColors[i],fontWeight:700 }}>{rankLabels[i]}</div>
                <div style={{ fontSize:11,color:t.textSub,fontWeight:700 }}>{m.name.split(" ")[0]}</div>
                <div style={{ fontSize:14,color:t.text,fontWeight:900 }}>{m.totalWorkouts||0}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
