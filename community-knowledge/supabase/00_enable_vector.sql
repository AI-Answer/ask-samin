-- Check where pgvector lives on this project (informational)
select e.extname, n.nspname as extension_schema
from pg_extension e
join pg_namespace n on n.oid = e.extnamespace
where e.extname = 'vector';

select ns.nspname as operator_schema,
       o.oprname,
       format_type(t1.oid, null) as left_type,
       format_type(t2.oid, null) as right_type
from pg_operator o
join pg_namespace ns on ns.oid = o.oprnamespace
join pg_type t1 on t1.oid = o.oprleft
join pg_type t2 on t2.oid = o.oprright
where o.oprname = '<=>'
  and t1.typname = 'vector'
  and t2.typname = 'vector';
