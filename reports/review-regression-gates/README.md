# Review regression gates (2026-10-17)

Base: `bb9a95ac351a677117428447df09585af3b711f2` (freshly fetched main).
No AGENTS.md was present; the initial worktree was clean.

## Root causes and changes

- Backend Contract omitted review math/execution regressions. Both files now run in its explicit command. Synthetic known-answer acceptance is marked `slow`, so a separate `-m slow` step executes it instead of silently excluding it under pytest.ini.
- Recovery browser tests require a real backend and a deterministic 35-second solver delay. Tag both `@real`, exclude their dedicated fixture from the ordinary real server, and invoke their self-starting config through `test:e2e:review`. `test:e2e:real` runs both configurations sequentially; PR CI directly runs the recovery gate. The existing synthetic test token and all authentication assertions are retained; no new credential or LLM service is used. Runtime stores are unique temporary files.
- Generic-linear saves intentionally have an empty `component_spec`. Assert that plus the authoritative `semantic_spec.ui_metadata.time_dimension`, retaining the top-level/draft and reload assertions.
- Source switching uses the shared draft dialog. Update its title and action labels while retaining assertions that continuing preserves edits and discarding loads the selected template.
- Selecting a scenario kept the URL but replaced its workspace session ID with a timestamp. A changed system configuration then reinitialized the workspace and erased dirty edits. Retain the URL request identity; workspace generation still changes to reject stale saves. Test new and template entry points against changed configuration/template cache responses.

## Reproduction

`draft-before.log` records the deterministic failing assertion against the original implementation: name changed from 保留编辑内容 to an empty string, scenario disappeared, and the generated model code changed. The test waits for React Query cache notification delivery; window focus is not involved. The initial test harness attempt failed to select the Ant Design option and was corrected before this reproduction.

## Validation

Results observed before the final PR verification (see [PR #2](https://github.com/yingerfeng-cloud/New-Operations-Optimization/pull/2) for the final commit and check results):

| Command / gate | Observed result |
| --- | --- |
| `python -m pytest -q tests/test_review_math_contracts.py tests/test_review_execution_contracts.py tests/test_review_synthetic_poc.py` | 35 passed; slow synthetic test excluded by default, hence separate command below |
| `python -m pytest -q` with the complete Backend Contract file list in `.github/workflows/ci.yml` | 154 passed |
| `python -m pytest -q -m slow tests/test_review_synthetic_poc.py` | 1 passed, asserting all 11 synthetic outcomes |
| `npx vitest run src/tests/unit/ModelCreationPage.test.tsx --maxWorkers=1` | 20 passed (including both new regressions) |
| `npm run build` | passed after the draft fix |
| `npm run test:unit` in PR CI | 80 files / 465 tests passed |
| `npm run test:e2e:mock` in PR CI | 43 passed |
| `python scripts/verify_test_matrix.py` | passed, 20 mock / 5 real spec files |
| Windows delivery checks in PR CI | passed |

The first CI run is [39041922846](https://github.com/yingerfeng-cloud/New-Operations-Optimization/actions/runs/39041922846): four checks passed and recovery E2E had one pass / one timeout. The new fixture incorrectly inherited forced synchronous execution, causing the 35-second task submission to exceed Axios's 30-second timeout. Its final configuration explicitly sets `OPTIFORGE_SYNC_JOBS=false`; assertions still require acceptance within 10 seconds, elapsed execution over 30 seconds, one submission, refresh/network recovery, and objective 7. The submit locator also tolerates the exiting spinner's accessible label and explicitly checks that loading has ended.

Local environment: Python 3.12.14 / Node 24.19.0 / system Chromium; CI uses Python 3.13.5 / Node 22.17.0 / Playwright Chromium. The local full unit run was stopped after approximately seven minutes without a suite summary; it is **not** counted as passing. Targeted tests and the full CI suite supply the recorded results. Initial local Mock E2E could not create pages because Playwright FFmpeg was absent (43 environment failures). Browser download returned HTTP 403 from the network policy; the existing `/usr/bin/ffmpeg` was linked into a workspace-only Playwright cache for rerunning with system Chromium. No repository dependency or credential change was needed.

Backend runs emit five Starlette/httpx deprecation warnings. Builds emit the existing large-chunk warning. Neither was hidden. Final recovery and broader real-backend results, including any unrelated limitations, are reported in the PR and handoff.

No main merge, deployment, customer data, or paid LLM calls.
