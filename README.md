# GigTrack

Track your gig delivery shifts, earnings, and ATO tax deductions. Built for Australian Uber Eats & DoorDash drivers.

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Run the dev server
```bash
npm run dev
```

The app will be served at `http://localhost:5173`.

### 3. Test on your phone (same Wi-Fi)
Look at the terminal output. You'll see something like:

```
  ➜  Local:   http://localhost:5173/
  ➜  Network: http://192.168.1.42:5173/
```

Open the **Network** URL on your phone's browser. The app will load just like it does on your computer.

For full PWA behaviour (offline, "Add to Home Screen"), you'll need to deploy to Vercel — see below.

### 4. Build for production
```bash
npm run build
```

This creates a `dist/` folder containing optimized static files ready to deploy.

### 5. Preview the production build
```bash
npm run preview
```

## Deploy to Vercel

1. Push this project to a GitHub repo (`git init && git add . && git commit -m "Initial" && git push`)
2. Go to [vercel.com](https://vercel.com) and import the repo
3. Vercel auto-detects Vite and configures everything
4. Hit Deploy. You'll get a `*.vercel.app` URL within ~30 seconds
5. Push to `main` from here on to redeploy automatically

## Tech stack

- React 18
- Vite (build tool)
- vite-plugin-pwa (service worker + manifest)
- localStorage (will move to Supabase later)
