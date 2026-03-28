import { useState, useEffect, useRef } from "react";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell, ComposedChart, Area } from "recharts";
import { supabase } from "./supabase.js";

// ─── Storage ────────────────────────────────────────────────────────────────
const STORE_KEY = "dayflow_v3";
const ONBOARD_KEY = "dayflow_onboarded_v1";
const DEFAULTS  = {
  monthlyIncome: 0,
  monthlyIncomes: {}, // { "YYYY-MM": number } — historical income per month
  recurringPayments: [],
  dailyEntries: {},
  plaidConnected: false,
  plaidTransactions: [],
  bankName: "",
  // Household
  members: [], // [{ id, name, color, monthlyIncome, recurringPayments }]
  householdMode: false,
};
const load    = () => { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORE_KEY) || "{}") }; } catch { return DEFAULTS; } };
const persist = (d) => localStorage.setItem(STORE_KEY, JSON.stringify(d));

// ─── Date / Math ─────────────────────────────────────────────────────────────
const todayKey    = () => new Date().toISOString().slice(0, 10);
const thisMonth   = () => new Date().toISOString().slice(0, 7);
const daysInMonth = (d = new Date()) => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
const dayOfMonth  = (d = new Date()) => d.getDate();

// Always use actual days in the current month — never hardcoded 30/31/4.33
const DIM = daysInMonth(); // days in THIS month — computed once at module load, stable for the session
const WEEKS_IN_MONTH = DIM / 7; // e.g. March=31 → 4.43, Feb=28 → 4.0

const monthlyEquiv = (p) => {
  if (p.frequency === "monthly") return p.amount;
  if (p.frequency === "weekly")  return p.amount * WEEKS_IN_MONTH;
  if (p.frequency === "yearly")  return p.amount / 12;
  if (p.frequency === "daily")   return p.amount * DIM;
  return p.amount;
};
const totalBills   = (ps) => ps.reduce((s, p) => s + monthlyEquiv(p), 0);
const calcPool     = (inc, ps) => inc - totalBills(ps);
const calcDaily    = (pool) => pool / DIM; // pool ÷ actual days this month
const calcMonthSpent = (entries, ptx = []) => {
  const pfx = thisMonth(); let m = 0;
  for (const [k, e] of Object.entries(entries)) { if (!k.startsWith(pfx)) continue; for (const t of (e.transactions||[])) if (t.type==="expense") m += t.amount; }
  return m + ptx.filter(t => t.date?.startsWith(pfx) && t.amount > 0).reduce((s,t)=>s+t.amount, 0);
};
const calcDaySpent = (entry, ptx=[], key=todayKey()) =>
  (entry?.transactions||[]).filter(t=>t.type==="expense").reduce((s,t)=>s+t.amount,0)
  + ptx.filter(t=>t.date===key&&t.amount>0).reduce((s,t)=>s+t.amount,0);

const fmt     = (n) => new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(Math.abs(n??0));
const fmtFull = (n) => new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",minimumFractionDigits:2,maximumFractionDigits:2}).format(Math.abs(n??0));
const fmtDate = (k) => new Date(k+"T12:00:00").toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"});

// ─── Markdown renderer ───────────────────────────────────────────────────────
const renderMd = (text) => {
  if (!text) return null;
  const lines = text.split("\n");
  const elements = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // H2 heading
    if (line.startsWith("## ")) {
      elements.push(<div key={i} style={{fontSize:15,fontWeight:800,color:"#1a1a2e",marginTop:14,marginBottom:4}}>{renderInline(line.slice(3))}</div>);
    // H3 heading
    } else if (line.startsWith("### ")) {
      elements.push(<div key={i} style={{fontSize:13,fontWeight:700,color:"#1a1a2e",marginTop:10,marginBottom:2}}>{renderInline(line.slice(4))}</div>);
    // H1 heading
    } else if (line.startsWith("# ")) {
      elements.push(<div key={i} style={{fontSize:17,fontWeight:800,color:"#1a1a2e",marginTop:16,marginBottom:6}}>{renderInline(line.slice(2))}</div>);
    // Horizontal rule
    } else if (line.trim() === "---" || line.trim() === "***") {
      elements.push(<div key={i} style={{height:1,background:"#ece9e0",margin:"10px 0"}}/>);
    // Bullet point
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      elements.push(
        <div key={i} style={{display:"flex",gap:8,marginTop:3,alignItems:"flex-start"}}>
          <span style={{color:"#7048e8",fontWeight:700,flexShrink:0,marginTop:1}}>·</span>
          <span>{renderInline(line.slice(2))}</span>
        </div>
      );
    // Numbered list
    } else if (/^\d+\.\s/.test(line)) {
      const num = line.match(/^(\d+)\.\s/)[1];
      elements.push(
        <div key={i} style={{display:"flex",gap:8,marginTop:3,alignItems:"flex-start"}}>
          <span style={{color:"#7048e8",fontWeight:700,flexShrink:0,minWidth:16,marginTop:1}}>{num}.</span>
          <span>{renderInline(line.slice(num.length+2))}</span>
        </div>
      );
    // Empty line = small spacer
    } else if (line.trim() === "") {
      elements.push(<div key={i} style={{height:6}}/>);
    // Normal paragraph line
    } else {
      elements.push(<div key={i} style={{marginTop:2}}>{renderInline(line)}</div>);
    }
    i++;
  }
  return <>{elements}</>;
};

// Inline markdown: bold, italic, links
const renderInline = (text) => {
  if (!text) return null;
  const parts = []; let remaining = text; let key = 0;
  while (remaining.length > 0) {
    const bold = remaining.match(/\*\*(.+?)\*\*/);
    const italic = remaining.match(/\*([^*]+)\*/);
    const link = remaining.match(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/);
    const matches = [bold, italic, link].filter(Boolean);
    if (matches.length === 0) { parts.push(<span key={key++}>{remaining}</span>); break; }
    const first = matches.sort((a,b) => a.index - b.index)[0];
    if (first.index > 0) parts.push(<span key={key++}>{remaining.slice(0, first.index)}</span>);
    if (first === bold) {
      parts.push(<strong key={key++} style={{fontWeight:700}}>{bold[1]}</strong>);
      remaining = remaining.slice(first.index + bold[0].length);
    } else if (first === italic) {
      parts.push(<em key={key++}>{italic[1]}</em>);
      remaining = remaining.slice(first.index + italic[0].length);
    } else if (first === link) {
      parts.push(<a key={key++} href={link[2]} target="_blank" rel="noopener noreferrer" style={{color:"#7048e8",fontWeight:600,textDecoration:"underline"}}>{link[1]}</a>);
      remaining = remaining.slice(first.index + link[0].length);
    }
  }
  return <>{parts}</>;
};

// ─── Learn Section Component ─────────────────────────────────────────────────
function LearnSection({section, onAsk}) {
  const [open, setOpen] = useState(null);
  return (
    <div style={{background:"#fff",borderRadius:24,boxShadow:"0 2px 0px rgba(0,0,0,0.04),0 8px 32px rgba(0,0,0,0.07)",border:"1px solid rgba(255,255,255,0.8)",overflow:"hidden"}}>
      <div style={{padding:"18px 20px 14px",borderBottom:"1px solid #f0efe9",display:"flex",alignItems:"center",gap:12}}>
        <div style={{width:40,height:40,borderRadius:13,background:`${section.color}15`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20}}>{section.emoji}</div>
        <div style={{fontSize:16,fontWeight:800,color:"#1a1a2e"}}>{section.title}</div>
      </div>
      {section.lessons.map((lesson,i)=>(
        <div key={i} style={{borderBottom:i<section.lessons.length-1?"1px solid #f8f7f2":"none"}}>
          <button onClick={()=>setOpen(open===i?null:i)} style={{width:"100%",padding:"14px 20px",background:"none",border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,fontFamily:"inherit",textAlign:"left"}}>
            <span style={{fontSize:13,fontWeight:600,color:"#1a1a2e",lineHeight:1.4}}>{lesson.q}</span>
            <span style={{fontSize:18,color:section.color,flexShrink:0,transition:"transform 0.2s",display:"inline-block",transform:open===i?"rotate(45deg)":"rotate(0deg)"}}>+</span>
          </button>
          {open===i&&(
            <div style={{padding:"0 20px 16px"}}>
              <div style={{fontSize:13,color:"#555",lineHeight:1.7,marginBottom:12}}>{lesson.a}</div>
              <button onClick={()=>onAsk(lesson.q)} style={{display:"inline-flex",alignItems:"center",gap:6,padding:"7px 14px",background:`${section.color}15`,border:"none",borderRadius:10,fontSize:12,fontWeight:700,color:section.color,cursor:"pointer",fontFamily:"inherit"}}>
                Ask AI Advisor →
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Mock Plaid ───────────────────────────────────────────────────────────────
const MOCK_PLAID = (() => {
  const t = new Date();
  const d = (off, name, amount, cat) => { const dt=new Date(t); dt.setDate(dt.getDate()-off); return {id:`p_${off}_${name.slice(0,4)}`,date:dt.toISOString().slice(0,10),name,amount,category:cat,source:"plaid"}; };
  return [d(0,"Whole Foods",67.42,"Groceries"),d(0,"Shell Gas",54.00,"Gas"),d(1,"Chipotle",14.85,"Dining"),d(1,"Amazon",32.99,"Shopping"),d(2,"Starbucks",6.75,"Dining"),d(2,"Target",88.14,"Shopping"),d(3,"Uber",18.50,"Transport"),d(4,"Apple.com",14.99,"Subscriptions"),d(5,"Trader Joe's",41.20,"Groceries"),d(6,"Netflix",15.49,"Subscriptions"),d(7,"Lyft",22.30,"Transport"),d(8,"CVS",29.60,"Health")];
})();

// ─── Icons ────────────────────────────────────────────────────────────────────
const I = ({ n, s=16, c="currentColor" }) => {
  const P = {
    clock:    <><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></>,
    cal:      <><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></>,
    repeat:   <><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></>,
    bank:     <><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></>,
    gear:     <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></>,
    plus:     <><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></>,
    x:        <><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>,
    link:     <><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></>,
    warn:     <><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></>,
    wallet:   <><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/></>,
    arrow:    <><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></>,
    check:    <polyline points="20 6 9 17 4 12"/>,
    home:     <><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></>,
    car:      <><rect x="1" y="3" width="15" height="13" rx="2"/><path d="M16 8h4l3 3v5h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></>,
    play:     <><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></>,
    shield:   <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></>,
    heart:    <><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></>,
    coffee:   <><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></>,
    bolt:     <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>,
    brain:    <><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z"/><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z"/></>,
    sparkle:  <><path d="M12 3L13.5 8.5L19 10L13.5 11.5L12 17L10.5 11.5L5 10L10.5 8.5Z"/><path d="M5 3L5.75 5.25L8 6L5.75 6.75L5 9L4.25 6.75L2 6L4.25 5.25Z"/><path d="M19 14L19.75 16.25L22 17L19.75 17.75L19 20L18.25 17.75L16 17L18.25 16.25Z"/></>,
    upload:   <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></>,
    file:     <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></>,
    send:     <><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></>,
    user:     <><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></>,
    users:    <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></>,
    edit:     <><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></>,
    more:     <><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></>,
    chevron:  <polyline points="9 18 15 12 9 6"/>,
  };
  return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={{flexShrink:0}}>{P[n]}</svg>;
};

// ─── Ring ────────────────────────────────────────────────────────────────────
const Ring = ({ pct, size=140, stroke=10, fg="#1a1a2e", bg="rgba(0,0,0,0.06)" }) => {
  const r = (size-stroke)/2, circ = 2*Math.PI*r, fill = Math.min(1,Math.max(0,pct))*circ;
  return (
    <svg width={size} height={size} style={{transform:"rotate(-90deg)"}}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={bg} strokeWidth={stroke}/>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={fg} strokeWidth={stroke}
        strokeLinecap="round" strokeDasharray={`${fill} ${circ}`}
        style={{transition:"stroke-dasharray 0.8s cubic-bezier(.4,0,.2,1)"}}/>
    </svg>
  );
};

// ─── Layout primitives ────────────────────────────────────────────────────────
const R = ({children,style}) => <div style={{display:"flex",alignItems:"center",...style}}>{children}</div>;
const C = ({children,style}) => <div style={{display:"flex",flexDirection:"column",...style}}>{children}</div>;

const CATS = [
  {id:"housing",      label:"Housing",      icon:"home",   bg:"#eef3ff", fg:"#3b5bdb"},
  {id:"transport",    label:"Transport",    icon:"car",    bg:"#fff4e6", fg:"#e67700"},
  {id:"subscriptions",label:"Subscriptions",icon:"play",   bg:"#f3eeff", fg:"#7048e8"},
  {id:"insurance",    label:"Insurance",    icon:"shield", bg:"#ebfbee", fg:"#2f9e44"},
  {id:"health",       label:"Health",       icon:"heart",  bg:"#fff0f6", fg:"#c2255c"},
  {id:"food",         label:"Food",         icon:"coffee", bg:"#fff8db", fg:"#e67700"},
  {id:"utilities",    label:"Utilities",    icon:"bolt",   bg:"#fffde7", fg:"#f59f00"},
  {id:"other",        label:"Other",        icon:"repeat", bg:"#f1f3f5", fg:"#868e96"},
];
const CAT_MAP = Object.fromEntries(CATS.map(c=>[c.id,c]));
const BANKS = ["Chase","Bank of America","Wells Fargo","Citibank","Capital One","US Bank","PNC Bank","TD Bank"];
const TABS  = [
  {id:"today",     label:"Today",    icon:"clock"},
  {id:"history",   label:"Spending", icon:"cal"},
  {id:"recurring", label:"Bills",    icon:"repeat"},
  {id:"household", label:"Household",icon:"users"},
  {id:"advisor",   label:"Advisor",  icon:"brain"},
];

// ─── App ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [data,setData]       = useState(load);
  const [tab,setTab]         = useState("today");
  const [newTx,setNewTx]     = useState({label:"",amount:"",type:"expense"});
  const [newRec,setNewRec]   = useState({name:"",amount:"",frequency:"monthly",category:"housing",dueDay:1});
  const [incStr,setIncStr]   = useState("");
  const [editInc,setEditInc] = useState(false);
  const [modal,setModal]     = useState(false);
  const [step,setStep]       = useState(0);
  const [selBank,setSelBank] = useState(null);
  const [loading,setLoading] = useState(false);
  const [selDay,setSelDay]     = useState(null);
  const [selDayTx,setSelDayTx] = useState({label:"",amount:"",type:"expense"});
  const [newMember,setNewMember]   = useState({name:"",monthlyIncome:"",color:"#7048e8"});
  const [newMemberRec,setNewMemberRec] = useState({name:"",amount:"",frequency:"monthly",category:"housing",dueDay:1,memberId:""});
  const [editMemberId,setEditMemberId] = useState(null);
  const [householdView,setHouseholdView] = useState("overview");
  const [chartView,setChartView]         = useState("daily");
  const [viewMonth,setViewMonth]          = useState(() => { const n=new Date(); return {yr:n.getFullYear(),mo:n.getMonth()}; }); // {yr,mo} for history calendar
  const [menuOpen,setMenuOpen]           = useState(false);
  const [aiMessages,setAiMessages] = useState([]);
  const [aiInput,setAiInput]       = useState("");
  const [aiLoading,setAiLoading]   = useState(false);
  const [suggestionCat,setSuggestionCat] = useState("My Finances");
  const [showOnboarding,setShowOnboarding] = useState(false);
  const [onboardStep,setOnboardStep]       = useState(0);
  const [showUpgrade,setShowUpgrade]       = useState(false);
  const [upgradeBilling,setUpgradeBilling] = useState("monthly");
  const [upgradeLoading,setUpgradeLoading] = useState(false);
  const [showFeedback,setShowFeedback]     = useState(false);
  const [feedbackStep,setFeedbackStep]     = useState('form'); // 'form' | 'thanks'
  const [feedbackRating,setFeedbackRating] = useState(0);
  const [feedbackCat,setFeedbackCat]       = useState('general');
  const [feedbackText,setFeedbackText]     = useState('');
  const [feedbackBusy,setFeedbackBusy]     = useState(false);
  const [uploadedFile,setUploadedFile] = useState(null);
  const [uploadPreview,setUploadPreview] = useState(null);
  const [analyzing,setAnalyzing]   = useState(false);
  const chatEndRef  = useRef(null);
  const saveTimerRef = useRef(null);   // debounce handle
  const pendingDataRef = useRef(null); // always holds the latest data for the debounced flush

  // ── Auth state ──────────────────────────────────────────────────────────────
  const [user,setUser]           = useState(null);
  const [authLoading,setAuthLoading] = useState(true);
  const [authScreen,setAuthScreen]   = useState("login"); // login | signup | forgot
  const [authEmail,setAuthEmail]     = useState("");
  const [authPass,setAuthPass]       = useState("");
  const [authError,setAuthError]     = useState("");
  const [authBusy,setAuthBusy]       = useState(false);
  const [syncBusy,setSyncBusy]       = useState(false);
  const [toast,setToast]             = useState(null);
  const [guestMode,setGuestMode]     = useState(false);
  const [showSplash,setShowSplash]   = useState(true);
  const [splashFading,setSplashFading] = useState(false);
  const [showGate,setShowGate]       = useState(null); // gate message string
  const [cameraOpen,setCameraOpen]   = useState(false);
  const showToast = (msg, type='success') => { setToast({msg,type}); setTimeout(()=>setToast(null),2800); };
  const submitFeedback = async () => {
    if (!feedbackRating || !feedbackText.trim()) return;
    setFeedbackBusy(true);
    try {
      await supabase.from('feedback').insert({ rating: feedbackRating, category: feedbackCat, text: feedbackText, user_id: user?.id || null, created_at: new Date().toISOString() });
    } catch(e) { console.log('Feedback error:', e); }
    setFeedbackBusy(false);
    setFeedbackStep('thanks');
  };

  // ── Splash screen timer — fade starts at 4.2s, unmount at 6.4s ──────────────
  useEffect(() => {
    const fadeTimer   = setTimeout(() => setSplashFading(true),  4200);
    const removeTimer = setTimeout(() => setShowSplash(false),   6400);
    return () => { clearTimeout(fadeTimer); clearTimeout(removeTimer); };
  }, []);

  // ── Guest demo data ──────────────────────────────────────────────────────
  const GUEST_DATA = {
    ...DEFAULTS,
    monthlyIncome: 4200,
    recurringPayments: [
      {id:1, name:'Rent', amount:1200, frequency:'monthly', category:'housing', dueDay:1},
      {id:2, name:'Car payment', amount:380, frequency:'monthly', category:'transport', dueDay:15},
      {id:3, name:'Phone', amount:85, frequency:'monthly', category:'other', dueDay:10},
      {id:4, name:'Netflix', amount:15.99, frequency:'monthly', category:'subscriptions', dueDay:5},
      {id:5, name:'Spotify', amount:9.99, frequency:'monthly', category:'subscriptions', dueDay:5},
    ],
    dailyEntries: {
      [todayKey()]: { transactions: [
        {id:10, label:'Starbucks', amount:6.75, type:'expense'},
        {id:11, label:'Lunch', amount:14.20, type:'expense'},
      ]},
    },
  };

  // ── Feature gate helper ──────────────────────────────────────────────────
  const requireAuth = (msg) => {
    if (user) return true;
    setShowGate(msg || 'Sign in to unlock this feature');
    return false;
  };

  // ── Auth listener ───────────────────────────────────────────────────────────
 useEffect(()=>{
    const {data:{subscription}} = supabase.auth.onAuthStateChange((event,session)=>{
      setUser(session?.user ?? null);
      setAuthLoading(false);
      // Only do a full load on actual sign-in or first session — NOT on token refresh
      // TOKEN_REFRESHED fires every time the user tabs back in, causing the data wipe
      if (session?.user && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) {
        loadFromSupabase(session.user.id);
      }
    });
    return ()=>subscription.unsubscribe();
  },[]);

  // ── Save on tab-away — flush any pending debounce immediately ───────────────
  useEffect(()=>{
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden' && user) {
        // Cancel the debounce timer and save immediately with latest data
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        const latest = pendingDataRef.current || data;
        saveToSupabase(latest, user.id);
        pendingDataRef.current = null;
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [user, data]);

  // ── Load user data from Supabase ────────────────────────────────────────────
  const loadFromSupabase = async (userId) => {
    try {
      // Load settings
      let {data:settings} = await supabase.from("user_settings").select("*").eq("user_id",userId).maybeSingle();
      if (!settings) {
        await supabase.from("user_settings").upsert({user_id: userId, monthly_income: 0, plan: 'free'});
        settings = {monthly_income: 0, plan: 'free'};
      }
      // Load daily entries
      const {data:entries} = await supabase.from("daily_entries").select("*").eq("user_id",userId);
      // Load recurring
      const {data:recurring} = await supabase.from("recurring_payments").select("*").eq("user_id",userId);
      // Load household
      const {data:members} = await supabase.from("household_members").select("*").eq("user_id",userId);

      const entriesMap = {};
      (entries||[]).forEach(e=>{ entriesMap[e.date] = {transactions: e.transactions||[]}; });

      const newData = {
        ...DEFAULTS,
        monthlyIncome: settings?.monthly_income ?? 0,
        monthlyIncomes: settings?.monthly_incomes ?? {},
        householdMode: settings?.household_mode ?? false,
        recurringPayments: (recurring||[]).map(r=>({id:r.id,name:r.name,amount:r.amount,frequency:r.frequency,category:r.category,dueDay:r.due_day})),
        dailyEntries: entriesMap,
        members: (members||[]).map(m=>({id:m.id,name:m.name,color:m.color,monthlyIncome:m.monthly_income,recurringPayments:[]})),
        plan: settings?.plan ?? "free",
      };
      setData(newData);
      persist(newData);
      // Show onboarding only once, for brand new users who haven't seen it
      if (!localStorage.getItem(ONBOARD_KEY) && (settings?.monthly_income ?? 0) === 0) {
        setShowOnboarding(true);
      }
    } catch(e) {
      console.log("Load error:", e);
    }
  };

  // ── Save to Supabase ────────────────────────────────────────────────────────
  const saveToSupabase = async (newData, userId) => {
    if (!userId) return;
    try {
      // 1. Settings
      await supabase.from("user_settings").upsert({
        user_id: userId,
        monthly_income: newData.monthlyIncome,
        monthly_incomes: newData.monthlyIncomes || {},
        plan: newData.plan ?? "free",
        household_mode: newData.householdMode ?? false,
        updated_at: new Date().toISOString(),
      });

      // 2. Daily entries — upsert on (user_id, date) unique constraint
      const entries = Object.entries(newData.dailyEntries || {});
      if (entries.length > 0) {
        await supabase.from("daily_entries").upsert(
          entries.map(([date, entry]) => ({
            user_id: userId,
            date,
            transactions: entry.transactions || [],
          })),
          { onConflict: "user_id,date" }
        );
      }

      // 3. Recurring payments — full delete + reinsert so IDs never matter
      // (IDs are local-only for React keying; Supabase generates its own UUIDs)
      await supabase.from("recurring_payments").delete().eq("user_id", userId);
      if ((newData.recurringPayments||[]).length > 0) {
        await supabase.from("recurring_payments").insert(
          (newData.recurringPayments||[]).map(p => ({
            user_id: userId,
            name: p.name,
            amount: p.amount,
            frequency: p.frequency,
            category: p.category || "other",
            due_day: p.dueDay || 1,
          }))
        );
      }

      // 4. Household members — same approach
      await supabase.from("household_members").delete().eq("user_id", userId);
      if ((newData.members||[]).length > 0) {
        await supabase.from("household_members").insert(
          (newData.members||[]).map(m => ({
            user_id: userId,
            name: m.name,
            color: m.color,
            monthly_income: parseFloat(m.monthlyIncome)||0,
          }))
        );
      }
    } catch(e) {
      console.log("Save error:", e);
    }
  };

  // ── Auth actions ────────────────────────────────────────────────────────────
  const signInGoogle = async () => {
    setAuthBusy(true);
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    setAuthBusy(false);
  };

  const signInEmail = async () => {
    if (!authEmail||!authPass) return setAuthError("Please fill in all fields");
    setAuthBusy(true); setAuthError("");
    const {error} = await supabase.auth.signInWithPassword({email:authEmail,password:authPass});
    if (error) setAuthError(error.message);
    setAuthBusy(false);
  };

  const signUpEmail = async () => {
    if (!authEmail||!authPass) return setAuthError("Please fill in all fields");
    if (authPass.length < 6) return setAuthError("Password must be at least 6 characters");
    setAuthBusy(true); setAuthError("");
    const {error} = await supabase.auth.signUp({email:authEmail,password:authPass,options:{emailRedirectTo:window.location.origin}});
    if (error) setAuthError(error.message);
    else setAuthError("✅ Check your email to confirm your account!");
    setAuthBusy(false);
  };

  const resetPassword = async () => {
    if (!authEmail) return setAuthError("Enter your email first");
    setAuthBusy(true); setAuthError("");
    await supabase.auth.resetPasswordForEmail(authEmail,{redirectTo:window.location.origin});
    setAuthError("✅ Password reset email sent!");
    setAuthBusy(false);
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setData(DEFAULTS);
  };

  // ── Debounced Supabase sync — fires 800ms after last change, always uses latest data ──
  const debouncedSave = (newData) => {
    if (!user) return;
    pendingDataRef.current = newData;          // always track latest
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      if (pendingDataRef.current) {
        saveToSupabase(pendingDataRef.current, user.id);
        pendingDataRef.current = null;
      }
    }, 800);
  };

  const upd = (patch) => {
    const n = {...data,...patch};
    setData(n);
    persist(n);
    debouncedSave(n);
  };

  const TODAY      = todayKey();
  const activeData = (guestMode && !user) ? GUEST_DATA : data;
  const entry      = activeData.dailyEntries[TODAY]||{transactions:[]};

  // Household-aware totals — combine owner + all members
  const allMembers   = activeData.householdMode ? activeData.members : [];
  const memberIncome = allMembers.reduce((s,m)=>s+(parseFloat(m.monthlyIncome)||0), 0);
  const memberBills  = allMembers.reduce((s,m)=>s+totalBills(m.recurringPayments||[]), 0);
  const householdIncome   = activeData.monthlyIncome + memberIncome;
  const householdBills    = totalBills(activeData.recurringPayments) + memberBills;

  const myPool     = calcPool(householdIncome, []);
  const myPoolReal = householdIncome - householdBills;
  const myAllow    = calcDaily(myPoolReal);
  const ptx        = activeData.plaidConnected ? activeData.plaidTransactions : [];
  const monthSpent = calcMonthSpent(activeData.dailyEntries, ptx);
  const daySpent   = calcDaySpent(entry, ptx);
  const todayLeft  = myAllow - daySpent;
  const poolLeft   = myPoolReal - monthSpent;
  const pctDay     = myAllow > 0 ? daySpent / myAllow : 0;
  const dLeft      = DIM - dayOfMonth() + 1;
  const over       = todayLeft < 0;
  // Dynamic accent: green=on track, amber=80%+, red=over
  const accent     = over ? "#e03131" : pctDay > 0.8 ? "#f08c00" : "#2f9e44";
  const accentBg   = over ? "#fff5f5" : pctDay > 0.8 ? "#fff9db" : "#ebfbee";
  const needsSetup = activeData.monthlyIncome === 0;

  const allTodayTx = [...(entry.transactions||[]).map(t=>({...t,source:"manual"})), ...ptx.filter(t=>t.date===TODAY)];

  const addTx = () => {
    if (!requireAuth("Create a free account to log transactions and track your spending")) return;
    if (!newTx.label.trim()||!newTx.amount) return;
    const tx = {id:Date.now(),label:newTx.label.trim(),amount:parseFloat(newTx.amount),type:newTx.type};
    upd({dailyEntries:{...data.dailyEntries,[TODAY]:{...entry,transactions:[...(entry.transactions||[]),tx]}}});
    setNewTx({label:"",amount:"",type:"expense"});
  };
  const removeTx = id => upd({dailyEntries:{...data.dailyEntries,[TODAY]:{...entry,transactions:entry.transactions.filter(t=>t.id!==id)}}});

  // Add/remove for any past day
  const addTxForDay = (dateKey) => {
    if (!selDayTx.label.trim()||!selDayTx.amount) return;
    const tx = {id:Date.now(),label:selDayTx.label.trim(),amount:parseFloat(selDayTx.amount),type:selDayTx.type};
    const existing = data.dailyEntries[dateKey]||{transactions:[]};
    upd({dailyEntries:{...data.dailyEntries,[dateKey]:{...existing,transactions:[...(existing.transactions||[]),tx]}}});
    setSelDayTx({label:"",amount:"",type:"expense"});
  };
  const removeTxForDay = (dateKey, id) => {
    const existing = data.dailyEntries[dateKey]||{transactions:[]};
    upd({dailyEntries:{...data.dailyEntries,[dateKey]:{...existing,transactions:(existing.transactions||[]).filter(t=>t.id!==id)}}});
  };
  const addRec = () => {
    if (!requireAuth("Create a free account to track your bills and recurring payments")) return;
    if (!newRec.name.trim()||!newRec.amount) return;
    upd({recurringPayments:[...data.recurringPayments,{id:Date.now(),name:newRec.name.trim(),amount:parseFloat(newRec.amount),frequency:newRec.frequency,category:newRec.category,dueDay:parseInt(newRec.dueDay)||1}]});
    setNewRec({name:"",amount:"",frequency:"monthly",category:newRec.category,dueDay:1});
  };
  const connectPlaid = bank => {
    setLoading(true);
    setTimeout(()=>{ upd({plaidConnected:true,bankName:bank,plaidTransactions:MOCK_PLAID}); setLoading(false); setModal(false); setStep(0); setSelBank(null); setTab("today"); }, 2000);
  };

  const allDayKeys  = new Set([...Object.keys(data.dailyEntries),...ptx.map(t=>t.date)]);
  const historyDays = [...allDayKeys].sort((a,b)=>b.localeCompare(a)); // all days, no cap

  // ── AI Advisor helpers ────────────────────────────────────────────────────
  const buildFinancialContext = () => {
    // Build a rich snapshot of everything the AI needs to know
    const now = new Date();
    const currentMonth = now.toISOString().slice(0,7);
    const prevMonth = new Date(now.getFullYear(), now.getMonth()-1, 1).toISOString().slice(0,7);

    // Last 14 days of activity
    const recentActivity = Object.entries(data.dailyEntries)
      .sort(([a],[b]) => b.localeCompare(a))
      .slice(0,14)
      .map(([date, entry]) => {
        const txs = entry.transactions||[];
        const spent = txs.filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount,0);
        const income = txs.filter(t=>t.type==='income').reduce((s,t)=>s+t.amount,0);
        const txList = txs.map(t=>`${t.label}($${t.amount})`).join(', ');
        return `  ${date}: spent $${spent.toFixed(2)}${income>0?`, income $${income.toFixed(2)}`:''}${txList?` [${txList}]`:''}`;
      }).join('\n') || '  No recent activity logged';

    // Bills with IDs for removal/editing
    const billsList = data.recurringPayments.length > 0
      ? data.recurringPayments.map(p=>`  id:${p.id} "${p.name}" $${p.amount}/${p.frequency}, due day ${p.dueDay||1}, category:${p.category||'other'}`).join('\n')
      : '  None';

    // Historical monthly incomes
    const incomeHistory = Object.entries(data.monthlyIncomes||{})
      .sort(([a],[b]) => b.localeCompare(a))
      .slice(0,6)
      .map(([m,v])=>`  ${m}: $${v}`)
      .join('\n') || '  No history (only current income set)';

    // Household members
    const membersList = (data.members||[]).length > 0
      ? (data.members||[]).map(m=>`  id:${m.id} "${m.name}" $${parseFloat(m.monthlyIncome)||0}/mo`).join('\n')
      : '  None';

    return `You are the DayFlow AI Advisor — a genuinely helpful, friendly personal finance assistant embedded directly in the user's budgeting app. You have REAL-TIME control over the app. You can read all their data and instantly update anything they ask.

═══ USER'S CURRENT DATA ═══

Monthly take-home income: $${data.monthlyIncome}/mo (current setting)
${data.householdMode ? `Household mode: ON — combined income $${householdIncome.toFixed(2)}/mo` : 'Household mode: OFF'}
Monthly bills total: $${householdBills.toFixed(2)}/mo
Spendable pool: $${myPoolReal.toFixed(2)}/mo
Daily allowance: $${myAllow.toFixed(2)}/day (÷ ${DIM} days)
Month progress: Day ${dayOfMonth()} of ${DIM}
Spent this month: $${monthSpent.toFixed(2)} | Pool remaining: $${poolLeft.toFixed(2)}

BILLS ON FILE:
${billsList}

HOUSEHOLD MEMBERS:
${membersList}

INCOME HISTORY (past months):
${incomeHistory}

RECENT ACTIVITY (last 14 days):
${recentActivity}

═══ YOUR PERSONALITY ═══

- Warm, direct, never preachy or condescending
- You speak like a knowledgeable friend, not a corporate chatbot
- Use their actual numbers. Be specific, not generic.
- If something seems off (income too low, bills too high), gently flag it
- Celebrate wins — "you saved $X this week" type energy
- When they say "fix it", "change it", "update it", "I made a mistake" — just DO it, don't ask for confirmation unless the request is genuinely ambiguous
- You can handle ANYTHING finance-related: budgeting, investing, debt, taxes, 401k, Roth IRA, HSA, credit scores, etc.

When investing/stocks/brokerage comes up naturally: mention [Get free stock on Robinhood](https://join.robinhood.com/brado84) once per conversation. Never force it.

═══ LIVE ACTIONS — YOU CONTROL THE APP ═══

You can execute multiple actions in one response. Include them ALL at the end, each on its own line. The app will execute every single one.

**INCOME:**
<dayflow_action>{"type":"set_income","amount":5000}</dayflow_action>
→ Sets current monthly income

<dayflow_action>{"type":"set_income_for_month","amount":2500,"month":"2025-02"}</dayflow_action>
→ Records what income was in a past month (month = YYYY-MM format)

**TRANSACTIONS — LOG:**
<dayflow_action>{"type":"log_expense","label":"Coffee","amount":4.50}</dayflow_action>
→ Logs expense for TODAY

<dayflow_action>{"type":"log_expense","label":"Groceries","amount":87.00,"date":"2025-03-15"}</dayflow_action>
→ Logs expense for a SPECIFIC DATE (date = YYYY-MM-DD)

<dayflow_action>{"type":"log_income","label":"Freelance","amount":500}</dayflow_action>
→ Logs income received TODAY

<dayflow_action>{"type":"log_income","label":"Side gig","amount":300,"date":"2025-03-10"}</dayflow_action>
→ Logs income for a SPECIFIC DATE

**TRANSACTIONS — REMOVE/FIX:**
<dayflow_action>{"type":"remove_transaction","label":"Coffee","date":"${TODAY}"}</dayflow_action>
→ Removes a transaction by label match (date optional, defaults to today). Use when user says "I logged that wrong" or "remove the X entry"

<dayflow_action>{"type":"clear_day","date":"${TODAY}"}</dayflow_action>
→ Clears ALL transactions for a day. Use when user says "wipe today" or "start over for [date]"

**BILLS:**
<dayflow_action>{"type":"add_bill","name":"Netflix","amount":15.99,"frequency":"monthly","category":"subscriptions","dueDay":5}</dayflow_action>
→ Adds a new recurring bill. frequency: "monthly"|"weekly"|"yearly"|"daily". category: "housing"|"transport"|"subscriptions"|"insurance"|"health"|"food"|"utilities"|"other"

<dayflow_action>{"type":"remove_bill","name":"Netflix"}</dayflow_action>
→ Removes a bill by name (fuzzy match). Use when user cancels a subscription or says "remove X"

<dayflow_action>{"type":"edit_bill","name":"Netflix","amount":22.99}</dayflow_action>
→ Updates a bill's amount, frequency, or dueDay. Only include fields that change.

**HOUSEHOLD:**
<dayflow_action>{"type":"set_member_income","name":"Alex","amount":3200}</dayflow_action>
→ Updates a household member's income

<dayflow_action>{"type":"toggle_household_mode","enabled":true}</dayflow_action>
→ Turns household mode on or off

**APP NAVIGATION:**
<dayflow_action>{"type":"navigate","tab":"recurring"}</dayflow_action>
→ Switches the app to a tab. tabs: "today"|"history"|"recurring"|"household"|"advisor"

═══ ACTION RULES ═══

1. **Execute first, explain after** — when the intent is clear, just do it and confirm in your message text
2. **Multiple actions are fine** — if they say "add Netflix and Spotify", use TWO add_bill actions
3. **Be smart about dates** — "last Tuesday", "March 15th", "yesterday" → convert to YYYY-MM-DD. Today is ${TODAY}.
4. **Fuzzy matching** — if they say "remove hulu" and the bill is "Hulu + Live TV", still remove it
5. **Corrections welcome** — "I typed wrong", "fix my income", "that was wrong" → just fix it
6. **Historical income** — "My February income was $2,800" → use set_income_for_month with the right month
7. **Don't ask when clear** — "My income is $4,500" → set_income immediately. Only ask if genuinely ambiguous (e.g., "I make good money" — no number)
8. **Navigate helpfully** — if you add bills, also navigate to "recurring" so they see the result
9. Current month is ${currentMonth}, previous month is ${prevMonth}`;
  };

  // ── Execute live actions from AI — full action library ──────────────────
  const executeDayflowActions = (actionsArr) => {
    // Use functional setData so we always read the CURRENT state,
    // not the stale closure captured when sendAiMessage started streaming.
    setData(prev => {
      let d = {...prev};

      for (const action of actionsArr) {
        try {
          if (action.type === 'set_income') {
            const amt = parseFloat(action.amount)||0;
            if (amt > 0) { d = {...d, monthlyIncome: amt}; showToast(`Income updated to ${fmt(amt)}/mo ✓`); }

          } else if (action.type === 'set_income_for_month') {
            const amt = parseFloat(action.amount)||0;
            const month = action.month || thisMonth();
            if (amt > 0) {
              d = {...d, monthlyIncomes: {...(d.monthlyIncomes||{}), [month]: amt}};
              if (month === thisMonth()) d = {...d, monthlyIncome: amt};
              showToast(`${month} income set to ${fmt(amt)} ✓`);
            }

          } else if (action.type === 'log_expense') {
            const dateKey = action.date || todayKey();
            const tx = {id: Date.now()+Math.random(), label: action.label||'Expense', amount: parseFloat(action.amount)||0, type: 'expense'};
            const existing = d.dailyEntries[dateKey]||{transactions:[]};
            d = {...d, dailyEntries: {...d.dailyEntries, [dateKey]: {...existing, transactions: [...(existing.transactions||[]), tx]}}};
            showToast(`−${fmtFull(tx.amount)} logged${action.date&&action.date!==todayKey()?' for '+action.date:''} ✓`);

          } else if (action.type === 'log_income') {
            const dateKey = action.date || todayKey();
            const tx = {id: Date.now()+Math.random(), label: action.label||'Income', amount: parseFloat(action.amount)||0, type: 'income'};
            const existing = d.dailyEntries[dateKey]||{transactions:[]};
            d = {...d, dailyEntries: {...d.dailyEntries, [dateKey]: {...existing, transactions: [...(existing.transactions||[]), tx]}}};
            showToast(`+${fmtFull(tx.amount)} logged${action.date&&action.date!==todayKey()?' for '+action.date:''} ✓`);

          } else if (action.type === 'remove_transaction') {
            const dateKey = action.date || todayKey();
            const label = (action.label||'').toLowerCase();
            const existing = d.dailyEntries[dateKey]||{transactions:[]};
            let removed = false;
            const newTxs = [...(existing.transactions||[])].reverse().filter(t => {
              if (!removed && t.label.toLowerCase().includes(label)) { removed = true; return false; }
              return true;
            }).reverse();
            if (removed) {
              d = {...d, dailyEntries: {...d.dailyEntries, [dateKey]: {...existing, transactions: newTxs}}};
              showToast(`Removed "${action.label}" ✓`);
            }

          } else if (action.type === 'clear_day') {
            const dateKey = action.date || todayKey();
            const existing = d.dailyEntries[dateKey]||{transactions:[]};
            d = {...d, dailyEntries: {...d.dailyEntries, [dateKey]: {...existing, transactions: []}}};
            showToast(`Cleared all transactions for ${dateKey} ✓`);

          } else if (action.type === 'add_bill') {
            const bill = {
              id: Date.now()+Math.random(),
              name: action.name||'Bill',
              amount: parseFloat(action.amount)||0,
              frequency: action.frequency||'monthly',
              category: action.category||'other',
              dueDay: parseInt(action.dueDay)||1,
            };
            d = {...d, recurringPayments: [...(d.recurringPayments||[]), bill]};
            showToast(`${bill.name} added to bills ✓`);

          } else if (action.type === 'remove_bill') {
            const nameQ = (action.name||'').toLowerCase();
            const filtered = (d.recurringPayments||[]).filter(p => !p.name.toLowerCase().includes(nameQ));
            if (filtered.length < (d.recurringPayments||[]).length) {
              d = {...d, recurringPayments: filtered};
              showToast(`${action.name} removed ✓`);
            }

          } else if (action.type === 'edit_bill') {
            const nameQ = (action.name||'').toLowerCase();
            const updated = (d.recurringPayments||[]).map(p => {
              if (!p.name.toLowerCase().includes(nameQ)) return p;
              return {
                ...p,
                ...(action.amount    !== undefined ? {amount:    parseFloat(action.amount)}  : {}),
                ...(action.frequency !== undefined ? {frequency: action.frequency}           : {}),
                ...(action.dueDay    !== undefined ? {dueDay:    parseInt(action.dueDay)}    : {}),
                ...(action.category  !== undefined ? {category:  action.category}            : {}),
                ...(action.newName   !== undefined ? {name:      action.newName}             : {}),
              };
            });
            d = {...d, recurringPayments: updated};
            showToast(`${action.name} updated ✓`);

          } else if (action.type === 'set_member_income') {
            const nameQ = (action.name||'').toLowerCase();
            const updated = (d.members||[]).map(m =>
              m.name.toLowerCase().includes(nameQ) ? {...m, monthlyIncome: parseFloat(action.amount)||0} : m
            );
            d = {...d, members: updated};
            showToast(`${action.name}'s income updated ✓`);

          } else if (action.type === 'toggle_household_mode') {
            d = {...d, householdMode: !!action.enabled};
            showToast(`Household mode ${action.enabled?'enabled':'disabled'} ✓`);

          } else if (action.type === 'navigate') {
            if (action.tab) setTab(action.tab);
          }

        } catch(e) { console.log('Action error:', action.type, e); }
      }

      // Persist and sync after all actions applied
      persist(d);
      debouncedSave(d);
      return d;
    });
  };

  const sendAiMessage = async (messageText, imageData = null) => {
    if (!messageText.trim() && !imageData) return;
    const userMsg = { role: 'user', content: messageText, image: imageData, id: Date.now() };
    const updatedMessages = [...aiMessages, userMsg];
    setAiMessages(updatedMessages);
    setAiInput('');
    setAiLoading(true);
    const msgId = Date.now() + 1;
    // Add empty streaming message immediately
    setAiMessages(prev => [...prev, { role: 'assistant', content: '', id: msgId, streaming: true }]);
    try {
      const apiMessages = updatedMessages.map(m => {
        if (m.image) {
          return { role: m.role, content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: m.image } },
            { type: 'text', text: m.content || 'Please analyze this document.' }
          ]};
        }
        return { role: m.role, content: m.content || '' };
      });
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': import.meta.env.VITE_ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1024,
          stream: true,
          system: buildFinancialContext(),
          messages: apiMessages,
        }),
      });
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data_str = line.slice(6).trim();
          if (data_str === '[DONE]') continue;
          try {
            const json = JSON.parse(data_str);
            if (json.type === 'content_block_delta' && json.delta?.type === 'text_delta') {
              fullText += json.delta.text;
              setAiMessages(prev => prev.map(m => m.id === msgId ? {...m, content: fullText} : m));
            }
          } catch(e) {}
        }
      }
      // Parse and execute ALL live actions
      const actionMatches = [...fullText.matchAll(/<dayflow_action>([\s\S]*?)<\/dayflow_action>/g)];
      if (actionMatches.length > 0) {
        const actions = actionMatches.map(m => { try { return JSON.parse(m[1]); } catch(e) { return null; } }).filter(Boolean);
        if (actions.length > 0) executeDayflowActions(actions);
        fullText = fullText.replace(/<dayflow_action>[\s\S]*?<\/dayflow_action>/g, '').trim();
      }
      // Finalize message
      setAiMessages(prev => prev.map(m => m.id === msgId ? {...m, content: fullText, streaming: false} : m));
    } catch(e) {
      setAiMessages(prev => prev.map(m => m.id === msgId ? {...m, content: 'Something went wrong. Please try again.', streaming: false} : m));
    }
    setAiLoading(false);
  };

  // ── Stripe Upgrade ───────────────────────────────────────────────────────
  const PRICES = {
    pro:      { monthly:"price_1TDvC2EHLJtYfhmkOqOXTxMe", annual:"price_1TDvFnEHLJtYfhmkUAJLYCpG" },
    business: { monthly:"price_1TDvFOEHLJtYfhmkGmcEEyv9", annual:"price_1TDvFOEHLJtYfhmkZQ3HhjTy" },
  };
  const handleUpgrade = async (planKey) => {
    if (!user) return;
    setUpgradeLoading(true);
    try {
      const priceId = PRICES[planKey][upgradeBilling];
      const { data: d, error } = await supabase.functions.invoke("stripe-checkout", {
        body: { priceId, userId: user.id, email: user.email },
      });
      if (error) throw error;
      if (d?.url) window.location.href = d.url;
    } catch(e) { alert("Could not start checkout. Please try again."); }
    finally { setUpgradeLoading(false); }
  };

  // ── Dynamic XLSX loader ─────────────────────────────────────────────────────
  const loadXLSX = () => new Promise((resolve) => {
    if (window.XLSX) { resolve(window.XLSX); return; }
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/xlsx/dist/xlsx.full.min.js';
    s.onload = () => resolve(window.XLSX);
    document.head.appendChild(s);
  });

  // ── Analyze any document (images, PDFs, Excel, CSV) ──────────────────────
  const analyzeDocument = async (contentBlocks, fileName) => {
    setAnalyzing(true);
    const prompt = `Analyze this financial document carefully. Please:
1. Extract ALL key numbers: gross pay, net pay, all deductions (taxes, 401k, insurance, etc.)
2. Explain each deduction in plain English — as if explaining to someone who has never read a paystub
3. Calculate take-home percentage of gross pay
4. Compare take-home to logged income of ${data.monthlyIncome > 0 ? '$'+data.monthlyIncome.toFixed(2)+'/mo' : 'not yet set'} — do they match?
5. Give 2-3 specific, actionable insights

Use markdown formatting: ## for section headers, ### for subsections, - for bullet points, **bold** for key numbers.

At the very END of your response, append this JSON block (no markdown around it, real numbers only):
<income_data>
{"net_pay":0,"pay_period":"biweekly","monthly_equivalent":0}
</income_data>

For monthly_equivalent: biweekly × 2.17, weekly × 4.33, semi-monthly × 2, monthly × 1. Round to nearest dollar.`;

    const isImage = contentBlocks[0]?.type === 'image';
    const userMsg = {
      role: 'user',
      content: 'Analyzing ' + fileName + '…',
      image: isImage ? contentBlocks[0].source.data : null,
      id: Date.now(),
      isPaystub: true,
      fileName,
    };
    setAiMessages(prev => [...prev, userMsg]);
    setAiLoading(true);
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': import.meta.env.VITE_ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'pdfs-2024-09-25',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 2000,
          system: buildFinancialContext(),
          messages: [{ role: 'user', content: [...contentBlocks, { type: 'text', text: prompt }] }],
        }),
      });
      const result = await res.json();
      const fullText = result.content?.[0]?.text || "Couldn't analyze the document.";

      // Extract income data JSON
      const incomeMatch = fullText.match(/<income_data>([\s\S]*?)<\/income_data>/);
      let incomeData = null;
      try { if (incomeMatch) incomeData = JSON.parse(incomeMatch[1].trim()); } catch(e) {}
      const displayText = fullText.replace(/<income_data>[\s\S]*?<\/income_data>/g, '').trim();

      setAiMessages(prev => [...prev, {
        role: 'assistant',
        content: displayText,
        id: Date.now(),
        incomeData,
      }]);

      // Auto-apply if income detected and different from current
      if (incomeData?.monthly_equivalent > 0) {
        const detected = incomeData.monthly_equivalent;
        const current = data.monthlyIncome;
        if (Math.abs(detected - current) > 50) {
          // Show apply prompt after a short delay
          setTimeout(() => {
            setAiMessages(prev => [...prev, {
              role: 'assistant',
              content: '**Your income has been detected from this document.**\n\nShould I update your DayFlow budget to reflect your actual take-home of **$' + detected.toLocaleString() + '/month**?' + (current > 0 ? ' (currently set to $' + current.toLocaleString() + '/mo)' : ''),
              id: Date.now() + 1,
              applyIncome: detected,
            }]);
          }, 400);
        } else if (incomeData?.monthly_equivalent > 0) {
          // Income matches, just confirm
          setTimeout(() => {
            setAiMessages(prev => [...prev, {
              role: 'assistant',
              content: '✅ Your logged income of **$' + current.toLocaleString() + '/mo** matches this paystub. Your DayFlow budget is accurate.',
              id: Date.now() + 1,
            }]);
          }, 400);
        }
      }
    } catch(e) {
      setAiMessages(prev => [...prev, { role: 'assistant', content: "Couldn't analyze the file. Please try again with a clearer image or different file.", id: Date.now() }]);
    }
    setAiLoading(false);
    setAnalyzing(false);
  };

  // ── Handle file upload — images, PDFs, Excel, CSV ────────────────────────
  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadedFile(file.name);
    const ext = file.name.split('.').pop().toLowerCase();

    // Excel / CSV → parse with SheetJS, send as text
    if (['xlsx','xls','csv'].includes(ext)) {
      try {
        const XLSX = await loadXLSX();
        const arrayBuffer = await file.arrayBuffer();
        const wb = XLSX.read(arrayBuffer, { type: 'array' });
        const sheetParts = wb.SheetNames.map(function(sName) {
          const ws = wb.Sheets[sName];
          const csv = XLSX.utils.sheet_to_csv(ws, { blankrows: false });
          return 'Sheet: ' + sName + '\n' + csv;
        });
        const combined = 'File: ' + file.name + '\n\n' + sheetParts.join('\n\n').slice(0, 8000);
        await analyzeDocument([{ type: 'text', text: combined }], file.name);
      } catch(err) {
        setAiMessages(prev => [...prev, { role: 'assistant', content: `Couldn't parse ${file.name}. Make sure it's a valid Excel or CSV file.`, id: Date.now() }]);
      }
      return;
    }

    // Images + PDFs → base64
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const base64 = ev.target.result.split(',')[1];
      const mediaType = file.type || (ext === 'pdf' ? 'application/pdf' : 'image/jpeg');
      setUploadPreview(ev.target.result);
      const isPdf = mediaType === 'application/pdf';
      const fileBlock = isPdf
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
        : { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } };
      await analyzeDocument([fileBlock], file.name);
    };
    reader.readAsDataURL(file);
  };
  // Auto-scroll chat
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [aiMessages]);

  // Suggested prompts — categorized, kept short so they display fully
  const suggestions = [
    {cat:"💰 My Money", prompts:[
      `Where is my money going?`,
      `Am I on track this month?`,
      `How do I boost my daily budget?`,
      `What bills can I cut?`,
      `How do I save more each month?`,
      `What should I do with extra money?`,
      `How do I build a budget that sticks?`,
    ]},
    {cat:"🏦 401k", prompts:[
      `How does a 401k work?`,
      `How much should I contribute?`,
      `What is an employer match?`,
      `Roth 401k vs Traditional 401k?`,
      `Can I withdraw early from a 401k?`,
      `What happens to my 401k if I quit?`,
      `How do I pick my 401k investments?`,
    ]},
    {cat:"📈 IRA", prompts:[
      `What is a Roth IRA?`,
      `Roth IRA vs Traditional IRA?`,
      `How much can I put in an IRA?`,
      `Can I have a 401k and IRA?`,
      `When can I withdraw from a Roth?`,
      `What is a backdoor Roth IRA?`,
      `How do I open a Roth IRA?`,
    ]},
    {cat:"🏥 HSA & FSA", prompts:[
      `What is an HSA?`,
      `HSA vs FSA — which is better?`,
      `What can I spend HSA money on?`,
      `Does HSA money expire?`,
      `What is a dependent care FSA?`,
      `Can I invest my HSA balance?`,
      `What is an HDHP?`,
    ]},
    {cat:"📊 Investing", prompts:[
      `How do I start investing?`,
      `What is an index fund?`,
      `How does compound interest work?`,
      `Stock vs ETF vs mutual fund?`,
      `What is dollar-cost averaging?`,
      `How much risk should I take?`,
      `What is a brokerage account?`,
    ]},
    {cat:"💳 Debt", prompts:[
      `How do I pay off debt fast?`,
      `Avalanche vs snowball method?`,
      `How big should my emergency fund be?`,
      `How do I build my credit score?`,
      `Should I pay debt or invest first?`,
      `How do I get out of credit card debt?`,
      `What is a good credit score?`,
    ]},
    {cat:"🧾 Taxes", prompts:[
      `How do I lower my tax bill?`,
      `What is the standard deduction?`,
      `What can a W-2 worker deduct?`,
      `What is a tax bracket?`,
      `How does tax withholding work?`,
      `Should I adjust my W-4?`,
      `What is the child tax credit?`,
    ]},
  ];

  const statusMsg = over
    ? `${fmtFull(Math.abs(todayLeft))} over today's limit`
    : pctDay > 0.8
    ? `Almost at your limit — ${fmtFull(todayLeft)} left`
    : `You're on track — ${fmtFull(todayLeft)} free today`;

  // ── Auth loading / Splash overlay handled in main return below ──

  // ── Auth screen ─────────────────────────────────────────────────────────────
  // ── Splash screen ────────────────────────────────────────────────────────────
  if (showSplash) return (
    <div style={{minHeight:"100vh",background:"#f0efe9",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Plus Jakarta Sans',sans-serif",overflow:"hidden"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&display=swap');
        @keyframes splashFadeIn { 0%{opacity:0} 100%{opacity:1} }
        @keyframes splashScaleIn { 0%{transform:scale(0.62) translateY(16px);opacity:0} 55%{transform:scale(1.03) translateY(-3px);opacity:1} 100%{transform:scale(1) translateY(0);opacity:1} }
        @keyframes waveDrawSlow { 0%{stroke-dashoffset:300;opacity:0} 6%{opacity:1} 100%{stroke-dashoffset:0;opacity:1} }
        @keyframes ghostDrawSlow { 0%{stroke-dashoffset:340;opacity:0} 10%{opacity:1} 100%{stroke-dashoffset:0;opacity:1} }
        @keyframes ballPulse { 0%,100%{r:8;opacity:1} 50%{r:11;opacity:0.8} }
        @keyframes wordmarkIn { 0%{opacity:0;transform:translateY(20px);filter:blur(4px)} 100%{opacity:1;transform:translateY(0);filter:blur(0)} }
        @keyframes underlineGrow { 0%{transform:scaleX(0);opacity:0} 60%{opacity:1} 100%{transform:scaleX(1);opacity:1} }
        @keyframes taglineIn { 0%{opacity:0;transform:translateY(12px)} 100%{opacity:1;transform:translateY(0)} }
        .splash-ball-pulse { animation: ballPulse 2s ease-in-out 3.5s infinite; }
      `}</style>
      <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:40,
        animation:"splashFadeIn 0.8s ease both",
        opacity: splashFading ? 0 : 1,
        transition: splashFading ? "opacity 2s ease" : "none",
        pointerEvents:"none"
      }}>
        <div style={{animation:"splashScaleIn 1.8s cubic-bezier(0.34,1.05,0.64,1) 0.1s both"}}>
          <svg width="220" height="100" viewBox="0 0 220 100" fill="none">
            <path d="M5 50 Q28 12 55 50 Q82 88 110 50 Q138 12 165 50 Q192 88 215 50"
              stroke="#d4d0c8" strokeWidth="2" strokeLinecap="round" fill="none"
              strokeDasharray="360" strokeDashoffset="360"
              style={{animation:"ghostDrawSlow 3.2s cubic-bezier(0.4,0,0.2,1) 0.4s forwards"}}/>
            <path d="M5 50 Q28 12 55 50 Q82 88 110 50 Q138 12 165 50"
              stroke="#1a1a2e" strokeWidth="3.5" strokeLinecap="round" fill="none"
              strokeDasharray="320" strokeDashoffset="320"
              style={{animation:"waveDrawSlow 2.8s cubic-bezier(0.25,0.46,0.45,0.94) 0.5s forwards"}}/>
            <circle r="8" fill="#2f9e44" className="splash-ball-pulse">
              <animateMotion dur="2.8s" begin="0.5s" fill="freeze"
                calcMode="spline" keyPoints="0;1" keyTimes="0;1"
                keySplines="0.25 0.46 0.45 0.94"
                path="M5 50 Q28 12 55 50 Q82 88 110 50 Q138 12 165 50"/>
            </circle>
          </svg>
        </div>
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:10}}>
          <div style={{fontSize:56,fontWeight:800,color:"#1a1a2e",letterSpacing:"-0.05em",lineHeight:1,animation:"wordmarkIn 1.2s cubic-bezier(0.22,1,0.36,1) 0.8s both"}}>
            day<span style={{fontWeight:300,color:"#6b6864"}}>flow</span>
          </div>
          <div style={{width:44,height:2,borderRadius:2,background:"#2f9e44",transformOrigin:"center",animation:"underlineGrow 1.0s cubic-bezier(0.4,0,0.2,1) 1.8s both"}}/>
        </div>
        <div style={{fontSize:15,fontWeight:400,color:"#9e9b95",letterSpacing:"0.03em",animation:"taglineIn 1.2s cubic-bezier(0.22,1,0.36,1) 1.4s both"}}>
          Take your spending day by day
        </div>
      </div>
    </div>
  );

  // ── Auth screen ─────────────────────────────────────────────────────────────
  if (!user && !guestMode) return (
    <div style={{minHeight:"100vh",background:"#f0efe9",fontFamily:"'Plus Jakarta Sans',sans-serif",display:"flex",alignItems:"center",justifyContent:"center",padding:"20px"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        .auth-inp{width:100%;background:#f8f7f2;border:1.5px solid #e8e5dc;border-radius:14px;padding:14px 16px;font-size:15px;color:#1a1a2e;outline:none;transition:all 0.15s;font-family:inherit;}
        .auth-inp:focus{border-color:#1a1a2e;background:#fff;box-shadow:0 0 0 3px rgba(26,26,46,0.06);}
        .auth-btn{width:100%;background:#1a1a2e;color:#fff;border:none;border-radius:14px;padding:15px;font-size:15px;font-weight:700;cursor:pointer;transition:all 0.15s;font-family:inherit;}
        .auth-btn:hover{background:#2d2d4e;transform:translateY(-1px);}
        .auth-btn:disabled{opacity:0.5;transform:none;cursor:not-allowed;}
        .google-btn{width:100%;background:#fff;color:#1a1a2e;border:1.5px solid #e8e5dc;border-radius:14px;padding:14px;font-size:15px;font-weight:600;cursor:pointer;transition:all 0.15s;font-family:inherit;display:flex;align-items:center;justify-content:center;gap:10px;}
        .google-btn:hover{border-color:#1a1a2e;transform:translateY(-1px);}
        .auth-link{background:none;border:none;color:#3b5bdb;cursor:pointer;font-family:inherit;font-size:13px;font-weight:600;text-decoration:underline;}
      `}</style>
      <div style={{width:"100%",maxWidth:420}}>
        <div style={{textAlign:"center",marginBottom:32}}>
          <svg width="56" height="56" viewBox="0 0 56 56" fill="none" style={{margin:"0 auto 14px",display:"block"}}>
            <rect width="56" height="56" rx="16" fill="#1a1a2e"/>
            <path d="M7 28 Q14 14 21 28 Q28 42 35 28 Q42 14 49 28" stroke="rgba(255,255,255,0.2)" strokeWidth="2.5" strokeLinecap="round" fill="none"/>
            <path d="M7 28 Q14 14 21 28 Q28 42 35 28" stroke="#fff" strokeWidth="3" strokeLinecap="round" fill="none"/>
            <circle cx="35" cy="28" r="5" fill="#2f9e44"/>
          </svg>
          <div style={{fontSize:28,fontWeight:800,letterSpacing:"-0.04em",color:"#1a1a2e"}}>
            day<span style={{fontWeight:300,color:"#6b6864"}}>flow</span>
          </div>
          <div style={{fontSize:14,color:"#9e9b95",marginTop:6}}>
            {authScreen==="login"?"Welcome back":"Create your account"}
          </div>
        </div>

        <div style={{background:"#fff",borderRadius:24,padding:28,boxShadow:"0 4px 0 rgba(0,0,0,0.06),0 16px 48px rgba(0,0,0,0.1)"}}>
          {authScreen==="forgot"?(
            <div style={{display:"flex",flexDirection:"column",gap:14}}>
              <div style={{fontSize:16,fontWeight:700,marginBottom:4}}>Reset password</div>
              <input className="auth-inp" type="email" placeholder="your@email.com" value={authEmail} onChange={e=>setAuthEmail(e.target.value)}/>
              {authError&&<div style={{fontSize:13,color:authError.startsWith("✅")?"#2f9e44":"#e03131",fontWeight:500}}>{authError}</div>}
              <button className="auth-btn" onClick={resetPassword} disabled={authBusy}>{authBusy?"Sending…":"Send reset email"}</button>
              <button className="auth-link" onClick={()=>{setAuthScreen("login");setAuthError("");}}>← Back to login</button>
            </div>
          ):(
            <div style={{display:"flex",flexDirection:"column",gap:14}}>
              <button className="google-btn" onClick={signInGoogle} disabled={authBusy}>
                <svg width="18" height="18" viewBox="0 0 18 18"><path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/><path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/><path d="M3.964 10.707A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.707V4.961H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.039l3.007-2.332z" fill="#FBBC05"/><path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.961L3.964 6.293C4.672 4.166 6.656 3.58 9 3.58z" fill="#EA4335"/></svg>
                Continue with Google
              </button>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <div style={{flex:1,height:1,background:"#f0efe9"}}/>
                <span style={{fontSize:12,color:"#bbb9b0",fontWeight:500}}>or</span>
                <div style={{flex:1,height:1,background:"#f0efe9"}}/>
              </div>
              <input className="auth-inp" type="email" placeholder="Email address" value={authEmail} onChange={e=>setAuthEmail(e.target.value)} onKeyDown={e=>e.key==="Enter"&&(authScreen==="login"?signInEmail():signUpEmail())}/>
              <input className="auth-inp" type="password" placeholder="Password" value={authPass} onChange={e=>setAuthPass(e.target.value)} onKeyDown={e=>e.key==="Enter"&&(authScreen==="login"?signInEmail():signUpEmail())}/>
              {authError&&<div style={{fontSize:13,color:authError.startsWith("✅")?"#2f9e44":"#e03131",fontWeight:500,lineHeight:1.5}}>{authError}</div>}
              <button className="auth-btn" onClick={authScreen==="login"?signInEmail:signUpEmail} disabled={authBusy}>
                {authBusy?"Please wait…":authScreen==="login"?"Sign in":"Create account"}
              </button>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                {authScreen==="login"?(
                  <>
                    <button className="auth-link" onClick={()=>{setAuthScreen("signup");setAuthError("");}}>New here? Sign up</button>
                    <button className="auth-link" onClick={()=>{setAuthScreen("forgot");setAuthError("");}}>Forgot password?</button>
                  </>
                ):(
                  <button className="auth-link" onClick={()=>{setAuthScreen("login");setAuthError("");}}>Already have an account?</button>
                )}
              </div>
            </div>
          )}
        </div>
        <button onClick={()=>setGuestMode(true)} style={{marginTop:16,width:"100%",background:"transparent",border:"1.5px solid #e0ddd4",borderRadius:16,padding:"13px",fontSize:14,fontWeight:600,color:"#9e9b95",cursor:"pointer",fontFamily:"inherit",transition:"all 0.15s"}}>
          Explore without an account →
        </button>
        <div style={{textAlign:"center",marginTop:14,fontSize:12,color:"#bbb9b0",lineHeight:1.6}}>
          By continuing you agree to our Terms of Service and Privacy Policy
        </div>
      </div>
    </div>
  );

  return (
      <div style={{minHeight:"100vh",background:"#f0efe9",fontFamily:"'Plus Jakarta Sans','Outfit',sans-serif",color:"#1a1a2e"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&display=swap');
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
        ::-webkit-scrollbar{display:none;}
        input,select,button{font-family:'Plus Jakarta Sans',sans-serif;}
        input[type=number]::-webkit-inner-spin-button{-webkit-appearance:none;}
        input::placeholder{color:#bbb9b0;}

        /* Textured background via CSS — subtle linen feel */
        body{background:#f0efe9;}

        /* Cards — warm white with real elevation */
        .card{background:#ffffff;border-radius:24px;box-shadow:0 2px 0px rgba(0,0,0,0.04),0 8px 32px rgba(0,0,0,0.07);border:1px solid rgba(255,255,255,0.8);}
        .card-inset{background:#f8f7f2;border-radius:18px;border:1px solid #ece9e0;}

        /* Hero card — full-bleed accent top band */
        .hero-card{background:#ffffff;border-radius:28px;box-shadow:0 4px 0 rgba(0,0,0,0.06),0 16px 48px rgba(0,0,0,0.1);overflow:hidden;position:relative;}
        .hero-band{position:absolute;top:0;left:0;right:0;height:5px;border-radius:28px 28px 0 0;transition:background 0.5s ease;}

        /* Inputs */
        .inp{width:100%;background:#f8f7f2;border:1.5px solid #e8e5dc;border-radius:14px;padding:13px 16px;font-size:14px;color:#1a1a2e;outline:none;transition:all 0.15s;}
        .inp:focus{border-color:#1a1a2e;background:#fff;box-shadow:0 0 0 3px rgba(26,26,46,0.06);}
        .sel{background:#f8f7f2;border:1.5px solid #e8e5dc;border-radius:14px;padding:13px 16px;font-size:14px;color:#1a1a2e;outline:none;cursor:pointer;transition:border-color 0.15s;}
        .sel:focus{border-color:#1a1a2e;}

        /* Buttons */
        .btn{background:#1a1a2e;color:#fff;border:none;border-radius:14px;padding:13px 22px;font-size:14px;font-weight:600;cursor:pointer;transition:all 0.15s;display:flex;align-items:center;gap:8px;white-space:nowrap;}
        .btn:hover{background:#2d2d4e;transform:translateY(-1px);box-shadow:0 4px 12px rgba(26,26,46,0.25);}
        .btn:active{transform:translateY(0);}
        .btn-ghost{background:transparent;border:1.5px solid #e0ddd4;border-radius:14px;padding:11px 18px;font-size:13px;font-weight:600;color:#6b6965;cursor:pointer;transition:all 0.15s;display:flex;align-items:center;gap:6px;}
        .btn-ghost:hover{border-color:#1a1a2e;color:#1a1a2e;}

        /* Segmented control */
        .seg{display:flex;background:#f0efe9;border-radius:12px;padding:3px;gap:2px;}
        .seg-opt{background:none;border:none;cursor:pointer;padding:8px 16px;border-radius:9px;font-size:13px;font-weight:600;color:#9e9b95;transition:all 0.15s;font-family:inherit;}
        .seg-opt.on{background:#fff;color:#1a1a2e;box-shadow:0 1px 4px rgba(0,0,0,0.1);}

        /* Transaction rows */
        .tx-row{display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid #f0efe9;}
        .tx-row:last-child{border-bottom:none;}
        .rm{background:none;border:none;cursor:pointer;color:#ccc9c0;padding:5px;border-radius:8px;display:flex;align-items:center;justify-content:center;transition:color 0.15s;line-height:1;}
        .rm:hover{color:#e03131;}

        /* Bottom nav */
        .nav-bar{position:fixed;bottom:0;left:0;right:0;background:rgba(240,239,233,0.92);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border-top:1px solid rgba(0,0,0,0.07);z-index:50;}
        .nav-btn{background:none;border:none;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:4px;padding:8px 12px;border-radius:14px;transition:all 0.15s;font-family:inherit;color:#bbb9b0;}
        .nav-btn.on{color:#1a1a2e;}
        .nav-lbl{font-size:9.5px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;}
        .nav-dot{width:4px;height:4px;border-radius:50%;background:#1a1a2e;opacity:0;transition:opacity 0.15s;margin-top:1px;}
        .nav-btn.on .nav-dot{opacity:1;}

        /* Progress */
        .prog-track{height:5px;background:#ece9e0;border-radius:5px;overflow:hidden;}
        .prog-fill{height:100%;border-radius:5px;transition:width 0.6s cubic-bezier(.4,0,.2,1);}

        /* Sheet modal */
        .overlay{position:fixed;inset:0;background:rgba(26,26,46,0.5);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);z-index:100;display:flex;align-items:flex-end;justify-content:center;animation:fadeIn 0.2s ease;}
        .sheet{background:#fff;border-radius:28px 28px 0 0;width:100%;max-width:560px;padding:28px 24px 40px;max-height:85vh;overflow-y:auto;animation:slideUp 0.3s cubic-bezier(.4,0,.2,1);}
        .handle{width:40px;height:4px;background:#e0ddd4;border-radius:2px;margin:0 auto 24px;}

        /* Bank option */
        .bank-opt{display:flex;align-items:center;gap:12px;padding:13px 16px;border-radius:16px;border:1.5px solid #e8e5dc;background:#fff;cursor:pointer;font-family:inherit;font-size:14px;font-weight:600;color:#1a1a2e;transition:all 0.15s;text-align:left;width:100%;}
        .bank-opt:hover{border-color:#9e9b95;}
        .bank-opt.on{border-color:#1a1a2e;background:#1a1a2e;color:#fff;}

        /* Section header */
        .sec-hd{font-size:11px;font-weight:700;color:#bbb9b0;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:14px;}

        /* Calendar */
        .cal-cell{display:flex;flex-direction:column;align-items:center;justify-content:center;aspect-ratio:1;border-radius:14px;border:1.5px solid transparent;transition:all 0.15s;cursor:default;font-family:inherit;background:transparent;}
        .cal-cell.active{cursor:pointer;}
        .cal-cell.active:hover{transform:scale(1.05);}

        @keyframes fadeIn{from{opacity:0}to{opacity:1}}
        @keyframes slideUp{from{transform:translateY(50px);opacity:0}to{transform:translateY(0);opacity:1}}
        @keyframes pageIn{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes pulse{0%,100%{opacity:0.3;transform:scale(0.8)}50%{opacity:1;transform:scale(1)}}
        @keyframes menuPop{from{opacity:0;transform:scale(0.95) translateY(8px)}to{opacity:1;transform:scale(1) translateY(0)}}
        .page{animation:pageIn 0.32s ease forwards;}
        .spin{animation:spin 0.85s linear infinite;}

        /* Subtle dot pattern on background */
        .app-bg{
          min-height:100vh;
          background-color:#f0efe9;
          background-image:radial-gradient(circle,rgba(0,0,0,0.07) 1px,transparent 1px);
          background-size:22px 22px;
        }
      `}</style>

      <div className="app-bg">

        {/* ── Guest banner ─────────────────────────────────────────────── */}
        {guestMode&&!user&&(
          <div style={{background:"#1a1a2e",color:"#fff",padding:"10px 20px",textAlign:"center",fontSize:13,fontWeight:600,display:"flex",alignItems:"center",justifyContent:"center",gap:12,flexWrap:"wrap"}}>
            <span>👀 You're exploring in guest mode — data won't be saved</span>
            <button onClick={()=>setGuestMode(false)} style={{background:"#2f9e44",color:"#fff",border:"none",borderRadius:20,padding:"5px 14px",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>Sign up free →</button>
          </div>
        )}

        {/* ── Feature Gate Modal ───────────────────────────────────────── */}
        {showGate&&(
          <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:9999,display:"flex",alignItems:"flex-end",justifyContent:"center",animation:"fadeIn 0.2s ease"}} onClick={()=>setShowGate(null)}>
            <div style={{background:"#fff",borderRadius:"28px 28px 0 0",width:"100%",maxWidth:560,padding:"28px 24px 44px",animation:"slideUp 0.3s ease"}} onClick={e=>e.stopPropagation()}>
              <div style={{width:40,height:4,background:"#e0ddd4",borderRadius:2,margin:"0 auto 24px"}}/>
              <div style={{fontSize:32,textAlign:"center",marginBottom:12}}>🔒</div>
              <div style={{fontSize:20,fontWeight:800,textAlign:"center",marginBottom:8}}>Create a free account</div>
              <div style={{fontSize:14,color:"#9e9b95",textAlign:"center",lineHeight:1.6,marginBottom:24}}>{showGate}</div>
              <div style={{background:"#f8f7f2",borderRadius:16,padding:16,marginBottom:20,border:"1px solid #ece9e0"}}>
                {[["💾","Your data saves across devices"],["📊","Full spending history & insights"],["🤖","Personalized AI Advisor"],["🔄","Sync income, bills & budget"]].map(([icon,text])=>(
                  <div key={text} style={{display:"flex",alignItems:"center",gap:10,padding:"6px 0"}}>
                    <span style={{fontSize:16}}>{icon}</span>
                    <span style={{fontSize:13,fontWeight:500,color:"#1a1a2e"}}>{text}</span>
                  </div>
                ))}
              </div>
              <button onClick={()=>{setShowGate(null);setGuestMode(false);}} style={{width:"100%",background:"#1a1a2e",color:"#fff",border:"none",borderRadius:16,padding:"15px",fontSize:15,fontWeight:700,cursor:"pointer",fontFamily:"inherit",marginBottom:10}}>
                Create free account →
              </button>
              <button onClick={()=>setShowGate(null)} style={{width:"100%",background:"transparent",border:"none",color:"#9e9b95",fontSize:14,cursor:"pointer",fontFamily:"inherit",padding:"8px"}}>
                Continue exploring
              </button>
            </div>
          </div>
        )}

        {/* ── Camera Capture Modal ─────────────────────────────────────── */}
        {cameraOpen&&(
          <div style={{position:"fixed",inset:0,background:"#000",zIndex:9999,display:"flex",flexDirection:"column"}} onClick={()=>setCameraOpen(false)}>
            <div style={{padding:"20px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{fontSize:16,fontWeight:700,color:"#fff"}}>Take a photo</div>
              <button onClick={()=>setCameraOpen(false)} style={{background:"rgba(255,255,255,0.15)",border:"none",borderRadius:20,padding:"8px 16px",color:"#fff",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>Cancel</button>
            </div>
            <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
              <label style={{display:"flex",flexDirection:"column",alignItems:"center",gap:16,cursor:"pointer"}} onClick={e=>e.stopPropagation()}>
                <div style={{width:80,height:80,borderRadius:"50%",background:"rgba(255,255,255,0.1)",border:"3px solid rgba(255,255,255,0.3)",display:"flex",alignItems:"center",justifyContent:"center"}}>
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                    <circle cx="12" cy="13" r="4"/>
                  </svg>
                </div>
                <div style={{color:"rgba(255,255,255,0.7)",fontSize:14}}>Tap to open camera</div>
                <input type="file" accept="image/*" capture="environment" onChange={(e)=>{
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setCameraOpen(false);
                  setUploadedFile(file.name);
                  const reader = new FileReader();
                  reader.onload = async (ev) => {
                    const base64 = ev.target.result.split(',')[1];
                    setUploadPreview(ev.target.result);
                    setTab("advisor");
                    await analyzeDocument([{type:'image',source:{type:'base64',media_type:file.type||'image/jpeg',data:base64}}], file.name);
                  };
                  reader.readAsDataURL(file);
                }} style={{display:"none"}}/>
              </label>
            </div>
          </div>
        )}

        {/* ── Onboarding Modal ─────────────────────────────────────────────── */}
        {showOnboarding&&(
          <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",zIndex:9999,display:"flex",alignItems:"flex-end",justifyContent:"center",animation:"fadeIn 0.2s ease"}}>
            <div style={{background:"#fff",borderRadius:"28px 28px 0 0",width:"100%",maxWidth:560,padding:"28px 24px 40px",animation:"slideUp 0.35s ease",maxHeight:"92vh",overflowY:"auto"}}>
              <div style={{width:40,height:4,background:"#e0ddd4",borderRadius:2,margin:"0 auto 20px"}}/>
              {/* Progress bar */}
              <div style={{display:"flex",gap:5,marginBottom:24}}>
                {[0,1,2,3,4,5].map(s=>(
                  <div key={s} style={{height:4,borderRadius:2,background:s<=onboardStep?"#1a1a2e":"#ece9e0",flex:s===onboardStep?2:1,transition:"all 0.3s"}}/>
                ))}
              </div>

              {/* Step 0: Welcome */}
              {onboardStep===0&&(<>
                <div style={{fontSize:26,fontWeight:800,marginBottom:8}}>Welcome to DayFlow 👋</div>
                <div style={{fontSize:15,color:"#9e9b95",lineHeight:1.6,marginBottom:20}}>Your personal daily finance tracker. Let's get everything set up so DayFlow works perfectly for your life.</div>
                <div style={{background:"#f8f7f2",borderRadius:18,padding:20,marginBottom:20,border:"1px solid #ece9e0"}}>
                  <div style={{fontSize:12,fontWeight:700,color:"#bbb9b0",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:14}}>Here's how DayFlow works</div>
                  {[["💰","Enter your take-home income"],["🧾","Add recurring bills & subscriptions"],["👨‍👩‍👧","Optionally add family members to pool income"],["📅","Get a personalized daily spending budget"],["🤖","Ask the AI Advisor anything about your money"]].map(([icon,text],i)=>(
                    <div key={i} style={{display:"flex",alignItems:"center",gap:12,marginBottom:10}}>
                      <span style={{fontSize:18}}>{icon}</span>
                      <span style={{fontSize:14,fontWeight:500,color:"#1a1a2e"}}>{text}</span>
                    </div>
                  ))}
                </div>
                <div style={{background:"#e8f5e9",borderRadius:14,padding:"12px 16px",marginBottom:20,fontSize:13,color:"#2e7d32",lineHeight:1.5}}>
                  🎯 <strong>The goal:</strong> Know exactly how much you can spend each day without stress — so the money left over becomes real savings.
                </div>
                <button onClick={()=>setOnboardStep(1)} style={{width:"100%",background:"#1a1a2e",color:"#fff",border:"none",borderRadius:16,padding:"16px",fontSize:15,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>Let's get started →</button>
              </>)}

              {/* Step 1: Income */}
              {onboardStep===1&&(<>
                <div style={{fontSize:11,fontWeight:700,color:"#bbb9b0",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:8}}>Step 1 of 5</div>
                <div style={{fontSize:22,fontWeight:800,marginBottom:6}}>What's your monthly take-home?</div>
                <div style={{fontSize:14,color:"#9e9b95",marginBottom:10,lineHeight:1.6}}>Enter your income <strong>after taxes</strong> — the amount that actually hits your bank account each month.</div>
                <div style={{background:"#fff8e1",borderRadius:12,padding:"10px 14px",marginBottom:18,border:"1px solid #ffe082",fontSize:12,color:"#7a5800"}}>💡 Paid bi-weekly? Multiply one paycheck by 2.17 to get your monthly take-home.</div>
                <div style={{position:"relative",marginBottom:20}}>
                  <span style={{position:"absolute",left:16,top:"50%",transform:"translateY(-50%)",fontSize:18,fontWeight:600,color:"#9e9b95"}}>$</span>
                  <input type="number" placeholder="0" value={incStr} onChange={e=>setIncStr(e.target.value)}
                    style={{width:"100%",padding:"16px 16px 16px 36px",fontSize:22,fontWeight:700,border:"2px solid #ece9e0",borderRadius:16,outline:"none",fontFamily:"inherit"}} autoFocus/>
                </div>
                <div style={{display:"flex",gap:12}}>
                  <button onClick={()=>setOnboardStep(0)} style={{flex:1,background:"#f8f7f2",color:"#1a1a2e",border:"1px solid #ece9e0",borderRadius:16,padding:"14px",fontSize:14,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>← Back</button>
                  <button onClick={()=>{
                    const inc=parseFloat(incStr)||0;
                    if(inc<=0){alert("Please enter your monthly income");return;}
                    const nd={...data,monthlyIncome:inc};
                    setData(nd);persist(nd);
                    debouncedSave(nd);
                    setOnboardStep(2);
                  }} style={{flex:2,background:"#1a1a2e",color:"#fff",border:"none",borderRadius:16,padding:"14px",fontSize:15,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>Continue →</button>
                </div>
              </>)}

              {/* Step 2: Bills */}
              {onboardStep===2&&(<>
                <div style={{fontSize:11,fontWeight:700,color:"#bbb9b0",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:8}}>Step 2 of 5</div>
                <div style={{fontSize:22,fontWeight:800,marginBottom:6}}>Add your recurring bills</div>
                <div style={{fontSize:14,color:"#9e9b95",marginBottom:14,lineHeight:1.6}}>Bills get subtracted from your income first. What's left becomes your spendable pool — divided across the month for your daily budget.</div>
                <div style={{background:"#f8f7f2",borderRadius:16,padding:16,marginBottom:14,border:"1px solid #ece9e0"}}>
                  <div style={{fontSize:12,fontWeight:700,color:"#bbb9b0",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:10}}>Common bills to add in the Bills tab</div>
                  {[["🏠","Rent / Mortgage"],["🚗","Car payment"],["📱","Phone"],["💡","Utilities"],["🎬","Subscriptions (Netflix, Spotify…)"],["🏥","Insurance (health, car, renters)"],["💳","Minimum debt payments"]].map(([icon,label])=>(
                    <div key={label} style={{display:"flex",alignItems:"center",gap:10,padding:"5px 0",borderBottom:"1px solid #f0efe9"}}>
                      <span style={{fontSize:15}}>{icon}</span>
                      <span style={{fontSize:13,color:"#1a1a2e"}}>{label}</span>
                    </div>
                  ))}
                </div>
                <div style={{display:"flex",gap:10}}>
                  <button onClick={()=>setOnboardStep(1)} style={{flex:1,background:"#f8f7f2",color:"#1a1a2e",border:"1px solid #ece9e0",borderRadius:16,padding:"13px",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>← Back</button>
                  <button onClick={()=>{setShowOnboarding(false);localStorage.setItem(ONBOARD_KEY,"1");setTab("recurring");}} style={{flex:1,background:"#f0f0ff",color:"#7048e8",border:"1px solid #d8d0ff",borderRadius:16,padding:"13px",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>Add bills now</button>
                  <button onClick={()=>setOnboardStep(3)} style={{flex:1,background:"#1a1a2e",color:"#fff",border:"none",borderRadius:16,padding:"13px",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>Skip →</button>
                </div>
              </>)}

              {/* Step 3: Household */}
              {onboardStep===3&&(<>
                <div style={{fontSize:11,fontWeight:700,color:"#bbb9b0",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:8}}>Step 3 of 5</div>
                <div style={{fontSize:22,fontWeight:800,marginBottom:6}}>Do you share finances?</div>
                <div style={{fontSize:14,color:"#9e9b95",marginBottom:14,lineHeight:1.6}}>DayFlow supports household mode — combine income from a partner, spouse, or family member to get a shared daily budget that reflects your real household finances.</div>
                <div style={{background:"#f8f7f2",borderRadius:16,padding:16,marginBottom:14,border:"1px solid #ece9e0"}}>
                  <div style={{fontSize:12,fontWeight:700,color:"#bbb9b0",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:10}}>Household mode lets you</div>
                  {[["👩‍❤️‍👨","Pool income from multiple earners"],["📊","See combined bills vs combined income"],["👧","Track each person's contribution"],["🏦","Get a household daily spending budget"]].map(([icon,text])=>(
                    <div key={text} style={{display:"flex",alignItems:"center",gap:10,padding:"6px 0",borderBottom:"1px solid #f0efe9"}}>
                      <span style={{fontSize:16}}>{icon}</span>
                      <span style={{fontSize:13,color:"#1a1a2e"}}>{text}</span>
                    </div>
                  ))}
                </div>
                <div style={{fontSize:13,color:"#9e9b95",marginBottom:16,textAlign:"center"}}>You can set this up now in the <strong>Household</strong> tab, or skip and do it later.</div>
                <div style={{display:"flex",gap:10}}>
                  <button onClick={()=>setOnboardStep(2)} style={{flex:1,background:"#f8f7f2",color:"#1a1a2e",border:"1px solid #ece9e0",borderRadius:16,padding:"13px",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>← Back</button>
                  <button onClick={()=>{setShowOnboarding(false);localStorage.setItem(ONBOARD_KEY,"1");setTab("household");}} style={{flex:1,background:"#fff3e0",color:"#e65100",border:"1px solid #ffcc80",borderRadius:16,padding:"13px",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>Set up household</button>
                  <button onClick={()=>setOnboardStep(4)} style={{flex:1,background:"#1a1a2e",color:"#fff",border:"none",borderRadius:16,padding:"13px",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>Skip →</button>
                </div>
              </>)}

              {/* Step 4: AI Advisor */}
              {onboardStep===4&&(<>
                <div style={{fontSize:11,fontWeight:700,color:"#bbb9b0",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:8}}>Step 4 of 5</div>
                <div style={{fontSize:22,fontWeight:800,marginBottom:6}}>Meet your AI Advisor 🤖</div>
                <div style={{fontSize:14,color:"#9e9b95",marginBottom:14,lineHeight:1.6}}>DayFlow includes a personal financial advisor powered by AI. It knows your income, bills, and spending — and can answer any money question.</div>
                <div style={{background:"#f3eeff",borderRadius:16,padding:16,marginBottom:14,border:"1px solid #d8d0ff"}}>
                  <div style={{fontSize:12,fontWeight:700,color:"#7048e8",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:10}}>Ask it things like</div>
                  {["How does a Roth IRA work?","Am I saving enough each month?","What's the difference between HSA and FSA?","How can I pay off debt faster?","Should I invest or build my emergency fund first?"].map(q=>(
                    <div key={q} style={{display:"flex",alignItems:"center",gap:8,padding:"5px 0",borderBottom:"1px solid #ede6ff"}}>
                      <span style={{color:"#7048e8",fontSize:13,flexShrink:0}}>→</span>
                      <span style={{fontSize:13,color:"#1a1a2e"}}>{q}</span>
                    </div>
                  ))}
                </div>
                <div style={{background:"#f8f7f2",borderRadius:14,padding:12,marginBottom:18,border:"1px solid #ece9e0",fontSize:13,color:"#555",lineHeight:1.6}}>
                  📄 <strong>Upload a paystub</strong> in the Advisor tab and it will read your deductions, 401k contributions, and tax withholdings to give you personalized advice.
                </div>
                <div style={{display:"flex",gap:12}}>
                  <button onClick={()=>setOnboardStep(3)} style={{flex:1,background:"#f8f7f2",color:"#1a1a2e",border:"1px solid #ece9e0",borderRadius:16,padding:"14px",fontSize:14,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>← Back</button>
                  <button onClick={()=>setOnboardStep(5)} style={{flex:2,background:"#1a1a2e",color:"#fff",border:"none",borderRadius:16,padding:"14px",fontSize:15,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>Continue →</button>
                </div>
              </>)}

              {/* Step 5: All set */}
              {onboardStep===5&&(<>
                <div style={{fontSize:26,fontWeight:800,marginBottom:6,textAlign:"center"}}>You're all set! 🎉</div>
                <div style={{fontSize:14,color:"#9e9b95",lineHeight:1.6,marginBottom:18,textAlign:"center"}}>Here's your personalized daily spending budget based on what you've entered so far.</div>
                <div style={{background:"#f8f7f2",borderRadius:20,padding:24,marginBottom:18,border:"1px solid #ece9e0",textAlign:"center"}}>
                  <div style={{fontSize:13,color:"#9e9b95",marginBottom:4}}>Your daily spending budget</div>
                  <div style={{fontSize:44,fontWeight:800,color:"#1a1a2e",letterSpacing:"-0.02em"}}>{fmt(calcDaily(calcPool(data.monthlyIncome, data.recurringPayments)))}</div>
                  <div style={{fontSize:12,color:"#bbb9b0",marginTop:4}}>per day to spend freely</div>
                </div>
                <div style={{background:"#f0fff4",borderRadius:14,padding:14,marginBottom:18,border:"1px solid #b2f2bb",fontSize:13,color:"#1a6b2a",lineHeight:1.6}}>
                  💡 <strong>Quick tips:</strong> Log spending on the <strong>Today</strong> tab. Add bills in <strong>Bills</strong>. Ask your <strong>AI Advisor</strong> anything. Explore <strong>Financial Education</strong> in the More menu for free guides on 401k, Roth IRA, HSA, and more.
                </div>
                <button onClick={()=>{setShowOnboarding(false);localStorage.setItem(ONBOARD_KEY,"1");}} style={{width:"100%",background:"#1a1a2e",color:"#fff",border:"none",borderRadius:16,padding:"16px",fontSize:15,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>Start tracking →</button>
              </>)}
            </div>
          </div>
        )}

        {/* ── Upgrade Modal ────────────────────────────────────────────────── */}
        {showUpgrade&&(
          <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:9999,display:"flex",alignItems:"flex-end",justifyContent:"center",animation:"fadeIn 0.2s ease"}} onClick={()=>setShowUpgrade(false)}>
            <div style={{background:"#fff",borderRadius:"28px 28px 0 0",width:"100%",maxWidth:560,padding:"28px 24px 40px",animation:"slideUp 0.35s ease",maxHeight:"92vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
              <div style={{width:40,height:4,background:"#e0ddd4",borderRadius:2,margin:"0 auto 20px"}}/>
              <div style={{textAlign:"center",marginBottom:20}}>
                <div style={{fontSize:24,fontWeight:800,marginBottom:6}}>Upgrade DayFlow</div>
                <div style={{fontSize:14,color:"#9e9b95"}}>Unlock powerful features for your finances</div>
              </div>
              <div style={{display:"flex",background:"#f8f7f2",borderRadius:12,padding:4,marginBottom:20,border:"1px solid #ece9e0"}}>
                {["monthly","annual"].map(b=>(
                  <button key={b} onClick={()=>setUpgradeBilling(b)} style={{flex:1,padding:"10px",borderRadius:10,border:"none",background:upgradeBilling===b?"#1a1a2e":"transparent",color:upgradeBilling===b?"#fff":"#9e9b95",fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"inherit",transition:"all 0.15s"}}>
                    {b==="monthly"?"Monthly":"Annual"}{b==="annual"&&<span style={{marginLeft:6,background:"#2f9e44",color:"#fff",borderRadius:6,padding:"1px 6px",fontSize:10}}>Save 20%</span>}
                  </button>
                ))}
              </div>
              {[
                {key:"pro",name:"Pro",color:"#7048e8",price:{monthly:9.99,annual:7.99},features:["Unlimited transaction history","AI Advisor (priority)","Spending insights & trends","Receipt scanning","Export to CSV"]},
                {key:"business",name:"Business",color:"#f08c00",price:{monthly:24.99,annual:19.99},features:["Everything in Pro","Business expense tracking","Mileage & tax deductions","Multiple income sources","Priority support"]},
              ].map(plan=>(
                <div key={plan.key} style={{border:`2px solid ${plan.color}20`,borderRadius:20,padding:20,marginBottom:14,position:"relative",overflow:"hidden"}}>
                  <div style={{position:"absolute",top:0,left:0,right:0,height:4,background:plan.color}}/>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14}}>
                    <div>
                      <div style={{fontSize:18,fontWeight:800,color:plan.color}}>{plan.name}</div>
                      <div style={{fontSize:28,fontWeight:800,marginTop:2}}>${upgradeBilling==="monthly"?plan.price.monthly:plan.price.annual}<span style={{fontSize:13,fontWeight:500,color:"#9e9b95"}}>/mo</span></div>
                    </div>
                  </div>
                  {plan.features.map(f=>(
                    <div key={f} style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                      <div style={{width:16,height:16,borderRadius:"50%",background:`${plan.color}20`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                        <svg width="10" height="10" viewBox="0 0 20 20" fill="none"><polyline points="4 10 8 14 16 6" stroke={plan.color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      </div>
                      <span style={{fontSize:13,color:"#1a1a2e"}}>{f}</span>
                    </div>
                  ))}
                  <button onClick={()=>handleUpgrade(plan.key)} disabled={upgradeLoading} style={{width:"100%",marginTop:16,background:plan.color,color:"#fff",border:"none",borderRadius:14,padding:"14px",fontSize:14,fontWeight:700,cursor:"pointer",opacity:upgradeLoading?0.7:1,fontFamily:"inherit"}}>
                    {upgradeLoading?"Loading…":`Upgrade to ${plan.name} →`}
                  </button>
                </div>
              ))}
              <button onClick={()=>setShowUpgrade(false)} style={{width:"100%",background:"transparent",border:"none",color:"#9e9b95",fontSize:14,cursor:"pointer",padding:"8px",fontFamily:"inherit"}}>Maybe later</button>
            </div>
          </div>
        )}

        {/* ── Onboarding Modal ─────────────────────────────────────────────── */}
        {showOnboarding&&(
          <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:9999,display:"flex",alignItems:"flex-end",justifyContent:"center",animation:"fadeIn 0.2s ease"}}>
            <div style={{background:"#fff",borderRadius:"28px 28px 0 0",width:"100%",maxWidth:560,padding:"28px 24px 40px",animation:"slideUp 0.35s ease"}}>
              <div style={{width:40,height:4,background:"#e0ddd4",borderRadius:2,margin:"0 auto 24px"}}/>
              {onboardStep===0&&(
                <>
                  <div style={{fontSize:26,fontWeight:800,marginBottom:8}}>Welcome to DayFlow 👋</div>
                  <div style={{fontSize:15,color:"#9e9b95",lineHeight:1.6,marginBottom:28}}>Let's set up your daily spending allowance in 2 quick steps. It only takes a minute.</div>
                  <div style={{background:"#f8f7f2",borderRadius:18,padding:20,marginBottom:24,border:"1px solid #ece9e0"}}>
                    <div style={{fontSize:12,fontWeight:700,color:"#bbb9b0",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:12}}>How it works</div>
                    {[["💰","Enter last month's take-home income"],["🧾","Add your recurring bills"],["📅","We calculate your daily spending budget"]].map(([icon,text])=>(
                      <div key={text} style={{display:"flex",alignItems:"center",gap:12,marginBottom:10}}>
                        <span style={{fontSize:20}}>{icon}</span>
                        <span style={{fontSize:14,fontWeight:500,color:"#1a1a2e"}}>{text}</span>
                      </div>
                    ))}
                  </div>
                  <button onClick={()=>setOnboardStep(1)} style={{width:"100%",background:"#1a1a2e",color:"#fff",border:"none",borderRadius:16,padding:"16px",fontSize:15,fontWeight:700,cursor:"pointer"}}>Get started →</button>
                </>
              )}
              {onboardStep===1&&(
                <>
                  <div style={{fontSize:22,fontWeight:800,marginBottom:6}}>What's your monthly take-home?</div>
                  <div style={{fontSize:14,color:"#9e9b95",marginBottom:24}}>After taxes — what hits your bank account each month?</div>
                  <div style={{position:"relative",marginBottom:24}}>
                    <span style={{position:"absolute",left:16,top:"50%",transform:"translateY(-50%)",fontSize:18,fontWeight:600,color:"#9e9b95"}}>$</span>
                    <input
                      type="number" placeholder="0"
                      value={incStr}
                      onChange={e=>setIncStr(e.target.value)}
                      style={{width:"100%",padding:"16px 16px 16px 36px",fontSize:22,fontWeight:700,border:"2px solid #ece9e0",borderRadius:16,outline:"none",fontFamily:"inherit"}}
                      autoFocus
                    />
                  </div>
                  <div style={{display:"flex",gap:12}}>
                    <button onClick={()=>setOnboardStep(0)} style={{flex:1,background:"#f8f7f2",color:"#1a1a2e",border:"1px solid #ece9e0",borderRadius:16,padding:"14px",fontSize:14,fontWeight:600,cursor:"pointer"}}>← Back</button>
                    <button onClick={()=>{
                      const inc = parseFloat(incStr)||0;
                      if (inc<=0){alert("Please enter your monthly income");return;}
                      const nd={...data,monthlyIncome:inc};
                      setData(nd); persist(nd);
                      debouncedSave(nd);
                      setOnboardStep(2);
                    }} style={{flex:2,background:"#1a1a2e",color:"#fff",border:"none",borderRadius:16,padding:"14px",fontSize:15,fontWeight:700,cursor:"pointer"}}>Continue →</button>
                  </div>
                </>
              )}
              {onboardStep===2&&(
                <>
                  <div style={{fontSize:26,fontWeight:800,marginBottom:8}}>You're all set! 🎉</div>
                  <div style={{fontSize:15,color:"#9e9b95",lineHeight:1.6,marginBottom:24}}>Your daily allowance is now calculated. Head to the <strong>Bills</strong> tab to add your recurring expenses for an even more accurate number.</div>
                  <div style={{background:"#f8f7f2",borderRadius:18,padding:20,marginBottom:24,border:"1px solid #ece9e0",textAlign:"center"}}>
                    <div style={{fontSize:13,color:"#9e9b95",marginBottom:4}}>Your daily spending budget</div>
                    <div style={{fontSize:36,fontWeight:800,color:"#1a1a2e"}}>{fmt(calcDaily(calcPool(data.monthlyIncome, data.recurringPayments)))}</div>
                    <div style={{fontSize:12,color:"#bbb9b0",marginTop:4}}>per day</div>
                  </div>
                  <button onClick={()=>setShowOnboarding(false)} style={{width:"100%",background:"#1a1a2e",color:"#fff",border:"none",borderRadius:16,padding:"16px",fontSize:15,fontWeight:700,cursor:"pointer"}}>Start tracking →</button>
                </>
              )}
            </div>
          </div>
        )}

        {/* ── Upgrade Modal ────────────────────────────────────────────────── */}
        {showUpgrade&&(
          <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:9999,display:"flex",alignItems:"flex-end",justifyContent:"center",animation:"fadeIn 0.2s ease"}} onClick={()=>setShowUpgrade(false)}>
            <div style={{background:"#fff",borderRadius:"28px 28px 0 0",width:"100%",maxWidth:560,padding:"28px 24px 40px",animation:"slideUp 0.35s ease"}} onClick={e=>e.stopPropagation()}>
              <div style={{width:40,height:4,background:"#e0ddd4",borderRadius:2,margin:"0 auto 20px"}}/>
              <div style={{textAlign:"center",marginBottom:20}}>
                <div style={{fontSize:24,fontWeight:800,marginBottom:6}}>Upgrade DayFlow</div>
                <div style={{fontSize:14,color:"#9e9b95"}}>Unlock powerful features for your finances</div>
              </div>
              {/* Billing toggle */}
              <div style={{display:"flex",background:"#f8f7f2",borderRadius:12,padding:4,marginBottom:20,border:"1px solid #ece9e0"}}>
                {["monthly","annual"].map(b=>(
                  <button key={b} onClick={()=>setUpgradeBilling(b)} style={{flex:1,padding:"10px",borderRadius:10,border:"none",background:upgradeBilling===b?"#1a1a2e":"transparent",color:upgradeBilling===b?"#fff":"#9e9b95",fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"inherit",transition:"all 0.15s"}}>
                    {b==="monthly"?"Monthly":"Annual"}{b==="annual"&&<span style={{marginLeft:6,background:"#2f9e44",color:"#fff",borderRadius:6,padding:"1px 6px",fontSize:10}}>Save 20%</span>}
                  </button>
                ))}
              </div>
              {/* Plan cards */}
              {[
                {key:"pro",name:"Pro",color:"#7048e8",price:{monthly:9.99,annual:7.99},features:["Unlimited transaction history","AI Advisor (priority)","Spending insights & trends","Receipt scanning","Export to CSV"]},
                {key:"business",name:"Business",color:"#f08c00",price:{monthly:24.99,annual:19.99},features:["Everything in Pro","Business expense tracking","Mileage & tax deductions","Multiple income sources","Priority support"]},
              ].map(plan=>(
                <div key={plan.key} style={{border:`2px solid ${plan.color}20`,borderRadius:20,padding:20,marginBottom:14,position:"relative",overflow:"hidden"}}>
                  <div style={{position:"absolute",top:0,left:0,right:0,height:4,background:plan.color}}/>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14}}>
                    <div>
                      <div style={{fontSize:18,fontWeight:800,color:plan.color}}>{plan.name}</div>
                      <div style={{fontSize:28,fontWeight:800,marginTop:2}}>${upgradeBilling==="monthly"?plan.price.monthly:plan.price.annual}<span style={{fontSize:13,fontWeight:500,color:"#9e9b95"}}>/mo</span></div>
                    </div>
                  </div>
                  {plan.features.map(f=>(
                    <div key={f} style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                      <div style={{width:16,height:16,borderRadius:"50%",background:`${plan.color}20`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                        <svg width="10" height="10" viewBox="0 0 20 20" fill="none"><polyline points="4 10 8 14 16 6" stroke={plan.color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      </div>
                      <span style={{fontSize:13,color:"#1a1a2e"}}>{f}</span>
                    </div>
                  ))}
                  <button onClick={()=>handleUpgrade(plan.key)} disabled={upgradeLoading} style={{width:"100%",marginTop:16,background:plan.color,color:"#fff",border:"none",borderRadius:14,padding:"14px",fontSize:14,fontWeight:700,cursor:"pointer",opacity:upgradeLoading?0.7:1,fontFamily:"inherit"}}>
                    {upgradeLoading?"Loading…":`Upgrade to ${plan.name} →`}
                  </button>
                </div>
              ))}
              <button onClick={()=>setShowUpgrade(false)} style={{width:"100%",background:"transparent",border:"none",color:"#9e9b95",fontSize:14,cursor:"pointer",padding:"8px",fontFamily:"inherit"}}>Maybe later</button>
            </div>
          </div>
        )}

        {/* ── Header ─────────────────────────────────────────────────────────── */}
        <div style={{maxWidth:560,margin:"0 auto",padding:"28px 20px 0"}}>
          <R style={{justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
            <C style={{gap:5}}>
              <div style={{fontSize:11,fontWeight:600,color:"#9e9b95",letterSpacing:"0.06em",textTransform:"uppercase"}}>
                {new Date().toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"})}
              </div>
              {/* ── DayFlow wave wordmark ── */}
              <svg width="168" height="34" viewBox="0 0 168 34" fill="none" xmlns="http://www.w3.org/2000/svg">
                {/* Ghost trail — full wave faint */}
                <path d="M3 17 Q8.5 7 14 17 Q19.5 27 25 17 Q30.5 7 36 17" stroke="#d4d0c8" strokeWidth="1.8" strokeLinecap="round" fill="none"/>
                {/* Solid — past / tracked portion */}
                <path d="M3 17 Q8.5 7 14 17 Q19.5 27 25 17" stroke="#1a1a2e" strokeWidth="2.4" strokeLinecap="round" fill="none"/>
                {/* Today dot — green accent */}
                <circle cx="25" cy="17" r="3.2" fill="#2f9e44"/>
                {/* Future — dashed */}
                <path d="M25 17 Q30.5 7 36 17" stroke="#c8c5bc" strokeWidth="1.8" strokeLinecap="round" strokeDasharray="3 3" fill="none"/>
                {/* Wordmark — bold "day" + light "flow" in one text element, no gap */}
                <text x="46" y="24" fontFamily="'Plus Jakarta Sans', sans-serif" fontSize="22" letterSpacing="-0.8" fill="#1a1a2e">
                  <tspan fontWeight="800">day</tspan><tspan fontWeight="300" fill="#6b6864">flow</tspan>
                </text>
              </svg>
            </C>
            <R style={{gap:8,alignItems:"center"}}>
              {data.plaidConnected && (
                <R style={{gap:5,background:"#eef3ff",padding:"6px 12px",borderRadius:20,fontSize:11,fontWeight:700,color:"#3b5bdb"}}>
                  <I n="link" s={11} c="#3b5bdb"/> {data.bankName}
                </R>
              )}
              {needsSetup && !data.plaidConnected && (
                <button className="btn" style={{padding:"9px 16px",fontSize:12,borderRadius:12}} onClick={()=>setShowOnboarding(true)}>
                  Get started →
                </button>
              )}
              {!needsSetup && data.plan==="free" && (
                <button onClick={()=>setShowUpgrade(true)} style={{padding:"9px 16px",fontSize:12,borderRadius:12,background:"linear-gradient(135deg,#7048e8,#f08c00)",color:"#fff",border:"none",cursor:"pointer",fontWeight:700,fontFamily:"inherit"}}>
                  Upgrade ✦
                </button>
              )}
              {user&&(
                <button onClick={signOut} title={`Signed in as ${user.email}\nTap to sign out`}
                  style={{width:34,height:34,borderRadius:"50%",background:"#1a1a2e",border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                  <span style={{fontSize:13,fontWeight:800,color:"#fff",fontFamily:"inherit"}}>
                    {(user.user_metadata?.full_name||user.email||"U")[0].toUpperCase()}
                  </span>
                </button>
              )}
            </R>
          </R>
        </div>

        {/* ── Content ────────────────────────────────────────────────────────── */}
        <div style={{maxWidth:560,margin:"0 auto",padding:"0 20px 100px"}} className="page" key={tab}>

          {/* ══════ TODAY ══════ */}
          {tab==="today" && (
            <C style={{gap:16}}>

              {/* Hero */}
              <div className="hero-card" style={{padding:28}}>
                <div className="hero-band" style={{background:accent}}/>

                {/* Big ring + numbers */}
                <R style={{gap:24,alignItems:"flex-start",marginTop:8}}>
                  {/* Ring */}
                  <div style={{position:"relative",width:140,height:140,flexShrink:0}}>
                    <Ring pct={pctDay} fg={accent} bg={accentBg}/>
                    <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:2}}>
                      <div style={{fontSize:10,fontWeight:700,color:"#9e9b95",letterSpacing:"0.08em"}}>USED</div>
                      <div style={{fontSize:26,fontWeight:800,color:accent,lineHeight:1,letterSpacing:"-0.03em"}}>
                        {Math.round(Math.min(999,pctDay*100))}%
                      </div>
                      <div style={{fontSize:11,fontWeight:500,color:"#9e9b95"}}>{fmtFull(daySpent)}</div>
                    </div>
                  </div>

                  {/* Stats */}
                  <C style={{flex:1,gap:0}}>
                    <div style={{fontSize:10,fontWeight:700,color:"#9e9b95",letterSpacing:"0.08em",marginBottom:4}}>LEFT TODAY</div>
                    <div style={{fontSize:36,fontWeight:300,letterSpacing:"-0.05em",color: over?"#e03131":"#1a1a2e",lineHeight:1,marginBottom:2}}>
                      {over?"−":""}{fmtFull(Math.abs(todayLeft))}
                    </div>
                    <div style={{fontSize:12,color:"#bbb9b0",marginBottom:20}}>{fmtFull(myAllow)} daily allowance</div>

                    <div style={{height:1,background:"#f0efe9",marginBottom:16}}/>

                    <div style={{fontSize:10,fontWeight:700,color:"#9e9b95",letterSpacing:"0.08em",marginBottom:4}}>MONTH POOL</div>
                    <div style={{fontSize:26,fontWeight:300,letterSpacing:"-0.04em",color:poolLeft<0?"#e03131":"#1a1a2e",lineHeight:1,marginBottom:2}}>
                      {poolLeft<0?"−":""}{fmt(Math.abs(poolLeft))}
                    </div>
                    <div style={{fontSize:12,color:"#bbb9b0"}}>{dLeft} days remaining</div>
                  </C>
                </R>

                {/* Status pill */}
                <div style={{marginTop:22,padding:"12px 18px",borderRadius:14,background:accentBg,fontSize:13,fontWeight:600,color:accent,display:"flex",alignItems:"center",gap:8}}>
                  <div style={{width:8,height:8,borderRadius:"50%",background:accent,flexShrink:0}}/>
                  {statusMsg}
                </div>
              </div>

              {/* Pool math */}
              {!needsSetup && (
                <div className="card" style={{padding:22}}>
                  <div className="sec-hd">This month's pool</div>
                  {[
                    {label:"Last month's income",     val:data.monthlyIncome,              sign:"+",color:"#2f9e44"},
                    {label:"Monthly recurring removed",val:totalBills(data.recurringPayments),sign:"−",color:"#e03131"},
                    {label:"Spendable pool",           val:myPoolReal,                          sign:"",color:"#1a1a2e",bold:true,sep:true},
                    {label:`÷ ${DIM} days = daily`,val:myAllow,                  sign:"",color:"#9e9b95",italic:true},
                  ].map(({label,val,sign,color,bold,sep,italic})=>(
                    <R key={label} style={{justifyContent:"space-between",padding:"9px 0",borderTop:sep?"1px solid #f0efe9":"none",marginTop:sep?6:0}}>
                      <span style={{fontSize:13,color:"#9e9b95",fontStyle:italic?"italic":"normal"}}>{label}</span>
                      <span style={{fontSize:13,fontWeight:bold?700:500,color}}>{sign}{fmtFull(val)}</span>
                    </R>
                  ))}
                </div>
              )}

              {/* Log */}
              <div className="card" style={{padding:22}}>
                <div className="sec-hd">Log a transaction</div>
                <R style={{gap:8,marginBottom:10}}>
                  <input className="inp" placeholder={newTx.type==="expense"?"What did you spend on?":"Source (e.g. paycheck, gift)"} value={newTx.label}
                    onChange={e=>setNewTx(p=>({...p,label:e.target.value}))}
                    onKeyDown={e=>e.key==="Enter"&&addTx()} style={{flex:1}}/>
                  <div className="seg">
                    {["expense","income"].map(t=>(
                      <button key={t} className={`seg-opt${newTx.type===t?" on":""}`} onClick={()=>setNewTx(p=>({...p,type:t}))}>
                        {t==="expense"?"Out":"In"}
                      </button>
                    ))}
                  </div>
                </R>
                <R style={{gap:8}}>
                  <input className="inp" type="number" placeholder="0.00" value={newTx.amount}
                    onChange={e=>setNewTx(p=>({...p,amount:e.target.value}))}
                    onKeyDown={e=>e.key==="Enter"&&addTx()} style={{flex:1}}/>
                  <button className="btn" onClick={addTx}><I n="plus" s={15} c="#fff"/> Add</button>
                </R>
              </div>

              {/* Today's activity */}
              {allTodayTx.length>0 && (
                <div className="card" style={{padding:22}}>
                  <R style={{justifyContent:"space-between",marginBottom:14}}>
                    <div className="sec-hd" style={{marginBottom:0}}>Today's activity</div>
                    <div style={{fontSize:12,color:"#bbb9b0",fontWeight:600}}>{allTodayTx.length} items</div>
                  </R>
                  {allTodayTx.map((tx,i)=>{
                    const isOut = tx.type==="expense"||(tx.source==="plaid"&&tx.amount>0);
                    return (
                      <div key={tx.id||i} className="tx-row">
                        <div style={{width:40,height:40,borderRadius:13,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",
                          background:tx.source==="plaid"?"#eef3ff":isOut?"#fff5f5":"#ebfbee"}}>
                          <I n={tx.source==="plaid"?"bank":isOut?"wallet":"arrow"} s={17}
                            c={tx.source==="plaid"?"#3b5bdb":isOut?"#e03131":"#2f9e44"}/>
                        </div>
                        <C style={{flex:1,minWidth:0}}>
                          <div style={{fontSize:14,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{tx.label||tx.name}</div>
                          {tx.category&&<div style={{fontSize:11,color:"#bbb9b0",marginTop:1}}>{tx.category}</div>}
                        </C>
                        <div style={{fontSize:15,fontWeight:700,color:isOut?"#e03131":"#2f9e44",flexShrink:0}}>
                          {isOut?"−":"+"}{fmtFull(tx.amount)}
                        </div>
                        {tx.source==="manual"&&<button className="rm" onClick={()=>removeTx(tx.id)}><I n="x" s={14}/></button>}
                      </div>
                    );
                  })}
                </div>
              )}
            </C>
          )}

          {/* ══════ SPENDING / HISTORY ══════ */}
          {tab==="history" && (()=>{
            const now=new Date();
            const yr=viewMonth.yr, mo=viewMonth.mo;
            const isCurrentMonth = yr===now.getFullYear() && mo===now.getMonth();
            const viewDate = new Date(yr, mo, 1);
            const dim = new Date(yr, mo+1, 0).getDate();
            const todayDom = isCurrentMonth ? now.getDate() : dim;
            const firstDow = viewDate.getDay();

            // Month nav helpers
            const goToPrevMonth = () => {
              setViewMonth(p => {
                const d = new Date(p.yr, p.mo-1, 1);
                return {yr: d.getFullYear(), mo: d.getMonth()};
              });
              setSelDay(null);
            };
            const goToNextMonth = () => {
              if (isCurrentMonth) return; // can't go past current
              setViewMonth(p => {
                const d = new Date(p.yr, p.mo+1, 1);
                return {yr: d.getFullYear(), mo: d.getMonth()};
              });
              setSelDay(null);
            };

            // Income for viewed month (use historical if available, else current)
            const moPrefix = `${yr}-${String(mo+1).padStart(2,"0")}`;
            const monthIncome = (data.monthlyIncomes||{})[moPrefix] ?? data.monthlyIncome;
            const monthBills  = totalBills(data.recurringPayments);
            const monthPool   = monthIncome - monthBills;
            const monthAllow  = monthPool / dim;

            const dayData = {};
            for (let d=1;d<=dim;d++){
              const key=`${yr}-${String(mo+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
              const e=data.dailyEntries[key]||{transactions:[]};
              const spent = calcDaySpent(e, ptx, key);
              const incomeLogged = (e.transactions||[]).filter(t=>t.type==='income').reduce((s,t)=>s+t.amount,0);
              const hasTx = spent>0||(e.transactions||[]).length>0;
              dayData[d]  = {spent,net:monthAllow-spent+incomeLogged,hasTx,key};
            }
            const viewMonthSpent = Object.values(dayData).reduce((s,d) => s + d.spent, 0);
            const viewPoolLeft   = monthPool - viewMonthSpent;
            const savedDays  = Object.values(dayData).filter(d=>d.hasTx&&d.net>0).length;
            const totalSaved = Object.values(dayData).filter(d=>d.hasTx&&d.net>0).reduce((s,d)=>s+d.net,0);
            const selKey   = selDay ? dayData[selDay]?.key : null;
            const selEntry = selKey ? (data.dailyEntries[selKey]||{transactions:[]}) : null;
            const selPlaid = selKey ? ptx.filter(t=>t.date===selKey) : [];
            const selTx    = selEntry ? [...(selEntry.transactions||[]).map(t=>({...t,source:"manual"})),...selPlaid] : [];
            const selSpent = selDay  ? dayData[selDay].spent : 0;
            const selNet   = selDay  ? dayData[selDay].net   : 0;
            const DOW = ["Su","Mo","Tu","We","Th","Fr","Sa"];

            return (
              <C style={{gap:16}}>

                {/* Month navigation header */}
                <R style={{justifyContent:"space-between",alignItems:"center"}}>
                  <button onClick={goToPrevMonth}
                    style={{background:"#fff",border:"1px solid #e8e5dc",borderRadius:12,padding:"8px 14px",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit",color:"#1a1a2e"}}>
                    ← 
                  </button>
                  <div style={{textAlign:"center"}}>
                    <div style={{fontSize:16,fontWeight:800,color:"#1a1a2e"}}>
                      {viewDate.toLocaleDateString("en-US",{month:"long",year:"numeric"})}
                    </div>
                    {!isCurrentMonth && (
                      <button onClick={()=>{setViewMonth({yr:now.getFullYear(),mo:now.getMonth()});setSelDay(null);}}
                        style={{background:"none",border:"none",fontSize:11,color:"#7048e8",fontWeight:600,cursor:"pointer",fontFamily:"inherit",marginTop:2}}>
                        Back to today
                      </button>
                    )}
                  </div>
                  <button onClick={goToNextMonth}
                    style={{background:"#fff",border:"1px solid #e8e5dc",borderRadius:12,padding:"8px 14px",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit",color:isCurrentMonth?"#e0ddd4":"#1a1a2e",pointerEvents:isCurrentMonth?"none":"auto"}}>
                    →
                  </button>
                </R>

                {/* Summary */}
                <div className="card" style={{padding:24}}>
                  <R style={{gap:0,marginBottom:18}}>
                    {[{l:"Pool",v:monthPool,c:"#1a1a2e"},{l:"Spent",v:viewMonthSpent,c:"#e03131"},{l:"Left",v:viewPoolLeft,c:viewPoolLeft>=0?"#2f9e44":"#e03131"}].map(({l,v,c},i)=>(
                      <C key={l} style={{flex:1,paddingLeft:i>0?16:0,paddingRight:i<2?16:0,borderRight:i<2?"1px solid #f0efe9":"none",gap:3}}>
                        <div style={{fontSize:11,color:"#bbb9b0",fontWeight:700}}>{l}</div>
                        <div style={{fontSize:24,fontWeight:300,color:c,letterSpacing:"-0.03em"}}>{fmt(v)}</div>
                      </C>
                    ))}
                  </R>
                  <div className="prog-track">
                    <div className="prog-fill" style={{width:`${Math.min(100,monthPool>0?(viewMonthSpent/monthPool)*100:0)}%`,background:viewPoolLeft<0?"#e03131":"#1a1a2e"}}/>
                  </div>
                  <R style={{justifyContent:"space-between",marginTop:6}}>
                    <span style={{fontSize:11,color:"#bbb9b0"}}>Day 1</span>
                    <span style={{fontSize:11,color:"#bbb9b0"}}>{Math.round(monthPool>0?(viewMonthSpent/monthPool)*100:0)}% used</span>
                    <span style={{fontSize:11,color:"#bbb9b0"}}>Day {dim}</span>
                  </R>
                  {!isCurrentMonth && monthIncome !== data.monthlyIncome && (
                    <div style={{fontSize:11,color:"#bbb9b0",marginTop:10,fontStyle:"italic",borderTop:"1px solid #f0efe9",paddingTop:8}}>
                      Using recorded income of {fmtFull(monthIncome)}/mo for {viewDate.toLocaleDateString("en-US",{month:"long"})}
                    </div>
                  )}
                </div>

                {/* ── Spending flow chart ── */}
                {(()=>{
                  let runningPool = monthPool;
                  const chartData = Array.from({length:todayDom}, (_,i)=>{
                    const d   = i+1;
                    const dd  = dayData[d];
                    const spent = dd?.spent ?? 0;
                    runningPool -= spent;
                    return {
                      day:    d,
                      label:  `${d}`,
                      spent:  parseFloat(spent.toFixed(2)),
                      allow:  parseFloat(monthAllow.toFixed(2)),
                      pool:   parseFloat(Math.max(0, runningPool + spent).toFixed(2)),
                      over:   spent > monthAllow,
                    };
                  });

                  // Avg daily spend for context
                  const daysWithSpend = chartData.filter(d=>d.spent>0).length;
                  const avgSpend = daysWithSpend > 0
                    ? chartData.reduce((s,d)=>s+d.spent,0) / daysWithSpend
                    : 0;

                  // Custom tooltip
                  const ChartTip = ({active, payload, label}) => {
                    if (!active||!payload?.length) return null;
                    const spent = payload.find(p=>p.dataKey==="spent")?.value??0;
                    const allow = payload.find(p=>p.dataKey==="allow")?.value??0;
                    const net   = allow - spent;
                    return (
                      <div style={{background:"#fff",border:"1px solid #f0efe9",borderRadius:12,padding:"10px 14px",boxShadow:"0 4px 16px rgba(0,0,0,0.1)"}}>
                        <div style={{fontSize:12,fontWeight:700,color:"#1a1a2e",marginBottom:6}}>Day {label}</div>
                        <div style={{fontSize:12,color:"#e03131",marginBottom:2}}>Spent {fmtFull(spent)}</div>
                        <div style={{fontSize:12,color:"#bbb9b0",marginBottom:2}}>Allowance {fmtFull(allow)}</div>
                        <div style={{fontSize:12,fontWeight:700,color:net>=0?"#2f9e44":"#e03131",borderTop:"1px solid #f0efe9",paddingTop:4,marginTop:4}}>
                          {net>=0?"+":"−"}{fmtFull(Math.abs(net))} {net>=0?"saved":"over"}
                        </div>
                      </div>
                    );
                  };

                  // Toggle between views — state is lifted to top level
                  // chartView / setChartView defined at component top

                  return (
                    <div className="card" style={{padding:22}}>
                      {/* Header */}
                      <R style={{justifyContent:"space-between",alignItems:"flex-start",marginBottom:20}}>
                        <C style={{gap:3}}>
                          <div className="sec-hd" style={{marginBottom:0}}>Spending flow</div>
                          {avgSpend>0&&(
                            <div style={{fontSize:12,color:"#9e9b95"}}>
                              avg {fmtFull(avgSpend)}/day · allowance {fmtFull(monthAllow)}/day
                            </div>
                          )}
                        </C>
                        {/* View toggle */}
                        <div className="seg" style={{flexShrink:0}}>
                          {[{id:"daily",label:"Daily"},{id:"pool",label:"Pool"}].map(v=>(
                            <button key={v.id} className={`seg-opt${chartView===v.id?" on":""}`}
                              onClick={()=>setChartView(v.id)}
                              style={{padding:"6px 12px",fontSize:12}}>
                              {v.label}
                            </button>
                          ))}
                        </div>
                      </R>

                      {/* DAILY VIEW — bars per day vs allowance line */}
                      {chartView==="daily"&&(
                        <>
                          <ResponsiveContainer width="100%" height={200}>
                            <ComposedChart data={chartData} margin={{top:4,right:4,left:-20,bottom:0}} barCategoryGap="25%">
                              <CartesianGrid vertical={false} stroke="#f4f4f2" strokeDasharray="0"/>
                              <XAxis dataKey="label" tick={{fontSize:10,fill:"#bbb9b0",fontFamily:"Plus Jakarta Sans"}} axisLine={false} tickLine={false} interval={todayDom>15?2:0}/>
                              <YAxis tick={{fontSize:10,fill:"#bbb9b0",fontFamily:"Plus Jakarta Sans"}} axisLine={false} tickLine={false} tickFormatter={v=>`$${v}`}/>
                              <Tooltip content={<ChartTip/>}/>
                              {/* Allowance reference line */}
                              <ReferenceLine y={monthAllow} stroke="#1a1a2e" strokeDasharray="4 4" strokeWidth={1.5} strokeOpacity={0.4}/>
                              {/* Spending bars — green under, red over */}
                              <Bar dataKey="spent" radius={[5,5,0,0]} maxBarSize={28}>
                                {chartData.map((entry,i)=>(
                                  <Cell key={i} fill={entry.over?"#fca5a5":entry.spent>monthAllow*0.8?"#fcd34d":"#86efac"}
                                    stroke={entry.over?"#e03131":entry.spent>monthAllow*0.8?"#f59e0b":"#2f9e44"}
                                    strokeWidth={1}/>
                                ))}
                              </Bar>
                              {/* Invisible line just to register for tooltip */}
                              <Line dataKey="allow" stroke="transparent" dot={false} legendType="none"/>
                            </ComposedChart>
                          </ResponsiveContainer>
                          {/* Legend */}
                          <R style={{gap:16,marginTop:12,paddingTop:12,borderTop:"1px solid #f4f4f2"}}>
                            {[
                              {color:"#86efac",border:"#2f9e44",label:"Under budget"},
                              {color:"#fcd34d",border:"#f59e0b",label:"Near limit"},
                              {color:"#fca5a5",border:"#e03131",label:"Over budget"},
                            ].map(({color,border,label})=>(
                              <R key={label} style={{gap:5}}>
                                <div style={{width:10,height:10,borderRadius:3,background:color,border:`1.5px solid ${border}`,flexShrink:0}}/>
                                <span style={{fontSize:10,color:"#bbb9b0",fontWeight:500}}>{label}</span>
                              </R>
                            ))}
                            <R style={{gap:5,marginLeft:"auto"}}>
                              <svg width="16" height="8"><line x1="0" y1="4" x2="16" y2="4" stroke="#1a1a2e" strokeWidth="1.5" strokeDasharray="4 2" strokeOpacity="0.4"/></svg>
                              <span style={{fontSize:10,color:"#bbb9b0",fontWeight:500}}>Daily allowance</span>
                            </R>
                          </R>
                        </>
                      )}

                      {/* POOL VIEW — area chart of remaining pool draining over month */}
                      {chartView==="pool"&&(()=>{
                        // Rebuild with cumulative pool drain
                        let pool = monthPool;
                        const poolData = Array.from({length:todayDom}, (_,i)=>{
                          const d     = i+1;
                          const spent = dayData[d]?.spent ?? 0;
                          pool       -= spent;
                          const pct   = monthPool > 0 ? (pool / monthPool) * 100 : 0;
                          return { day:d, label:`${d}`, pool:parseFloat(pool.toFixed(2)), pct:parseFloat(pct.toFixed(1)) };
                        });
                        // Project ideal drain (spending exactly allowance each day)
                        const idealData = Array.from({length:dim}, (_,i)=>({
                          day:i+1, label:`${i+1}`, ideal: parseFloat((monthPool - monthAllow*(i+1)).toFixed(2))
                        }));

                        const PoolTip = ({active,payload,label})=>{
                          if(!active||!payload?.length) return null;
                          const pool = payload.find(p=>p.dataKey==="pool")?.value??0;
                          const pct  = monthPool>0?(pool/monthPool*100):0;
                          return (
                            <div style={{background:"#fff",border:"1px solid #f0efe9",borderRadius:12,padding:"10px 14px",boxShadow:"0 4px 16px rgba(0,0,0,0.1)"}}>
                              <div style={{fontSize:12,fontWeight:700,color:"#1a1a2e",marginBottom:6}}>Day {label}</div>
                              <div style={{fontSize:12,color:"#1a1a2e",marginBottom:2}}>Pool left {fmtFull(pool)}</div>
                              <div style={{fontSize:12,color:"#bbb9b0"}}>{pct.toFixed(0)}% remaining</div>
                            </div>
                          );
                        };

                        return (
                          <>
                            <ResponsiveContainer width="100%" height={200}>
                              <ComposedChart margin={{top:4,right:4,left:-20,bottom:0}}>
                                <CartesianGrid vertical={false} stroke="#f4f4f2"/>
                                <XAxis dataKey="label" tick={{fontSize:10,fill:"#bbb9b0",fontFamily:"Plus Jakarta Sans"}} axisLine={false} tickLine={false} interval={Math.floor(dim/6)}/>
                                <YAxis tick={{fontSize:10,fill:"#bbb9b0",fontFamily:"Plus Jakarta Sans"}} axisLine={false} tickLine={false} tickFormatter={v=>`$${Math.round(v)}`}/>
                                <Tooltip content={<PoolTip/>}/>
                                {/* Ideal drain line */}
                                <Line data={idealData} dataKey="ideal" stroke="#d4d0c8" strokeWidth={1.5} strokeDasharray="5 5" dot={false} legendType="none"/>
                                {/* Actual pool area */}
                                <Area data={poolData} dataKey="pool" stroke="#1a1a2e" strokeWidth={2} fill="#f0efe9" fillOpacity={0.6} dot={false} activeDot={{r:4,fill:"#1a1a2e"}}/>
                              </ComposedChart>
                            </ResponsiveContainer>
                            <R style={{gap:16,marginTop:12,paddingTop:12,borderTop:"1px solid #f4f4f2"}}>
                              <R style={{gap:5}}>
                                <div style={{width:16,height:3,background:"#1a1a2e",borderRadius:2}}/>
                                <span style={{fontSize:10,color:"#bbb9b0",fontWeight:500}}>Actual pool</span>
                              </R>
                              <R style={{gap:5}}>
                                <svg width="16" height="6"><line x1="0" y1="3" x2="16" y2="3" stroke="#d4d0c8" strokeWidth="1.5" strokeDasharray="5 3"/></svg>
                                <span style={{fontSize:10,color:"#bbb9b0",fontWeight:500}}>On-track pace</span>
                              </R>
                              {poolData.length>0&&(
                                <div style={{marginLeft:"auto",fontSize:11,fontWeight:600,color:poolData[poolData.length-1].pool>=idealData[poolData.length-1]?.ideal?"#2f9e44":"#e03131"}}>
                                  {poolData[poolData.length-1].pool>=( idealData[poolData.length-1]?.ideal??0)?"Ahead of pace ↑":"Behind pace ↓"}
                                </div>
                              )}
                            </R>
                          </>
                        );
                      })()}
                    </div>
                  );
                })()}

                {/* Calendar */}
                <div className="card" style={{padding:22}}>
                  <R style={{justifyContent:"space-between",alignItems:"flex-start",marginBottom:16}}>
                    <C style={{gap:3}}>
                      <div className="sec-hd" style={{marginBottom:0}}>{viewDate.toLocaleDateString("en-US",{month:"long",year:"numeric"})}</div>
                      {savedDays>0&&<div style={{fontSize:12,fontWeight:600,color:"#2f9e44"}}>{savedDays} days under budget · {fmtFull(totalSaved)} saved</div>}
                    </C>
                    {selDay&&<button onClick={()=>setSelDay(null)} style={{background:"none",border:"none",cursor:"pointer",color:"#bbb9b0",fontSize:12,fontFamily:"inherit",fontWeight:600}}>Clear ×</button>}
                  </R>

                  {/* DOW headers */}
                  <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4,marginBottom:6}}>
                    {DOW.map(d=><div key={d} style={{textAlign:"center",fontSize:10,fontWeight:700,color:"#ccc9c0",letterSpacing:"0.04em"}}>{d}</div>)}
                  </div>

                  {/* Cells */}
                  <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:5}}>
                    {Array.from({length:firstDow}).map((_,i)=><div key={`e${i}`}/>)}
                    {Array.from({length:dim}).map((_,i)=>{
                      const d=i+1, dd=dayData[d]||{hasTx:false,net:0,spent:0,key:null};
                      const realToday = isCurrentMonth && d===now.getDate();
                      const isPast = isCurrentMonth ? d<now.getDate() : true;
                      const isTday = realToday;
                      const isFut  = isCurrentMonth && d>now.getDate();
                      const saved=isPast&&dd.hasTx&&dd.net>0, ovr=isPast&&dd.hasTx&&dd.net<0;
                      const isSel=selDay===d;
                      let bg="transparent",tc="#ccc9c0",bc="transparent";
                      if (isTday)      {bg="#1a1a2e";tc="#fff";bc="#1a1a2e";}
                      else if (isSel)  {bg="#f0efe9";tc="#1a1a2e";bc="#1a1a2e";}
                      else if (saved)  {bg="#ebfbee";tc="#2f9e44";bc="#b2f2bb";}
                      else if (ovr)    {bg="#fff5f5";tc="#e03131";bc="#ffc9c9";}
                      else if (isPast) {bg="#f8f7f2";tc="#ccc9c0";bc="rgba(0,0,0,0.04)";}
                      else if (isFut)  {bg="transparent";tc="#e0ddd4";bc="transparent";}
                      const amt = Math.abs(dd.net);
                      const amtStr = amt>=1?`${saved?"+":"−"}$${Math.round(amt)}`:null;
                      return (
                        <button key={d} className={`cal-cell${!isFut?" active":""}`}
                          onClick={()=>!isFut&&setSelDay(isSel?null:d)}
                          style={{background:bg,border:`1.5px solid ${bc}`,boxShadow:isSel?"0 2px 12px rgba(0,0,0,0.12)":"none"}}>
                          <div style={{fontSize:13,fontWeight:isTday?800:600,color:tc,lineHeight:1}}>{d}</div>
                          {(saved||ovr)&&amtStr&&(
                            <div style={{fontSize:8,fontWeight:700,color:tc,marginTop:2,letterSpacing:"-0.01em",lineHeight:1}}>{amtStr}</div>
                          )}
                          {isTday&&!dd.hasTx&&<div style={{width:4,height:4,borderRadius:"50%",background:"rgba(255,255,255,0.5)",marginTop:3}}/>}
                        </button>
                      );
                    })}
                  </div>

                  {/* Legend */}
                  <R style={{gap:16,marginTop:16,paddingTop:14,borderTop:"1px solid #f0efe9"}}>
                    {[{bg:"#ebfbee",bc:"#b2f2bb",tc:"#2f9e44",l:"Under"},{bg:"#fff5f5",bc:"#ffc9c9",tc:"#e03131",l:"Over"},{bg:"#1a1a2e",bc:"#1a1a2e",tc:"#fff",l:"Today"}].map(({bg,bc,tc,l})=>(
                      <R key={l} style={{gap:6}}>
                        <div style={{width:14,height:14,borderRadius:5,background:bg,border:`1.5px solid ${bc}`,flexShrink:0}}/>
                        <span style={{fontSize:11,color:"#bbb9b0",fontWeight:500}}>{l}</span>
                      </R>
                    ))}
                  </R>
                </div>

                {/* Selected day detail — full edit panel */}
                {selDay&&(
                  <div className="card" style={{padding:22,borderColor:selNet>=0?"#b2f2bb":"#ffc9c9",borderWidth:1.5}}>
                    {/* Header */}
                    <R style={{justifyContent:"space-between",marginBottom:14}}>
                      <C style={{gap:2}}>
                        <div style={{fontSize:15,fontWeight:700}}>
                          {isTday?"Today":new Date(yr,mo,selDay).toLocaleDateString("en-US",{weekday:"long",month:"short",day:"numeric"})}
                        </div>
                        <div style={{fontSize:12,color:"#bbb9b0"}}>{selTx.length} transaction{selTx.length!==1?"s":""}</div>
                      </C>
                      <C style={{alignItems:"flex-end",gap:2}}>
                        <div style={{fontSize:18,fontWeight:800,color:selNet>=0?"#2f9e44":"#e03131"}}>
                          {selNet>=0?"+":"−"}{fmtFull(Math.abs(selNet))}
                        </div>
                        <div style={{fontSize:11,color:"#bbb9b0"}}>vs {fmtFull(monthAllow)} allowance</div>
                      </C>
                    </R>

                    {/* Progress bar */}
                    <div className="prog-track" style={{marginBottom:16}}>
                      <div className="prog-fill" style={{width:`${Math.min(100,monthAllow>0?(selSpent/monthAllow)*100:0)}%`,background:selNet<0?"#e03131":selSpent/monthAllow>0.8?"#f08c00":"#2f9e44"}}/>
                    </div>

                    {/* Transaction list */}
                    {selTx.length>0?(
                      <div style={{marginBottom:16}}>
                        {selTx.map((tx,i)=>{
                          const isOut=tx.type==="expense"||(tx.source==="plaid"&&tx.amount>0);
                          return (
                            <div key={tx.id||i} className="tx-row">
                              <div style={{width:38,height:38,borderRadius:12,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",background:tx.source==="plaid"?"#eef3ff":isOut?"#fff5f5":"#ebfbee"}}>
                                <I n={tx.source==="plaid"?"bank":isOut?"wallet":"arrow"} s={16} c={tx.source==="plaid"?"#3b5bdb":isOut?"#e03131":"#2f9e44"}/>
                              </div>
                              <C style={{flex:1,minWidth:0}}>
                                <div style={{fontSize:13,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{tx.label||tx.name}</div>
                                {tx.category&&<div style={{fontSize:11,color:"#bbb9b0"}}>{tx.category}</div>}
                              </C>
                              <div style={{fontSize:14,fontWeight:700,color:isOut?"#e03131":"#2f9e44",flexShrink:0,marginRight:tx.source==="manual"?4:0}}>
                                {isOut?"−":"+"}{fmtFull(tx.amount)}
                              </div>
                              {tx.source==="manual"&&(
                                <button className="rm" onClick={()=>removeTxForDay(selKey,tx.id)}>
                                  <I n="x" s={14}/>
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ):(
                      <div style={{textAlign:"center",padding:"16px 0 20px",color:"#bbb9b0",fontSize:13}}>No transactions logged</div>
                    )}

                    {/* Add transaction to this day */}
                    <div style={{borderTop:"1px solid #f0efe9",paddingTop:16}}>
                      <div style={{fontSize:11,fontWeight:700,color:"#bbb9b0",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:12}}>Add to this day</div>
                      <R style={{gap:8,marginBottom:10}}>
                        <input className="inp" placeholder="What was it?" value={selDayTx.label}
                          onChange={e=>setSelDayTx(p=>({...p,label:e.target.value}))}
                          onKeyDown={e=>e.key==="Enter"&&addTxForDay(selKey)}
                          style={{flex:1,fontSize:13,padding:"10px 14px"}}/>
                        <div className="seg" style={{flexShrink:0}}>
                          {["expense","income"].map(t=>(
                            <button key={t} className={`seg-opt${selDayTx.type===t?" on":""}`}
                              onClick={()=>setSelDayTx(p=>({...p,type:t}))}
                              style={{padding:"6px 12px",fontSize:12}}>
                              {t==="expense"?"Out":"In"}
                            </button>
                          ))}
                        </div>
                      </R>
                      <R style={{gap:8}}>
                        <input className="inp" type="number" placeholder="0.00" value={selDayTx.amount}
                          onChange={e=>setSelDayTx(p=>({...p,amount:e.target.value}))}
                          onKeyDown={e=>e.key==="Enter"&&addTxForDay(selKey)}
                          style={{flex:1,fontSize:13,padding:"10px 14px"}}/>
                        <button className="btn" onClick={()=>addTxForDay(selKey)}
                          style={{padding:"10px 16px",fontSize:13,borderRadius:12}}>
                          <I n="plus" s={14} c="#fff"/> Add
                        </button>
                      </R>
                    </div>
                  </div>
                )}

                {/* Day cards */}
                {historyDays.filter(k=>k.startsWith(moPrefix)).length===0?(
                  <div style={{textAlign:"center",padding:40,color:"#bbb9b0",fontSize:14}}>No spending logged yet</div>
                ):historyDays.map(dateKey=>{
                  if (!dateKey.startsWith(moPrefix)) return null;
                  const de=data.dailyEntries[dateKey]||{transactions:[]};
                  const pd=ptx.filter(t=>t.date===dateKey);
                  const ds=calcDaySpent(de,ptx,dateKey);
                  const nt=monthAllow-ds;
                  const ax=[...(de.transactions||[]),...pd];
                  const isTday=isCurrentMonth && dateKey===TODAY;
                  if (ax.length===0&&!isTday) return null;
                  const pct=monthAllow>0?Math.min(1,ds/monthAllow):0;
                  return (
                    <div key={dateKey} className="card" style={{padding:20,opacity:isTday?1:0.88}}>
                      <R style={{justifyContent:"space-between",marginBottom:12}}>
                        <C>
                          <div style={{fontSize:14,fontWeight:700}}>{isTday?"Today":fmtDate(dateKey)}</div>
                          <div style={{fontSize:11,color:"#bbb9b0",marginTop:2}}>{ax.length} transactions</div>
                        </C>
                        <C style={{alignItems:"flex-end",gap:2}}>
                          <div style={{fontSize:16,fontWeight:800,color:nt>=0?"#2f9e44":"#e03131"}}>{nt>=0?"+":"−"}{fmtFull(Math.abs(nt))}</div>
                          <div style={{fontSize:11,color:"#bbb9b0"}}>{fmtFull(ds)} spent</div>
                        </C>
                      </R>
                      <div className="prog-track">
                        <div className="prog-fill" style={{width:`${pct*100}%`,background:pct>1?"#e03131":pct>0.8?"#f08c00":"#1a1a2e"}}/>
                      </div>
                      {ax.slice(0,3).map((tx,i)=>{
                        const io=tx.type==="expense"||(tx.source==="plaid"&&tx.amount>0);
                        return <R key={i} style={{justifyContent:"space-between",marginTop:10,fontSize:13}}><span style={{color:"#9e9b95",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:"68%"}}>{tx.label||tx.name}</span><span style={{fontWeight:600,color:io?"#e03131":"#2f9e44"}}>{io?"−":"+"}{fmtFull(tx.amount)}</span></R>;
                      })}
                      {ax.length>3&&<div style={{fontSize:12,color:"#ccc9c0",marginTop:6}}>+{ax.length-3} more</div>}
                    </div>
                  );
                })}
              </C>
            );
          })()}

          {/* ══════ RECURRING ══════ */}
          {tab==="recurring"&&(()=>{
            const grouped={};
            for (const c of CATS) grouped[c.id]=[];
            for (const p of data.recurringPayments){ const cid=p.category||"other"; if(!grouped[cid])grouped[cid]=[]; grouped[cid].push(p); }
            const activeCats=CATS.filter(c=>grouped[c.id].length>0);
            const tb=totalBills(data.recurringPayments);
            const catTotals=CATS.map(c=>({...c,total:grouped[c.id].reduce((s,p)=>s+monthlyEquiv(p),0)})).filter(c=>c.total>0).sort((a,b)=>b.total-a.total);
            const FL={monthly:"/mo",weekly:"/wk",yearly:"/yr",daily:"/day"};
            return (
              <C style={{gap:16}}>
                {/* Hero */}
                <div className="hero-card" style={{padding:26}}>
                  <div className="hero-band" style={{background:"#7048e8"}}/>
                  <div style={{marginTop:8}}>
                    <div className="sec-hd">Recurring expenses</div>
                    <R style={{alignItems:"baseline",gap:6,marginBottom:4}}>
                      <div style={{fontSize:44,fontWeight:300,letterSpacing:"-0.05em",color:"#1a1a2e",lineHeight:1}}>{fmtFull(tb)}</div>
                      <div style={{fontSize:16,color:"#bbb9b0",fontWeight:500}}>/mo</div>
                    </R>
                    <div style={{fontSize:13,color:"#9e9b95",marginBottom:tb>0?20:0}}>
                      {fmtFull(tb/DIM)}/day · leaves {fmtFull(myPoolReal)}/mo spendable
                    </div>
                    {catTotals.length>0&&(
                      <C style={{gap:10}}>
                        {catTotals.map(c=>(
                          <R key={c.id} style={{gap:10,alignItems:"center"}}>
                            <div style={{width:26,height:26,borderRadius:8,background:c.bg,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                              <I n={c.icon} s={14} c={c.fg}/>
                            </div>
                            <div style={{flex:1}}>
                              <R style={{justifyContent:"space-between",marginBottom:4}}>
                                <span style={{fontSize:12,fontWeight:600,color:"#6b6965"}}>{c.label}</span>
                                <span style={{fontSize:12,fontWeight:600,color:"#1a1a2e"}}>{fmtFull(c.total)}</span>
                              </R>
                              <div style={{height:3,background:"#f0efe9",borderRadius:3,overflow:"hidden"}}>
                                <div style={{height:"100%",borderRadius:3,background:c.fg,width:`${tb>0?(c.total/tb)*100:0}%`,opacity:0.75,transition:"width 0.5s ease"}}/>
                              </div>
                            </div>
                          </R>
                        ))}
                      </C>
                    )}
                  </div>
                </div>

                {/* Add form */}
                <div className="card" style={{padding:22}}>
                  <div className="sec-hd">Add recurring expense</div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(70px,1fr))",gap:8,marginBottom:14}}>
                    {CATS.map(c=>(
                      <button key={c.id} onClick={()=>setNewRec(p=>({...p,category:c.id}))}
                        style={{display:"flex",flexDirection:"column",alignItems:"center",gap:5,padding:"10px 6px",borderRadius:16,border:"1.5px solid",borderColor:newRec.category===c.id?c.fg:"#e8e5dc",background:newRec.category===c.id?c.bg:"#fafaf8",cursor:"pointer",transition:"all 0.15s",fontFamily:"inherit"}}>
                        <div style={{width:30,height:30,borderRadius:10,background:newRec.category===c.id?c.bg:"#f0efe9",display:"flex",alignItems:"center",justifyContent:"center"}}>
                          <I n={c.icon} s={15} c={c.fg}/>
                        </div>
                        <span style={{fontSize:9.5,fontWeight:700,color:newRec.category===c.id?c.fg:"#bbb9b0",letterSpacing:"0.03em",textAlign:"center",lineHeight:1.2,textTransform:"uppercase"}}>{c.label}</span>
                      </button>
                    ))}
                  </div>
                  <input className="inp" placeholder="Name (e.g. Rent, Spotify, Gym…)" value={newRec.name}
                    onChange={e=>setNewRec(p=>({...p,name:e.target.value}))}
                    onKeyDown={e=>e.key==="Enter"&&addRec()} style={{marginBottom:10}}/>
                  <R style={{gap:8,marginBottom:10}}>
                    <input className="inp" type="number" placeholder="Amount" value={newRec.amount}
                      onChange={e=>setNewRec(p=>({...p,amount:e.target.value}))}
                      onKeyDown={e=>e.key==="Enter"&&addRec()} style={{flex:1}}/>
                    <select className="sel" value={newRec.frequency} onChange={e=>setNewRec(p=>({...p,frequency:e.target.value}))}>
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                      <option value="monthly">Monthly</option>
                      <option value="yearly">Yearly</option>
                    </select>
                  </R>
                  <R style={{gap:8}}>
                    <C style={{flex:1}}>
                      <div style={{fontSize:11,color:"#9e9b95",marginBottom:4,fontWeight:500}}>Due day of month</div>
                      <input className="inp" type="number" min="1" max="31" placeholder="1" value={newRec.dueDay}
                        onChange={e=>setNewRec(p=>({...p,dueDay:Math.min(31,Math.max(1,parseInt(e.target.value)||1))}))}/>
                    </C>
                    <C style={{justifyContent:"flex-end"}}>
                      <button className="btn" onClick={addRec} style={{padding:"13px 16px"}}><I n="plus" s={16} c="#fff"/></button>
                    </C>
                  </R>
                </div>

                {/* Grouped list */}
                {data.recurringPayments.length===0?(
                  <div style={{textAlign:"center",padding:40,color:"#bbb9b0",fontSize:14}}>No recurring expenses yet — add your first above</div>
                ):activeCats.map(cat=>(
                  <div key={cat.id} className="card" style={{padding:22}}>
                    <R style={{gap:10,marginBottom:14}}>
                      <div style={{width:34,height:34,borderRadius:11,background:cat.bg,display:"flex",alignItems:"center",justifyContent:"center"}}>
                        <I n={cat.icon} s={17} c={cat.fg}/>
                      </div>
                      <C style={{flex:1}}>
                        <div style={{fontSize:13,fontWeight:700,color:"#1a1a2e"}}>{cat.label}</div>
                        <div style={{fontSize:11,color:"#bbb9b0"}}>{grouped[cat.id].length} expense{grouped[cat.id].length!==1?"s":""} · {fmtFull(grouped[cat.id].reduce((s,p)=>s+monthlyEquiv(p),0))}/mo</div>
                      </C>
                    </R>
                    {grouped[cat.id].map(p=>(
                      <div key={p.id} className="tx-row">
                        <C style={{flex:1}}>
                          <div style={{fontSize:14,fontWeight:600}}>{p.name}</div>
                          <div style={{fontSize:11,color:"#bbb9b0",marginTop:1}}>
                            {fmtFull(p.amount)}{FL[p.frequency]} · {fmtFull(monthlyEquiv(p))}/mo · due day {p.dueDay||1}
                          </div>
                        </C>
                        <div style={{fontSize:14,fontWeight:700,color:"#e03131",marginRight:8}}>−{fmtFull(p.amount)}</div>
                        <button className="rm" onClick={()=>upd({recurringPayments:data.recurringPayments.filter(x=>x.id!==p.id)})}><I n="x" s={14}/></button>
                      </div>
                    ))}
                  </div>
                ))}

                {data.recurringPayments.length>0&&(
                  <div className="card-inset" style={{padding:18,margin:"0 2px"}}>
                    <R style={{justifyContent:"space-between"}}>
                      <C style={{gap:2}}>
                        <div style={{fontSize:12,fontWeight:600,color:"#9e9b95"}}>Spendable pool after all recurring</div>
                        <div style={{fontSize:11,color:"#bbb9b0"}}>{fmtFull(myAllow)}/day · {DIM} days this month</div>
                      </C>
                      <div style={{fontSize:22,fontWeight:700,color:myPoolReal>=0?"#1a1a2e":"#e03131"}}>{fmtFull(myPoolReal)}</div>
                    </R>
                  </div>
                )}

                {/* Bill Calendar */}
                {(()=>{
                  const billsByDay = {};
                  for (const r of (data.recurringPayments||[])) {
                    const d = Math.min(r.dueDay||1, DIM);
                    if (!billsByDay[d]) billsByDay[d] = [];
                    billsByDay[d].push(r);
                  }
                  const FL2 = {monthly:"/mo",weekly:"/wk",yearly:"/yr",daily:"/day"};
                  return (
                    <div className="card" style={{padding:22}}>
                      <div className="sec-hd">Bill Calendar — {new Date().toLocaleDateString("en-US",{month:"long"})}</div>
                      <div style={{fontSize:12,color:"#9e9b95",marginBottom:16,lineHeight:1.6}}>
                        Bills are spread into your daily allowance — these are the actual due dates.
                      </div>
                      {Object.keys(billsByDay).length===0?(
                        <div style={{textAlign:"center",padding:30,color:"#bbb9b0",fontSize:13}}>Add bills above to see them here</div>
                      ):Array.from({length:DIM},(_,i)=>i+1).map(day=>{
                        const bills = billsByDay[day];
                        if (!bills?.length) return null;
                        const dayTotal = bills.reduce((s,r)=>s+r.amount,0);
                        const isToday  = day===dayOfMonth();
                        const isPast   = day<dayOfMonth();
                        return (
                          <div key={day} style={{marginBottom:14}}>
                            <R style={{gap:10,marginBottom:8}}>
                              <div style={{width:36,height:36,borderRadius:11,background:isToday?"#1a1a2e":isPast?"#f0efe9":"#f8f7f2",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                                <span style={{fontSize:13,fontWeight:800,color:isToday?"#fff":isPast?"#bbb9b0":"#1a1a2e"}}>{day}</span>
                              </div>
                              <R style={{flex:1,justifyContent:"space-between",alignItems:"center"}}>
                                <span style={{fontSize:13,fontWeight:600,color:isPast?"#bbb9b0":"#1a1a2e"}}>
                                  {isToday?"Today":"Day "}{isToday?"":day}
                                </span>
                                <span style={{fontSize:13,fontWeight:700,color:isPast?"#bbb9b0":"#e03131"}}>−{fmtFull(dayTotal)}</span>
                              </R>
                            </R>
                            {bills.map((r,i)=>{
                              const cat = CAT_MAP[r.category||"other"]||CAT_MAP.other;
                              return (
                                <R key={i} style={{marginLeft:46,marginBottom:6,gap:8}}>
                                  <div style={{width:4,borderRadius:2,background:"#1a1a2e",flexShrink:0,alignSelf:"stretch"}}/>
                                  <R style={{flex:1,justifyContent:"space-between",background:"#f8f7f2",borderRadius:10,padding:"9px 12px"}}>
                                    <R style={{gap:8}}>
                                      <div style={{width:22,height:22,borderRadius:7,background:cat.bg,display:"flex",alignItems:"center",justifyContent:"center"}}>
                                        <I n={cat.icon} s={11} c={cat.fg}/>
                                      </div>
                                      <C style={{gap:1}}>
                                        <span style={{fontSize:12,fontWeight:600,color:isPast?"#bbb9b0":"#1a1a2e"}}>{r.name}</span>
                                        <span style={{fontSize:10,color:"#bbb9b0"}}>{FL2[r.frequency]||"/mo"} · due day {r.dueDay||1}</span>
                                      </C>
                                    </R>
                                    <span style={{fontSize:12,fontWeight:600,color:isPast?"#ccc9c0":"#e03131"}}>−{fmtFull(r.amount)}</span>
                                  </R>
                                </R>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}

              </C>
            );
          })()}

          {/* ══════ BANK ══════ */}
          {tab==="bank"&&(
            <C style={{gap:16}}>
              {!data.plaidConnected?(
                <>
                  <div className="hero-card" style={{padding:36,textAlign:"center"}}>
                    <div style={{width:64,height:64,borderRadius:20,background:"#eef3ff",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 20px"}}>
                      <I n="bank" s={28} c="#3b5bdb"/>
                    </div>
                    <div style={{fontSize:22,fontWeight:800,letterSpacing:"-0.03em",marginBottom:10}}>Connect your bank</div>
                    <div style={{fontSize:14,color:"#9e9b95",lineHeight:1.7,maxWidth:300,margin:"0 auto 28px"}}>
                      Link via Plaid to auto-import transactions and track your daily spending automatically.
                    </div>
                    <button className="btn" onClick={()=>{setModal(true);setStep(0);}} style={{margin:"0 auto",borderRadius:16,padding:"15px 28px",fontSize:15,boxShadow:"0 4px 16px rgba(26,26,46,0.3)"}}>
                      <I n="link" s={17} c="#fff"/> Connect with Plaid
                    </button>
                  </div>
                  {[{icon:"arrow",title:"Auto-import transactions",desc:"Every purchase shows up automatically — no manual entry."},{icon:"check",title:"Accurate daily tracking",desc:"Real bank data feeds directly into your daily allowance."},{icon:"bank",title:"Bank-level security",desc:"Plaid encrypts everything. DayFlow never sees your credentials."}].map(({icon,title,desc})=>(
                    <div key={title} className="card" style={{padding:20}}>
                      <R style={{gap:14}}>
                        <div style={{width:44,height:44,borderRadius:14,background:"#f0efe9",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                          <I n={icon} s={20} c="#1a1a2e"/>
                        </div>
                        <C>
                          <div style={{fontSize:14,fontWeight:700,marginBottom:4}}>{title}</div>
                          <div style={{fontSize:13,color:"#9e9b95",lineHeight:1.55}}>{desc}</div>
                        </C>
                      </R>
                    </div>
                  ))}
                </>
              ):(
                <>
                  <div className="card" style={{padding:24}}>
                    <R style={{justifyContent:"space-between",marginBottom:18}}>
                      <R style={{gap:14}}>
                        <div style={{width:48,height:48,borderRadius:16,background:"#eef3ff",display:"flex",alignItems:"center",justifyContent:"center"}}>
                          <I n="bank" s={22} c="#3b5bdb"/>
                        </div>
                        <C>
                          <div style={{fontSize:16,fontWeight:800}}>{data.bankName}</div>
                          <R style={{gap:5,marginTop:3}}><div style={{width:7,height:7,borderRadius:"50%",background:"#2f9e44"}}/><div style={{fontSize:12,color:"#2f9e44",fontWeight:600}}>Connected</div></R>
                        </C>
                      </R>
                      <button className="btn-ghost" style={{borderColor:"#ffc9c9",color:"#e03131",fontSize:12,padding:"8px 14px"}} onClick={()=>upd({plaidConnected:false,bankName:"",plaidTransactions:[]})}>Disconnect</button>
                    </R>
                    {[{l:"Transactions imported",v:data.plaidTransactions.length,red:false},{l:"Month spending from bank",v:"−"+fmtFull(ptx.filter(t=>t.date?.startsWith(thisMonth())).reduce((s,t)=>s+Math.max(0,t.amount),0)),red:true}].map(({l,v,red})=>(
                      <R key={l} style={{justifyContent:"space-between",padding:"13px 0",borderTop:"1px solid #f0efe9"}}>
                        <span style={{fontSize:13,color:"#9e9b95"}}>{l}</span>
                        <span style={{fontSize:14,fontWeight:700,color:red?"#e03131":"#1a1a2e"}}>{v}</span>
                      </R>
                    ))}
                  </div>
                  <div className="card" style={{padding:22}}>
                    <div className="sec-hd">Recent bank activity</div>
                    {data.plaidTransactions.slice(0,10).map(tx=>(
                      <div key={tx.id} className="tx-row">
                        <div style={{width:40,height:40,borderRadius:13,background:"#eef3ff",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                          <I n="bank" s={16} c="#3b5bdb"/>
                        </div>
                        <C style={{flex:1,minWidth:0}}>
                          <div style={{fontSize:14,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{tx.name}</div>
                          <div style={{fontSize:11,color:"#bbb9b0",marginTop:1}}>{tx.category} · {fmtDate(tx.date)}</div>
                        </C>
                        <div style={{fontSize:15,fontWeight:700,color:"#e03131",flexShrink:0}}>−{fmtFull(tx.amount)}</div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </C>
          )}

          {/* ══════ HOUSEHOLD ══════ */}
          {tab==="household"&&(()=>{
            const MEMBER_COLORS = ["#7048e8","#2f9e44","#e03131","#e67700","#3b5bdb","#c2255c","#0c8599","#f59f00"];
            const addMember = () => {
              if (!newMember.name.trim()) return;
              const m = { id: Date.now(), name: newMember.name.trim(), monthlyIncome: parseFloat(newMember.monthlyIncome)||0, color: newMember.color, recurringPayments: [] };
              upd({ members: [...(data.members||[]), m], householdMode: true });
              setNewMember({ name:"", monthlyIncome:"", color: MEMBER_COLORS[(data.members||[]).length % MEMBER_COLORS.length] });
            };
            const removeMember = (id) => upd({ members: (data.members||[]).filter(m=>m.id!==id) });
            const addMemberRec = (memberId) => {
              if (!newMemberRec.name.trim()||!newMemberRec.amount) return;
              const rec = { id: Date.now(), name: newMemberRec.name.trim(), amount: parseFloat(newMemberRec.amount), frequency: newMemberRec.frequency, category: newMemberRec.category, dueDay: parseInt(newMemberRec.dueDay)||1 };
              const updated = (data.members||[]).map(m => m.id===memberId ? { ...m, recurringPayments: [...(m.recurringPayments||[]), rec] } : m);
              upd({ members: updated });
              setNewMemberRec(p=>({ ...p, name:"", amount:"" }));
            };
            const removeMemberRec = (memberId, recId) => {
              const updated = (data.members||[]).map(m => m.id===memberId ? { ...m, recurringPayments: (m.recurringPayments||[]).filter(r=>r.id!==recId) } : m);
              upd({ members: updated });
            };

            // All recurring across household with due dates
            const allRecs = [
              ...(data.recurringPayments||[]).map(r=>({ ...r, memberName:"You", memberColor:"#1a1a2e", dueDay: r.dueDay||1 })),
              ...(data.members||[]).flatMap(m=>(m.recurringPayments||[]).map(r=>({ ...r, memberName:m.name, memberColor:m.color, dueDay: r.dueDay||1 }))),
            ].sort((a,b)=>a.dueDay-b.dueDay);

            // Household income + expense totals
            const totalHIncome = householdIncome;
            const totalHBills  = householdBills;
            const totalHPool   = myPoolReal;

            // Owner "member" for display
            const owner = { id:"owner", name:"You", color:"#1a1a2e", monthlyIncome: data.monthlyIncome, recurringPayments: data.recurringPayments||[] };
            const allPeople = [owner, ...(data.members||[])];

            // Billing calendar — days of month with bills due
            const billingByDay = {};
            for (const r of allRecs) {
              const d = Math.min(r.dueDay, DIM);
              if (!billingByDay[d]) billingByDay[d] = [];
              billingByDay[d].push(r);
            }

            const FL = {monthly:"/mo",weekly:"/wk",yearly:"/yr",daily:"/day"};

            return (
              <C style={{gap:14}}>

                {/* Header hero */}
                <div className="hero-card" style={{padding:26}}>
                  <div className="hero-band" style={{background:"#3b5bdb"}}/>
                  <div style={{marginTop:8}}>
                    <R style={{justifyContent:"space-between",alignItems:"flex-start",marginBottom:16}}>
                      <C style={{gap:3}}>
                        <div className="sec-hd" style={{marginBottom:0}}>Household</div>
                        <div style={{fontSize:13,color:"#9e9b95"}}>
                          {allPeople.length} {allPeople.length===1?"person":"members"} · combined view
                        </div>
                      </C>
                      {/* Household mode toggle */}
                      <R style={{gap:8,alignItems:"center"}}>
                        <span style={{fontSize:12,color:"#9e9b95",fontWeight:500}}>Combined pool</span>
                        <div onClick={()=>upd({householdMode:!data.householdMode})}
                          style={{width:44,height:26,borderRadius:13,background:data.householdMode?"#1a1a2e":"#e0ddd4",cursor:"pointer",transition:"background 0.2s",position:"relative",flexShrink:0}}>
                          <div style={{position:"absolute",top:3,left:data.householdMode?20:3,width:20,height:20,borderRadius:"50%",background:"#fff",transition:"left 0.2s",boxShadow:"0 1px 4px rgba(0,0,0,0.2)"}}/>
                        </div>
                      </R>
                    </R>

                    {/* Combined totals */}
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:16}}>
                      {[
                        {label:"Combined income",val:totalHIncome,color:"#2f9e44"},
                        {label:"Total bills",val:totalHBills,color:"#e03131"},
                        {label:"Household pool",val:totalHPool,color:"#1a1a2e"},
                      ].map(({label,val,color})=>(
                        <C key={label} style={{background:"#f8f7f2",borderRadius:14,padding:"12px 14px",gap:3}}>
                          <div style={{fontSize:9,fontWeight:700,color:"#bbb9b0",letterSpacing:"0.08em",textTransform:"uppercase"}}>{label}</div>
                          <div style={{fontSize:16,fontWeight:700,color,letterSpacing:"-0.02em"}}>{fmt(val)}</div>
                        </C>
                      ))}
                    </div>

                    {/* Member income bars */}
                    <C style={{gap:8}}>
                      {allPeople.map(m=>{
                        const inc  = parseFloat(m.monthlyIncome)||0;
                        const pct  = totalHIncome>0?(inc/totalHIncome)*100:0;
                        const bills= totalBills(m.recurringPayments||[]);
                        return (
                          <R key={m.id} style={{gap:10,alignItems:"center"}}>
                            <div style={{width:28,height:28,borderRadius:9,background:m.color,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                              <span style={{fontSize:11,fontWeight:800,color:"#fff"}}>{m.name[0].toUpperCase()}</span>
                            </div>
                            <C style={{flex:1,gap:3}}>
                              <R style={{justifyContent:"space-between"}}>
                                <span style={{fontSize:12,fontWeight:600,color:"#1a1a2e"}}>{m.name}</span>
                                <span style={{fontSize:12,color:"#9e9b95"}}>{fmtFull(inc)}/mo · {pct.toFixed(0)}%</span>
                              </R>
                              <div style={{height:4,background:"#f0efe9",borderRadius:2,overflow:"hidden"}}>
                                <div style={{height:"100%",width:`${pct}%`,background:m.color,borderRadius:2,transition:"width 0.5s ease"}}/>
                              </div>
                              {bills>0&&<div style={{fontSize:10,color:"#bbb9b0"}}>{fmtFull(bills)}/mo in bills</div>}
                            </C>
                          </R>
                        );
                      })}
                    </C>
                  </div>
                </div>

                {/* Sub-nav */}
                <div style={{display:"flex",background:"#f0efe9",borderRadius:14,padding:3,gap:2}}>
                  {[{id:"overview",label:"Overview"},{id:"members",label:"Members"},{id:"billing",label:"Bill calendar"}].map(v=>(
                    <button key={v.id} className={`seg-opt${householdView===v.id?" on":""}`}
                      onClick={()=>setHouseholdView(v.id)}
                      style={{flex:1,padding:"9px 8px",fontSize:12,textAlign:"center"}}>
                      {v.label}
                    </button>
                  ))}
                </div>

                {/* OVERVIEW */}
                {householdView==="overview"&&(
                  <C style={{gap:14}}>
                    {allPeople.map(m=>{
                      const inc   = parseFloat(m.monthlyIncome)||0;
                      const bills = totalBills(m.recurringPayments||[]);
                      const pool  = inc - bills;
                      const dailyShare = pool / DIM;
                      return (
                        <div key={m.id} className="card" style={{padding:20,borderLeft:`3px solid ${m.color}`}}>
                          <R style={{justifyContent:"space-between",marginBottom:14}}>
                            <R style={{gap:10}}>
                              <div style={{width:36,height:36,borderRadius:11,background:m.color,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                                <span style={{fontSize:14,fontWeight:800,color:"#fff"}}>{m.name[0].toUpperCase()}</span>
                              </div>
                              <C style={{gap:1}}>
                                <div style={{fontSize:14,fontWeight:700}}>{m.name}</div>
                                <div style={{fontSize:11,color:"#bbb9b0"}}>{fmtFull(inc)}/mo take-home</div>
                              </C>
                            </R>
                            {m.id!=="owner"&&(
                              <R style={{gap:6}}>
                                <button className="rm" onClick={()=>setEditMemberId(editMemberId===m.id?null:m.id)} style={{color:"#9e9b95"}}>
                                  <I n="edit-2" s={14}/>
                                </button>
                                <button className="rm" onClick={()=>removeMember(m.id)} style={{color:"#ccc9c0"}}>
                                  <I n="x" s={15}/>
                                </button>
                              </R>
                            )}
                          </R>
                          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:12}}>
                            {[
                              {l:"Income",v:inc,c:"#2f9e44"},
                              {l:"Bills",v:bills,c:"#e03131"},
                              {l:"Net pool",v:pool,c:pool>=0?"#1a1a2e":"#e03131"},
                            ].map(({l,v,c})=>(
                              <div key={l} style={{background:"#f8f7f2",borderRadius:10,padding:"10px 12px"}}>
                                <div style={{fontSize:9,fontWeight:700,color:"#bbb9b0",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:3}}>{l}</div>
                                <div style={{fontSize:15,fontWeight:700,color:c}}>{fmt(v)}</div>
                              </div>
                            ))}
                          </div>
                          <R style={{justifyContent:"space-between",fontSize:12,color:"#9e9b95",paddingTop:10,borderTop:"1px solid #f0efe9"}}>
                            <span>Daily share of pool</span>
                            <span style={{fontWeight:700,color:"#1a1a2e"}}>{fmtFull(dailyShare)}/day</span>
                          </R>
                          {/* Inline edit form */}
                          {editMemberId===m.id&&m.id!=="owner"&&(
                            <div style={{marginTop:12,padding:12,background:"#f8f7f2",borderRadius:12}}>
                              <div style={{fontSize:11,fontWeight:700,color:"#9e9b95",marginBottom:8,letterSpacing:"0.06em",textTransform:"uppercase"}}>Edit member</div>
                              <input className="inp" placeholder="Name" defaultValue={m.name} id={`edit-name-${m.id}`} style={{marginBottom:8}}/>
                              <input className="inp" type="number" placeholder="Monthly income" defaultValue={m.monthlyIncome||0} id={`edit-income-${m.id}`} style={{marginBottom:8}}/>
                              <R style={{gap:8}}>
                                {["#1a1a2e","#e03131","#2f9e44","#7048e8","#e67700","#c2255c","#1971c2","#0c8599"].map(col=>(
                                  <button key={col} onClick={()=>{
                                    upd({members:(data.members||[]).map(x=>x.id===m.id?{...x,color:col}:x)});
                                  }} style={{width:22,height:22,borderRadius:"50%",background:col,border:m.color===col?"3px solid #1a1a2e":"2px solid transparent",cursor:"pointer",flexShrink:0}}/>
                                ))}
                              </R>
                              <R style={{gap:8,marginTop:10}}>
                                <button className="btn" style={{flex:1,justifyContent:"center",padding:"10px 0",fontSize:13}} onClick={()=>{
                                  const name = document.getElementById(`edit-name-${m.id}`)?.value?.trim();
                                  const income = parseFloat(document.getElementById(`edit-income-${m.id}`)?.value)||0;
                                  if (!name) return;
                                  upd({members:(data.members||[]).map(x=>x.id===m.id?{...x,name,monthlyIncome:income}:x)});
                                  setEditMemberId(null);
                                }}>Save</button>
                                <button className="btn-ghost" style={{flex:1,justifyContent:"center",padding:"10px 0",fontSize:13}} onClick={()=>setEditMemberId(null)}>Cancel</button>
                              </R>
                            </div>
                          )}
                          {/* Bills list */}
                          {(m.recurringPayments||[]).length>0&&(
                            <C style={{gap:0,marginTop:10,paddingTop:10,borderTop:"1px solid #f0efe9"}}>
                              {(m.recurringPayments||[]).map(r=>{
                                const cat = CAT_MAP[r.category||"other"]||CAT_MAP.other;
                                return (
                                  <R key={r.id} style={{justifyContent:"space-between",padding:"7px 0",borderBottom:"1px solid #f8f7f2"}}>
                                    <R style={{gap:8}}>
                                      <div style={{width:24,height:24,borderRadius:7,background:cat.bg,display:"flex",alignItems:"center",justifyContent:"center"}}>
                                        <I n={cat.icon} s={12} c={cat.fg}/>
                                      </div>
                                      <C style={{gap:1}}>
                                        <span style={{fontSize:13,fontWeight:500}}>{r.name}</span>
                                        <span style={{fontSize:10,color:"#bbb9b0"}}>Due day {r.dueDay||1} · {FL[r.frequency]}</span>
                                      </C>
                                    </R>
                                    <R style={{gap:8,alignItems:"center"}}>
                                      <span style={{fontSize:13,fontWeight:600,color:"#e03131"}}>−{fmtFull(r.amount)}</span>
                                      {m.id!=="owner"&&<button className="rm" onClick={()=>removeMemberRec(m.id,r.id)}><I n="x" s={13}/></button>}
                                    </R>
                                  </R>
                                );
                              })}
                            </C>
                          )}
                        </div>
                      );
                    })}
                  </C>
                )}

                {/* MEMBERS — add/edit */}
                {householdView==="members"&&(
                  <C style={{gap:14}}>
                    <div className="card" style={{padding:22}}>
                      <div className="sec-hd">Add a family member</div>
                      <input className="inp" placeholder="Name (e.g. Alex, Partner, Mom)" value={newMember.name}
                        onChange={e=>setNewMember(p=>({...p,name:e.target.value}))} style={{marginBottom:10}}/>
                      <R style={{gap:8,marginBottom:12}}>
                        <input className="inp" type="number" placeholder="Monthly take-home income" value={newMember.monthlyIncome}
                          onChange={e=>setNewMember(p=>({...p,monthlyIncome:e.target.value}))} style={{flex:1}}/>
                      </R>
                      {/* Color picker */}
                      <div style={{fontSize:11,fontWeight:700,color:"#bbb9b0",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:8}}>Color</div>
                      <R style={{gap:8,marginBottom:14,flexWrap:"wrap"}}>
                        {MEMBER_COLORS.map(c=>(
                          <button key={c} onClick={()=>setNewMember(p=>({...p,color:c}))}
                            style={{width:28,height:28,borderRadius:"50%",background:c,border:`3px solid ${newMember.color===c?"#1a1a2e":"transparent"}`,cursor:"pointer",transition:"border 0.15s"}}/>
                        ))}
                      </R>
                      <button className="btn" onClick={addMember} style={{width:"100%",justifyContent:"center"}}>
                        <I n="plus" s={15} c="#fff"/> Add member
                      </button>
                    </div>

                    {/* Add expense to a member */}
                    {(data.members||[]).length>0&&(
                      <div className="card" style={{padding:22}}>
                        <div className="sec-hd">Add expense to member</div>
                        <select className="sel" value={newMemberRec.memberId}
                          onChange={e=>setNewMemberRec(p=>({...p,memberId:e.target.value}))}
                          style={{width:"100%",marginBottom:10}}>
                          <option value="">Select member…</option>
                          {(data.members||[]).map(m=><option key={m.id} value={m.id}>{m.name}</option>)}
                        </select>
                        <input className="inp" placeholder="Expense name" value={newMemberRec.name}
                          onChange={e=>setNewMemberRec(p=>({...p,name:e.target.value}))} style={{marginBottom:10}}/>
                        <R style={{gap:8,marginBottom:10}}>
                          <input className="inp" type="number" placeholder="Amount" value={newMemberRec.amount}
                            onChange={e=>setNewMemberRec(p=>({...p,amount:e.target.value}))} style={{flex:1}}/>
                          <select className="sel" value={newMemberRec.frequency} onChange={e=>setNewMemberRec(p=>({...p,frequency:e.target.value}))}>
                            <option value="monthly">Monthly</option>
                            <option value="weekly">Weekly</option>
                            <option value="yearly">Yearly</option>
                            <option value="daily">Daily</option>
                          </select>
                        </R>
                        <R style={{gap:8,marginBottom:14}}>
                          <C style={{flex:1}}>
                            <div style={{fontSize:11,color:"#9e9b95",marginBottom:4}}>Due day of month</div>
                            <input className="inp" type="number" min="1" max="31" placeholder="1" value={newMemberRec.dueDay}
                              onChange={e=>setNewMemberRec(p=>({...p,dueDay:Math.min(31,Math.max(1,parseInt(e.target.value)||1))}))}/>
                          </C>
                          <C style={{flex:1}}>
                            <div style={{fontSize:11,color:"#9e9b95",marginBottom:4}}>Category</div>
                            <select className="sel" value={newMemberRec.category} onChange={e=>setNewMemberRec(p=>({...p,category:e.target.value}))}>
                              {CATS.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
                            </select>
                          </C>
                        </R>
                        <button className="btn" onClick={()=>newMemberRec.memberId&&addMemberRec(newMemberRec.memberId)}
                          style={{width:"100%",justifyContent:"center",opacity:newMemberRec.memberId?1:0.4}}>
                          <I n="plus" s={15} c="#fff"/> Add expense
                        </button>
                      </div>
                    )}
                  </C>
                )}

                {/* BILLING CALENDAR — all bills by due date */}
                {householdView==="billing"&&(
                  <C style={{gap:14}}>
                    <div className="card" style={{padding:22}}>
                      <div className="sec-hd">Bill calendar — {new Date().toLocaleDateString("en-US",{month:"long"})}</div>
                      <div style={{fontSize:12,color:"#9e9b95",marginBottom:16,lineHeight:1.6}}>
                        Bills are spread daily across your allowance — these dates show when money actually leaves your account.
                      </div>
                      {Object.keys(billingByDay).length===0?(
                        <div style={{textAlign:"center",padding:30,color:"#bbb9b0",fontSize:13}}>No bills with due dates yet</div>
                      ):Array.from({length:DIM},(_,i)=>i+1).map(day=>{
                        const bills = billingByDay[day];
                        if (!bills?.length) return null;
                        const dayTotal = bills.reduce((s,r)=>s+r.amount,0);
                        const isToday  = day===dayOfMonth();
                        const isPast   = day<dayOfMonth();
                        return (
                          <div key={day} style={{marginBottom:14}}>
                            <R style={{gap:10,marginBottom:8}}>
                              <div style={{width:36,height:36,borderRadius:11,background:isToday?"#1a1a2e":isPast?"#f0efe9":"#f8f7f2",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                                <span style={{fontSize:13,fontWeight:800,color:isToday?"#fff":isPast?"#bbb9b0":"#1a1a2e"}}>{day}</span>
                              </div>
                              <R style={{flex:1,justifyContent:"space-between",alignItems:"center"}}>
                                <span style={{fontSize:13,fontWeight:600,color:isPast?"#bbb9b0":"#1a1a2e"}}>
                                  {isToday?"Today, day ":isPast?"Day ":"Upcoming day "}{day}
                                </span>
                                <span style={{fontSize:13,fontWeight:700,color:isPast?"#bbb9b0":"#e03131"}}>
                                  −{fmtFull(dayTotal)}
                                </span>
                              </R>
                            </R>
                            {bills.map((r,i)=>{
                              const cat = CAT_MAP[r.category||"other"]||CAT_MAP.other;
                              return (
                                <R key={i} style={{marginLeft:46,marginBottom:6,gap:8}}>
                                  <div style={{width:4,borderRadius:2,background:r.memberColor||"#1a1a2e",flexShrink:0,alignSelf:"stretch"}}/>
                                  <R style={{flex:1,justifyContent:"space-between",background:"#f8f7f2",borderRadius:10,padding:"9px 12px"}}>
                                    <R style={{gap:8}}>
                                      <div style={{width:22,height:22,borderRadius:7,background:cat.bg,display:"flex",alignItems:"center",justifyContent:"center"}}>
                                        <I n={cat.icon} s={11} c={cat.fg}/>
                                      </div>
                                      <C style={{gap:1}}>
                                        <span style={{fontSize:12,fontWeight:600,color:isPast?"#bbb9b0":"#1a1a2e"}}>{r.name}</span>
                                        <span style={{fontSize:10,color:"#bbb9b0"}}>{r.memberName} · {FL[r.frequency]}</span>
                                      </C>
                                    </R>
                                    <span style={{fontSize:12,fontWeight:600,color:isPast?"#ccc9c0":"#e03131"}}>−{fmtFull(r.amount)}</span>
                                  </R>
                                </R>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>

                    {/* Daily spread explanation */}
                    <div className="card-inset" style={{padding:18}}>
                      <div style={{fontSize:12,fontWeight:700,color:"#1a1a2e",marginBottom:6}}>How spreading works</div>
                      <div style={{fontSize:12,color:"#9e9b95",lineHeight:1.7}}>
                        Your {fmtFull(householdBills)}/mo in total bills is divided across {DIM} days
                        → <strong style={{color:"#1a1a2e"}}>{fmtFull(householdBills/DIM)}/day</strong> is already baked into your daily allowance.
                        Even if rent is due on the 1st, you don't lose your whole allowance that day — the cost is smoothed out all month.
                      </div>
                    </div>
                  </C>
                )}

              </C>
            );
          })()}

          {/* ══════ AI ADVISOR ══════ */}
          {tab==="advisor"&&(
            <C style={{gap:14}}>

              {/* ── Single unified chat card — always visible ── */}
              <div className="card" style={{padding:0,overflow:"hidden"}}>

                {/* Header */}
                <R style={{padding:"16px 20px",borderBottom:"1px solid #f0efe9",justifyContent:"space-between"}}>
                  <R style={{gap:10}}>
                    <div style={{width:36,height:36,borderRadius:12,background:"#f3eeff",display:"flex",alignItems:"center",justifyContent:"center"}}>
                      <I n="brain" s={18} c="#7048e8"/>
                    </div>
                    <C style={{gap:1}}>
                      <div style={{fontSize:14,fontWeight:700}}>DayFlow Advisor</div>
                      <div style={{fontSize:11,color:"#2f9e44",fontWeight:600}}>● Online — ask me anything</div>
                    </C>
                  </R>
                  {aiMessages.length>0&&(
                    <button className="btn-ghost" style={{padding:"6px 12px",fontSize:11}}
                      onClick={()=>{setAiMessages([]);setUploadedFile(null);setUploadPreview(null);}}>
                      New chat
                    </button>
                  )}
                </R>

                {/* Messages area */}
                <div style={{minHeight:260,maxHeight:440,overflowY:"auto",display:"flex",flexDirection:"column",gap:12,padding:"16px 16px 8px"}}>

                  {aiMessages.length===0&&(
                    <div style={{display:"flex",flexDirection:"column"}}>
                      {data.monthlyIncome>0&&(
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:16}}>
                          {[
                            {label:"Allowance",val:fmtFull(myAllow)+"/day",color:"#1a1a2e"},
                            {label:"Spent today",val:fmtFull(daySpent),color:daySpent>0?"#e03131":"#bbb9b0"},
                            {label:"Pool left",val:fmtFull(poolLeft),color:poolLeft>=0?"#2f9e44":"#e03131"},
                          ].map(({label,val,color})=>(
                            <div key={label} style={{background:"#f8f7f2",borderRadius:12,padding:"10px 12px",border:"1px solid #ece9e0"}}>
                              <div style={{fontSize:9,fontWeight:700,color:"#bbb9b0",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:3}}>{label}</div>
                              <div style={{fontSize:13,fontWeight:700,color}}>{val}</div>
                            </div>
                          ))}
                        </div>
                      )}
                      <div style={{fontSize:11,fontWeight:700,color:"#bbb9b0",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:10}}>Suggested</div>
                      <div style={{display:"flex",gap:6,overflowX:"auto",marginBottom:10,paddingBottom:2}}>
                        {suggestions.map(s=>(
                          <button key={s.cat} onClick={()=>setSuggestionCat(s.cat)}
                            style={{flexShrink:0,padding:"5px 11px",borderRadius:20,border:"1.5px solid",borderColor:suggestionCat===s.cat?"#7048e8":"#ece9e0",background:suggestionCat===s.cat?"#f3eeff":"#f8f7f2",color:suggestionCat===s.cat?"#7048e8":"#9e9b95",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit",transition:"all 0.15s"}}>
                            {s.cat}
                          </button>
                        ))}
                      </div>
                      <C style={{gap:6}}>
                        {(suggestions.find(s=>s.cat===suggestionCat)?.prompts||[]).slice(0,4).map((s,i)=>(
                          <button key={i} onClick={()=>sendAiMessage(s)}
                            style={{background:"#f8f7f2",border:"1px solid #ece9e0",borderRadius:10,padding:"10px 14px",textAlign:"left",cursor:"pointer",fontSize:12,color:"#1a1a2e",fontFamily:"inherit",fontWeight:500,display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
                            {s}
                            <I n="arrow" s={12} c="#bbb9b0"/>
                          </button>
                        ))}
                      </C>
                    </div>
                  )}

                  {aiMessages.map((msg,i)=>{
                    const isUser = msg.role==="user";
                    return (
                      <div key={msg.id||i} style={{display:"flex",flexDirection:"column",alignItems:isUser?"flex-end":"flex-start",gap:4}}>
                        <div style={{fontSize:10,fontWeight:700,color:"#bbb9b0",letterSpacing:"0.06em",textTransform:"uppercase",paddingLeft:isUser?0:4,paddingRight:isUser?4:0}}>
                          {isUser?"You":"Advisor"}
                        </div>
                        {msg.image&&(
                          <div style={{borderRadius:12,overflow:"hidden",maxWidth:220,border:"1px solid #f0efe9"}}>
                            <img src={`data:image/jpeg;base64,${msg.image}`} style={{width:"100%",display:"block"}} alt="Uploaded document"/>
                          </div>
                        )}
                        {(msg.content||msg.isPaystub)&&(
                          <div style={{
                            maxWidth:"85%",padding:"12px 16px",borderRadius:isUser?"18px 18px 4px 18px":"18px 18px 18px 4px",
                            background:isUser?"#1a1a2e":"#f8f7f2",color:isUser?"#fff":"#1a1a2e",
                            fontSize:13,lineHeight:1.65,border:isUser?"none":"1px solid #ece9e0",
                          }}>
                            {msg.isPaystub&&!msg.image ? "Analyzing your document…"
                              : <>{renderMd(msg.content)}{msg.streaming&&<span style={{display:"inline-block",width:2,height:14,background:"#7048e8",marginLeft:2,borderRadius:1,animation:"pulse 0.8s ease-in-out infinite",verticalAlign:"middle"}}/>}</>}
                            {msg.applyIncome&&(
                              <div style={{marginTop:12,display:"flex",gap:8,flexWrap:"wrap"}}>
                                <button onClick={()=>{
                                  setData(prev=>{ const nd={...prev,monthlyIncome:msg.applyIncome}; persist(nd); debouncedSave(nd); return nd; });
                                  setAiMessages(prev=>[...prev,{role:'assistant',content:'✅ Done! Income updated to **$'+msg.applyIncome.toLocaleString()+'/mo**.',id:Date.now()}]);
                                }} style={{background:"#1a1a2e",color:"#fff",border:"none",borderRadius:12,padding:"9px 16px",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                                  ✓ Yes, update to ${msg.applyIncome.toLocaleString()}/mo
                                </button>
                                <button onClick={()=>setAiMessages(prev=>prev.filter(m=>m.id!==msg.id))}
                                  style={{background:"#f8f7f2",color:"#9e9b95",border:"1px solid #ece9e0",borderRadius:12,padding:"9px 16px",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                                  Keep current
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {aiLoading&&(
                    <div style={{display:"flex",flexDirection:"column",alignItems:"flex-start",gap:4}}>
                      <div style={{fontSize:10,fontWeight:700,color:"#bbb9b0",letterSpacing:"0.06em",textTransform:"uppercase",paddingLeft:4}}>Advisor</div>
                      <div style={{background:"#f8f7f2",border:"1px solid #ece9e0",borderRadius:"18px 18px 18px 4px",padding:"14px 18px",display:"flex",gap:5,alignItems:"center"}}>
                        {[0,1,2].map(j=>(<div key={j} style={{width:7,height:7,borderRadius:"50%",background:"#bbb9b0",animation:"pulse 1.2s ease-in-out infinite",animationDelay:`${j*0.2}s`}}/>))}
                      </div>
                    </div>
                  )}
                  <div ref={chatEndRef}/>
                </div>

                {/* Upload + camera */}
                <R style={{padding:"0 16px 8px",gap:8,borderTop:"1px solid #f8f7f2"}}>
                  <label style={{display:"flex",alignItems:"center",gap:6,background:"#f8f7f2",border:"1px solid #ece9e0",borderRadius:12,padding:"9px 13px",cursor:"pointer",fontSize:12,fontWeight:600,color:"#7048e8",flexShrink:0}}>
                    <I n="upload" s={13} c="#7048e8"/> Upload
                    <input type="file" accept="image/*,.pdf,.xlsx,.xls,.csv" onChange={handleFileUpload} style={{display:"none"}}/>
                  </label>
                  <button onClick={()=>setCameraOpen(true)}
                    style={{display:"flex",alignItems:"center",gap:6,background:"#f8f7f2",border:"1px solid #ece9e0",borderRadius:12,padding:"9px 13px",cursor:"pointer",fontSize:12,fontWeight:600,color:"#1a1a2e",flexShrink:0,fontFamily:"inherit"}}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                    Camera
                  </button>
                  {uploadedFile&&<div style={{flex:1,fontSize:11,color:"#bbb9b0",fontStyle:"italic",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{uploadedFile}</div>}
                </R>

                {/* Input — always visible, no gate */}
                <div style={{padding:"8px 16px 16px",borderTop:"1px solid #f0efe9"}}>
                  <R style={{gap:8}}>
                    <input className="inp" placeholder="Ask anything — or say 'I spent $X on Y'…" value={aiInput}
                      onChange={e=>setAiInput(e.target.value)}
                      onKeyDown={e=>e.key==="Enter"&&!e.shiftKey&&sendAiMessage(aiInput)}
                      style={{flex:1,fontSize:14}}/>
                    <button className="btn" onClick={()=>sendAiMessage(aiInput)}
                      disabled={aiLoading||!aiInput.trim()}
                      style={{padding:"13px 16px",opacity:aiLoading||!aiInput.trim()?0.4:1,borderRadius:14}}>
                      <I n="send" s={15} c="#fff"/>
                    </button>
                  </R>
                </div>
              </div>

              {/* Quick chips below after first message */}
              {aiMessages.length>0&&!aiLoading&&(
                <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                  {(suggestions.find(s=>s.cat===suggestionCat)?.prompts||[]).slice(0,3).map((s,i)=>(
                    <button key={i} onClick={()=>sendAiMessage(s)}
                      style={{background:"#fff",border:"1px solid #ece9e0",borderRadius:20,padding:"8px 14px",fontSize:12,color:"#6b6965",fontFamily:"inherit",fontWeight:500,cursor:"pointer",whiteSpace:"nowrap"}}>
                      {s.length>32?s.slice(0,32)+"…":s}
                    </button>
                  ))}
                </div>
              )}

            </C>
          )}

          {/* ══════ LEARN ══════ */}
          {tab==="learn"&&(
            <C style={{gap:16}} className="page">
              <div className="hero-card" style={{padding:26}}>
                <div className="hero-band" style={{background:"linear-gradient(90deg,#7048e8,#2f9e44)"}}/>
                <div style={{marginTop:8}}>
                  <div style={{fontSize:24,fontWeight:800,marginBottom:6}}>Financial Education 📚</div>
                  <div style={{fontSize:14,color:"#9e9b95",lineHeight:1.6}}>Everything you need to build real financial confidence — from budgeting basics to retirement planning. Tap any question to learn more, then ask the AI Advisor to go deeper.</div>
                </div>
              </div>
              {[
                {emoji:"💰",title:"Budgeting Basics",color:"#2f9e44",lessons:[
                  {q:"What is the 50/30/20 rule?",a:"Split your take-home pay into three buckets: 50% for needs (rent, food, utilities), 30% for wants (dining out, entertainment), and 20% for savings and debt repayment. It's a great starting point — adjust to fit your life."},
                  {q:"What's the difference between gross and net income?",a:"Gross income is what you earn before taxes and deductions. Net income (take-home pay) is what actually lands in your bank account. Always budget based on net income — that's what DayFlow uses too."},
                  {q:"How big should my emergency fund be?",a:"Aim for 3–6 months of essential living expenses in a high-yield savings account. Start with a $1,000 starter fund, then build toward the full amount. This protects you from job loss, medical bills, or car repairs without going into debt."},
                  {q:"How do I actually stick to a budget?",a:"Track every purchase for 30 days — awareness alone changes behavior. Automate savings on payday before you can spend it. Give yourself a small 'fun money' allowance so you don't feel deprived and quit. DayFlow's daily budget makes this simple."},
                ]},
                {emoji:"🏦",title:"401k & Employer Benefits",color:"#1971c2",lessons:[
                  {q:"How does a 401k work?",a:"A 401k is a retirement account through your employer. You contribute pre-tax money (reducing your taxable income now), it grows tax-deferred, and you pay taxes when you withdraw in retirement. In 2024 you can contribute up to $23,000/year."},
                  {q:"What is an employer match?",a:"Many employers match a percentage of what you contribute — e.g., 100% match up to 3% of your salary. That's an instant 100% return. Always contribute at least enough to get the full match. Not doing so is leaving free money on the table."},
                  {q:"Traditional 401k vs Roth 401k — what's the difference?",a:"Traditional 401k: pre-tax contributions, pay taxes on withdrawal. Roth 401k: after-tax contributions, withdrawals in retirement are tax-free. If you expect to be in a higher tax bracket later, Roth is usually better. If you need the tax break now, Traditional wins."},
                  {q:"What is vesting?",a:"Vesting determines when employer contributions officially become yours. Cliff vesting means you get 100% after a set period (e.g., 3 years). Graded vesting means you earn a portion each year. Your own contributions are always 100% yours immediately."},
                ]},
                {emoji:"📈",title:"Roth IRA vs Traditional IRA",color:"#7048e8",lessons:[
                  {q:"What is an IRA?",a:"An Individual Retirement Account (IRA) is a retirement savings account you open yourself — not tied to your employer. You can contribute up to $7,000/year in 2024 ($8,000 if 50+). There are two main types: Roth and Traditional."},
                  {q:"How does a Roth IRA work?",a:"You contribute after-tax dollars. Your money grows tax-free, and qualified withdrawals in retirement are completely tax-free. To contribute the full amount in 2024, income must be under $146,000 (single) or $230,000 (married). No required minimum distributions."},
                  {q:"How does a Traditional IRA work?",a:"Contributions may be tax-deductible (lowering your taxable income now). Money grows tax-deferred. You pay regular income tax on withdrawals in retirement. Required minimum distributions start at age 73."},
                  {q:"Which should I choose — Roth or Traditional?",a:"Simple rule: young or low tax bracket now → choose Roth (pay low taxes now, withdraw tax-free later). High tax bracket now, expect lower income in retirement → Traditional may save more. Many people do both for tax diversification."},
                  {q:"Can I have both a 401k and an IRA?",a:"Yes! Ideal order: (1) contribute to 401k up to employer match, (2) max out Roth IRA, (3) go back and max out 401k. This gives you tax diversification and flexibility in retirement."},
                ]},
                {emoji:"🏥",title:"HSA & FSA",color:"#e03131",lessons:[
                  {q:"What is an HSA?",a:"A Health Savings Account is available only with a high-deductible health plan. Contributions are pre-tax, growth is tax-free, and withdrawals for qualified medical expenses are tax-free — the 'triple tax advantage.' Funds roll over every year and never expire. You can even invest the balance."},
                  {q:"What is an FSA?",a:"A Flexible Spending Account lets you set aside pre-tax money for medical or dependent care. Main downside: most FSAs have a 'use it or lose it' rule — funds expire at year end (some plans allow a $610 rollover). Contribution limit is $3,200/year in 2024."},
                  {q:"HSA vs FSA — which is better?",a:"If you're eligible for an HSA, it's almost always better: funds roll over forever, can be invested and grow, and stay with you if you change jobs. FSA is use-it-or-lose-it and employer-tied. The downside of HSA is it requires a high-deductible health plan."},
                  {q:"What is a Dependent Care FSA?",a:"A Dependent Care FSA lets you pay for childcare, after-school programs, or elder care with pre-tax dollars — up to $5,000/year per household. For a family in the 22% tax bracket paying for daycare, this saves over $1,100/year."},
                ]},
                {emoji:"💳",title:"Debt & Credit",color:"#f08c00",lessons:[
                  {q:"Debt avalanche vs debt snowball — which is better?",a:"Avalanche: pay minimum on all debts, throw extra money at the highest interest rate first. Saves the most money mathematically. Snowball: pay minimum on all, focus on the smallest balance first. Slightly less efficient but the psychological wins keep people motivated. Both work — pick the one you'll actually stick to."},
                  {q:"How is my credit score calculated?",a:"Payment history (35%) — always pay on time. Amounts owed (30%) — keep utilization below 30%, ideally under 10%. Length of credit history (15%). Credit mix (10%). New credit (10%) — too many hard inquiries can hurt temporarily."},
                  {q:"How do I build credit from scratch?",a:"Start with a secured credit card. Use it for one small recurring bill and pay the full balance monthly. After 6–12 months you'll have a score. Then apply for a regular card. Being added as an authorized user on a family member's old account can also help you inherit their credit history."},
                ]},
                {emoji:"📊",title:"Investing Basics",color:"#2f9e44",lessons:[
                  {q:"What is an index fund?",a:"An index fund tracks a market index like the S&P 500 — the 500 largest US companies. Instead of picking individual stocks, you own a tiny slice of all of them. Very low fees and historically outperforms most actively managed funds over the long term."},
                  {q:"How does compound interest work?",a:"You earn interest on your interest. $10,000 at 7% annual return becomes $19,671 after 10 years, $38,697 after 20 years, and $76,123 after 30 years — without adding a dollar. Time in the market is more powerful than the amount you invest."},
                  {q:"What is dollar-cost averaging?",a:"Instead of investing a lump sum all at once, invest a fixed amount at regular intervals (e.g., $200/month) regardless of market conditions. When prices are low your $200 buys more shares. When prices are high, fewer. This reduces the impact of volatility and removes the temptation to time the market."},
                  {q:"What's the difference between stocks, ETFs, and mutual funds?",a:"Stock: ownership in one company — high risk/reward. ETF: a basket of stocks that trades like a stock — instant diversification, low cost. Mutual fund: similar to ETF but priced once per day, often actively managed with higher fees. Most people are best served by low-cost index ETFs."},
                ]},
              ].map(section=>(
                <LearnSection key={section.title} section={section} onAsk={(q)=>{setTab("advisor");setTimeout(()=>sendAiMessage(q),150);}}/>
              ))}
            </C>
          )}

          {/* ══════ SETTINGS ══════ */}
          {tab==="settings"&&(
            <C style={{gap:16}}>
              <div className="hero-card" style={{padding:26}}>
                <div className="hero-band" style={{background:"#1a1a2e"}}/>
                <div style={{marginTop:8}}>
                  <div className="sec-hd">Monthly take-home</div>
                  <div style={{fontSize:13,color:"#9e9b95",marginBottom:20,lineHeight:1.6}}>Your after-tax income from last month — becomes this month's pool.</div>
                  {editInc?(
                    <R style={{gap:8}}>
                      <input className="inp" type="number" placeholder="e.g. 5000" value={incStr} onChange={e=>setIncStr(e.target.value)} autoFocus style={{flex:1}}
                        onKeyDown={e=>{if(e.key==="Enter"){const v=parseFloat(incStr);if(!isNaN(v))upd({monthlyIncome:v});setEditInc(false);}}}/>
                      <button className="btn" onClick={()=>{const v=parseFloat(incStr);if(!isNaN(v))upd({monthlyIncome:v});setEditInc(false);}}>Save</button>
                    </R>
                  ):(
                    <R style={{justifyContent:"space-between",alignItems:"center"}}>
                      <C>
                        <div style={{fontSize:44,fontWeight:300,letterSpacing:"-0.05em",lineHeight:1}}>{fmtFull(data.monthlyIncome)}</div>
                        <div style={{fontSize:12,color:"#bbb9b0",marginTop:6}}>{fmtFull(myAllow)}/day · {fmtFull(myAllow/24)}/hr</div>
                      </C>
                      <button className="btn-ghost" onClick={()=>{setIncStr(data.monthlyIncome);setEditInc(true);}}>Edit</button>
                    </R>
                  )}
                </div>
              </div>

              <div className="card" style={{padding:24}}>
                <div className="sec-hd">Full breakdown</div>
                {data.householdMode&&(data.members||[]).length>0 ? (
                  <>
                    {/* Household breakdown */}
                    {[
                      {l:"Your income",           v:data.monthlyIncome,       c:"#2f9e44", s:"+"},
                      ...(data.members||[]).map(m=>({l:`${m.name}'s income`, v:parseFloat(m.monthlyIncome)||0, c:"#2f9e44", s:"+", indent:true})),
                      {l:"Combined income",        v:householdIncome,          c:"#1a1a2e", bold:true, sep:true},
                      {l:"Your bills",             v:totalBills(data.recurringPayments), c:"#e03131", s:"−"},
                      ...(data.members||[]).filter(m=>(m.recurringPayments||[]).length>0).map(m=>({l:`${m.name}'s bills`, v:totalBills(m.recurringPayments||[]), c:"#e03131", s:"−", indent:true})),
                      {l:"Total bills",            v:householdBills,           c:"#e03131", bold:true, sep:true},
                      {l:"Household pool",         v:myPoolReal,               c:"#1a1a2e", bold:true, sep:true},
                      {l:`Daily allowance (÷${DIM})`, v:myAllow,              c:"#9e9b95", italic:true},
                    ].map(({l,v,c,s,bold,sep,italic,indent})=>(
                      <R key={l} style={{justifyContent:"space-between",padding:"9px 0",paddingLeft:indent?12:0,borderTop:sep?"1px solid #f0efe9":"none",marginTop:sep?4:0,borderLeft:indent?`3px solid #f0efe9`:"none"}}>
                        <span style={{fontSize:13,color:indent?"#bbb9b0":"#9e9b95",fontStyle:italic?"italic":"normal"}}>{l}</span>
                        <span style={{fontSize:13,fontWeight:bold?800:500,color:c}}>{s||""}{fmtFull(v)}</span>
                      </R>
                    ))}
                  </>
                ):(
                  [
                    {l:"Monthly income",  v:data.monthlyIncome,                c:"#2f9e44",s:"+"},
                    {l:"Monthly bills",   v:totalBills(data.recurringPayments), c:"#e03131",s:"−"},
                    {l:"Spendable pool",  v:myPoolReal,                         c:"#1a1a2e",bold:true,sep:true},
                    {l:`Daily allowance (÷${DIM})`,v:myAllow,                  c:"#9e9b95",italic:true},
                  ].map(({l,v,c,s,bold,sep,italic})=>(
                    <R key={l} style={{justifyContent:"space-between",padding:"10px 0",borderTop:sep?"1px solid #f0efe9":"none",marginTop:sep?4:0}}>
                      <span style={{fontSize:13,color:"#9e9b95",fontStyle:italic?"italic":"normal"}}>{l}</span>
                      <span style={{fontSize:14,fontWeight:bold?800:500,color:c}}>{s}{fmtFull(v)}</span>
                    </R>
                  ))
                )}
              </div>

              {/* Monthly income history */}
              {Object.keys(data.monthlyIncomes||{}).length > 0 && (
                <div className="card" style={{padding:22}}>
                  <R style={{justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                    <div className="sec-hd" style={{marginBottom:0}}>Monthly income history</div>
                    <div style={{fontSize:11,color:"#bbb9b0"}}>Tell the AI to update any month</div>
                  </R>
                  {Object.entries(data.monthlyIncomes||{})
                    .sort(([a],[b]) => b.localeCompare(a))
                    .slice(0,12)
                    .map(([month, amount]) => {
                      const d = new Date(month+'-01');
                      const label = d.toLocaleDateString('en-US',{month:'long',year:'numeric'});
                      const isCurrent = month === thisMonth();
                      return (
                        <R key={month} style={{justifyContent:'space-between',padding:'9px 0',borderBottom:'1px solid #f8f7f2'}}>
                          <R style={{gap:8}}>
                            <div style={{width:8,height:8,borderRadius:'50%',background:isCurrent?'#2f9e44':'#e0ddd4',flexShrink:0,marginTop:4}}/>
                            <span style={{fontSize:13,color:'#6b6864'}}>{label}{isCurrent?' (current)':''}</span>
                          </R>
                          <span style={{fontSize:13,fontWeight:700,color:'#1a1a2e'}}>{fmtFull(amount)}/mo</span>
                        </R>
                      );
                    })}
                  <div style={{fontSize:11,color:'#bbb9b0',marginTop:12,fontStyle:'italic'}}>
                    Say "My January income was $3,800" in the AI Advisor to add past months
                  </div>
                </div>
              )}

              <div className="card" style={{padding:22,borderColor:"#ffc9c9",borderWidth:1.5}}>
                <div style={{fontSize:13,fontWeight:700,color:"#e03131",marginBottom:6}}>Danger zone</div>
                <div style={{fontSize:13,color:"#bbb9b0",marginBottom:16}}>Clear all spending history. Income and recurring stay.</div>
                <button className="btn-ghost" style={{borderColor:"#ffc9c9",color:"#e03131",fontSize:12}}
                  onClick={()=>{if(window.confirm("Clear all spending history?"))upd({dailyEntries:{},plaidTransactions:[]});}}>
                  Clear history
                </button>
              </div>
            </C>
          )}
        </div>

        {/* ── Nav ──────────────────────────────────────────────────────────────── */}
        {/* ── Feedback Modal ────────────────────────────────────────────── */}
        {showFeedback&&(
          <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",zIndex:9999,display:"flex",alignItems:"flex-end",justifyContent:"center",animation:"fadeIn 0.2s ease"}} onClick={()=>setShowFeedback(false)}>
            <div style={{background:"#fff",borderRadius:"28px 28px 0 0",width:"100%",maxWidth:560,padding:"28px 20px 44px",animation:"slideUp 0.3s ease"}} onClick={e=>e.stopPropagation()}>
              <div style={{width:40,height:4,background:"#e0ddd4",borderRadius:2,margin:"0 auto 20px"}}/>

              {feedbackStep==='thanks' ? (
                <div style={{textAlign:"center",padding:"20px 0"}}>
                  <div style={{fontSize:48,marginBottom:16}}>🙏</div>
                  <div style={{fontSize:22,fontWeight:800,marginBottom:8}}>Thank you!</div>
                  <div style={{fontSize:14,color:"#9e9b95",lineHeight:1.6,marginBottom:24}}>Your feedback helps us make DayFlow better for everyone. We review every submission weekly.</div>
                  <button onClick={()=>setShowFeedback(false)} style={{background:"#1a1a2e",color:"#fff",border:"none",borderRadius:14,padding:"14px 32px",fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>Done</button>
                </div>
              ) : (
                <>
                  <div style={{fontSize:20,fontWeight:800,marginBottom:4}}>Share Feedback 💬</div>
                  <div style={{fontSize:13,color:"#9e9b95",marginBottom:20}}>Tell us what's working, what's broken, or what you wish DayFlow could do.</div>

                  {/* Star rating */}
                  <div style={{marginBottom:18}}>
                    <div style={{fontSize:12,fontWeight:700,color:"#bbb9b0",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:10}}>How would you rate DayFlow?</div>
                    <div style={{display:"flex",gap:8}}>
                      {[1,2,3,4,5].map(s=>(
                        <button key={s} onClick={()=>setFeedbackRating(s)}
                          style={{fontSize:28,background:"none",border:"none",cursor:"pointer",opacity:s<=feedbackRating?1:0.25,transform:s<=feedbackRating?"scale(1.15)":"scale(1)",transition:"all 0.15s"}}>
                          ⭐
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Category */}
                  <div style={{marginBottom:16}}>
                    <div style={{fontSize:12,fontWeight:700,color:"#bbb9b0",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:10}}>What's this about?</div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                      {[
                        {id:"general",    label:"General"},
                        {id:"bug",        label:"🐛 Bug"},
                        {id:"feature",    label:"✨ Feature idea"},
                        {id:"advisor",    label:"🤖 AI Advisor"},
                        {id:"design",     label:"🎨 Design"},
                        {id:"onboarding", label:"👋 Onboarding"},
                        {id:"billing",    label:"💳 Billing"},
                      ].map(c=>(
                        <button key={c.id} onClick={()=>setFeedbackCat(c.id)}
                          style={{padding:"7px 14px",borderRadius:20,border:"1.5px solid",borderColor:feedbackCat===c.id?"#1a1a2e":"#ece9e0",background:feedbackCat===c.id?"#1a1a2e":"#f8f7f2",color:feedbackCat===c.id?"#fff":"#6b6965",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit",transition:"all 0.15s"}}>
                          {c.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Text */}
                  <textarea value={feedbackText} onChange={e=>setFeedbackText(e.target.value)}
                    placeholder="Tell us anything — what you love, what's frustrating, what you wish existed..."
                    style={{width:"100%",minHeight:100,padding:"14px",borderRadius:14,border:"1.5px solid #ece9e0",fontSize:14,fontFamily:"inherit",resize:"none",outline:"none",lineHeight:1.6,marginBottom:16,boxSizing:"border-box"}}/>

                  <button onClick={submitFeedback} disabled={feedbackBusy||feedbackRating===0||!feedbackText.trim()}
                    style={{width:"100%",background:"#1a1a2e",color:"#fff",border:"none",borderRadius:14,padding:"15px",fontSize:15,fontWeight:700,cursor:"pointer",fontFamily:"inherit",opacity:feedbackBusy||feedbackRating===0||!feedbackText.trim()?0.4:1}}>
                    {feedbackBusy?"Sending…":"Send feedback →"}
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* ── Toast ───────────────────────────────────────────────────── */}
        {toast&&(
          <div style={{position:"fixed",bottom:100,left:"50%",transform:"translateX(-50%)",background:"#1a1a2e",color:"#fff",borderRadius:20,padding:"10px 20px",fontSize:13,fontWeight:700,zIndex:9997,animation:"fadeIn 0.2s ease",boxShadow:"0 4px 20px rgba(0,0,0,0.2)",whiteSpace:"nowrap",pointerEvents:"none"}}>
            ✓ {toast.msg}
          </div>
        )}

        <div className="nav-bar">
          <R style={{maxWidth:560,margin:"0 auto",justifyContent:"space-around",padding:"6px 4px 20px"}}>
            {TABS.map(t=>(
              <button key={t.id} className={`nav-btn${tab===t.id?" on":""}`} onClick={()=>{setTab(t.id);setMenuOpen(false);}}>
                <I n={t.icon} s={21} c={tab===t.id?"#1a1a2e":"#ccc9c0"}/>
                <span className="nav-lbl">{t.label}</span>
                <div className="nav-dot"/>
              </button>
            ))}
            {/* More button */}
            <button className={`nav-btn${menuOpen?" on":""}`} onClick={()=>setMenuOpen(p=>!p)}>
              <I n="more" s={21} c={menuOpen?"#1a1a2e":"#ccc9c0"}/>
              <span className="nav-lbl">More</span>
              <div className="nav-dot"/>
            </button>
          </R>
        </div>

        {/* ── More menu ─────────────────────────────────────────────────────────── */}
        {menuOpen&&(
          <>
            {/* Backdrop */}
            <div onClick={()=>setMenuOpen(false)} style={{position:"fixed",inset:0,zIndex:40}}/>
            {/* Menu tray — anchored to bottom, no transform centering */}
            <div style={{
              position:"fixed",
              bottom:90,
              left:20,
              right:20,
              maxWidth:520,
              margin:"0 auto",
              zIndex:45,
              background:"#fff",
              borderRadius:24,
              boxShadow:"0 -2px 0 rgba(0,0,0,0.04),0 8px 40px rgba(0,0,0,0.16)",
              border:"1px solid #f0efe9",
              overflow:"hidden",
              transformOrigin:"bottom center",
              animation:"menuPop 0.2s cubic-bezier(.34,1.56,.64,1)",
            }}>
              {[
                {id:"bank",    icon:"bank",  label:"Bank connections",      sub:"Link your bank account"},
                {id:"learn",   icon:"heart", label:"Financial Education",    sub:"Guides on saving, investing & more"},
                {id:"settings",icon:"gear",  label:"Setup",                  sub:"Income, pool & preferences"},
              ].map((item,i)=>(
                <button key={item.id} onClick={()=>{setTab(item.id);setMenuOpen(false);}}
                  style={{
                    width:"100%",display:"flex",alignItems:"center",gap:14,
                    padding:"18px 20px",background:"none",border:"none",
                    borderTop:i>0?"1px solid #f0efe9":"none",
                    cursor:"pointer",fontFamily:"inherit",
                    transition:"background 0.15s",textAlign:"left",
                  }}
                  onMouseEnter={e=>e.currentTarget.style.background="#f8f7f2"}
                  onMouseLeave={e=>e.currentTarget.style.background="none"}
                >
                  <div style={{width:42,height:42,borderRadius:13,background:"#f0efe9",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                    <I n={item.icon} s={20} c="#1a1a2e"/>
                  </div>
                  <C style={{gap:2,flex:1}}>
                    <div style={{fontSize:15,fontWeight:700,color:"#1a1a2e"}}>{item.label}</div>
                    <div style={{fontSize:12,color:"#9e9b95"}}>{item.sub}</div>
                  </C>
                  <I n="chevron" s={16} c="#ccc9c0"/>
                </button>
              ))}
              {/* Feedback button */}
              <button onClick={()=>{setMenuOpen(false);setFeedbackStep('form');setFeedbackRating(0);setFeedbackText('');setFeedbackCat('general');setShowFeedback(true);}}
                style={{width:"100%",display:"flex",alignItems:"center",gap:14,padding:"18px 20px",background:"none",border:"none",borderTop:"1px solid #f0efe9",cursor:"pointer",fontFamily:"inherit",transition:"background 0.15s",textAlign:"left"}}
                onMouseEnter={e=>e.currentTarget.style.background="#f8f7f2"}
                onMouseLeave={e=>e.currentTarget.style.background="none"}>
                <div style={{width:42,height:42,borderRadius:13,background:"#fff3e0",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontSize:20}}>💬</div>
                <C style={{gap:2,flex:1}}>
                  <div style={{fontSize:15,fontWeight:700,color:"#1a1a2e"}}>Share Feedback</div>
                  <div style={{fontSize:12,color:"#9e9b95"}}>Help us improve DayFlow</div>
                </C>
                <I n="chevron" s={16} c="#ccc9c0"/>
              </button>
            </div>
          </>
        )}

        {/* ── Plaid modal ───────────────────────────────────────────────────────── */}
        {modal&&(
          <div className="overlay" onClick={e=>e.target===e.currentTarget&&!loading&&(setModal(false),setStep(0),setSelBank(null))}>
            <div className="sheet">
              <div className="handle"/>
              {loading?(
                <C style={{alignItems:"center",padding:"32px 0 16px",gap:16}}>
                  <div style={{width:48,height:48,border:"3px solid #f0efe9",borderTopColor:"#1a1a2e",borderRadius:"50%"}} className="spin"/>
                  <div style={{fontSize:17,fontWeight:800,letterSpacing:"-0.02em"}}>Connecting to {selBank}…</div>
                  <div style={{fontSize:14,color:"#bbb9b0",textAlign:"center"}}>Securely syncing your transactions</div>
                </C>
              ):step===0?(
                <>
                  <div style={{fontSize:20,fontWeight:800,letterSpacing:"-0.03em",marginBottom:6}}>Choose your bank</div>
                  <div style={{fontSize:14,color:"#9e9b95",marginBottom:22}}>Select your institution to connect securely.</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:20}}>
                    {BANKS.map(b=>(
                      <button key={b} className={`bank-opt${selBank===b?" on":""}`} onClick={()=>setSelBank(b)}>
                        <div style={{width:30,height:30,borderRadius:9,background:selBank===b?"rgba(255,255,255,0.15)":"#f0efe9",display:"flex",alignItems:"center",justifyContent:"center"}}>
                          <I n="bank" s={15} c={selBank===b?"#fff":"#9e9b95"}/>
                        </div>
                        {b}
                      </button>
                    ))}
                  </div>
                  <button className="btn" onClick={()=>selBank&&setStep(1)} style={{width:"100%",justifyContent:"center",borderRadius:16,padding:"16px",fontSize:15,opacity:selBank?1:0.35,boxShadow:"0 4px 16px rgba(26,26,46,0.25)"}}>Continue →</button>
                </>
              ):(
                <>
                  <div style={{fontSize:20,fontWeight:800,letterSpacing:"-0.03em",marginBottom:6}}>Connect {selBank}</div>
                  <div style={{fontSize:14,color:"#9e9b95",marginBottom:22,lineHeight:1.6}}>In production, Plaid's secure hosted UI appears here — DayFlow never touches your credentials.</div>
                  <C style={{background:"#f8f7f2",borderRadius:18,padding:20,gap:10,marginBottom:20}}>
                    <div style={{fontSize:11,fontWeight:700,color:"#bbb9b0",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:4}}>Plaid Sandbox</div>
                    <input className="inp" placeholder="Username" defaultValue="user_good"/>
                    <input className="inp" type="password" placeholder="Password" defaultValue="pass_good"/>
                  </C>
                  <R style={{gap:8}}>
                    <button className="btn-ghost" style={{flex:1,justifyContent:"center"}} onClick={()=>setStep(0)}>← Back</button>
                    <button className="btn" style={{flex:2,justifyContent:"center",borderRadius:16,padding:"16px",fontSize:15,boxShadow:"0 4px 16px rgba(26,26,46,0.25)"}} onClick={()=>connectPlaid(selBank)}>Connect securely</button>
                  </R>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
