// Supabase project settings: Supabase Dashboard → Project Settings → API Keys / Data API.
// The "publishable" (or legacy "anon public") key is designed to be public; the data is protected by the rules in supabase/schema.sql.
window.SGAP_CONFIG = {
  supabaseUrl: 'https://YOUR-PROJECT-REF.supabase.co',
  supabaseAnonKey: 'YOUR-ANON-PUBLIC-KEY',
  // Staff can add, edit or delete their own hours for this many days (must match schema.sql)
  editWindowDays: 14,
  activities: ['Adventure Playground', '5s & Under Stay & Play', 'Holiday Scheme', 'Training', 'Meeting', 'Admin', 'Other'],
};
