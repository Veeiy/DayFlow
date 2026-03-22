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
- localStorage (data persistence)
- Vercel (hosting)
