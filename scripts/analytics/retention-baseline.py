#!/usr/bin/env python3
"""Monthly activation, retention and per-feature usage, rebuilt from production D1.

PostHog only has feature events from v2.56.85 (2026-09-26) on; this is the
historical baseline back to launch. Read-only: it runs two SELECTs through
wrangler and prints counts, never emails.

    python3 scripts/analytics/retention-baseline.py [--exclude email ...]

Caveats baked into the SQL:
- "active" = any audited product action or created record, not a sign-in.
- animals.created_at before 2026-07-10 (migration 0054) is backfilled from old
  adoptions, so animal creation only counts after that date.
- "adopter_import_link" approximates single imports as manual adopters that
  carry a source_url.
- Forms shared were never stored server-side; see the PostHog form_shared event.
"""
import argparse
import collections
import json
import subprocess

ACTIVITY_SQL = """
WITH act AS (
  SELECT lower(user_email) e, strftime('%Y-%m', created_at, 'unixepoch') m,
    CASE action WHEN 'search' THEN 'search' WHEN 'adopter_created' THEN 'adopter_created'
      WHEN 'adoption_created' THEN 'adoption_registered' WHEN 'profile_viewed' THEN 'profile_viewed'
      ELSE 'other' END f
  FROM audit_log
  WHERE user_email IS NOT NULL
    AND action NOT IN ('sign_in', 'terms_accepted', 'pii_search_match_grant', 'pii_search_match_grant_replay')
  UNION ALL SELECT lower(added_by), strftime('%Y-%m', created_at, 'unixepoch'), 'animal_created'
  FROM animals WHERE added_by IS NOT NULL AND created_at >= strftime('%s', '2026-07-10')
  UNION ALL SELECT lower(added_by), strftime('%Y-%m', created_at, 'unixepoch'), 'adopter_import_link'
  FROM adopters WHERE source = 'manual' AND source_url IS NOT NULL AND source_url <> ''
  UNION ALL SELECT lower(actor_email), strftime('%Y-%m', started_at, 'unixepoch'), 'list_import'
  FROM import_runs
)
SELECT DISTINCT e, m, f FROM act
WHERE e LIKE '%@%' AND e NOT LIKE 'test%' AND m >= '2026-02'
"""

SIGNUP_SQL = """
SELECT lower(user_email) e, strftime('%Y-%m', MIN(created_at), 'unixepoch') m
FROM audit_log WHERE action = 'sign_in' AND user_email IS NOT NULL
GROUP BY lower(user_email)
"""

FEATURES = ['search', 'profile_viewed', 'adopter_created', 'adoption_registered',
            'animal_created', 'adopter_import_link', 'list_import', 'other']


def d1(sql: str) -> list[dict]:
    out = subprocess.run(
        ['npx', 'wrangler', 'd1', 'execute', 'pet-adoption-db', '--remote', '--json',
         '--command', ' '.join(sql.split())],
        check=True, capture_output=True, text=True,
    ).stdout
    return json.loads(out)[0]['results']


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--exclude', nargs='*', default=['jurfalino@gmail.com', 'gatitosolivos@gmail.com'],
                    help='internal accounts to leave out (matches the PostHog internal-users cohort)')
    args = ap.parse_args()
    excl = {e.lower() for e in args.exclude}

    months_by_user = collections.defaultdict(set)
    users_by_feature = collections.defaultdict(lambda: collections.defaultdict(set))
    for r in d1(ACTIVITY_SQL):
        if r['e'] in excl:
            continue
        months_by_user[r['e']].add(r['m'])
        users_by_feature[r['m']][r['f']].add(r['e'])

    signup = {r['e']: r['m'] for r in d1(SIGNUP_SQL) if r['e'] not in excl}
    for e, ms in months_by_user.items():
        signup.setdefault(e, min(ms))
    months = sorted(set(signup.values()) | {m for ms in months_by_user.values() for m in ms})

    activated = sum(1 for e in signup if e in months_by_user)
    print(f'Signed up: {len(signup)} | did something: {activated} | never did anything: {len(signup) - activated}\n')

    print('Cohort by sign-up month (counts of people active in each later month)')
    print('cohort   size  activated  ' + ' '.join(f'M+{i}'.rjust(4) for i in range(1, len(months))))
    for c in months:
        cohort = [e for e in signup if signup[e] == c]
        if not cohort:
            continue
        i0 = months.index(c)
        later = [sum(1 for e in cohort if months[i0 + k] in months_by_user.get(e, ()))
                 for k in range(1, len(months) - i0)]
        did = sum(1 for e in cohort if e in months_by_user)
        print(f'{c} {len(cohort):5} {did:10}   ' + ' '.join(f'{n:4}' for n in later))

    print('\nPeople per month, by feature')
    print('month    active ' + ' '.join(f[:11].rjust(11) for f in FEATURES))
    for m in months:
        active = sum(1 for ms in months_by_user.values() if m in ms)
        print(f'{m} {active:7} ' + ' '.join(f'{len(users_by_feature[m].get(f, ())):11}' for f in FEATURES))


if __name__ == '__main__':
    main()
