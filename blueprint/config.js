/* Category Book Blueprint — connection settings.
   ────────────────────────────────────────────────────────────────────────
   Paste the SAME two values Smart Publishing Studio uses. Both are the
   PUBLISHABLE (anon) credentials: they are meant to be seen by the browser,
   and Row Level Security is what actually protects the data.

   NEVER put a service_role key here. It bypasses every policy, and this file
   is public on the website.
   ──────────────────────────────────────────────────────────────────────── */
window.CBB_CONFIG = {
  supabaseUrl: "",            // e.g. https://xxxxxxxxxxxx.supabase.co
  supabasePublishableKey: ""  // the anon / publishable key
};
