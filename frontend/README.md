# DeltaDock frontend

React 18 + Vite 5 + TypeScript + Tailwind 3.

## Quick start

```bash
npm install
npm run dev   # http://localhost:5173
```

The dev server proxies `/api/*` → `http://localhost:8000/*` so you can run the FastAPI backend without CORS configuration. Override with `VITE_API_URL=http://your-host` if needed.

## Layout

```
src/
├── main.tsx                       # entry, providers
├── App.tsx                        # router shell + header/footer
├── api.ts                         # typed API client
├── index.css                      # Tailwind base + component classes
├── pages/
│   ├── HomePage.tsx               # marketing/landing
│   ├── NewJobPage.tsx             # mutation + compounds form
│   └── JobPage.tsx                # job detail w/ live polling
└── components/
    └── SelectivityMatrix.tsx      # the centerpiece — N compounds × M variants
```

## Build

```bash
npm run build      # → dist/
npm run preview    # serve the build locally
```
