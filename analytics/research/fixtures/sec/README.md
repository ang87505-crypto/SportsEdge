# SEC fixtures

Real EDGAR records for Berkshire Hathaway (CIK 0001067983), retrieved 2026-11-09 through a rendering
relay for format inspection, saved verbatim:

- `submissions_13f_only_2026-11-09.json`: `data.sec.gov/submissions/CIK0001067983.json`, reduced to the
  13F rows of `filings.recent` (all fields kept for those rows) plus the `files` list.
- `index_000095012325008361.json`, `primary_doc_000095012325008361.xml`,
  `infotable_000095012325008361.xml`: the 13F-HR/A (NEW HOLDINGS) accepted 2025-08-14 for 2025-03-31.

Fixtures whose file name contains `synthetic` are invented TEST-ONLY variants for failure cases.
