"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type { User } from "@supabase/supabase-js";

type Bookmark = {
  id: string;
  url: string;
  title: string;
  created_at: string;
};

export default function BookmarkManager({
  initialBookmarks,
  user,
}: {
  initialBookmarks: Bookmark[];
  user: User;
}) {
  // ─── Create a SINGLE stable supabase client (never recreated) ───────────
  const supabaseRef = useRef(createClient());
  const supabase = supabaseRef.current;

  // ─── State ───────────────────────────────────────────────────────────────
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(initialBookmarks);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [realtimeStatus, setRealtimeStatus] = useState<
    "connecting" | "connected" | "error"
  >("connecting");
  const channelRef = useRef<RealtimeChannel | null>(null);

  // ─── Optimistic helpers ──────────────────────────────────────────────────
  const addToList = useCallback((bookmark: Bookmark) => {
    setBookmarks((prev) => {
      if (prev.some((b) => b.id === bookmark.id)) return prev;
      return [bookmark, ...prev];
    });
    // Green flash for 2s
    setNewIds((prev) => new Set(prev).add(bookmark.id));
    setTimeout(() => {
      setNewIds((prev) => {
        const next = new Set(prev);
        next.delete(bookmark.id);
        return next;
      });
    }, 2000);
  }, []);

  const removeFromList = useCallback((id: string) => {
    setBookmarks((prev) => prev.filter((b) => b.id !== id));
  }, []);

  // ─── Realtime subscription ────────────────────────────────────────────────
  // KEY FIX: We subscribe WITHOUT a server-side filter because Supabase
  // Realtime row-level filters require special setup. Instead we filter
  // client-side by user_id. This is safe because RLS still prevents
  // other users' data from being returned by queries.
  useEffect(() => {
    // Remove any existing channel before creating a new one
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
    }

    const channel = supabase
      .channel(`bookmarks:${user.id}:${Date.now()}`) // unique name prevents stale channels
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "bookmarks",
        },
        (payload) => {
          const incoming = payload.new as Bookmark & { user_id: string };
          // Client-side ownership check
          if (incoming.user_id !== user.id) return;
          addToList(incoming);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "bookmarks",
        },
        (payload) => {
          const deleted = payload.old as Bookmark & { user_id: string };
          // user_id may not be in payload.old for DELETEs — safe to just remove by id
          removeFromList(deleted.id);
        }
      )
      .subscribe((status, err) => {
        console.log("[Realtime] status:", status, err ?? "");
        if (status === "SUBSCRIBED") {
          setRealtimeStatus("connected");
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setRealtimeStatus("error");
        } else {
          setRealtimeStatus("connecting");
        }
      });

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user.id, addToList, removeFromList]);

  // ─── Add bookmark ─────────────────────────────────────────────────────────
  const addBookmark = useCallback(async () => {
    const trimUrl = url.trim();
    const trimTitle = title.trim();

    if (!trimUrl || !trimTitle) {
      setError("Both title and URL are required.");
      return;
    }
    try {
      new URL(trimUrl);
    } catch {
      setError("Please enter a valid URL — e.g. https://example.com");
      return;
    }

    setError(null);
    setLoading(true);

    const { data, error: insertError } = await supabase
      .from("bookmarks")
      .insert({ url: trimUrl, title: trimTitle, user_id: user.id })
      .select()         // ← return the inserted row
      .single();

    if (insertError) {
      console.error("[Insert error]", insertError);
      setError("Failed to add bookmark. Please try again.");
    } else if (data) {
      // ── OPTIMISTIC UPDATE ──
      // Add immediately to the list without waiting for realtime event.
      // The realtime handler deduplicates so there's no double-add.
      addToList(data as Bookmark);
      setUrl("");
      setTitle("");
    }

    setLoading(false);
  }, [url, title, user.id, addToList]);

  // ─── Delete bookmark ──────────────────────────────────────────────────────
  const deleteBookmark = useCallback(
    async (id: string) => {
      // Optimistic: remove from UI immediately
      removeFromList(id);
      setDeleting(id);

      const { error: deleteError } = await supabase
        .from("bookmarks")
        .delete()
        .eq("id", id)
        .eq("user_id", user.id); // extra safety

      if (deleteError) {
        console.error("[Delete error]", deleteError);
        // Rollback: re-fetch to restore state
        const { data } = await supabase
          .from("bookmarks")
          .select("*")
          .order("created_at", { ascending: false });
        if (data) setBookmarks(data);
      }

      setDeleting(null);
    },
    [user.id, removeFromList]
  );

  // ─── Sign out ─────────────────────────────────────────────────────────────
  const signOut = async () => {
    if (channelRef.current) await supabase.removeChannel(channelRef.current);
    await supabase.auth.signOut();
    window.location.href = "/";
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") addBookmark();
  };

  // ─── Status indicator config ──────────────────────────────────────────────
  const statusConfig = {
    connected:  { dot: "bg-green-400",                  label: "Live"         },
    connecting: { dot: "bg-yellow-400 animate-pulse",   label: "Connecting…"  },
    error:      { dot: "bg-red-400",                    label: "Offline"      },
  } as const;

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-stone-100 px-4 py-8 sm:py-12">
      <div className="max-w-2xl mx-auto w-full">

        {/* ── Header ──────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-start mb-8 sm:mb-10">
          {/* Title */}
          <div>
            <h1 className="text-4xl sm:text-5xl font-bold text-stone-900 leading-tight tracking-tight">
              Bookmarks
            </h1>
            <p className="text-sm text-stone-400 mt-1 font-light tracking-wide">
              Your private collection
            </p>
          </div>

          {/* User controls */}
          <div className="flex flex-row sm:flex-col items-center sm:items-end justify-between sm:justify-start gap-2 flex-wrap">
            <button
              onClick={signOut}
              className="text-xs text-stone-500 border border-stone-300 px-4 py-1.5 rounded-full
                         hover:bg-stone-900 hover:text-stone-100 hover:border-stone-900
                         transition-all duration-200 whitespace-nowrap"
            >
              Sign out
            </button>

            <div className="flex items-center gap-1.5 text-xs text-stone-400 bg-stone-200 px-3 py-1 rounded-full max-w-[180px] sm:max-w-[220px]">
              <span>👤</span>
              <span className="truncate">{user.email}</span>
            </div>

            {/* Realtime dot */}
            <div className="flex items-center gap-1.5 text-xs text-stone-400">
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusConfig[realtimeStatus].dot}`} />
              <span>{statusConfig[realtimeStatus].label}</span>
            </div>
          </div>
        </div>

        {/* ── Add Bookmark Form ────────────────────────────────────────── */}
        <div className="bg-white border border-stone-200 rounded-2xl p-4 sm:p-6 mb-6 sm:mb-8 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-widest text-stone-400 mb-4">
            Add Bookmark
          </p>

          <div className="flex flex-col gap-2.5">
            <input
              className="w-full border border-stone-200 rounded-xl px-4 py-3 text-sm text-stone-800
                         bg-stone-50 placeholder-stone-300 outline-none
                         focus:border-amber-400 focus:ring-2 focus:ring-amber-100 focus:bg-white
                         transition-all"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Title — e.g. Hacker News"
              disabled={loading}
            />
            <input
              className="w-full border border-stone-200 rounded-xl px-4 py-3 text-sm text-stone-800
                         bg-stone-50 placeholder-stone-300 outline-none
                         focus:border-amber-400 focus:ring-2 focus:ring-amber-100 focus:bg-white
                         transition-all"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="URL — https://news.ycombinator.com"
              disabled={loading}
              type="url"
              inputMode="url"
            />
          </div>

          <div className="flex items-center gap-3 mt-3">
            {error ? (
              <p className="text-xs text-red-500 flex-1 min-w-0">{error}</p>
            ) : (
              <span className="flex-1" />
            )}
            <button
              onClick={addBookmark}
              disabled={loading}
              className="bg-stone-900 text-stone-100 text-sm font-medium px-5 sm:px-6 py-2.5 rounded-xl
                         hover:bg-amber-500 hover:text-white hover:-translate-y-0.5 hover:shadow-lg
                         disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-none
                         transition-all duration-200 whitespace-nowrap flex-shrink-0"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                  </svg>
                  Adding…
                </span>
              ) : (
                "+ Add"
              )}
            </button>
          </div>
        </div>

        {/* ── List Header ──────────────────────────────────────────────── */}
        <div className="flex justify-between items-center mb-3 sm:mb-4">
          <span className="text-xs font-semibold uppercase tracking-widest text-stone-400">
            Saved
          </span>
          <span className="bg-stone-200 text-stone-500 text-xs font-semibold px-3 py-0.5 rounded-full">
            {bookmarks.length}
          </span>
        </div>

        {/* ── Bookmark List ─────────────────────────────────────────────── */}
        {bookmarks.length === 0 ? (
          <div className="text-center py-16 sm:py-20 text-stone-300">
            <span className="text-4xl block mb-3">🔖</span>
            <p className="text-sm">No bookmarks yet — add one above!</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {bookmarks.map((b) => {
              let hostname = "";
              try { hostname = new URL(b.url).hostname; } catch {}
              const faviconUrl = hostname
                ? `https://www.google.com/s2/favicons?domain=${hostname}&sz=32`
                : null;

              const isNew = newIds.has(b.id);
              const isDeleting = deleting === b.id;

              return (
                <li
                  key={b.id}
                  style={isNew ? { animation: "slideIn 0.35s ease" } : {}}
                  className={`
                    flex justify-between items-center gap-3 sm:gap-4
                    bg-white border rounded-xl px-4 sm:px-5 py-3.5 sm:py-4
                    shadow-sm transition-all duration-200 group
                    ${isNew
                      ? "border-green-400 bg-green-50"
                      : "border-stone-200 hover:border-amber-300 hover:-translate-y-0.5 hover:shadow-md"
                    }
                    ${isDeleting ? "opacity-40 scale-95" : ""}
                  `}
                >
                  {/* Favicon + text */}
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="w-7 h-7 rounded-md bg-stone-100 border border-stone-200
                                    flex items-center justify-center flex-shrink-0 overflow-hidden">
                      {faviconUrl && (
                        <img
                          src={faviconUrl}
                          alt=""
                          aria-hidden="true"
                          className="w-4 h-4 object-contain"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                        />
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <a
                        href={b.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block text-sm font-medium text-stone-800 truncate
                                   hover:text-amber-600 transition-colors"
                        title={b.title}
                      >
                        {b.title}
                      </a>
                      <span className="block text-xs text-stone-300 truncate mt-0.5">
                        {hostname}
                      </span>
                    </div>
                  </div>

                  {/* Delete — always visible on mobile, hover on desktop */}
                  <button
                    onClick={() => deleteBookmark(b.id)}
                    disabled={!!deleting}
                    title="Delete bookmark"
                    aria-label={`Delete ${b.title}`}
                    className="text-stone-300 hover:text-red-500 hover:bg-red-50
                               text-base px-2 py-1 rounded-md flex-shrink-0
                               transition-all duration-150 disabled:opacity-30
                               sm:opacity-0 sm:group-hover:opacity-100
                               focus:opacity-100"
                  >
                    ✕
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {/* ── Footer ───────────────────────────────────────────────────── */}
        <p className="text-center text-xs text-stone-300 mt-10">
          Changes sync instantly across all your tabs
        </p>
      </div>

      <style>{`
        @keyframes slideIn {
          from { opacity: 0; transform: translateY(-10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}