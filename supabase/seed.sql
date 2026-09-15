-- Dev seed. Safe to re-run.
insert into settings (key, value) values
  ('auto_push_enabled', 'false'),
  ('auto_push_min_confidence', '0.90'),
  ('extraction_model', '"<set in .env>"'),
  ('prompt_version', '"v1"'),
  ('default_cogs_account_id', 'null'),
  ('default_bank_account_id', 'null')
on conflict (key) do nothing;

-- Placeholder QB accounts until AccountQuery runs (Phase 3). ListIDs are fake.
insert into qb_accounts (qb_list_id, name, account_type) values
  ('DEV-COGS', 'Cost of Goods Sold', 'CostOfGoodsSold'),
  ('DEV-CHK',  'Checking',           'Bank'),
  ('DEV-AP',   'Accounts Payable',   'AccountsPayable')
on conflict (qb_list_id) do nothing;

update settings set value = to_jsonb((select id from qb_accounts where qb_list_id='DEV-COGS')) where key='default_cogs_account_id';
update settings set value = to_jsonb((select id from qb_accounts where qb_list_id='DEV-CHK'))  where key='default_bank_account_id';

insert into vendors (name) values ('Sysco'), ('Pepsi Bottling'), ('Frito-Lay'), ('Coca-Cola'), ('Bimbo Bakeries')
on conflict do nothing;

insert into vendor_aliases (vendor_id, alias_normalized, source)
select v.id, a.alias, 'import' from vendors v
join (values
  ('Sysco','SYSCO'), ('Sysco','SYSCO SAN FRANCISCO'), ('Sysco','SYSCO SF'),
  ('Pepsi Bottling','PEPSI'), ('Pepsi Bottling','PEPSI BOTTLING VENTURES'), ('Pepsi Bottling','PEPSICO'),
  ('Frito-Lay','FRITO LAY'), ('Frito-Lay','FRITOLAY'),
  ('Coca-Cola','COCA COLA'), ('Coca-Cola','COKE'),
  ('Bimbo Bakeries','BIMBO'), ('Bimbo Bakeries','BIMBO BAKERIES USA')
) as a(vendor, alias) on a.vendor = v.name
on conflict (alias_normalized) do nothing;
