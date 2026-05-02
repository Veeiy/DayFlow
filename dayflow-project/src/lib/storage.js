export const STORE_KEY   = "dayflow_v3";
export const ONBOARD_KEY = "dayflow_onboarded_v1";

export const DEFAULTS = {
  monthlyIncome: 0,
  monthlyIncomes: {},
  recurringPayments: [],
  dailyEntries: {},
  plaidConnected: false,
  plaidTransactions: [],
  bankName: "",
  members: [],
  householdMode: false,
};

export const load = () => {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORE_KEY) || "{}") }; }
  catch { return DEFAULTS; }
};

export const persist = (d) => localStorage.setItem(STORE_KEY, JSON.stringify(d));
