# 🔖 Smart Bookmark App

> A bookmark manager built with **Next.js 15**, **Supabase**, and **Vercel** - featuring Google OAuth, real-time sync across tabs, and per-user data isolation enforced at the database level.

[![Live Demo](https://img.shields.io/badge/Live%20Demo-Vercel-black?style=for-the-badge&logo=vercel)](https://smart-bookmark-micro-challenge.vercel.app/)
[![Next.js](https://img.shields.io/badge/Next.js-15-black?style=for-the-badge&logo=next.js)](https://nextjs.org)
[![Supabase](https://img.shields.io/badge/Supabase-Auth%20+%20DB%20+%20Realtime-3ECF8E?style=for-the-badge&logo=supabase)](https://supabase.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-3178C6?style=for-the-badge&logo=typescript)](https://typescriptlang.org)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-CSS-38BDF8?style=for-the-badge&logo=tailwind-css)](https://tailwindcss.com)

---

## 📸 Architecture

![Production Architecture](./architecture.png)

---

## ✨ Features

| Feature                   | Implementation                                                                   |
| ------------------------- | -------------------------------------------------------------------------------- |
| **Google OAuth Login**    | Supabase Auth with PKCE flow via `@supabase/ssr`                                 |
| **Private bookmarks**     | PostgreSQL Row Level Security — users only see their own data                    |
| **Real-time sync**        | Supabase Realtime WebSocket — changes appear across all open tabs instantly      |
| **Optimistic UI**         | Add/delete updates the UI immediately, rolls back on failure                     |
| **Server-Side Rendering** | Bookmarks are pre-fetched in a React Server Component for zero loading flash     |
| **Edge-protected routes** | `middleware.ts` runs on Vercel Edge Network — JWT validated before any page load |
| **Fully responsive**      | Mobile-first Tailwind layout with `sm:` breakpoints throughout                   |
| **Favicon detection**     | Google's S2 favicon API shows site icons automatically                           |

---

## 🏗️ Tech Stack

```
Frontend    Next.js 15 (App Router) · React 19 · TypeScript (strict) · Tailwind CSS
Auth        Supabase Auth · Google OAuth 2.0 · PKCE · @supabase/ssr
Database    Supabase PostgreSQL · Row Level Security (RLS)
Realtime    Supabase Realtime · WebSocket (postgres_changes / WAL)
Hosting     Vercel · Edge Middleware · Streaming SSR
Fonts       Geist Sans (next/font) · next-themes (dark mode ready)
```

---

## 📁 Project Structure

```
smart-bookmark-app/
│
├── app/
│   ├── auth/
│   │   └── callback/
│   │       └── route.ts          # OAuth callback — exchanges code for session
│   ├── dashboard/
│   │   └── page.tsx              # Server Component — SSR bookmark fetch
│   ├── globals.css               # CSS custom properties + Tailwind base
│   ├── layout.tsx                # Root layout — Geist font, ThemeProvider
│   └── page.tsx                  # Login page — Google OAuth button
│
├── components/
│   └── BookmarkManager.tsx       # Client Component — all UI + realtime logic
│
├── lib/
│   ├── supabase/
│   │   ├── client.ts             # Browser Supabase client (createBrowserClient)
│   │   └── server.ts             # Server Supabase client (createServerClient)
│   └── utils.ts                  # cn() helper — clsx + tailwind-merge
│
├── middleware.ts                  # Edge middleware — JWT auth guard for /dashboard
├── tailwind.config.ts             # Theme config — stone/amber palette
├── tsconfig.json                  # TypeScript strict config + @/* alias
├── next.config.ts                 # Next.js config
└── .env.local                     # Supabase URL + publishable key
```

---

## 🔄 How It Works — Request Lifecycle

```
1. User visits /dashboard
        │
        ▼
2. middleware.ts (Vercel Edge)
   └── createServerClient() reads JWT from cookie
   └── auth.getUser() validates token with Supabase
   └── Not valid? → redirect("/")

        │ valid session
        ▼
3. app/dashboard/page.tsx (React Server Component)
   └── Fetches bookmarks from PostgreSQL (server-side)
   └── RLS ensures only this user's rows are returned
   └── Streams HTML to browser with data embedded

        │
        ▼
4. Browser receives pre-rendered HTML (zero loading flash)
   └── React hydrates → BookmarkManager mounts
   └── supabase.channel() opens WebSocket connection
   └── Subscribes to INSERT / DELETE events on bookmarks table

        │ user adds a bookmark
        ▼
5. addBookmark()
   └── .insert().select().single() → write to DB
   └── Optimistic update → item added to list immediately
   └── Realtime event fires → other tabs receive the change
   └── Green "slideIn" flash animation on new item

        │ user deletes a bookmark
        ▼
6. deleteBookmark()
   └── Item removed from UI immediately (optimistic)
   └── .delete() fires to DB in background
   └── If DB fails → re-fetch to rollback state
   └── Other tabs receive DELETE event via WebSocket
```

---

## 🔒 Security Model

### Row Level Security (PostgreSQL)

Every database query is gated by RLS policies — even if someone bypassed the app layer, the database itself rejects unauthorized access.

```sql
-- Users can only read their own bookmarks
CREATE POLICY "select_own" ON bookmarks
  FOR SELECT USING (auth.uid() = user_id);

-- Users can only insert bookmarks for themselves
CREATE POLICY "insert_own" ON bookmarks
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Users can only delete their own bookmarks
CREATE POLICY "delete_own" ON bookmarks
  FOR DELETE USING (auth.uid() = user_id);
```

### Auth Flow

```
Browser → Google OAuth popup
       → Google redirects to /auth/callback?code=...
       → exchangeCodeForSession(code)
       → Supabase sets httpOnly session cookie
       → redirect("/dashboard")
       → middleware.ts validates cookie on every subsequent request
```

### Why `@supabase/ssr`?

The standard Supabase JS client doesn't work with Next.js Server Components because it uses `localStorage` for session storage. `@supabase/ssr` provides cookie-based session adapters for both client and server contexts — this is what makes SSR + auth work correctly together.

---

## ⚡ Realtime Architecture

```
Supabase PostgreSQL
    │  Write-Ahead Log (WAL)
    ▼
Supabase Realtime Engine
    │  postgres_changes events
    ▼
WebSocket connection (supabase.channel())
    │
    ▼
BookmarkManager (browser)
    ├── INSERT event → addToList() → green flash animation
    └── DELETE event → removeFromList()
```

**Key design decision:** The Realtime channel subscribes to the whole `bookmarks` table (no server-side `user_id` filter). Filtering happens client-side (`if (incoming.user_id !== user.id) return`). This avoids a common pitfall where server-side `filter:` on `postgres_changes` silently fails without proper Supabase configuration — breaking realtime entirely with no error.

---

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- pnpm (or npm/yarn)
- A [Supabase](https://supabase.com) account
- A [Google Cloud](https://console.cloud.google.com) project with OAuth 2.0 credentials

### 1. Clone & Install

```bash
git clone https://github.com/your-username/smart-bookmark-app.git
cd smart-bookmark-app
pnpm install
```

### 2. Supabase Setup

**Create a project** at [supabase.com](https://supabase.com), then run this SQL in the SQL Editor:

```sql
-- Bookmarks table
CREATE TABLE bookmarks (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  url        TEXT NOT NULL,
  title      TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE bookmarks ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "select_own" ON bookmarks FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "insert_own" ON bookmarks FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "delete_own" ON bookmarks FOR DELETE USING (auth.uid() = user_id);
```

**Enable Realtime:**
Supabase Dashboard → Database → Replication → Toggle `bookmarks` table ON

**Enable Google OAuth:**
Supabase Dashboard → Authentication → Providers → Google → Enable → Add your Client ID + Secret

### 3. Google OAuth Credentials

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. APIs & Services → Credentials → Create OAuth 2.0 Client ID
3. Add Authorized Redirect URI:
   ```
   https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback
   ```

### 4. Environment Variables

Create `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-anon-key
```

Find these in: Supabase Dashboard → Project Settings → API

### 5. Run Locally

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000)

---

## 🌐 Deploy to Vercel

```bash
# Push to GitHub, then import at vercel.com
git add .
git commit -m "feat: smart bookmark app"
git push
```

1. Go to [vercel.com](https://vercel.com) → **New Project** → Import your repo
2. Add Environment Variables in Vercel Dashboard:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
3. Click **Deploy**

**After deploying**, add your Vercel URL to:

- Supabase → Authentication → URL Configuration → Site URL: `https://your-app.vercel.app`
- Supabase → Authentication → URL Configuration → Redirect URLs: `https://your-app.vercel.app/auth/callback`
- Google Console → OAuth Client → Authorized redirect URIs: `https://your-project-ref.supabase.co/auth/v1/callback`

---

## 🧠 Key Engineering Decisions

### Why Server Components for the dashboard?

The dashboard page is an async React Server Component. This means the initial HTML sent to the browser already contains the user's bookmarks — no loading spinner, no layout shift, no client-side fetch on mount. The `BookmarkManager` client component receives this data as a prop and hydrates immediately.

### Why optimistic UI instead of waiting for Realtime?

When a user adds a bookmark, we call `.insert().select().single()` to get the new row back from the database, then immediately add it to local state. We don't wait for the Realtime WebSocket event. This makes the app feel instant. The Realtime handler deduplicates by `id`, so there's no double-add if the event also arrives.

### Why is the Supabase client created with `useRef`?

```typescript
const supabaseRef = useRef(createClient());
const supabase = supabaseRef.current;
```

If `createClient()` were called directly in the component body, it would create a new client instance on every render. Each instance would try to open its own WebSocket connection, causing duplicate Realtime subscriptions and event firing. `useRef` ensures exactly one client is created for the lifetime of the component.

### Why no server-side Realtime filter?

```typescript
// ❌ This silently fails without special Supabase config:
filter: `user_id=eq.${user.id}`;

// ✅ This always works:
// Subscribe to table, filter client-side
if (incoming.user_id !== user.id) return;
```

Server-side `filter` on `postgres_changes` requires enabling it per-table in Supabase settings, and fails silently when not configured — breaking realtime with no error message. Client-side filtering is safe because RLS still prevents the DB from ever returning another user's data in queries.

---

## 📊 Database Schema

```
┌─────────────────────────────────────────────────────┐
│                    bookmarks                        │
├────────────┬──────────────┬────────────────────────┤
│ id         │ uuid         │ PK, gen_random_uuid()   │
│ user_id    │ uuid         │ FK → auth.users, NOT NULL│
│ url        │ text         │ NOT NULL                │
│ title      │ text         │ NOT NULL                │
│ created_at │ timestamptz  │ DEFAULT now()           │
└────────────┴──────────────┴────────────────────────┘
       │
       └── RLS: every operation filtered by auth.uid() = user_id
```

---

## 🛠️ Scripts

```bash
pnpm dev          # Start development server (localhost:3000)
pnpm build        # Production build
pnpm start        # Start production server
pnpm lint         # ESLint check
```

<div align="center">
  Built with Next.js · Supabase · Vercel · TypeScript
</div>
