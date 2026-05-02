export const CATS = [
  { id: "housing",       label: "Housing",       icon: "home",   bg: "#eef3ff", fg: "#3b5bdb" },
  { id: "transport",     label: "Transport",     icon: "car",    bg: "#fff4e6", fg: "#e67700" },
  { id: "subscriptions", label: "Subscriptions", icon: "play",   bg: "#f3eeff", fg: "#7048e8" },
  { id: "insurance",     label: "Insurance",     icon: "shield", bg: "#ebfbee", fg: "#2f9e44" },
  { id: "health",        label: "Health",        icon: "heart",  bg: "#fff0f6", fg: "#c2255c" },
  { id: "food",          label: "Food",          icon: "coffee", bg: "#fff8db", fg: "#e67700" },
  { id: "utilities",     label: "Utilities",     icon: "bolt",   bg: "#fffde7", fg: "#f59f00" },
  { id: "other",         label: "Other",         icon: "repeat", bg: "#f1f3f5", fg: "#868e96" },
];

export const CAT_MAP = Object.fromEntries(CATS.map(c => [c.id, c]));

export const BANKS = ["Chase", "Bank of America", "Wells Fargo", "Citibank", "Capital One", "US Bank", "PNC Bank", "TD Bank"];

export const TABS = [
  { id: "today",     label: "Today",     icon: "clock"  },
  { id: "history",   label: "Spending",  icon: "cal"    },
  { id: "recurring", label: "Bills",     icon: "repeat" },
  { id: "household", label: "Household", icon: "users"  },
  { id: "advisor",   label: "Advisor",   icon: "brain"  },
];

export const PRICES = {
  pro:      { monthly: "price_1TDvC2EHLJtYfhmkOqOXTxMe", annual: "price_1TDvFnEHLJtYfhmkUAJLYCpG" },
  business: { monthly: "price_1TDvFOEHLJtYfhmkGmcEEyv9", annual: "price_1TDvFOEHLJtYfhmkZQ3HhjTy" },
};
