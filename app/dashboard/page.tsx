import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import BookmarkManager from "@/components/BookmarkManager";

async function DashboardContent() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const { data: bookmarks } = await supabase
    .from("bookmarks")
    .select("*")
    .order("created_at", { ascending: false });

  return <BookmarkManager initialBookmarks={bookmarks ?? []} user={user} />;
}

export default function Dashboard() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center text-stone-400">
          Loading your bookmarks...
        </div>
      }
    >
      <DashboardContent />
    </Suspense>
  );
}