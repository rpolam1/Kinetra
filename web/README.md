# Kinetra: web app

React 19 + TypeScript + Tailwind 4 front end for instructors, volunteers and the TV board.

```powershell
npm install
npm run build        # web/dist, served by the hub (see ../vision)
npm run dev          # hot reload; set VITE_HUB_URL to the hub address
npm test             # unit and integration tests
npm run test:e2e     # real hub + simulated camera + real browser
```

Put your white logo at `public/logo.png`. Copy `.env.example` to `.env.local` for Firebase.

Everything else (Firebase setup, accounts and approval, design system, data model, tests) is in
[`../docs/web-app.md`](../docs/web-app.md).
