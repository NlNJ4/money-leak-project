-- Fixed category enum from the product spec (section 7).
-- The AI parser may only assign these slugs; name_th/name_en power the i18n UI.
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name_th text not null,
  name_en text not null,
  type text not null check (type in ('income', 'expense')),
  icon text not null default '',
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

insert into public.categories (slug, name_th, name_en, type, icon, sort_order) values
  ('food',          'อาหาร',        'Food',          'expense', '🍜',    1),
  ('transport',     'เดินทาง',      'Transport',     'expense', '🚕',    2),
  ('shopping',      'ช้อปปิ้ง',      'Shopping',      'expense', '🛒',    3),
  ('housing',       'ที่อยู่อาศัย',  'Housing',       'expense', '🏠',    4),
  ('bills',         'ค่าบิล',        'Bills',         'expense', '🧾',    5),
  ('health',        'สุขภาพ',        'Health',        'expense', '💊',    6),
  ('entertainment', 'บันเทิง',       'Entertainment', 'expense', '🎮',    7),
  ('family',        'ครอบครัว',      'Family',        'expense', '👨‍👩‍👧', 8),
  ('other',         'อื่น ๆ',        'Other',         'expense', '📦',    9),
  ('salary',        'เงินเดือน',     'Salary',        'income',  '💼',    1),
  ('freelance',     'ฟรีแลนซ์',      'Freelance',     'income',  '🧑‍💻',  2),
  ('investment',    'การลงทุน',      'Investment',    'income',  '📈',    3),
  ('refund',        'เงินคืน',       'Refund',        'income',  '↩️',    4),
  ('other_income',  'รายรับอื่น ๆ',  'Other income',  'income',  '💰',    5);
