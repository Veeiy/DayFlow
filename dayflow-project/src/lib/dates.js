export const todayKey    = () => new Date().toISOString().slice(0, 10);
export const thisMonth   = () => new Date().toISOString().slice(0, 7);
export const daysInMonth = (d = new Date()) => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
export const dayOfMonth  = (d = new Date()) => d.getDate();

// Days in the current month — stable for the session
export const DIM = daysInMonth();
export const WEEKS_IN_MONTH = DIM / 7;
