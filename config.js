// Supabase project settings: Supabase Dashboard → Project Settings → API Keys / Data API.
// The "publishable" (or legacy "anon public") key is designed to be public; the data is protected by the rules in supabase/schema.sql.
window.SGAP_CONFIG = {
  supabaseUrl: 'https://bwsxknttmasrvhyejdbm.supabase.co',
  supabaseAnonKey: 'sb_publishable_xsCPlxRINhpygD20XKaGXg_SUO7DoR1',
  // Staff can add, edit or delete their own hours for this many days (must match schema.sql)
  editWindowDays: 14,
  activities: ['Adventure Playground', '5s & Under Stay & Play', 'Holiday Scheme', 'Training', 'Meeting', 'Admin', 'Other'],
};
