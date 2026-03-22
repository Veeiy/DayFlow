import { useState, useEffect, useRef } from "react";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell, ComposedChart, Area } from "recharts";
import { supabase } from "./supabase.js";

// ─── Storage ────────────────────────────────────────────────────────────────
const STORE_KEY = "dayflow_v3";
const DEFAULTS  = {
  monthlyIncome: 0,
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
  const [menuOpen,setMenuOpen]           = useState(false);
  const [aiMessages,setAiMessages] = useState([]);
  const [aiInput,setAiInput]       = useState("");
  const [aiLoading,setAiLoading]   = useState(false);
  const [uploadedFile,setUploadedFile] = useState(null);
  const [uploadPreview,setUploadPreview] = useState(null);
  const [analyzing,setAnalyzing]   = useState(false);
  const chatEndRef = useRef(null);

  // ── Auth state ──────────────────────────────────────────────────────────────
  const [user,setUser]           = useState(null);
  const [authLoading,setAuthLoading] = useState(true);
  const [authScreen,setAuthScreen]   = useState("login"); // login | signup | forgot
  const [authEmail,setAuthEmail]     = useState("");
  const [authPass,setAuthPass]       = useState("");
  const [authError,setAuthError]     = useState("");
  const [authBusy,setAuthBusy]       = useState(false);
  const [syncBusy,setSyncBusy]       = useState(false);

  // ── Auth listener ───────────────────────────────────────────────────────────
  useEffect(()=>{
    supabase.auth.getSession().then(({data:{session}})=>{
      setUser(session?.user ?? null);
      setAuthLoading(false);
      if (session?.user) loadFromSupabase(session.user.id);
    });
    const {data:{subscription}} = supabase.auth.onAuthStateChange((_,session)=>{
      setUser(session?.user ?? null);
      if (session?.user) loadFromSupabase(session.user.id);
    });
    return ()=>subscription.unsubscribe();
  },[]);

  // ── Load user data from Supabase ────────────────────────────────────────────
  const loadFromSupabase = async (userId) => {
    try {
      // Load settings
      const {data:settings} = await supabase.from("user_settings").select("*").eq("user_id",userId).single();
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
        recurringPayments: (recurring||[]).map(r=>({id:r.id,name:r.name,amount:r.amount,frequency:r.frequency,category:r.category,dueDay:r.due_day})),
        dailyEntries: entriesMap,
        members: (members||[]).map(m=>({id:m.id,name:m.name,color:m.color,monthlyIncome:m.monthly_income,recurringPayments:[]})),
        plan: settings?.plan ?? "free",
      };
      setData(newData);
      persist(newData);
    } catch(e) {
      console.log("Load error:", e);
    }
  };

  // ── Save to Supabase ────────────────────────────────────────────────────────
  const saveToSupabase = async (newData, userId) => {
    if (!userId) return;
    try {
      // Upsert settings
      await supabase.from("user_settings").upsert({
        user_id: userId,
        monthly_income: newData.monthlyIncome,
        plan: newData.plan ?? "free",
        updated_at: new Date().toISOString(),
      });
      // Upsert today's daily entry
      const today = todayKey();
      const todayEntry = newData.dailyEntries[today];
      if (todayEntry) {
        await supabase.from("daily_entries").upsert({
          user_id: userId,
          date: today,
          transactions: todayEntry.transactions || [],
        });
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

  const upd = (patch) => {
    const n = {...data,...patch};
    setData(n);
    persist(n);
    if (user) saveToSupabase(n, user.id);
  };

  const TODAY      = todayKey();
  const entry      = data.dailyEntries[TODAY]||{transactions:[]};

  // Household-aware totals — combine owner + all members
  const allMembers   = data.householdMode ? data.members : [];
  const memberIncome = allMembers.reduce((s,m)=>s+(parseFloat(m.monthlyIncome)||0), 0);
  const memberBills  = allMembers.reduce((s,m)=>s+totalBills(m.recurringPayments||[]), 0);
  const householdIncome   = data.monthlyIncome + memberIncome;
  const householdBills    = totalBills(data.recurringPayments) + memberBills;

  const myPool     = calcPool(householdIncome, []);  // pass 0 bills since we subtract manually
  const myPoolReal = householdIncome - householdBills;
  const myAllow    = calcDaily(myPoolReal);
  const ptx        = data.plaidConnected ? data.plaidTransactions : [];
  const monthSpent = calcMonthSpent(data.dailyEntries, ptx);
  const daySpent   = calcDaySpent(entry, ptx);
  const todayLeft  = myAllow - daySpent;
  const poolLeft   = myPoolReal - monthSpent;
  const pctDay     = myAllow > 0 ? daySpent / myAllow : 0;
  const dLeft      = DIM - dayOfMonth() + 1;
  const over       = todayLeft < 0;
  // Dynamic accent: green=on track, amber=80%+, red=over
  const accent     = over ? "#e03131" : pctDay > 0.8 ? "#f08c00" : "#2f9e44";
  const accentBg   = over ? "#fff5f5" : pctDay > 0.8 ? "#fff9db" : "#ebfbee";
  const needsSetup = data.monthlyIncome === 0;

  const allTodayTx = [...(entry.transactions||[]).map(t=>({...t,source:"manual"})), ...ptx.filter(t=>t.date===TODAY)];

  const addTx = () => {
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
    if (!newRec.name.trim()||!newRec.amount) return;
    upd({recurringPayments:[...data.recurringPayments,{id:Date.now(),name:newRec.name.trim(),amount:parseFloat(newRec.amount),frequency:newRec.frequency,category:newRec.category,dueDay:parseInt(newRec.dueDay)||1}]});
    setNewRec({name:"",amount:"",frequency:"monthly",category:newRec.category,dueDay:1});
  };
  const connectPlaid = bank => {
    setLoading(true);
    setTimeout(()=>{ upd({plaidConnected:true,bankName:bank,plaidTransactions:MOCK_PLAID}); setLoading(false); setModal(false); setStep(0); setSelBank(null); setTab("today"); }, 2000);
  };

  const allDayKeys  = new Set([...Object.keys(data.dailyEntries),...ptx.map(t=>t.date)]);
  const historyDays = [...allDayKeys].sort((a,b)=>b.localeCompare(a)).slice(0,30);

  // ── AI Advisor helpers ────────────────────────────────────────────────────
  const buildFinancialContext = () => `
You are a friendly, knowledgeable financial advisor embedded in DayFlow — a daily spending tracker.
The user's financial snapshot:
- Monthly income (take-home): ${fmtFull(data.monthlyIncome)}${data.householdMode&&(data.members||[]).length>0?`\n- Household members: ${(data.members||[]).map(m=>`${m.name} (${fmtFull(parseFloat(m.monthlyIncome)||0)}/mo)`).join(", ")}\n- Combined household income: ${fmtFull(householdIncome)}`:""}
- Monthly recurring expenses: ${fmtFull(householdBills)}
- Spendable pool this month: ${fmtFull(myPoolReal)}
- Daily allowance: ${fmtFull(myAllow)} (pool ÷ ${DIM} days)
- Spent so far this month: ${fmtFull(monthSpent)}
- Pool remaining: ${fmtFull(poolLeft)}
- Day ${dayOfMonth()} of ${DIM}
- Recurring expenses: ${data.recurringPayments.length > 0 ? data.recurringPayments.map(p=>`${p.name} (${fmtFull(p.amount)}/${p.frequency}, due day ${p.dueDay||1})`).join(", ") : "none logged"}${data.householdMode&&(data.members||[]).length>0?`\n- Household bills: ${(data.members||[]).flatMap(m=>(m.recurringPayments||[]).map(r=>`${m.name}: ${r.name} (${fmtFull(r.amount)}/${r.frequency})`)).join(", ")}`:""}

Your role: help the user understand their finances, identify patterns, give actionable advice, and make them feel financially literate — not judged. Be warm, specific, and concrete. Use their actual numbers. Keep responses concise but genuinely useful. Never be preachy.`;

  const sendAiMessage = async (messageText, imageData = null) => {
    if (!messageText.trim() && !imageData) return;
    const userMsg = { role: "user", content: messageText, image: imageData, id: Date.now() };
    const updatedMessages = [...aiMessages, userMsg];
    setAiMessages(updatedMessages);
    setAiInput("");
    setAiLoading(true);
    try {
      const apiMessages = updatedMessages.map(m => {
        if (m.image) {
          return { role: m.role, content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: m.image } },
            { type: "text", text: m.content || "Please analyze this document." }
          ]};
        }
        return { role: m.role, content: m.content };
      });
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": import.meta.env.VITE_ANTHROPIC_KEY,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system: buildFinancialContext(),
          messages: apiMessages,
        }),
      });
      const result = await res.json();
      const reply = result.content?.[0]?.text || "Sorry, I couldn't process that.";
      setAiMessages(prev => [...prev, { role: "assistant", content: reply, id: Date.now() }]);
    } catch {
      setAiMessages(prev => [...prev, { role: "assistant", content: "Something went wrong. Please try again.", id: Date.now() }]);
    }
    setAiLoading(false);
  };

  const analyzePaystub = async (base64, mediaType) => {
    setAnalyzing(true);
    const prompt = `This is my paystub or financial document. Please:
1. Extract the key numbers: gross pay, net pay, all deductions (taxes, insurance, 401k etc)
2. Explain what each deduction means in plain English
3. Calculate what percentage of gross pay I actually take home
4. Compare my take-home to my logged income of ${fmtFull(data.monthlyIncome)}/mo — do they match?
5. Give me 2-3 specific, actionable insights about what I'm seeing
Format your response clearly with sections. Be specific with dollar amounts.`;
    const userMsg = { role: "user", content: prompt, image: base64, id: Date.now(), isPaystub: true };
    setAiMessages(prev => [...prev, userMsg]);
    setAiLoading(true);
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": import.meta.env.VITE_ANTHROPIC_KEY,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system: buildFinancialContext(),
          messages: [{
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
              { type: "text", text: prompt }
            ]
          }]
        }),
      });
      const result = await res.json();
      const reply = result.content?.[0]?.text || "Couldn't analyze the document.";
      setAiMessages(prev => [...prev, { role: "assistant", content: reply, id: Date.now() }]);
    } catch {
      setAiMessages(prev => [...prev, { role: "assistant", content: "Couldn't analyze the file. Try a clearer image.", id: Date.now() }]);
    }
    setAiLoading(false);
    setAnalyzing(false);
  };

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const result = ev.target.result;
      const base64 = result.split(",")[1];
      const mediaType = file.type || "image/jpeg";
      setUploadedFile(file.name);
      setUploadPreview(result);
      analyzePaystub(base64, mediaType);
    };
    reader.readAsDataURL(file);
  };

  // Auto-scroll chat
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [aiMessages]);

  // Suggested prompts seeded with user's actual data
  const suggestions = [
    `Where is most of my money going each month?`,
    `Am I on track to stay in budget this month?`,
    `How can I increase my daily allowance?`,
    `What's eating up my pool the fastest?`,
    `Give me a simple plan to save ${fmt(myPoolReal * 0.1)} this month`,
  ];

  const statusMsg = over
    ? `${fmtFull(Math.abs(todayLeft))} over today's limit`
    : pctDay > 0.8
    ? `Almost at your limit — ${fmtFull(todayLeft)} left`
    : `You're on track — ${fmtFull(todayLeft)} free today`;

  // ── Auth loading ────────────────────────────────────────────────────────────
  if (authLoading) return (
    <div style={{minHeight:"100vh",background:"#f0efe9",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Plus Jakarta Sans',sans-serif"}}>
      <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:16}}>
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
          <rect width="48" height="48" rx="14" fill="#1a1a2e"/>
          <path d="M6 24 Q12 12 18 24 Q24 36 30 24 Q36 12 42 24" stroke="rgba(255,255,255,0.2)" strokeWidth="2.5" strokeLinecap="round" fill="none"/>
          <path d="M6 24 Q12 12 18 24 Q24 36 30 24" stroke="#fff" strokeWidth="3" strokeLinecap="round" fill="none"/>
          <circle cx="30" cy="24" r="4" fill="#2f9e44"/>
        </svg>
        <div style={{fontSize:13,color:"#9e9b95"}}>Loading…</div>
      </div>
    </div>
  );

  // ── Auth screen ─────────────────────────────────────────────────────────────
  if (!user) return (
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
        <div style={{textAlign:"center",marginTop:20,fontSize:12,color:"#bbb9b0",lineHeight:1.6}}>
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
                <button className="btn" style={{padding:"9px 16px",fontSize:12,borderRadius:12}} onClick={()=>setTab("settings")}>
                  Get started →
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
                  <input className="inp" placeholder={newTx.type==="expense"?"What did you spend on?":"What came in?"} value={newTx.label}
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
            const now=new Date(), yr=now.getFullYear(), mo=now.getMonth(), dim=DIM, todayDom=dayOfMonth(now);
            const firstDow = new Date(yr,mo,1).getDay();
            const dayData = {};
            for (let d=1;d<=dim;d++){
              const key=`${yr}-${String(mo+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
              const e=data.dailyEntries[key]||{transactions:[]};
              const spent = calcDaySpent(e, ptx, key);
              const hasTx = spent>0||(e.transactions||[]).length>0;
              dayData[d]  = {spent,net:myAllow-spent,hasTx,key};
            }
            const savedDays  = Object.values(dayData).filter(d=>d.hasTx&&d.net>0&&d.key<=TODAY).length;
            const totalSaved = Object.values(dayData).filter(d=>d.hasTx&&d.net>0&&d.key<=TODAY).reduce((s,d)=>s+d.net,0);
            const selKey   = selDay ? dayData[selDay]?.key : null;
            const selEntry = selKey ? (data.dailyEntries[selKey]||{transactions:[]}) : null;
            const selPlaid = selKey ? ptx.filter(t=>t.date===selKey) : [];
            const selTx    = selEntry ? [...(selEntry.transactions||[]).map(t=>({...t,source:"manual"})),...selPlaid] : [];
            const selSpent = selDay  ? dayData[selDay].spent : 0;
            const selNet   = selDay  ? dayData[selDay].net   : 0;
            const DOW = ["Su","Mo","Tu","We","Th","Fr","Sa"];
            const moPrefix = `${yr}-${String(mo+1).padStart(2,"0")}`;

            return (
              <C style={{gap:16}}>
                {/* Summary */}
                <div className="card" style={{padding:24}}>
                  <R style={{gap:0,marginBottom:18}}>
                    {[{l:"Pool",v:myPoolReal,c:"#1a1a2e"},{l:"Spent",v:monthSpent,c:"#e03131"},{l:"Left",v:poolLeft,c:poolLeft>=0?"#2f9e44":"#e03131"}].map(({l,v,c},i)=>(
                      <C key={l} style={{flex:1,paddingLeft:i>0?16:0,paddingRight:i<2?16:0,borderRight:i<2?"1px solid #f0efe9":"none",gap:3}}>
                        <div style={{fontSize:11,color:"#bbb9b0",fontWeight:700}}>{l}</div>
                        <div style={{fontSize:24,fontWeight:300,color:c,letterSpacing:"-0.03em"}}>{fmt(v)}</div>
                      </C>
                    ))}
                  </R>
                  <div className="prog-track">
                    <div className="prog-fill" style={{width:`${Math.min(100,myPoolReal>0?(monthSpent/myPoolReal)*100:0)}%`,background:poolLeft<0?"#e03131":"#1a1a2e"}}/>
                  </div>
                  <R style={{justifyContent:"space-between",marginTop:6}}>
                    <span style={{fontSize:11,color:"#bbb9b0"}}>Day {dayOfMonth()}</span>
                    <span style={{fontSize:11,color:"#bbb9b0"}}>{Math.round(myPoolReal>0?(monthSpent/myPoolReal)*100:0)}% used</span>
                    <span style={{fontSize:11,color:"#bbb9b0"}}>Day {DIM}</span>
                  </R>
                </div>

                {/* ── Spending flow chart ── */}
                {(()=>{
                  // Build chart data — one entry per day of month so far
                  let runningPool = myPoolReal;
                  const chartData = Array.from({length:todayDom}, (_,i)=>{
                    const d   = i+1;
                    const dd  = dayData[d];
                    const spent = dd?.spent ?? 0;
                    runningPool -= spent;
                    return {
                      day:    d,
                      label:  `${d}`,
                      spent:  parseFloat(spent.toFixed(2)),
                      allow:  parseFloat(myAllow.toFixed(2)),
                      pool:   parseFloat(Math.max(0, runningPool + spent).toFixed(2)), // pool at START of day
                      over:   spent > myAllow,
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
                              avg {fmtFull(avgSpend)}/day · allowance {fmtFull(myAllow)}/day
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
                              <ReferenceLine y={myAllow} stroke="#1a1a2e" strokeDasharray="4 4" strokeWidth={1.5} strokeOpacity={0.4}/>
                              {/* Spending bars — green under, red over */}
                              <Bar dataKey="spent" radius={[5,5,0,0]} maxBarSize={28}>
                                {chartData.map((entry,i)=>(
                                  <Cell key={i} fill={entry.over?"#fca5a5":entry.spent>myAllow*0.8?"#fcd34d":"#86efac"}
                                    stroke={entry.over?"#e03131":entry.spent>myAllow*0.8?"#f59e0b":"#2f9e44"}
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
                        let pool = myPoolReal;
                        const poolData = Array.from({length:todayDom}, (_,i)=>{
                          const d     = i+1;
                          const spent = dayData[d]?.spent ?? 0;
                          pool       -= spent;
                          const pct   = myPoolReal > 0 ? (pool / myPoolReal) * 100 : 0;
                          return { day:d, label:`${d}`, pool:parseFloat(pool.toFixed(2)), pct:parseFloat(pct.toFixed(1)) };
                        });
                        // Project ideal drain (spending exactly allowance each day)
                        const idealData = Array.from({length:DIM}, (_,i)=>({
                          day:i+1, label:`${i+1}`, ideal: parseFloat((myPoolReal - myAllow*(i+1)).toFixed(2))
                        }));

                        const PoolTip = ({active,payload,label})=>{
                          if(!active||!payload?.length) return null;
                          const pool = payload.find(p=>p.dataKey==="pool")?.value??0;
                          const pct  = myPoolReal>0?(pool/myPoolReal*100):0;
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
                                <XAxis dataKey="label" tick={{fontSize:10,fill:"#bbb9b0",fontFamily:"Plus Jakarta Sans"}} axisLine={false} tickLine={false} interval={Math.floor(DIM/6)}/>
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
                      <div className="sec-hd" style={{marginBottom:0}}>{now.toLocaleDateString("en-US",{month:"long",year:"numeric"})}</div>
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
                      const d=i+1, dd=dayData[d];
                      const isPast=d<todayDom, isTday=d===todayDom, isFut=d>todayDom;
                      const saved=isPast&&dd.hasTx&&dd.net>0, ovr=isPast&&dd.hasTx&&dd.net<0;
                      const isSel=selDay===d;
                      let bg="transparent",tc="#ccc9c0",bc="transparent";
                      if (isTday)      {bg="#1a1a2e";tc="#fff";bc="#1a1a2e";}
                      else if (isSel)  {bg="#f0efe9";tc="#1a1a2e";bc="#1a1a2e";}
                      else if (saved)  {bg="#ebfbee";tc="#2f9e44";bc="#b2f2bb";}
                      else if (ovr)    {bg:"#fff5f5";tc="#e03131";bc="#ffc9c9";}
                      else if (isPast) {bg="#f8f7f2";tc="#ccc9c0";bc="rgba(0,0,0,0.04)";}
                      else if (isFut)  {bg="transparent";tc="#e0ddd4";bc="transparent";}
                      if (ovr) {bg="#fff5f5"; bc="#ffc9c9";}
                      const amt = Math.abs(dd.net);
                      const amtStr = amt>=100?`${saved?"+":"−"}$${Math.round(amt)}`:amt>=1?`${saved?"+":"−"}$${Math.round(amt)}`:null;
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
                          {selDay===todayDom?"Today":new Date(yr,mo,selDay).toLocaleDateString("en-US",{weekday:"long",month:"short",day:"numeric"})}
                        </div>
                        <div style={{fontSize:12,color:"#bbb9b0"}}>{selTx.length} transaction{selTx.length!==1?"s":""}</div>
                      </C>
                      <C style={{alignItems:"flex-end",gap:2}}>
                        <div style={{fontSize:18,fontWeight:800,color:selNet>=0?"#2f9e44":"#e03131"}}>
                          {selNet>=0?"+":"−"}{fmtFull(Math.abs(selNet))}
                        </div>
                        <div style={{fontSize:11,color:"#bbb9b0"}}>vs {fmtFull(myAllow)} allowance</div>
                      </C>
                    </R>

                    {/* Progress bar */}
                    <div className="prog-track" style={{marginBottom:16}}>
                      <div className="prog-fill" style={{width:`${Math.min(100,myAllow>0?(selSpent/myAllow)*100:0)}%`,background:selNet<0?"#e03131":selSpent/myAllow>0.8?"#f08c00":"#2f9e44"}}/>
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
                  const nt=myAllow-ds;
                  const ax=[...(de.transactions||[]),...pd];
                  const isTday=dateKey===TODAY;
                  if (ax.length===0&&!isTday) return null;
                  const pct=myAllow>0?Math.min(1,ds/myAllow):0;
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
                  <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:14}}>
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
                              <button className="rm" onClick={()=>removeMember(m.id)} style={{color:"#ccc9c0"}}>
                                <I n="x" s={15}/>
                              </button>
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

              {/* Hero intro — shown only when no messages yet */}
              {aiMessages.length===0&&(
                <>
                  <div className="hero-card" style={{padding:28,textAlign:"center"}}>
                    <div className="hero-band" style={{background:"#7048e8"}}/>
                    <div style={{marginTop:8}}>
                      <div style={{width:60,height:60,borderRadius:20,background:"#f3eeff",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 16px"}}>
                        <I n="brain" s={28} c="#7048e8"/>
                      </div>
                      <div style={{fontSize:22,fontWeight:800,letterSpacing:"-0.03em",marginBottom:8}}>Your financial advisor</div>
                      <div style={{fontSize:14,color:"#9e9b95",lineHeight:1.7,maxWidth:320,margin:"0 auto"}}>
                        Ask anything about your money. Upload a paystub and I'll break down every line. I know your numbers — let's make sense of them.
                      </div>
                    </div>
                  </div>

                  {/* Snapshot card */}
                  {data.monthlyIncome>0&&(
                    <div className="card" style={{padding:20}}>
                      <div className="sec-hd">Your snapshot</div>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                        {[
                          {label:"Take-home",val:fmtFull(data.monthlyIncome),color:"#2f9e44"},
                          {label:"Bills",val:fmtFull(totalBills(data.recurringPayments)),color:"#e03131"},
                          {label:"Daily allowance",val:fmtFull(myAllow),color:"#1a1a2e"},
                          {label:"Pool left",val:fmtFull(poolLeft),color:poolLeft>=0?"#2f9e44":"#e03131"},
                        ].map(({label,val,color})=>(
                          <div key={label} style={{background:"#f8f7f2",borderRadius:14,padding:"12px 14px"}}>
                            <div style={{fontSize:10,fontWeight:700,color:"#bbb9b0",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:4}}>{label}</div>
                            <div style={{fontSize:18,fontWeight:700,color,letterSpacing:"-0.02em"}}>{val}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Upload paystub card */}
                  <div className="card" style={{padding:22}}>
                    <R style={{gap:12,marginBottom:14}}>
                      <div style={{width:40,height:40,borderRadius:13,background:"#f3eeff",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                        <I n="upload" s={18} c="#7048e8"/>
                      </div>
                      <C>
                        <div style={{fontSize:14,fontWeight:700,marginBottom:2}}>Upload a paystub</div>
                        <div style={{fontSize:12,color:"#9e9b95",lineHeight:1.5}}>PNG, JPG, or PDF — I'll extract every number and explain what it means</div>
                      </C>
                    </R>
                    <label style={{display:"flex",alignItems:"center",justifyContent:"center",gap:8,background:"#f3eeff",border:"1.5px dashed #c8b8f8",borderRadius:14,padding:"18px",cursor:"pointer",transition:"all 0.15s"}}>
                      <I n="file" s={18} c="#7048e8"/>
                      <span style={{fontSize:14,fontWeight:600,color:"#7048e8"}}>Choose file to analyze</span>
                      <input type="file" accept="image/*,.pdf" onChange={handleFileUpload} style={{display:"none"}}/>
                    </label>
                  </div>

                  {/* Suggested prompts */}
                  <div className="card" style={{padding:20}}>
                    <div className="sec-hd">Ask me anything</div>
                    <C style={{gap:8}}>
                      {suggestions.map((s,i)=>(
                        <button key={i} onClick={()=>sendAiMessage(s)}
                          style={{background:"#f8f7f2",border:"1px solid #ece9e0",borderRadius:12,padding:"12px 16px",textAlign:"left",cursor:"pointer",fontSize:13,color:"#1a1a2e",fontFamily:"inherit",fontWeight:500,transition:"all 0.15s",display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
                          {s}
                          <I n="arrow" s={14} c="#bbb9b0"/>
                        </button>
                      ))}
                    </C>
                  </div>
                </>
              )}

              {/* Chat messages */}
              {aiMessages.length>0&&(
                <div className="card" style={{padding:0,overflow:"hidden"}}>
                  {/* Chat header */}
                  <R style={{padding:"16px 20px",borderBottom:"1px solid #f0efe9",justifyContent:"space-between"}}>
                    <R style={{gap:10}}>
                      <div style={{width:34,height:34,borderRadius:11,background:"#f3eeff",display:"flex",alignItems:"center",justifyContent:"center"}}>
                        <I n="brain" s={16} c="#7048e8"/>
                      </div>
                      <C style={{gap:1}}>
                        <div style={{fontSize:13,fontWeight:700}}>DayFlow Advisor</div>
                        <div style={{fontSize:11,color:"#2f9e44",fontWeight:600}}>● Online</div>
                      </C>
                    </R>
                    <button className="btn-ghost" style={{padding:"6px 12px",fontSize:11}}
                      onClick={()=>{setAiMessages([]);setUploadedFile(null);setUploadPreview(null);}}>
                      New chat
                    </button>
                  </R>

                  {/* Messages */}
                  <div style={{padding:"16px 16px 8px",maxHeight:420,overflowY:"auto",display:"flex",flexDirection:"column",gap:12}}>
                    {aiMessages.map((msg,i)=>{
                      const isUser = msg.role==="user";
                      return (
                        <div key={msg.id||i} style={{display:"flex",flexDirection:"column",alignItems:isUser?"flex-end":"flex-start",gap:4}}>
                          {/* Sender label */}
                          <div style={{fontSize:10,fontWeight:700,color:"#bbb9b0",letterSpacing:"0.06em",textTransform:"uppercase",paddingLeft:isUser?0:4,paddingRight:isUser?4:0}}>
                            {isUser?"You":"Advisor"}
                          </div>
                          {/* Image preview if paystub */}
                          {msg.image&&(
                            <div style={{borderRadius:12,overflow:"hidden",maxWidth:220,border:"1px solid #f0efe9"}}>
                              <img src={`data:image/jpeg;base64,${msg.image}`} style={{width:"100%",display:"block"}} alt="Uploaded document"/>
                            </div>
                          )}
                          {/* Message bubble */}
                          {(msg.content||msg.isPaystub)&&(
                            <div style={{
                              maxWidth:"85%",padding:"12px 16px",borderRadius:isUser?"18px 18px 4px 18px":"18px 18px 18px 4px",
                              background:isUser?"#1a1a2e":"#f8f7f2",
                              color:isUser?"#fff":"#1a1a2e",
                              fontSize:13,lineHeight:1.65,fontWeight:400,
                              border:isUser?"none":"1px solid #ece9e0",
                            }}>
                              {msg.isPaystub&&!msg.image
                                ? "Analyzing your document…"
                                : msg.content.split("\n").map((line,j)=>(
                                    <span key={j}>{line}{j<msg.content.split("\n").length-1&&<br/>}</span>
                                  ))
                              }
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {/* Typing indicator */}
                    {aiLoading&&(
                      <div style={{display:"flex",flexDirection:"column",alignItems:"flex-start",gap:4}}>
                        <div style={{fontSize:10,fontWeight:700,color:"#bbb9b0",letterSpacing:"0.06em",textTransform:"uppercase",paddingLeft:4}}>Advisor</div>
                        <div style={{background:"#f8f7f2",border:"1px solid #ece9e0",borderRadius:"18px 18px 18px 4px",padding:"14px 18px",display:"flex",gap:5,alignItems:"center"}}>
                          {[0,1,2].map(j=>(
                            <div key={j} style={{width:7,height:7,borderRadius:"50%",background:"#bbb9b0",animation:"pulse 1.2s ease-in-out infinite",animationDelay:`${j*0.2}s`}}/>
                          ))}
                        </div>
                      </div>
                    )}
                    <div ref={chatEndRef}/>
                  </div>

                  {/* Upload button inside chat */}
                  <R style={{padding:"0 16px 8px",gap:8}}>
                    <label style={{display:"flex",alignItems:"center",gap:6,background:"#f8f7f2",border:"1px solid #ece9e0",borderRadius:12,padding:"10px 14px",cursor:"pointer",fontSize:12,fontWeight:600,color:"#7048e8",transition:"all 0.15s",flexShrink:0}}>
                      <I n="upload" s={14} c="#7048e8"/>
                      Upload
                      <input type="file" accept="image/*,.pdf" onChange={handleFileUpload} style={{display:"none"}}/>
                    </label>
                    <div style={{flex:1,fontSize:11,color:"#bbb9b0",fontStyle:"italic",lineHeight:1.4}}>
                      {uploadedFile ? `Uploaded: ${uploadedFile}` : "Add a paystub or document"}
                    </div>
                  </R>

                  {/* Input */}
                  <div style={{padding:"8px 16px 16px",borderTop:"1px solid #f0efe9"}}>
                    <R style={{gap:8}}>
                      <input className="inp" placeholder="Ask about your finances…" value={aiInput}
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
              )}

              {/* Quick prompts shown below chat */}
              {aiMessages.length>0&&!aiLoading&&(
                <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                  {suggestions.slice(0,3).map((s,i)=>(
                    <button key={i} onClick={()=>sendAiMessage(s)}
                      style={{background:"#fff",border:"1px solid #ece9e0",borderRadius:20,padding:"8px 14px",fontSize:12,color:"#6b6965",fontFamily:"inherit",fontWeight:500,cursor:"pointer",transition:"all 0.15s",whiteSpace:"nowrap"}}>
                      {s.length>32?s.slice(0,32)+"…":s}
                    </button>
                  ))}
                </div>
              )}

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
                {id:"bank",    icon:"bank",  label:"Bank connections", sub:"Link your bank account"},
                {id:"settings",icon:"gear",  label:"Setup",            sub:"Income, pool & preferences"},
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
