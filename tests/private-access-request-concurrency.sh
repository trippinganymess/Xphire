#!/usr/bin/env bash
# Disposable loopback database only, after migrations 004 and 005.
set -euo pipefail
case "${PGHOST:-}" in localhost|127.0.0.1) ;; *) echo 'A loopback disposable database is required.' >&2; exit 1 ;; esac
test_dir="$(mktemp -d)"
test_user='60000000-0000-0000-0000-000000000001'
cleanup() {
  psql -X -v ON_ERROR_STOP=1 -q -c "delete from auth.users where id = '$test_user';" >/dev/null
  rm -f "$test_dir/one" "$test_dir/two"
  rmdir "$test_dir"
}
trap cleanup EXIT
psql -X -v ON_ERROR_STOP=1 -q -c "insert into auth.users(id, is_anonymous) values ('$test_user', false);"
for name in one two; do
  psql -X -v ON_ERROR_STOP=1 -Atq >"$test_dir/$name" <<SQL &
begin;
set local role service_role;
select public.claim_private_job_access_request('$test_user', 'candidate@example.test', 'Candidate', 'Access please')->>'status';
select pg_sleep(0.5);
commit;
SQL
done
wait
count_status() {
  awk -v expected="$1" '$0 == expected {count++} END {print count+0}' "$test_dir/one" "$test_dir/two"
}
[[ "$(count_status claimed)" == 1 ]]
[[ "$(count_status cooldown)" == 1 ]]
for name in one two; do
  psql -X -v ON_ERROR_STOP=1 -Atq >"$test_dir/$name" <<SQL &
begin;
set local role service_role;
select public.claim_private_job_access_notification(
  (select request_id from public.private_job_access_requests where user_id = '$test_user'))->>'status';
select pg_sleep(0.5);
commit;
SQL
done
wait
[[ "$(count_status claimed)" == 1 ]]
[[ "$(count_status skipped)" == 1 ]]
echo 'PASS: overlapping requests and notifications each acquire exactly one durable claim.'
