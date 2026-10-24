-- =============================================================================
-- RandRoute — 4 of 4: system categories (shared, read-only for users)
-- Safe to run more than once.
-- =============================================================================

insert into public.categories (user_id, key, name, default_transaction_type, sort_order)
values
  -- Income
  (null, 'salary',            'Salary & wages',          'income',   10),
  (null, 'other_income',      'Other income',            'income',   20),
  -- Essentials
  (null, 'housing',           'Rent & bond',             'expense', 100),
  (null, 'utilities',         'Electricity & water',     'expense', 110),
  (null, 'groceries',         'Groceries',               'expense', 120),
  (null, 'transport',         'Transport & fuel',        'expense', 130),
  (null, 'airtime_data',      'Airtime & data',          'expense', 140),
  (null, 'insurance',         'Insurance',               'expense', 150),
  (null, 'medical',           'Medical & pharmacy',      'expense', 160),
  (null, 'education',         'Education',               'expense', 170),
  (null, 'debt_repayments',   'Loans & credit repayments','expense', 180),
  (null, 'bank_fees',         'Bank fees',               'expense', 190),
  -- Lifestyle
  (null, 'eating_out',        'Eating out & takeaways',  'expense', 200),
  (null, 'subscriptions',     'Subscriptions',           'expense', 210),
  (null, 'entertainment',     'Entertainment',           'expense', 220),
  (null, 'shopping',          'Shopping & clothing',     'expense', 230),
  (null, 'personal_care',     'Personal care',           'expense', 240),
  (null, 'gifts_donations',   'Gifts & donations',       'expense', 250),
  (null, 'family_support',    'Family support',          'expense', 260),
  -- Savings
  (null, 'savings',           'Savings & investments',   'transfer', 300),
  -- Special
  (null, 'transfers',         'Transfers between my accounts', 'transfer', 900),
  (null, 'refunds',           'Refunds & reversals',     'refund',  910),
  (null, 'cash_withdrawal',   'Cash withdrawals',        'expense', 920),
  (null, 'uncategorised',     'Uncategorised',           'unknown', 999)
on conflict (key) where user_id is null do update
  set name = excluded.name,
      default_transaction_type = excluded.default_transaction_type,
      sort_order = excluded.sort_order;
