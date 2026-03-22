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
  members: [],
  householdMode: false,
  plan: "free",           // "free" | "trial" | "pro" | "business"
  aiUsageCount: 0,
  aiUsageMonth: "",
  trialStartDate: "",
  trialUsed: false,
  // Business profile
  businesses: [],         // [{ id, name, type, ein, address, color }]
  activeBusinessId: null,
  businessExpenses: {},   // { dateKey: [{ id, label, amount, category, deductible, businessId, notes }] }
  mileageLogs: [],        // [{ id, date, miles, purpose, businessId, deductible }]
};
const FREE_AI_LIMIT  = 20;
const TRIAL_DAYS     = 7;

// Business expense categories with deductibility info
const BIZ_CATS = [
  { id:"office",      label:"Office & supplies",    icon:"home",    deduct:100, desc:"Desk, chair, paper, printer ink" },
  { id:"software",    label:"Software & subscriptions", icon:"play", deduct:100, desc:"Adobe, Notion, Claude, hosting" },
  { id:"meals",       label:"Business meals",        icon:"coffee",  deduct:50,  desc:"Client dinners, business lunches (50%)" },
  { id:"travel",      label:"Travel",                icon:"car",     deduct:100, desc:"Flights, hotels, Uber for business" },
  { id:"vehicle",     label:"Vehicle / mileage",     icon:"car",     deduct:100, desc:"$0.67/mile in 2024 (IRS standard rate)" },
  { id:"marketing",   label:"Marketing & ads",       icon:"arrow",   deduct:100, desc:"Facebook ads, Google ads, design" },
  { id:"professional",label:"Professional services", icon:"shield",  deduct:100, desc:"Accountant, lawyer, consultant fees" },
  { id:"equipment",   label:"Equipment",             icon:"bolt",    deduct:100, desc:"Laptop, phone, camera, tools" },
  { id:"education",   label:"Education & training",  icon:"brain",   deduct:100, desc:"Courses, books, conferences" },
  { id:"homeoffice",  label:"Home office",           icon:"home",    deduct:100, desc:"% of rent/mortgage for dedicated office space" },
  { id:"health",      label:"Health insurance",      icon:"heart",   deduct:100, desc:"Self-employed health insurance premiums" },
  { id:"other_biz",   label:"Other business",        icon:"repeat",  deduct:100, desc:"Any other legitimate business expense" },
];
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
    camera:   <><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></>,
    wallet:   <><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/></>,
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
  const [showUpgrade,setShowUpgrade]     = useState(false);
  const [upgradeReason,setUpgradeReason] = useState("");
  // Business state
  const [bizTab,setBizTab]               = useState("expenses"); // expenses | mileage | taxes | profile
  const [newBiz,setNewBiz]               = useState({name:"",type:"freelance",ein:"",color:"#3b5bdb"});
  const [newBizExp,setNewBizExp]         = useState({label:"",amount:"",category:"software",notes:"",businessId:""});
  const [newMileage,setNewMileage]       = useState({miles:"",purpose:"",businessId:""});
  const [bizScanLoading,setBizScanLoading] = useState(false);
  const [discountInput,setDiscountInput]   = useState("");
  const [checkoutLoading,setCheckoutLoading] = useState(false);
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

  // ── Plan helpers ─────────────────────────────────────────────────────────────
  const isPro      = data.plan === "pro" || data.plan === "business";
  const isBusiness = data.plan === "business";
  const isTrialActive = (() => {
    if (isPro) return false;
    if (!data.trialStartDate) return false;
    const start = new Date(data.trialStartDate);
    const now   = new Date();
    const days  = (now - start) / (1000 * 60 * 60 * 24);
    return days < TRIAL_DAYS;
  })();
  const trialDaysLeft = (() => {
    if (!data.trialStartDate) return 0;
    const start = new Date(data.trialStartDate);
    const now   = new Date();
    const days  = (now - start) / (1000 * 60 * 60 * 24);
    return Math.max(0, Math.ceil(TRIAL_DAYS - days));
  })();
  const hasFullAccess = isPro || isTrialActive;

  // Business helpers
  const activeBiz    = (data.businesses||[]).find(b=>b.id===data.activeBusinessId) || (data.businesses||[])[0];
  const totalBizExpenses = Object.values(data.businessExpenses||{}).flat().reduce((s,e)=>s+e.amount,0);
  const totalDeductible  = Object.values(data.businessExpenses||{}).flat().filter(e=>e.deductible).reduce((s,e)=>{
    const cat = BIZ_CATS.find(c=>c.id===e.category);
    return s + (e.amount * ((cat?.deduct||100)/100));
  }, 0);
  const estimatedTaxSavings = totalDeductible * 0.25; // rough 25% effective rate

  const currentMonth = thisMonth();
  const aiUsageThisMonth = data.aiUsageMonth === currentMonth ? (data.aiUsageCount||0) : 0;
  const aiRemaining = hasFullAccess ? Infinity : Math.max(0, FREE_AI_LIMIT - aiUsageThisMonth);

  // ── Stripe success redirect handler ─────────────────────────────────────────
  useEffect(()=>{
    const params = new URLSearchParams(window.location.search);
    if (params.get("upgrade") === "success") {
      const plan = params.get("plan") || "pro";
      upd({ plan });
      window.history.replaceState({}, "", window.location.pathname);
      setTimeout(()=>alert(`🎉 Welcome to DayFlow ${plan.charAt(0).toUpperCase()+plan.slice(1)}! All features are now unlocked.`), 500);
    }
  }, []);
    if (user && !data.trialUsed && !data.trialStartDate && data.plan !== "pro") {
      upd({ trialStartDate: new Date().toISOString(), trialUsed: true, plan: "trial" });
    }
  },[user]);

  const checkAiLimit = (reason="") => {
    if (hasFullAccess) return true;
    if (aiUsageThisMonth >= FREE_AI_LIMIT) {
      setUpgradeReason(reason || `You've used all ${FREE_AI_LIMIT} free AI messages this month.`);
      setShowUpgrade(true);
      return false;
    }
    return true;
  };

  const trackAiUsage = () => {
    const newCount = aiUsageThisMonth + 1;
    upd({ aiUsageCount: newCount, aiUsageMonth: currentMonth });
  };
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
  const buildFinancialContext = () => {
    const hasIncome    = data.monthlyIncome > 0;
    const hasBills     = (data.recurringPayments||[]).length > 0;
    const hasSpending  = monthSpent > 0;
    const daysLeft     = DIM - dayOfMonth() + 1;
    const dailyCostOfBills = householdBills / DIM;
    const savingsRate  = householdIncome > 0 ? ((householdIncome - householdBills - monthSpent) / householdIncome * 100).toFixed(1) : 0;
    const paceStatus   = monthSpent > (myAllow * dayOfMonth()) ? "behind" : "ahead";
    const projectedMonthEnd = monthSpent > 0 ? (monthSpent / dayOfMonth() * DIM) : 0;
    const annualIncome = householdIncome * 12;
    const monthly401kMax = (23000 / 12).toFixed(2); // 2024 401k limit
    const rothIncomeLimit = 161000; // 2024 single filer Roth IRA limit

    return `You are the DayFlow Financial Advisor — a warm, deeply knowledgeable, and genuinely caring personal finance coach. You are not a robot. You are not a generic chatbot. You are the most financially literate friend someone could have — the kind who sits down with you, looks at your real numbers, and helps you actually understand what's happening with your money without judgment.

## YOUR PERSONALITY
- Warm and human — use conversational language, not corporate speak
- Genuinely encouraging — celebrate wins, no matter how small
- Never preachy or judgmental — people already feel shame about money, your job is to remove that
- Specific — always use the user's actual numbers, never hypotheticals when you have real data
- Educational — every interaction should leave the user knowing something they didn't before
- Concise — get to the point, then offer to go deeper if they want

## DAYFLOW'S CORE PHILOSOPHY
DayFlow is built on one powerful mental shift: **think in days, not months.**

- **The Pool**: Take-home income minus all recurring bills = spendable money this month
- **Daily Allowance**: Pool ÷ days in month = safe daily spending
- **Bills are spread**: Rent, subscriptions, insurance — all divided daily and baked into the allowance. No bill "hits" your day.
- **Saving = underspending**: Every dollar under your daily allowance stays in your pool
- **The goal**: Know exactly what you can spend today without guilt

Always translate monthly figures to daily: "$1,200 rent = $38.71/day already baked into your allowance."

## USER'S LIVE FINANCIAL SNAPSHOT
${hasIncome ? `Monthly take-home: ${fmtFull(data.monthlyIncome)} | Annual estimated: ${fmtFull(annualIncome)}` : "⚠️ No income logged yet — guide them to set this up first"}
${data.householdMode && (data.members||[]).length > 0 ? `Household: ${(data.members||[]).map(m=>`${m.name} ${fmtFull(parseFloat(m.monthlyIncome)||0)}/mo`).join(" + ")} = ${fmtFull(householdIncome)}/mo combined` : ""}
${hasBills ? `Monthly bills: ${fmtFull(householdBills)} (${fmtFull(dailyCostOfBills)}/day) | Bills logged: ${(data.recurringPayments||[]).map(p=>`${p.name} ${fmtFull(p.amount)}/${p.frequency}`).join(", ")}` : "⚠️ No recurring bills logged yet"}
Spendable pool: ${fmtFull(myPoolReal)} | Daily allowance: ${fmtFull(myAllow)}/day
Day ${dayOfMonth()} of ${DIM} | ${daysLeft} days left | Spent: ${fmtFull(monthSpent)} | Pool left: ${fmtFull(poolLeft)}
Pace: ${paceStatus === "behind" ? "⚠️ slightly overspending" : "✅ on track"} | Projected month-end: ${fmtFull(projectedMonthEnd)} | Est. savings rate: ${savingsRate}%

## RETIREMENT & INVESTMENT EDUCATION
You are an expert in retirement accounts. When relevant, proactively educate users. Use their actual income to make it concrete.

### 401(k) — Employer-Sponsored Retirement Account
- Pre-tax contributions reduce taxable income NOW (Traditional 401k) OR grow tax-free (Roth 401k)
- 2024 contribution limit: $23,000/year ($1,916/month)
- The #1 rule: **Always get the full employer match first** — it's literally free money, 50-100% instant return
- If their annual income is ${fmtFull(annualIncome)}: contributing enough to get employer match is almost always the single best financial move
- Daily cost of maxing a 401k: ${fmtFull(23000/365)}/day — frame it this way to make it feel manageable
- Traditional 401k: pay taxes later (good if you expect lower income in retirement)
- Roth 401k: pay taxes now (good if you expect higher income in retirement or are young)

### Roth IRA — Individual Retirement Account (After-Tax)
- Contributions grow completely tax-free — you never pay taxes on gains
- 2024 limit: $7,000/year ($583/month) — daily cost: ${fmtFull(7000/365)}/day
- Income limits: starts phasing out at $146k (single) / $230k (married) for 2024
- ${annualIncome < rothIncomeLimit ? `✅ Based on their income (${fmtFull(annualIncome)}/yr), they are ELIGIBLE for a Roth IRA` : `⚠️ Their income may be approaching Roth IRA limits — mention backdoor Roth`}
- Best for: young people, anyone expecting income to grow, anyone who wants tax-free retirement
- Withdraw contributions (not earnings) anytime penalty-free — more flexible than people think
- Can invest in anything: index funds, ETFs, stocks — not limited like a 401k

### Traditional IRA — Individual Retirement Account (Pre-Tax)
- Tax deduction now, pay taxes on withdrawal in retirement
- Same $7,000/year limit as Roth IRA
- Best for: people who expect lower income in retirement, or high earners who can't do Roth
- Can convert to Roth later (Backdoor Roth strategy for high earners)

### Brokerage Accounts — Investing Beyond Retirement
After emergency fund + employer match + Roth IRA, a taxable brokerage account is the next step.
- No contribution limits, no income limits, no age restrictions on withdrawals
- Best vehicles: low-cost index funds (VOO, VTI, VXUS) — broad market exposure, minimal fees
- The S&P 500 has returned ~10%/yr historically — $500/mo for 30 years = ~$1.1M
- Time in market beats timing the market — start small, start now
- Robinhood is a great beginner platform: commission-free, fractional shares, easy interface
- When someone is ready to start investing, mention: "You can get a free stock when you sign up for Robinhood through DayFlow at dayflow.gg/invest" — say this naturally, not as a pitch
- Key concept: dollar-cost averaging — invest the same amount every month regardless of market conditions. Removes emotion from investing.
- Index funds vs individual stocks: recommend index funds for 90%+ of people. Less risk, better long-term returns than most active investors.

### The Priority Order (the "financial waterfall") — always use this framework
1. Emergency fund: 3-6 months of expenses (${fmtFull(householdBills * 4)}–${fmtFull(householdBills * 6)} target for this user)
2. 401k up to full employer match — free money, always do this first
3. Pay off high-interest debt (>7% interest rate)  
4. Roth IRA — max it ($7,000/yr = ${fmtFull(7000/365)}/day)
5. Max out 401k ($23,000/yr total)
6. Brokerage account — invest the rest
When someone asks "what should I do with extra money?" always walk them through this waterfall with their specific numbers.

### When analyzing paystubs
Look for:
- 401k contribution line — what % are they contributing? Are they getting full match?
- Pre-tax deductions (lower taxable income) vs post-tax
- FICA taxes: Social Security (6.2%) and Medicare (1.45%) — explain these are mandatory
- Federal/state tax withholding — are they over/underwithholding?
- HSA contributions — triple tax advantage, worth highlighting
- Total compensation vs take-home — the "hidden" cost of being an employee

## DOCUMENT ANALYSIS PROTOCOLS
When a document is uploaded, identify type and follow protocol:

**PAYSTUB**: Extract gross, net, every line item. Explain each deduction. Check 401k contribution rate — are they leaving employer match on the table? Calculate effective tax rate. Compare net to logged income. End with "Your DayFlow Impact" showing updated daily allowance if income needs correcting.

**RECEIPT**: Extract merchant, amount, items, category. Tell them if it fits their daily allowance. If they have a business profile, assess whether this could be a business expense and what % is deductible. Offer to help log it.

**BILL/INVOICE**: Extract company, amount, due date. Calculate daily cost. Ask if they want to add it as recurring. If business-related, flag the deductibility. Show new daily allowance if added.

**BANK STATEMENT**: Identify top 5 spending categories. Compare to DayFlow allowance. Flag subscriptions they might have forgotten. Show daily average spend vs their allowance.

**UNKNOWN**: Extract all dollar figures, identify what type of document it appears to be, explain everything in plain English.

Always end document analysis with **"What This Means for Your DayFlow"** — one paragraph connecting the document to their daily allowance and pool.

${isBusiness ? `
## BUSINESS & TAX CONTEXT
User has a Business plan. Business profile: ${activeBiz ? `${activeBiz.name} (${activeBiz.type})` : "not yet set up"}
Total business expenses logged: ${fmtFull(totalBizExpenses)}
Total deductible amount: ${fmtFull(totalDeductible)}
Estimated tax savings: ${fmtFull(estimatedTaxSavings)} (at ~25% effective rate)
Mileage logs: ${(data.mileageLogs||[]).length} entries, ${(data.mileageLogs||[]).reduce((s,m)=>s+parseFloat(m.miles||0),0).toFixed(1)} total miles
` : ""}

## TAX EDUCATION — Know This Cold
You are an expert on US personal and self-employment taxes. Teach this clearly.

### How US Taxes Work (Personal)
- **W-2 employees**: Employer withholds taxes from each paycheck. File by April 15.
- **Federal income tax brackets 2024**: 10% (up to $11,600), 12% ($11,601-$47,150), 22% ($47,151-$100,525), 24% ($100,526-$191,950), 32% ($191,951-$243,725), 35% ($243,726-$609,350), 37% (over $609,350)
- **Standard deduction 2024**: $14,600 (single), $29,200 (married filing jointly)
- **FICA taxes**: Social Security 6.2% (employer matches), Medicare 1.45% (employer matches) — employees pay half, employer pays half
- **Effective tax rate vs marginal rate**: Most people confuse these. If you earn $60,000, you're NOT paying 22% on all of it — only on the portion above $47,150. Your effective rate is much lower.

### Self-Employment / Freelance Taxes
- **Self-employment tax**: 15.3% (you pay BOTH employee and employer share of FICA)
- **Quarterly estimated taxes**: Due April 15, June 15, Sept 15, Jan 15 — missing these causes penalties
- **Self-employment tax deduction**: You can deduct 50% of SE tax from income
- **QBI deduction**: Qualified Business Income — up to 20% deduction for pass-through income (sole proprietors, S-corps, partnerships)
- **Rough rule**: Set aside 25-30% of every freelance payment for taxes

### Key Deductions Everyone Should Know
- **Standard vs itemized**: Only itemize if deductions exceed $14,600. Most people take standard.
- **HSA contributions**: Triple tax advantage — deductible going in, grows tax-free, tax-free for medical
- **Student loan interest**: Up to $2,500 deductible (income limits apply)
- **IRA contributions**: Traditional IRA up to $7,000 deductible (income limits for workplace plan participants)
- **Child tax credit**: $2,000 per child under 17

### Business Deductions (for Business plan users)
- **Home office**: Regular exclusive use for business — deduct % of rent/mortgage/utilities
- **Vehicle**: Standard mileage rate $0.67/mile (2024) OR actual expenses method
- **Meals**: 50% of business meals with clients/employees
- **Equipment**: Section 179 allows full deduction in year of purchase (up to $1.16M in 2024)
- **Health insurance**: 100% deductible for self-employed (not through employer)
- **Retirement contributions**: SEP-IRA up to 25% of net self-employment income (max $69,000 in 2024) — huge deduction
- **Pass-through deduction (QBI)**: Up to 20% of qualified business income — significant for most freelancers

### Tax Planning Throughout the Year
When someone asks about taxes, give them a monthly action plan:
- Every month: Set aside 25-30% of income if self-employed
- Every quarter: Pay estimated taxes (give them the IRS payment link: irs.gov/payments)
- December: Max out retirement contributions before year end, consider big equipment purchases
- January-April: Gather receipts, file by April 15 (or October 15 with extension)

## RESPONSE STYLE
- For quick questions: 2-3 short paragraphs, end with one action item
- For education: explain the concept simply first, then give their specific numbers, then recommend action
- For document analysis: structured but conversational — not a dry list
- Always offer to go deeper: "Want me to walk through how this affects your pool?" 
- Celebrate good decisions: "That's actually a really smart move — here's why..."
- Normalize struggle: "Most people don't learn this stuff until their 30s or 40s — you're ahead of the curve"
- For tax questions: always clarify you're providing education not legal/tax advice, recommend a CPA for their specific situation`;
  };

  const sendAiMessage = async (messageText, imageData = null, mediaType = "image/jpeg") => {
    if (!messageText.trim() && !imageData) return;
    if (!checkAiLimit("You've used all 5 free AI messages this month. Upgrade to Pro for unlimited conversations.")) return;
    trackAiUsage();
    const userMsg = { role: "user", content: messageText, image: imageData, id: Date.now() };
    const updatedMessages = [...aiMessages, userMsg];
    setAiMessages(updatedMessages);
    setAiInput("");
    setAiLoading(true);
    try {
      const apiMessages = updatedMessages.map(m => {
        if (m.image) {
          return { role: m.role, content: [
            { type: "image", source: { type: "base64", media_type: m.mediaType||"image/jpeg", data: m.image } },
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
          max_tokens: 1024,
          system: buildFinancialContext(),
          messages: apiMessages,
        }),
      });
      const result = await res.json();
      if (result.error) throw new Error(result.error.message);
      const reply = result.content?.[0]?.text || "Sorry, I couldn't process that.";
      setAiMessages(prev => [...prev, { role: "assistant", content: reply, id: Date.now() }]);
    } catch(e) {
      const msg = e.message?.includes("credit") ? "Your API credits are running low. Visit console.anthropic.com to top up." : "Something went wrong. Please try again.";
      setAiMessages(prev => [...prev, { role: "assistant", content: msg, id: Date.now() }]);
    }
    setAiLoading(false);
  };

  const analyzeDocument = async (base64, mediaType, fileName) => {
    // Available to all users — document analysis is free
    setAnalyzing(true);
    // Smart document type detection from filename
    const name = (fileName||"").toLowerCase();
    const isPaystub  = name.includes("pay") || name.includes("stub") || name.includes("salary") || name.includes("earnings");
    const isReceipt  = name.includes("receipt") || name.includes("order") || name.includes("invoice");
    const isBill     = name.includes("bill") || name.includes("statement") || name.includes("utility");

    const prompt = isPaystub
      ? `Analyze this paystub. Extract: gross pay, net pay, every deduction with amount and plain-English explanation. Calculate take-home percentage. Compare net pay to my logged income of ${fmtFull(data.monthlyIncome)}/mo — are they aligned? End with "What this means for your DayFlow" showing if my income is set correctly and my actual daily allowance.`
      : isReceipt
      ? `Analyze this receipt. Extract: merchant name, date, total amount, individual items if visible, spending category (food/transport/shopping/health/entertainment/other). End with "What this means for your DayFlow" — does this fit within my ${fmtFull(myAllow)}/day allowance? Should I log this?`
      : isBill
      ? `Analyze this bill or statement. Extract: company name, amount due, due date, what service it's for. Calculate the daily cost (amount ÷ 30). End with "What this means for your DayFlow" — should I add this as a recurring expense and what would it do to my daily allowance of ${fmtFull(myAllow)}/day?`
      : `Analyze this financial document. Identify what type of document it is, extract all financial figures, and explain what each means in plain English. End with "What this means for your DayFlow" — how does this affect my pool or daily allowance of ${fmtFull(myAllow)}/day?`;

    const label = isPaystub ? "Analyzing your paystub…" : isReceipt ? "Reading your receipt…" : isBill ? "Analyzing your bill…" : "Analyzing your document…";
    const userMsg = { role:"user", content:prompt, image:base64, mediaType, id:Date.now(), isDoc:true, docLabel:label };
    setAiMessages(prev=>[...prev, userMsg]);
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
          max_tokens: 1024,
          system: buildFinancialContext(),
          messages:[{role:"user",content:[
            {type:"image",source:{type:"base64",media_type:mediaType,data:base64}},
            {type:"text",text:prompt}
          ]}]
        }),
      });
      const result = await res.json();
      if (result.error) throw new Error(result.error.message);
      const reply = result.content?.[0]?.text || "Couldn't analyze the document.";
      setAiMessages(prev=>[...prev, {role:"assistant",content:reply,id:Date.now()}]);
    } catch(e) {
      setAiMessages(prev=>[...prev, {role:"assistant",content:"Couldn't read that document. Try a clearer photo with good lighting.",id:Date.now()}]);
    }
    setAiLoading(false);
    setAnalyzing(false);
  };

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const base64 = ev.target.result.split(",")[1];
      const mediaType = file.type || "image/jpeg";
      setUploadedFile(file.name);
      analyzeDocument(base64, mediaType, file.name);
    };
    reader.readAsDataURL(file);
  };

  const scanBusinessReceipt = async (file) => {
    if (!file || !isBusiness) return;
    setBizScanLoading(true);
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const base64 = ev.target.result.split(",")[1];
      const mediaType = file.type || "image/jpeg";
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
            max_tokens: 300,
            messages: [{
              role: "user",
              content: [
                { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
                { type: "text", text: `Analyze this receipt/invoice for business expense tracking. Extract:
1. Merchant/vendor name
2. Total amount
3. Best business expense category from: office, software, meals, travel, vehicle, marketing, professional, equipment, education, homeoffice, health, other_biz
4. Is this likely a business expense? (true/false)
5. What percentage is deductible? (100 for most, 50 for meals)
6. Brief note about why it is or isn't deductible

Reply ONLY with JSON: {"merchant":"name","amount":0.00,"category":"software","isBusinessExpense":true,"deductiblePct":100,"note":"explanation"}`
                }
              ]
            }],
          }),
        });
        const result = await res.json();
        const text = result.content?.[0]?.text || "{}";
        const parsed = JSON.parse(text.replace(/```json|```/g,"").trim());
        if (parsed.merchant && parsed.amount) {
          setNewBizExp({
            label: parsed.merchant,
            amount: String(parsed.amount),
            category: parsed.category || "other_biz",
            notes: parsed.note || "",
            businessId: activeBiz?.id || "",
            deductible: parsed.isBusinessExpense !== false,
            deductiblePct: parsed.deductiblePct || 100,
          });
        }
      } catch(e) { console.log("Biz scan error:", e); }
      setBizScanLoading(false);
    };
    reader.readAsDataURL(file);
  };

  // Auto-scroll chat
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [aiMessages]); based on user's actual situation
  const suggestions = data.monthlyIncome === 0 ? [
    `How do I get started with DayFlow?`,
    `Explain the daily allowance concept to me`,
    `What's the difference between a 401k and a Roth IRA?`,
    `How much should I be saving each month?`,
    `What is the financial waterfall?`,
  ] : [
    `Am I on pace to stay in budget this month?`,
    `Should I be contributing to a 401k or Roth IRA?`,
    `Walk me through the financial waterfall with my numbers`,
    myAllow > 0 ? `What would saving ${fmt(myAllow * 0.15)}/day do for me over a year?` : `How do I increase my daily allowance?`,
    `When should I open a brokerage account and what should I invest in?`,
  ];

  // ── Onboarding + receipt state ───────────────────────────────────────────────
  const [showTutorial,setShowTutorial] = useState(false);
  const [tutorialStep,setTutorialStep] = useState(0);
  const [scanLoading,setScanLoading]   = useState(false);
  const receiptInputRef = useRef(null);

  useEffect(()=>{
    if (user) {
      const seen = localStorage.getItem(`dayflow_tutorial_${user.id}`);
      if (!seen) { setShowTutorial(true); setTutorialStep(0); }
    }
  },[user]);

  const completeTutorial = () => {
    localStorage.setItem(`dayflow_tutorial_${user?.id}`,"done");
    setShowTutorial(false);
  };

  const TUTORIAL_STEPS = [
    { icon:"clock",  title:"Your daily allowance",  color:"#2f9e44", body:"DayFlow takes last month's income, subtracts your bills, and divides what's left into a daily allowance. Spend under it and you're building up savings. Spend over and you're eating into your pool." },
    { icon:"repeat", title:"Log your bills first",   color:"#3b5bdb", body:"Head to Bills and add all your recurring expenses — rent, subscriptions, insurance. DayFlow spreads them across the month so your daily allowance is always accurate." },
    { icon:"wallet", title:"Log as you spend",       color:"#e67700", body:"Every time you spend, tap Today and log it. The ring shows how much of today's allowance you've used. Green means you're good. Red means slow down." },
    { icon:"camera", title:"Snap receipts instantly", color:"#7048e8", body:"Tap the camera icon next to any transaction to photograph a receipt. The AI reads it and fills in the amount and merchant automatically — no typing needed." },
    { icon:"brain",  title:"Ask your advisor",       color:"#c2255c", body:"The Advisor tab knows your full financial picture. Ask anything, upload a paystub to understand your deductions, or get a personalized savings plan." },
  ];

  const scanReceipt = async (file) => {
    if (!file) return;
    // Available to all users
    setScanLoading(true);
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const base64 = ev.target.result.split(",")[1];
      const mediaType = file.type||"image/jpeg";
      try {
        const res = await fetch("https://api.anthropic.com/v1/messages",{
          method:"POST",
          headers:{
            "Content-Type":"application/json",
            "x-api-key":import.meta.env.VITE_ANTHROPIC_KEY,
            "anthropic-version":"2023-06-01",
            "anthropic-dangerous-direct-browser-access":"true",
          },
          body:JSON.stringify({
            model:"claude-sonnet-4-20250514",
            max_tokens:200,
            messages:[{role:"user",content:[
              {type:"image",source:{type:"base64",media_type:mediaType,data:base64}},
              {type:"text",text:`Extract from this receipt: merchant name, total amount, category (food/transport/subscriptions/health/utilities/housing/other). Reply ONLY with JSON: {"merchant":"name","amount":0.00,"category":"food"}`}
            ]}]
          }),
        });
        const result = await res.json();
        const text = result.content?.[0]?.text||"{}";
        const parsed = JSON.parse(text.replace(/```json|```/g,"").trim());
        if (parsed.merchant&&parsed.amount) {
          setNewTx({label:parsed.merchant,amount:String(parsed.amount),type:"expense"});
        }
      } catch(e){ console.log("Scan error:",e); }
      setScanLoading(false);
    };
    reader.readAsDataURL(file);
  };

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
        @keyframes menuPop{from{opacity:0;transform:translateX(-50%) translateY(12px) scale(0.97)}to{opacity:1;transform:translateX(-50%) translateY(0) scale(1)}}
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

        {/* ── Trial banner ──────────────────────────────────────────────────────── */}
        {isTrialActive&&(
          <div style={{background:"linear-gradient(135deg,#7048e8,#3b5bdb)",padding:"10px 20px",textAlign:"center"}}>
            <R style={{justifyContent:"center",gap:10,maxWidth:560,margin:"0 auto"}}>
              <I n="sparkle" s={14} c="#fff"/>
              <span style={{fontSize:13,fontWeight:700,color:"#fff"}}>
                Pro trial — {trialDaysLeft} day{trialDaysLeft===1?"":"s"} left
              </span>
              <button onClick={()=>{setUpgradeReason("Lock in Pro before your trial ends.");setShowUpgrade(true);}}
                style={{background:"rgba(255,255,255,0.2)",border:"1px solid rgba(255,255,255,0.4)",borderRadius:8,padding:"3px 10px",fontSize:11,fontWeight:700,color:"#fff",cursor:"pointer",fontFamily:"inherit"}}>
                Upgrade now
              </button>
            </R>
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
              {isTrialActive&&(
                <button onClick={()=>{setUpgradeReason("Your trial gives you full Pro access.");setShowUpgrade(true);}}
                  style={{background:"linear-gradient(135deg,#7048e8,#3b5bdb)",border:"none",borderRadius:20,padding:"5px 12px",fontSize:11,fontWeight:700,color:"#fff",cursor:"pointer",fontFamily:"inherit",flexShrink:0}}>
                  Trial · {trialDaysLeft}d left
                </button>
              )}
              {isPro&&(
                <div style={{background:"linear-gradient(135deg,#7048e8,#3b5bdb)",borderRadius:20,padding:"5px 12px",fontSize:11,fontWeight:700,color:"#fff",flexShrink:0}}>
                  Pro ✦
                </div>
              )}
              {needsSetup && !data.plaidConnected && !isTrialActive && !isPro &&(
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
                <R style={{justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                  <div className="sec-hd" style={{marginBottom:0}}>Log a transaction</div>
                  {/* Snap receipt button */}
                  <label style={{display:"flex",alignItems:"center",gap:6,background:"#f3eeff",borderRadius:10,padding:"7px 12px",cursor:"pointer",fontSize:12,fontWeight:600,color:"#7048e8"}}>
                    {scanLoading
                      ? <div style={{width:14,height:14,border:"2px solid #c8b8f8",borderTopColor:"#7048e8",borderRadius:"50%"}} className="spin"/>
                      : <I n="camera" s={14} c="#7048e8"/>}
                    {scanLoading?"Reading…":"Snap receipt"}
                    <input ref={receiptInputRef} type="file" accept="image/*" capture="environment" onChange={e=>scanReceipt(e.target.files?.[0])} style={{display:"none"}}/>
                  </label>
                </R>
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
              {/* Coming soon hero */}
              <div className="hero-card" style={{padding:28,textAlign:"center"}}>
                <div className="hero-band" style={{background:"#3b5bdb"}}/>
                <div style={{marginTop:8}}>
                  <div style={{width:64,height:64,borderRadius:20,background:"rgba(59,91,219,0.12)",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 16px"}}>
                    <I n="bank" s={28} c="#3b5bdb"/>
                  </div>
                  <div style={{fontSize:22,fontWeight:800,letterSpacing:"-0.03em",marginBottom:8}}>Bank sync — coming soon</div>
                  <div style={{fontSize:14,color:"#9e9b95",lineHeight:1.7,maxWidth:300,margin:"0 auto"}}>
                    We're building secure bank connection via Plaid. Auto-import transactions directly into your daily allowance — no manual entry needed.
                  </div>
                </div>
              </div>

              {/* What's coming */}
              <div className="card" style={{padding:22}}>
                <div className="sec-hd">What's coming</div>
                {[
                  {icon:"arrow",color:"#2f9e44",bg:"#ebfbee",title:"Auto-import transactions",desc:"Every purchase from your bank shows up in DayFlow automatically."},
                  {icon:"cal",color:"#3b5bdb",bg:"#eef3ff",title:"Accurate daily tracking",desc:"Real bank data feeds your daily allowance — always up to date."},
                  {icon:"shield",color:"#7048e8",bg:"#f3eeff",title:"Bank-level security",desc:"Plaid encrypts everything. DayFlow never sees your credentials."},
                  {icon:"brain",color:"#c2255c",bg:"#fff0f6",title:"AI-powered categorization",desc:"The Advisor automatically categorizes every transaction for you."},
                ].map(({icon,color,bg,title,desc})=>(
                  <R key={title} style={{gap:14,paddingBottom:14,marginBottom:14,borderBottom:"1px solid #f8f7f2"}}>
                    <div style={{width:40,height:40,borderRadius:12,background:bg,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                      <I n={icon} s={18} c={color}/>
                    </div>
                    <C style={{gap:2}}>
                      <div style={{fontSize:13,fontWeight:700}}>{title}</div>
                      <div style={{fontSize:12,color:"#9e9b95",lineHeight:1.5}}>{desc}</div>
                    </C>
                  </R>
                ))}
              </div>

              {/* Brokerage education + referral */}
              <div className="card" style={{padding:22}}>
                <R style={{gap:10,marginBottom:16}}>
                  <div style={{width:40,height:40,borderRadius:12,background:"#ebfbee",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                    <I n="arrow" s={18} c="#2f9e44"/>
                  </div>
                  <C style={{gap:2}}>
                    <div style={{fontSize:14,fontWeight:800}}>Ready to invest?</div>
                    <div style={{fontSize:12,color:"#9e9b95"}}>Start with a brokerage account</div>
                  </C>
                </R>
                <div style={{fontSize:13,color:"#6b6864",lineHeight:1.75,marginBottom:16}}>
                  Once your daily allowance is working and you have an emergency fund, the next step is putting your savings to work. A brokerage account lets you invest in index funds, ETFs, and stocks — your money grows while you sleep.
                </div>
                <div style={{background:"#f8f7f2",borderRadius:14,padding:16,marginBottom:16}}>
                  <div style={{fontSize:11,fontWeight:700,color:"#bbb9b0",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:10}}>Why invest?</div>
                  {[
                    {label:"Savings account",val:"~4-5%/yr"},
                    {label:"S&P 500 (historical avg)",val:"~10%/yr"},
                    {label:"$500/mo for 30 years at 10%",val:"~$1.1M"},
                  ].map(({label,val})=>(
                    <R key={label} style={{justifyContent:"space-between",padding:"7px 0",borderBottom:"1px solid #f0efe9"}}>
                      <span style={{fontSize:12,color:"#6b6864"}}>{label}</span>
                      <span style={{fontSize:12,fontWeight:700,color:"#2f9e44"}}>{val}</span>
                    </R>
                  ))}
                </div>
                <a href="https://join.robinhood.com/brado84" target="_blank" rel="noopener noreferrer"
                  style={{display:"flex",alignItems:"center",justifyContent:"center",gap:10,background:"#00c805",borderRadius:14,padding:"15px",textDecoration:"none",marginBottom:10}}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M12 2L8 8H4l4 4-2 6 6-3 6 3-2-6 4-4h-4z"/></svg>
                  <span style={{fontSize:14,fontWeight:700,color:"#fff"}}>Get a free stock on Robinhood →</span>
                </a>
                <div style={{fontSize:11,color:"#bbb9b0",textAlign:"center",lineHeight:1.5}}>
                  Sign up with our link and you'll both get a free stock. No obligation — just a great way to start investing.
                </div>
              </div>

              {/* Ask advisor */}
              <button onClick={()=>setTab("advisor")}
                style={{background:"#f3eeff",border:"1.5px solid #e0d4fc",borderRadius:16,padding:"16px 20px",display:"flex",alignItems:"center",gap:12,cursor:"pointer",fontFamily:"inherit",width:"100%",textAlign:"left"}}>
                <I n="brain" s={20} c="#7048e8"/>
                <C style={{gap:2,flex:1}}>
                  <div style={{fontSize:13,fontWeight:700,color:"#7048e8"}}>Ask the Advisor about investing</div>
                  <div style={{fontSize:12,color:"#9e9b95"}}>Learn about 401k, Roth IRA, index funds and more</div>
                </C>
                <I n="chevron" s={15} c="#c8b8f8"/>
              </button>
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
                    <div className="hero-band" style={{background:isPro?"linear-gradient(90deg,#7048e8,#3b5bdb)":"#7048e8"}}/>
                    <div style={{marginTop:8}}>
                      <div style={{width:60,height:60,borderRadius:20,background:"#f3eeff",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 16px",position:"relative"}}>
                        <I n="brain" s={28} c="#7048e8"/>
                        {isPro&&<div style={{position:"absolute",top:-6,right:-6,background:"linear-gradient(135deg,#7048e8,#3b5bdb)",borderRadius:8,padding:"2px 7px",fontSize:9,fontWeight:800,color:"#fff",letterSpacing:"0.05em"}}>PRO</div>}
                      </div>
                      <div style={{fontSize:22,fontWeight:800,letterSpacing:"-0.03em",marginBottom:8}}>Your financial advisor</div>
                      <div style={{fontSize:14,color:"#9e9b95",lineHeight:1.7,maxWidth:320,margin:"0 auto 12px"}}>
                        Ask anything about your money. Upload a paystub and I'll break down every line. I know your numbers — let's make sense of them.
                      </div>
                      {/* Free tier usage pill */}
                      {!hasFullAccess&&(
                        <div style={{display:"inline-flex",alignItems:"center",gap:8,background:"#f3eeff",borderRadius:20,padding:"6px 14px",cursor:"pointer"}}
                          onClick={()=>{setUpgradeReason("Unlock unlimited AI conversations and document analysis.");setShowUpgrade(true);}}>
                          <div style={{width:60,height:6,background:"#e0d4fc",borderRadius:3,overflow:"hidden"}}>
                            <div style={{height:"100%",width:`${Math.min(100,(aiUsageThisMonth/FREE_AI_LIMIT)*100)}%`,background:aiRemaining<=5?"#e03131":"#7048e8",borderRadius:3,transition:"width 0.3s"}}/>
                          </div>
                          <span style={{fontSize:11,fontWeight:700,color:"#7048e8"}}>
                            {aiRemaining > 0 ? `${aiRemaining}/${FREE_AI_LIMIT} messages left` : "Upgrade for unlimited"}
                          </span>
                        </div>
                      )}
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

                  {/* Upload card */}
                  <div className="card" style={{padding:22}}>
                    <R style={{gap:12,marginBottom:14}}>
                      <div style={{width:40,height:40,borderRadius:13,background:"#f3eeff",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                        <I n="upload" s={18} c="#7048e8"/>
                      </div>
                      <C>
                        <div style={{fontSize:14,fontWeight:700,marginBottom:2}}>Upload any financial document</div>
                        <div style={{fontSize:12,color:"#9e9b95",lineHeight:1.5}}>Paystub, receipt, bill, or bank statement — I'll analyze it and connect it to your DayFlow numbers</div>
                      </C>
                    </R>
                    <label style={{display:"flex",alignItems:"center",justifyContent:"center",gap:8,background:"#f3eeff",border:"1.5px dashed #c8b8f8",borderRadius:14,padding:"18px",cursor:"pointer"}}>
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
                    {/* Free tier usage bar */}
                    {!hasFullAccess&&(
                      <R style={{justifyContent:"space-between",marginBottom:8,padding:"6px 10px",background:aiRemaining<=1?"#fff5f5":"#f8f7f2",borderRadius:10}}>
                        <span style={{fontSize:11,color:aiRemaining<=1?"#e03131":"#9e9b95",fontWeight:500}}>
                          {aiRemaining > 0 ? `${aiRemaining} free message${aiRemaining===1?"":"s"} left this month` : "No messages left — upgrade to continue"}
                        </span>
                        <button onClick={()=>{setUpgradeReason("Unlock unlimited AI conversations and document analysis.");setShowUpgrade(true);}}
                          style={{fontSize:11,fontWeight:700,color:"#7048e8",background:"none",border:"none",cursor:"pointer",fontFamily:"inherit",padding:0}}>
                          Upgrade →
                        </button>
                      </R>
                    )}
                    <R style={{gap:8}}>
                      <input className="inp" placeholder={aiRemaining<=0&&!hasFullAccess?"Upgrade to Pro to continue…":"Ask about your finances…"} value={aiInput}
                        onChange={e=>setAiInput(e.target.value)}
                        onKeyDown={e=>e.key==="Enter"&&!e.shiftKey&&sendAiMessage(aiInput)}
                        style={{flex:1,fontSize:14}}
                        disabled={aiRemaining<=0&&!hasFullAccess}/>
                      <button className="btn" onClick={()=>sendAiMessage(aiInput)}
                        disabled={aiLoading||!aiInput.trim()||(aiRemaining<=0&&!hasFullAccess)}
                        style={{padding:"13px 16px",opacity:aiLoading||!aiInput.trim()||(aiRemaining<=0&&!hasFullAccess)?0.4:1,borderRadius:14}}>
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

          {/* ══════ BUSINESS ══════ */}
          {tab==="business"&&(()=>{
            if (!isBusiness) return (
              <C style={{gap:14}}>
                <div className="hero-card" style={{padding:28,textAlign:"center"}}>
                  <div className="hero-band" style={{background:"linear-gradient(135deg,#1a1a2e,#3b5bdb)"}}/>
                  <div style={{marginTop:8}}>
                    <div style={{width:64,height:64,borderRadius:20,background:"#eef3ff",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 16px"}}>
                      <I n="wallet" s={28} c="#3b5bdb"/>
                    </div>
                    <div style={{fontSize:22,fontWeight:800,letterSpacing:"-0.03em",marginBottom:8}}>Business plan</div>
                    <div style={{fontSize:14,color:"#9e9b95",lineHeight:1.7,maxWidth:300,margin:"0 auto 20px"}}>
                      Track business expenses, log mileage, identify tax deductions, and get a year-end tax summary. Built for freelancers and small business owners.
                    </div>
                    <button className="btn" style={{margin:"0 auto",borderRadius:14,padding:"14px 28px",fontSize:14,background:"linear-gradient(135deg,#1a1a2e,#3b5bdb)"}}
                      onClick={()=>{setUpgradeReason("Unlock business expense tracking, tax deductions, and mileage logging.");setShowUpgrade(true);}}>
                      Upgrade to Business — $24.99/mo
                    </button>
                  </div>
                </div>
                {[
                  {icon:"wallet",color:"#3b5bdb",bg:"#eef3ff",title:"AI expense classification",desc:"Upload any receipt and AI instantly categorizes it as a business expense and calculates deductibility."},
                  {icon:"car",color:"#e67700",bg:"#fff4e6",title:"Mileage tracking",desc:"Log business miles at the IRS standard rate of $0.67/mile and track your deduction automatically."},
                  {icon:"brain",color:"#c2255c",bg:"#fff0f6",title:"Tax deduction detection",desc:"The advisor identifies every possible deduction from your expenses — home office, equipment, meals and more."},
                  {icon:"cal",color:"#2f9e44",bg:"#ebfbee",title:"Year-end tax summary",desc:"Get a clean report of all business expenses, deductions, and estimated tax savings ready for your accountant."},
                ].map(({icon,color,bg,title,desc})=>(
                  <div key={title} className="card" style={{padding:20}}>
                    <R style={{gap:14}}>
                      <div style={{width:42,height:42,borderRadius:13,background:bg,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                        <I n={icon} s={19} c={color}/>
                      </div>
                      <C style={{gap:3}}>
                        <div style={{fontSize:13,fontWeight:700}}>{title}</div>
                        <div style={{fontSize:12,color:"#9e9b95",lineHeight:1.5}}>{desc}</div>
                      </C>
                    </R>
                  </div>
                ))}
              </C>
            );

            const addBizExpense = () => {
              if (!newBizExp.label||!newBizExp.amount) return;
              const exp = {
                id:Date.now(), label:newBizExp.label, amount:parseFloat(newBizExp.amount),
                category:newBizExp.category, notes:newBizExp.notes,
                businessId:newBizExp.businessId||activeBiz?.id,
                deductible:newBizExp.deductible!==false, date:todayKey(),
              };
              const key = todayKey();
              const existing = data.businessExpenses?.[key] || [];
              upd({businessExpenses:{...data.businessExpenses,[key]:[...existing,exp]}});
              setNewBizExp({label:"",amount:"",category:"software",notes:"",businessId:activeBiz?.id||""});
            };

            const addMileage = () => {
              if (!newMileage.miles||!newMileage.purpose) return;
              const log = {id:Date.now(),date:todayKey(),miles:parseFloat(newMileage.miles),purpose:newMileage.purpose,businessId:newMileage.businessId||activeBiz?.id,deductible:true};
              upd({mileageLogs:[...(data.mileageLogs||[]),log]});
              setNewMileage({miles:"",purpose:"",businessId:activeBiz?.id||""});
            };

            const addBusiness = () => {
              if (!newBiz.name.trim()) return;
              const biz = {id:Date.now(),name:newBiz.name.trim(),type:newBiz.type,ein:newBiz.ein,color:newBiz.color};
              upd({businesses:[...(data.businesses||[]),biz],activeBusinessId:biz.id});
              setNewBiz({name:"",type:"freelance",ein:"",color:"#3b5bdb"});
            };

            const totalMiles = (data.mileageLogs||[]).reduce((s,m)=>s+parseFloat(m.miles||0),0);
            const mileageDeduction = totalMiles * 0.67;
            const allExpenses = Object.values(data.businessExpenses||{}).flat().sort((a,b)=>b.date?.localeCompare(a.date));

            return (
              <C style={{gap:14}}>
                {/* Business hero */}
                <div className="hero-card" style={{padding:22}}>
                  <div className="hero-band" style={{background:"linear-gradient(135deg,#1a1a2e,#3b5bdb)"}}/>
                  <div style={{marginTop:8}}>
                    <R style={{justifyContent:"space-between",alignItems:"flex-start",marginBottom:16}}>
                      <C style={{gap:3}}>
                        <div className="sec-hd" style={{marginBottom:0}}>{activeBiz?.name||"Business"}</div>
                        <div style={{fontSize:12,color:"#9e9b95"}}>{activeBiz?.type||"Add your business below"}</div>
                      </C>
                      <div style={{background:"linear-gradient(135deg,#1a1a2e,#3b5bdb)",borderRadius:8,padding:"3px 10px",fontSize:9,fontWeight:800,color:"#fff",letterSpacing:"0.05em"}}>BUSINESS</div>
                    </R>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
                      {[
                        {label:"Total expenses",val:fmtFull(totalBizExpenses),color:"#e03131"},
                        {label:"Deductible",val:fmtFull(totalDeductible),color:"#2f9e44"},
                        {label:"Est. tax saved",val:fmtFull(estimatedTaxSavings),color:"#3b5bdb"},
                      ].map(({label,val,color})=>(
                        <C key={label} style={{background:"#f8f7f2",borderRadius:12,padding:"12px",gap:3}}>
                          <div style={{fontSize:9,fontWeight:700,color:"#bbb9b0",letterSpacing:"0.08em",textTransform:"uppercase"}}>{label}</div>
                          <div style={{fontSize:15,fontWeight:700,color}}>{val}</div>
                        </C>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Sub-nav */}
                <div style={{display:"flex",background:"#f0efe9",borderRadius:14,padding:3,gap:2}}>
                  {[{id:"expenses",label:"Expenses"},{id:"mileage",label:"Mileage"},{id:"taxes",label:"Tax summary"},{id:"profile",label:"Profile"}].map(v=>(
                    <button key={v.id} className={`seg-opt${bizTab===v.id?" on":""}`}
                      onClick={()=>setBizTab(v.id)}
                      style={{flex:1,padding:"9px 4px",fontSize:11,textAlign:"center"}}>
                      {v.label}
                    </button>
                  ))}
                </div>

                {/* EXPENSES */}
                {bizTab==="expenses"&&(
                  <C style={{gap:14}}>
                    {/* Add expense */}
                    <div className="card" style={{padding:22}}>
                      <R style={{justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                        <div className="sec-hd" style={{marginBottom:0}}>Log business expense</div>
                        <label style={{display:"flex",alignItems:"center",gap:6,background:"#eef3ff",borderRadius:10,padding:"7px 12px",cursor:"pointer",fontSize:12,fontWeight:600,color:"#3b5bdb"}}>
                          {bizScanLoading
                            ? <div style={{width:14,height:14,border:"2px solid #aac4f8",borderTopColor:"#3b5bdb",borderRadius:"50%"}} className="spin"/>
                            : <I n="camera" s={14} c="#3b5bdb"/>}
                          {bizScanLoading?"Scanning…":"Scan receipt"}
                          <input type="file" accept="image/*" capture="environment" onChange={e=>scanBusinessReceipt(e.target.files?.[0])} style={{display:"none"}}/>
                        </label>
                      </R>
                      <input className="inp" placeholder="Expense description" value={newBizExp.label}
                        onChange={e=>setNewBizExp(p=>({...p,label:e.target.value}))} style={{marginBottom:10}}/>
                      <R style={{gap:8,marginBottom:10}}>
                        <input className="inp" type="number" placeholder="Amount" value={newBizExp.amount}
                          onChange={e=>setNewBizExp(p=>({...p,amount:e.target.value}))} style={{flex:1}}/>
                        <select className="sel" value={newBizExp.category} onChange={e=>setNewBizExp(p=>({...p,category:e.target.value}))}>
                          {BIZ_CATS.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
                        </select>
                      </R>
                      <input className="inp" placeholder="Notes (optional)" value={newBizExp.notes}
                        onChange={e=>setNewBizExp(p=>({...p,notes:e.target.value}))} style={{marginBottom:10}}/>
                      <R style={{gap:10,marginBottom:14,alignItems:"center"}}>
                        <button onClick={()=>setNewBizExp(p=>({...p,deductible:!p.deductible}))}
                          style={{display:"flex",alignItems:"center",gap:6,background:newBizExp.deductible!==false?"#ebfbee":"#f8f7f2",border:`1.5px solid ${newBizExp.deductible!==false?"#2f9e44":"#e8e5dc"}`,borderRadius:10,padding:"7px 12px",cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:600,color:newBizExp.deductible!==false?"#2f9e44":"#9e9b95"}}>
                          <div style={{width:14,height:14,borderRadius:"50%",background:newBizExp.deductible!==false?"#2f9e44":"#e8e5dc",display:"flex",alignItems:"center",justifyContent:"center"}}>
                            {newBizExp.deductible!==false&&<div style={{width:6,height:6,borderRadius:"50%",background:"#fff"}}/>}
                          </div>
                          Business deductible
                        </button>
                        <div style={{fontSize:11,color:"#9e9b95",flex:1}}>
                          {BIZ_CATS.find(c=>c.id===newBizExp.category)?.desc}
                        </div>
                      </R>
                      <button className="btn" onClick={addBizExpense} style={{width:"100%",justifyContent:"center"}}>
                        <I n="plus" s={15} c="#fff"/> Add expense
                      </button>
                    </div>

                    {/* Expense list */}
                    {allExpenses.length>0?(
                      <div className="card" style={{padding:22}}>
                        <R style={{justifyContent:"space-between",marginBottom:14}}>
                          <div className="sec-hd" style={{marginBottom:0}}>All expenses</div>
                          <div style={{fontSize:11,color:"#9e9b95"}}>{allExpenses.length} items</div>
                        </R>
                        {allExpenses.map(e=>{
                          const cat = BIZ_CATS.find(c=>c.id===e.category)||BIZ_CATS[BIZ_CATS.length-1];
                          return (
                            <div key={e.id} className="tx-row">
                              <div style={{width:38,height:38,borderRadius:12,background:"#eef3ff",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                                <I n={cat.icon} s={16} c="#3b5bdb"/>
                              </div>
                              <C style={{flex:1,minWidth:0,gap:2}}>
                                <div style={{fontSize:13,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{e.label}</div>
                                <R style={{gap:6}}>
                                  <span style={{fontSize:10,color:"#9e9b95"}}>{cat.label}</span>
                                  {e.deductible&&<span style={{fontSize:10,color:"#2f9e44",fontWeight:600}}>✓ Deductible</span>}
                                </R>
                              </C>
                              <div style={{fontSize:13,fontWeight:700,color:"#e03131",flexShrink:0}}>−{fmtFull(e.amount)}</div>
                            </div>
                          );
                        })}
                      </div>
                    ):(
                      <div style={{textAlign:"center",padding:30,color:"#bbb9b0",fontSize:13}}>No expenses logged yet — add your first above or scan a receipt</div>
                    )}
                  </C>
                )}

                {/* MILEAGE */}
                {bizTab==="mileage"&&(
                  <C style={{gap:14}}>
                    <div className="card" style={{padding:22}}>
                      <div className="sec-hd">Log mileage</div>
                      <div style={{background:"#eef3ff",borderRadius:12,padding:"12px 16px",marginBottom:14}}>
                        <div style={{fontSize:12,fontWeight:700,color:"#3b5bdb",marginBottom:4}}>2024 IRS standard rate</div>
                        <div style={{fontSize:22,fontWeight:800,color:"#1a1a2e",letterSpacing:"-0.02em"}}>$0.67 <span style={{fontSize:13,fontWeight:400,color:"#9e9b95"}}>/mile</span></div>
                        <div style={{fontSize:11,color:"#9e9b95",marginTop:4}}>Your {totalMiles.toFixed(1)} logged miles = {fmtFull(mileageDeduction)} deduction</div>
                      </div>
                      <R style={{gap:8,marginBottom:10}}>
                        <input className="inp" type="number" placeholder="Miles" value={newMileage.miles}
                          onChange={e=>setNewMileage(p=>({...p,miles:e.target.value}))} style={{flex:1}}/>
                        <input className="inp" placeholder="Purpose (e.g. client meeting)" value={newMileage.purpose}
                          onChange={e=>setNewMileage(p=>({...p,purpose:e.target.value}))} style={{flex:2}}/>
                      </R>
                      <button className="btn" onClick={addMileage} style={{width:"100%",justifyContent:"center"}}>
                        <I n="plus" s={15} c="#fff"/> Log miles
                      </button>
                    </div>
                    {(data.mileageLogs||[]).length>0&&(
                      <div className="card" style={{padding:22}}>
                        <div className="sec-hd">Mileage log</div>
                        {[...(data.mileageLogs||[])].reverse().map(log=>(
                          <div key={log.id} className="tx-row">
                            <div style={{width:38,height:38,borderRadius:12,background:"#fff4e6",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                              <I n="car" s={16} c="#e67700"/>
                            </div>
                            <C style={{flex:1,gap:1}}>
                              <div style={{fontSize:13,fontWeight:600}}>{log.purpose}</div>
                              <div style={{fontSize:10,color:"#9e9b95"}}>{log.date} · {fmtFull(parseFloat(log.miles)*0.67)} deduction</div>
                            </C>
                            <div style={{fontSize:13,fontWeight:700,color:"#e67700"}}>{parseFloat(log.miles).toFixed(1)} mi</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </C>
                )}

                {/* TAX SUMMARY */}
                {bizTab==="taxes"&&(
                  <C style={{gap:14}}>
                    <div className="card" style={{padding:22}}>
                      <div className="sec-hd">Tax deduction summary</div>
                      <div style={{fontSize:13,color:"#9e9b95",marginBottom:16,lineHeight:1.6}}>
                        Based on your logged expenses. Always verify with a CPA for your specific situation.
                      </div>
                      {/* Deduction breakdown by category */}
                      {BIZ_CATS.map(cat=>{
                        const catExps = allExpenses.filter(e=>e.category===cat.id&&e.deductible);
                        if (!catExps.length) return null;
                        const total = catExps.reduce((s,e)=>s+e.amount,0);
                        const deductAmt = total * (cat.deduct/100);
                        return (
                          <R key={cat.id} style={{justifyContent:"space-between",padding:"10px 0",borderBottom:"1px solid #f8f7f2"}}>
                            <C style={{gap:2}}>
                              <div style={{fontSize:13,fontWeight:600}}>{cat.label}</div>
                              <div style={{fontSize:10,color:"#9e9b95"}}>{catExps.length} expense{catExps.length!==1?"s":""} · {cat.deduct}% deductible</div>
                            </C>
                            <div style={{fontSize:13,fontWeight:700,color:"#2f9e44"}}>{fmtFull(deductAmt)}</div>
                          </R>
                        );
                      })}
                      {/* Mileage */}
                      {totalMiles>0&&(
                        <R style={{justifyContent:"space-between",padding:"10px 0",borderBottom:"1px solid #f8f7f2"}}>
                          <C style={{gap:2}}>
                            <div style={{fontSize:13,fontWeight:600}}>Vehicle mileage</div>
                            <div style={{fontSize:10,color:"#9e9b95"}}>{totalMiles.toFixed(1)} miles × $0.67</div>
                          </C>
                          <div style={{fontSize:13,fontWeight:700,color:"#2f9e44"}}>{fmtFull(mileageDeduction)}</div>
                        </R>
                      )}
                      {/* Totals */}
                      <div style={{background:"#ebfbee",borderRadius:14,padding:16,marginTop:14}}>
                        <R style={{justifyContent:"space-between",marginBottom:8}}>
                          <span style={{fontSize:13,color:"#1a1a2e",fontWeight:600}}>Total deductible</span>
                          <span style={{fontSize:16,fontWeight:800,color:"#2f9e44"}}>{fmtFull(totalDeductible+mileageDeduction)}</span>
                        </R>
                        <R style={{justifyContent:"space-between"}}>
                          <span style={{fontSize:12,color:"#9e9b95"}}>Est. tax savings (~25% rate)</span>
                          <span style={{fontSize:14,fontWeight:700,color:"#2f9e44"}}>{fmtFull((totalDeductible+mileageDeduction)*0.25)}</span>
                        </R>
                      </div>
                    </div>
                    {/* Ask advisor */}
                    <button onClick={()=>{setTab("advisor");sendAiMessage("Give me a tax planning summary based on my business expenses and deductions. What am I missing?");}}
                      style={{background:"#f3eeff",border:"1.5px solid #e0d4fc",borderRadius:16,padding:"16px 20px",display:"flex",alignItems:"center",gap:12,cursor:"pointer",fontFamily:"inherit",width:"100%",textAlign:"left"}}>
                      <I n="brain" s={20} c="#7048e8"/>
                      <C style={{gap:2,flex:1}}>
                        <div style={{fontSize:13,fontWeight:700,color:"#7048e8"}}>Ask advisor to review my taxes</div>
                        <div style={{fontSize:12,color:"#9e9b95"}}>Get personalized tax planning advice</div>
                      </C>
                      <I n="chevron" s={15} c="#c8b8f8"/>
                    </button>
                  </C>
                )}

                {/* PROFILE */}
                {bizTab==="profile"&&(
                  <C style={{gap:14}}>
                    {/* Add business */}
                    <div className="card" style={{padding:22}}>
                      <div className="sec-hd">Add a business</div>
                      <input className="inp" placeholder="Business name" value={newBiz.name}
                        onChange={e=>setNewBiz(p=>({...p,name:e.target.value}))} style={{marginBottom:10}}/>
                      <select className="sel" value={newBiz.type} onChange={e=>setNewBiz(p=>({...p,type:e.target.value}))} style={{width:"100%",marginBottom:10}}>
                        <option value="freelance">Freelancer / Independent contractor</option>
                        <option value="llc">LLC</option>
                        <option value="sole_prop">Sole proprietorship</option>
                        <option value="s_corp">S-Corporation</option>
                        <option value="partnership">Partnership</option>
                        <option value="other">Other</option>
                      </select>
                      <input className="inp" placeholder="EIN (optional)" value={newBiz.ein}
                        onChange={e=>setNewBiz(p=>({...p,ein:e.target.value}))} style={{marginBottom:14}}/>
                      <button className="btn" onClick={addBusiness} style={{width:"100%",justifyContent:"center"}}>
                        <I n="plus" s={15} c="#fff"/> Add business
                      </button>
                    </div>
                    {/* Existing businesses */}
                    {(data.businesses||[]).map(biz=>(
                      <div key={biz.id} className="card" style={{padding:20,borderLeft:`3px solid ${biz.color}`}}>
                        <R style={{justifyContent:"space-between"}}>
                          <C style={{gap:3}}>
                            <div style={{fontSize:14,fontWeight:700}}>{biz.name}</div>
                            <div style={{fontSize:12,color:"#9e9b95",textTransform:"capitalize"}}>{biz.type.replace("_"," ")}{biz.ein?` · EIN: ${biz.ein}`:""}</div>
                          </C>
                          <R style={{gap:8}}>
                            {data.activeBusinessId===biz.id
                              ? <div style={{fontSize:11,fontWeight:700,color:"#2f9e44",background:"#ebfbee",padding:"4px 10px",borderRadius:8}}>Active</div>
                              : <button className="btn-ghost" style={{fontSize:11,padding:"4px 10px"}} onClick={()=>upd({activeBusinessId:biz.id})}>Set active</button>
                            }
                            <button className="rm" onClick={()=>upd({businesses:(data.businesses||[]).filter(b=>b.id!==biz.id)})}><I n="x" s={14}/></button>
                          </R>
                        </R>
                      </div>
                    ))}
                  </C>
                )}
              </C>
            );
          })()}

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
            <div onClick={()=>setMenuOpen(false)} style={{position:"fixed",inset:0,zIndex:40}}/>
            <div style={{
              position:"fixed",
              bottom:90,
              left:"50%",
              transform:"translateX(-50%)",
              width:"min(calc(100% - 40px), 520px)",
              zIndex:45,
              background:"#fff",
              borderRadius:24,
              boxShadow:"0 -2px 0 rgba(0,0,0,0.04),0 8px 40px rgba(0,0,0,0.16)",
              border:"1px solid #f0efe9",
              overflow:"hidden",
              willChange:"opacity,transform",
              animation:"menuPop 0.18s cubic-bezier(.34,1.4,.64,1) both",
            }}>
              {/* User info bar */}
              {user&&(
                <div style={{padding:"14px 20px",background:"#f8f7f2",borderBottom:"1px solid #f0efe9"}}>
                  <div style={{fontSize:11,fontWeight:700,color:"#bbb9b0",letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:2}}>Signed in as</div>
                  <div style={{fontSize:13,fontWeight:600,color:"#1a1a2e",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{user.user_metadata?.full_name||user.email}</div>
                </div>
              )}
              {/* Nav items */}
              {[
                {id:"bank",     icon:"bank",   label:"Bank sync",       sub:"Coming soon — auto-import transactions"},
                {id:"business", icon:"wallet", label:"Business",        sub:isBusiness?"Expenses, mileage & taxes":"Upgrade to Business plan"},
                {id:"settings", icon:"gear",   label:"Setup",           sub:"Income, pool & preferences"},
              ].map((item,i)=>(
                <button key={item.id} onClick={()=>{setTab(item.id);setMenuOpen(false);}}
                  style={{width:"100%",display:"flex",alignItems:"center",gap:14,padding:"16px 20px",background:"none",border:"none",borderTop:"1px solid #f0efe9",cursor:"pointer",fontFamily:"inherit",transition:"background 0.15s",textAlign:"left"}}>
                  <div style={{width:40,height:40,borderRadius:12,background:"#f0efe9",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                    <I n={item.icon} s={19} c="#1a1a2e"/>
                  </div>
                  <C style={{gap:2,flex:1}}>
                    <div style={{fontSize:14,fontWeight:700,color:"#1a1a2e"}}>{item.label}</div>
                    <div style={{fontSize:12,color:"#9e9b95"}}>{item.sub}</div>
                  </C>
                  <I n="chevron" s={15} c="#ccc9c0"/>
                </button>
              ))}
              {/* Tutorial */}
              <button onClick={()=>{setMenuOpen(false);setTutorialStep(0);setShowTutorial(true);}}
                style={{width:"100%",display:"flex",alignItems:"center",gap:14,padding:"16px 20px",background:"none",border:"none",borderTop:"1px solid #f0efe9",cursor:"pointer",fontFamily:"inherit",transition:"background 0.15s",textAlign:"left"}}>
                <div style={{width:40,height:40,borderRadius:12,background:"#fff8db",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                  <I n="sparkle" s={19} c="#f59f00"/>
                </div>
                <C style={{gap:2,flex:1}}>
                  <div style={{fontSize:14,fontWeight:700,color:"#1a1a2e"}}>How DayFlow works</div>
                  <div style={{fontSize:12,color:"#9e9b95"}}>Replay the intro tutorial</div>
                </C>
                <I n="chevron" s={15} c="#ccc9c0"/>
              </button>
              {/* Sign out */}
              {user&&(
                <button onClick={()=>{setMenuOpen(false);signOut();}}
                  style={{width:"100%",display:"flex",alignItems:"center",gap:14,padding:"16px 20px",background:"none",border:"none",borderTop:"1px solid #f0efe9",cursor:"pointer",fontFamily:"inherit",transition:"background 0.15s",textAlign:"left"}}
                  onMouseEnter={e=>e.currentTarget.style.background="#fff5f5"}
                  onMouseLeave={e=>e.currentTarget.style.background="none"}>
                  <div style={{width:40,height:40,borderRadius:12,background:"#fff5f5",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                    <I n="x" s={19} c="#e03131"/>
                  </div>
                  <C style={{gap:2,flex:1}}>
                    <div style={{fontSize:14,fontWeight:700,color:"#e03131"}}>Sign out</div>
                    <div style={{fontSize:12,color:"#bbb9b0"}}>You'll need to sign back in</div>
                  </C>
                </button>
              )}
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

        {/* ── Upgrade modal ─────────────────────────────────────────────────────── */}
        {showUpgrade&&(
          <div style={{position:"fixed",inset:0,zIndex:100,background:"rgba(0,0,0,0.6)",display:"flex",alignItems:"flex-end",justifyContent:"center",padding:"0 0 0"}}>
            <div style={{background:"#fff",borderRadius:"28px 28px 0 0",padding:"32px 24px 48px",width:"100%",maxWidth:560,animation:"slideUp 0.3s cubic-bezier(.4,0,.2,1)"}}>
              <div style={{width:40,height:4,borderRadius:2,background:"#e8e5dc",margin:"0 auto 28px"}}/>

              {/* Header */}
              <div style={{textAlign:"center",marginBottom:28}}>
                <div style={{width:64,height:64,borderRadius:20,background:"linear-gradient(135deg,#7048e8,#3b5bdb)",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 16px",boxShadow:"0 8px 24px rgba(112,72,232,0.3)"}}>
                  <I n="sparkle" s={28} c="#fff"/>
                </div>
                <div style={{fontSize:24,fontWeight:800,letterSpacing:"-0.03em",marginBottom:8}}>Upgrade to Pro</div>
                <div style={{fontSize:14,color:"#9e9b95",lineHeight:1.6,maxWidth:300,margin:"0 auto"}}>{upgradeReason}</div>
              </div>

              {/* Comparison */}
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:20}}>
                {/* Free */}
                <div style={{background:"#f8f7f2",borderRadius:16,padding:14}}>
                  <div style={{fontSize:11,fontWeight:700,color:"#9e9b95",marginBottom:10,textTransform:"uppercase",letterSpacing:"0.06em"}}>Free</div>
                  {[
                    "Manual tracking","Charts","Household","20 AI msgs/mo",
                    "Doc analysis","Receipt scan","Tax deductions","1 business",
                  ].map(f=>(
                    <R key={f} style={{gap:6,marginBottom:6}}>
                      <div style={{width:12,height:12,borderRadius:"50%",background:"#ebfbee",border:"1px solid #2f9e44",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                        <div style={{width:5,height:5,borderRadius:"50%",background:"#2f9e44"}}/>
                      </div>
                      <span style={{fontSize:10,color:"#1a1a2e"}}>{f}</span>
                    </R>
                  ))}
                  {["Bank sync","Unlimited AI","Tax export"].map(f=>(
                    <R key={f} style={{gap:6,marginBottom:6}}>
                      <div style={{width:12,height:12,borderRadius:"50%",background:"#f8f7f2",border:"1px solid #e8e5dc",flexShrink:0}}/>
                      <span style={{fontSize:10,color:"#bbb9b0"}}>{f}</span>
                    </R>
                  ))}
                </div>
                {/* Pro */}
                <div style={{background:"linear-gradient(135deg,#f3eeff,#eef3ff)",borderRadius:16,padding:14,border:"1.5px solid #c8b8f8",position:"relative"}}>
                  <div style={{position:"absolute",top:-9,left:"50%",transform:"translateX(-50%)",background:"linear-gradient(135deg,#7048e8,#3b5bdb)",borderRadius:20,padding:"2px 10px",fontSize:9,fontWeight:800,color:"#fff",whiteSpace:"nowrap"}}>POPULAR</div>
                  <div style={{fontSize:11,fontWeight:700,color:"#7048e8",marginBottom:10,textTransform:"uppercase",letterSpacing:"0.06em"}}>Pro — $4.99/mo</div>
                  {[
                    "Everything free","Unlimited AI","Bank sync (soon)",
                    "Tax summary export","Full history","Priority support",
                  ].map(f=>(
                    <R key={f} style={{gap:6,marginBottom:6}}>
                      <div style={{width:12,height:12,borderRadius:"50%",background:"#f3eeff",border:"1.5px solid #7048e8",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                        <div style={{width:5,height:5,borderRadius:"50%",background:"#7048e8"}}/>
                      </div>
                      <span style={{fontSize:10,color:"#1a1a2e",fontWeight:500}}>{f}</span>
                    </R>
                  ))}
                </div>
                {/* Business */}
                <div style={{background:"linear-gradient(135deg,#1a1a2e,#2d3561)",borderRadius:16,padding:14,position:"relative"}}>
                  <div style={{fontSize:11,fontWeight:700,color:"rgba(255,255,255,0.6)",marginBottom:10,textTransform:"uppercase",letterSpacing:"0.06em"}}>Business — $24.99/mo</div>
                  {[
                    "Everything Pro","Unlimited businesses","Team members",
                    "Client invoicing","Advanced reports","Dedicated support",
                  ].map(f=>(
                    <R key={f} style={{gap:6,marginBottom:6}}>
                      <div style={{width:12,height:12,borderRadius:"50%",background:"rgba(255,255,255,0.15)",border:"1px solid rgba(255,255,255,0.4)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                        <div style={{width:5,height:5,borderRadius:"50%",background:"#fff"}}/>
                      </div>
                      <span style={{fontSize:10,color:"rgba(255,255,255,0.85)"}}>{f}</span>
                    </R>
                  ))}
                </div>
              </div>

              {/* Pricing */}
              <div style={{background:"#f8f7f2",borderRadius:16,padding:"16px 20px",marginBottom:16}}>
                <R style={{justifyContent:"space-between",alignItems:"center"}}>
                  <C style={{gap:3}}>
                    <div style={{fontSize:13,fontWeight:700}}>DayFlow Pro</div>
                    <div style={{fontSize:11,color:"#9e9b95"}}>Cancel anytime · No commitment</div>
                  </C>
                  <R style={{gap:4,alignItems:"baseline"}}>
                    <div style={{display:"flex",alignItems:"baseline",gap:6}}><div style={{fontSize:22,fontWeight:500,color:"#bbb9b0",textDecoration:"line-through"}}>$9.99</div><div style={{fontSize:28,fontWeight:800,color:"#7048e8",letterSpacing:"-0.04em"}}>$4.99</div></div>
                    <div style={{fontSize:12,color:"#9e9b95"}}>/month</div>
                  </R>
                </R>
                <div style={{fontSize:11,color:"#9e9b95",marginTop:6}}>Or $79.99/year (save 33%) · Launch pricing — locks in your rate forever</div>
              </div>

              {/* Discount code input */}
              {(()=>{
                const startCheckout = async (plan) => {
                  setCheckoutLoading(true);
                  try {
                    const SUPABASE_URL = "https://icsauqhyroyfugacmmze.supabase.co";
                    const PRICES = {
                      pro_monthly:      "price_1TDvC2EHLJtYfhmkOqOXTxMe",
                      pro_annual:       "price_1TDvFnEHLJtYfhmkUAJLYCpG",
                      business_monthly: "price_1TDvFOEHLJtYfhmkGmcEEyv9",
                      business_annual:  "price_1TDvFOEHLJtYfhmkZQ3HhjTy",
                    };
                    const priceId = PRICES[plan];
                    const planName = plan.startsWith("pro") ? "pro" : "business";
                    const res = await fetch(`${SUPABASE_URL}/functions/v1/stripe-checkout`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        priceId,
                        userId: user?.id,
                        email: user?.email,
                        plan: planName,
                        discountCode: discountInput.trim().toUpperCase(),
                      }),
                    });
                    const { url, error } = await res.json();
                    if (error) throw new Error(error);
                    if (url) window.location.href = url;
                  } catch(e) {
                    alert("Stripe checkout coming soon! Email brad@dayflow.gg to upgrade early.");
                  }
                  setCheckoutLoading(false);
                };

                return (
                  <>
                    <div style={{marginBottom:16}}>
                      <input className="inp" placeholder="Discount code (e.g. BRAD50)"
                        value={discountInput}
                        onChange={e=>setDiscountInput(e.target.value.toUpperCase())}
                        style={{width:"100%",fontSize:13,textAlign:"center",letterSpacing:"0.08em",fontWeight:600}}/>
                    </div>

                    {/* Pro CTA */}
                    <button className="btn" disabled={checkoutLoading}
                      style={{width:"100%",justifyContent:"center",borderRadius:14,padding:"15px",fontSize:14,background:"linear-gradient(135deg,#7048e8,#3b5bdb)",boxShadow:"0 6px 20px rgba(112,72,232,0.3)",marginBottom:10,opacity:checkoutLoading?0.7:1}}
                      onClick={()=>startCheckout("pro_monthly")}>
                      <I n="sparkle" s={15} c="#fff"/>
                      {checkoutLoading ? "Loading…" : "Upgrade to Pro — $4.99/mo ✦ Launch price"}
                    </button>

                    {/* Annual Pro */}
                    <button className="btn-ghost" disabled={checkoutLoading}
                      style={{width:"100%",justifyContent:"center",borderRadius:14,padding:"12px",fontSize:13,marginBottom:10}}
                      onClick={()=>startCheckout("pro_annual")}>
                      Pro annual — $79.99/yr (save 33%)
                    </button>

                    {/* Business CTA */}
                    <button className="btn" disabled={checkoutLoading}
                      style={{width:"100%",justifyContent:"center",borderRadius:14,padding:"15px",fontSize:14,background:"linear-gradient(135deg,#1a1a2e,#3b5bdb)",marginBottom:10,opacity:checkoutLoading?0.7:1}}
                      onClick={()=>startCheckout("business_monthly")}>
                      <I n="wallet" s={15} c="#fff"/>
                      {checkoutLoading ? "Loading…" : "Upgrade to Business — $24.99/mo"}
                    </button>

                    <div style={{textAlign:"center",fontSize:11,color:"#bbb9b0",marginBottom:12}}>
                      7-day free trial · Cancel anytime · Secure payment via Stripe
                    </div>
                    <button onClick={()=>setShowUpgrade(false)}
                      style={{width:"100%",background:"none",border:"none",fontSize:13,color:"#9e9b95",cursor:"pointer",fontFamily:"inherit",padding:"8px"}}>
                      Maybe later
                    </button>
                  </>
                );
              })()}
            </div>
          </div>
        )}

        {/* ── Tutorial overlay ──────────────────────────────────────────────────── */}
        {showTutorial&&(
          <div style={{position:"fixed",inset:0,zIndex:100,background:"rgba(0,0,0,0.6)",display:"flex",alignItems:"flex-end",justifyContent:"center",padding:"0 0 100px"}}>
            <div style={{background:"#fff",borderRadius:28,padding:32,width:"calc(100% - 40px)",maxWidth:480,animation:"slideUp 0.35s cubic-bezier(.4,0,.2,1)"}}>
              {/* Progress dots */}
              <R style={{justifyContent:"center",gap:6,marginBottom:24}}>
                {TUTORIAL_STEPS.map((_,i)=>(
                  <div key={i} style={{width:i===tutorialStep?20:6,height:6,borderRadius:3,background:i===tutorialStep?TUTORIAL_STEPS[tutorialStep].color:"#f0efe9",transition:"all 0.3s"}}/>
                ))}
              </R>
              {/* Icon */}
              <div style={{width:64,height:64,borderRadius:20,background:TUTORIAL_STEPS[tutorialStep].color+"18",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 20px"}}>
                <I n={TUTORIAL_STEPS[tutorialStep].icon} s={30} c={TUTORIAL_STEPS[tutorialStep].color}/>
              </div>
              {/* Content */}
              <div style={{textAlign:"center",marginBottom:28}}>
                <div style={{fontSize:22,fontWeight:800,letterSpacing:"-0.03em",marginBottom:10,color:"#1a1a2e"}}>
                  {TUTORIAL_STEPS[tutorialStep].title}
                </div>
                <div style={{fontSize:15,color:"#6b6864",lineHeight:1.7}}>
                  {TUTORIAL_STEPS[tutorialStep].body}
                </div>
              </div>
              {/* Buttons */}
              <R style={{gap:10}}>
                {tutorialStep>0&&(
                  <button onClick={()=>setTutorialStep(p=>p-1)}
                    style={{flex:1,padding:"14px",background:"#f0efe9",border:"none",borderRadius:14,fontSize:14,fontWeight:600,color:"#6b6864",cursor:"pointer",fontFamily:"inherit"}}>
                    ← Back
                  </button>
                )}
                <button onClick={()=>tutorialStep<TUTORIAL_STEPS.length-1?setTutorialStep(p=>p+1):completeTutorial()}
                  style={{flex:2,padding:"14px",background:TUTORIAL_STEPS[tutorialStep].color,border:"none",borderRadius:14,fontSize:14,fontWeight:700,color:"#fff",cursor:"pointer",fontFamily:"inherit"}}>
                  {tutorialStep<TUTORIAL_STEPS.length-1?"Next →":"Let's go! 🚀"}
                </button>
              </R>
              {/* Skip */}
              {tutorialStep<TUTORIAL_STEPS.length-1&&(
                <button onClick={completeTutorial}
                  style={{width:"100%",marginTop:12,background:"none",border:"none",fontSize:13,color:"#bbb9b0",cursor:"pointer",fontFamily:"inherit"}}>
                  Skip tutorial
                </button>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
