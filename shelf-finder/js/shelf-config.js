/* Where the tool talks to. Both values are the publishable Supabase ones —
   they are meant to be in the browser, and the results link is what gates a
   set of results, not this key. Never put a service_role key here. */
window.SHELF_CONFIG = {
  supabaseUrl: "",            // https://xxxxxxxx.supabase.co
  supabaseAnonKey: "",        // anon / publishable key
  blueprintUrl: "/blueprint"
};
