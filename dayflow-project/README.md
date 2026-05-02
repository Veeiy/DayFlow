# DayFlow

Daily spending tracker. Know exactly what you can spend today.

## Launch steps (do these in order)

### 1. Get your Anthropic API key
- Go to console.anthropic.com
- Sign up / log in
- Go to API Keys → Create key
- Copy it — you'll need it in step 4

### 2. Set a spend cap (do this before anything else)
- console.anthropic.com → Settings → Limits
- Set monthly cap to $20
- This prevents any surprise bills

### 3. Push this folder to GitHub
- Go to github.com → New repository → name it "dayflow"
- Upload all these files, keeping the folder structure

### 4. Deploy to Vercel
- Go to vercel.com → Sign in with GitHub
- New Project → Import "dayflow"
- Under Environment Variables, add:
  - Name:  VITE_ANTHROPIC_KEY
  - Value: sk-ant-your-key-here
- Click Deploy
- Your live URL will be: https://dayflow.vercel.app

### 5. Install on your phone
- Open your Vercel URL in Chrome on Android
- Tap the 3-dot menu → "Add to Home Screen"
- Tap Add
- Done — it's on your home screen like a real app

## Every future update
Push to GitHub → Vercel auto-deploys in 60 seconds → your phone gets it instantly.

## Tech stack
- React + Vite
- Recharts (spending charts)
- Anthropic Claude (AI Advisor + paystub analysis)
- Supabase (auth + sync)
- localStorage (offline cache)
- Vercel (hosting)

## Project layout

```
src/
  App.jsx              # main app (orchestrator)
  main.jsx             # React entry
  supabase.js          # Supabase client
  lib/                 # pure utilities (no React)
    storage.js         # localStorage shape + load/persist
    dates.js           # todayKey, DIM, etc.
    money.js           # totals, formatting
    markdown.jsx       # tiny markdown renderer for AI replies
    constants.js       # CATS, BANKS, TABS, PRICES
    mockData.js        # MOCK_PLAID + GUEST_DATA
  components/          # reusable UI primitives
    Icon.jsx           # SVG icon set
    Ring.jsx           # progress ring
    Layout.jsx         # R/C flex helpers
    LearnSection.jsx   # education card

supabase/functions/
  stripe-webhook/      # Stripe → Supabase plan sync (Deno edge function)

e2e/                   # Playwright tests
playwright.config.ts
```

## Tests

```bash
npm install
npx playwright install chromium      # first time only
npm run test:e2e                     # run full suite (desktop + mobile)
npm run test:e2e:ui                  # debug with the Playwright UI
npm run test:e2e:list                # list all tests without running
```

The suite covers boot/auth, guest mode, all five tabs, the More menu,
bills form, calendar grid, household header, AI advisor (with a stubbed
streaming endpoint), bank-connection modal, localStorage behavior, and
in-browser unit tests of `src/lib/*` modules. **45 tests × 2 viewports
= 90 passing.**
