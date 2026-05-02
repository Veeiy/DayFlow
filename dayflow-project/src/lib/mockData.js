import { todayKey } from "./dates.js";
import { DEFAULTS } from "./storage.js";

export const MOCK_PLAID = (() => {
  const t = new Date();
  const d = (off, name, amount, cat) => {
    const dt = new Date(t); dt.setDate(dt.getDate() - off);
    return { id: `p_${off}_${name.slice(0, 4)}`, date: dt.toISOString().slice(0, 10), name, amount, category: cat, source: "plaid" };
  };
  return [
    d(0, "Whole Foods", 67.42, "Groceries"),
    d(0, "Shell Gas", 54.00, "Gas"),
    d(1, "Chipotle", 14.85, "Dining"),
    d(1, "Amazon", 32.99, "Shopping"),
    d(2, "Starbucks", 6.75, "Dining"),
    d(2, "Target", 88.14, "Shopping"),
    d(3, "Uber", 18.50, "Transport"),
    d(4, "Apple.com", 14.99, "Subscriptions"),
    d(5, "Trader Joe's", 41.20, "Groceries"),
    d(6, "Netflix", 15.49, "Subscriptions"),
    d(7, "Lyft", 22.30, "Transport"),
    d(8, "CVS", 29.60, "Health"),
  ];
})();

export const GUEST_DATA = {
  ...DEFAULTS,
  monthlyIncome: 4200,
  recurringPayments: [
    { id: 1, name: "Rent",         amount: 1200,  frequency: "monthly", category: "housing",       dueDay: 1  },
    { id: 2, name: "Car payment",  amount: 380,   frequency: "monthly", category: "transport",     dueDay: 15 },
    { id: 3, name: "Phone",        amount: 85,    frequency: "monthly", category: "other",         dueDay: 10 },
    { id: 4, name: "Netflix",      amount: 15.99, frequency: "monthly", category: "subscriptions", dueDay: 5  },
    { id: 5, name: "Spotify",      amount: 9.99,  frequency: "monthly", category: "subscriptions", dueDay: 5  },
  ],
  dailyEntries: {
    [todayKey()]: { transactions: [
      { id: 10, label: "Starbucks", amount: 6.75,  type: "expense" },
      { id: 11, label: "Lunch",     amount: 14.20, type: "expense" },
    ]},
  },
};
