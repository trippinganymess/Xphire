#!/usr/bin/env bash
# Test only the disposable database created by private-job-board-bootstrap.sql.
set -euo pipefail
case "${PGHOST:-}" in localhost|127.0.0.1) ;; *) echo 'A loopback disposable test database is required.' >&2; exit 1 ;; esac
work="$(mktemp -d)"
user_id='90000000-0000-0000-0000-000000000001'
cleanup() {
  psql -X -v ON_ERROR_STOP=1 -q -c "delete from auth.users where id = '$user_id';" >/dev/null
  rm -f "$work/one" "$work/two"
  rmdir "$work"
}
trap cleanup EXIT
psql -X -v ON_ERROR_STOP=1 -q <<SQL
insert into auth.users(id, is_anonymous) values ('$user_id', false);
insert into public.private_job_entitlements(user_id, active, expires_at)
values ('$user_id', true, clock_timestamp() + interval '1 day');
SQL
# Overlapping real PostgreSQL transactions exercise FOR UPDATE, not a fake lock.
for name in one two; do
  token='91000000-0000-0000-0000-000000000001'
  if [[ "$name" == two ]]; then token='91000000-0000-0000-0000-000000000002'; fi
  psql -X -v ON_ERROR_STOP=1 -Atq >"$work/$name" <<SQL &
begin;
set local role service_role;
select public.claim_private_job_scan('$user_id', '$token', 'frontend developer')->>'status';
select pg_sleep(0.5);
commit;
SQL
done
wait
[[ "$(grep -hxc claimed "$work/one" "$work/two" | awk '{s+=$1} END {print s}')" == 1 ]]
[[ "$(grep -hxc running "$work/one" "$work/two" | awk '{s+=$1} END {print s}')" == 1 ]]
echo 'PASS: overlapping claims acquire exactly one per-user daily allowance.'
