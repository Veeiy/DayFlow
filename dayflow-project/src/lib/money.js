import { DIM, WEEKS_IN_MONTH, thisMonth, todayKey } from "./dates.js";

export const monthlyEquiv = (p) => {
  if (p.frequency === "monthly") return p.amount;
  if (p.frequency === "weekly")  return p.amount * WEEKS_IN_MONTH;
  if (p.frequency === "yearly")  return p.amount / 12;
  if (p.frequency === "daily")   return p.amount * DIM;
  return p.amount;
};

export const totalBills = (ps) => ps.reduce((s, p) => s + monthlyEquiv(p), 0);
export const calcPool   = (inc, ps) => inc - totalBills(ps);
export const calcDaily  = (pool) => pool / DIM;

export const calcMonthSpent = (entries, ptx = []) => {
  const pfx = thisMonth();
  let m = 0;
  for (const [k, e] of Object.entries(entries)) {
    if (!k.startsWith(pfx)) continue;
    for (const t of (e.transactions || [])) if (t.type === "expense") m += t.amount;
  }
  return m + ptx.filter(t => t.date?.startsWith(pfx) && t.amount > 0).reduce((s, t) => s + t.amount, 0);
};

export const calcDaySpent = (entry, ptx = [], key = todayKey()) =>
  (entry?.transactions || []).filter(t => t.type === "expense").reduce((s, t) => s + t.amount, 0)
  + ptx.filter(t => t.date === key && t.amount > 0).reduce((s, t) => s + t.amount, 0);

export const fmt     = (n) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Math.abs(n ?? 0));
export const fmtFull = (n) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(n ?? 0));
export const fmtDate = (k) => new Date(k + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
