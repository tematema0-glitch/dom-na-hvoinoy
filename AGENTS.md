# Production safety — GOLD

The owner confirmed the working version on 2026-11-25 after reverting the failed tariff change.
- GOLD branch: `gold`, commit `966bcd749882c19ec38f56082fc40c67a875caee`.
- GOLD tree: `e362d334f8a28507ee8e571561c147099bdfd8bb`.
- Never move, delete, or overwrite the GOLD branch without the owner's explicit approval.
- For each change, start from the verified production head; create a separate branch and a rollback point. Make minimal, scoped changes. Do not edit the compiled storefront or its HTML unless specifically necessary and tested for hydration, asset loading and regression risk.
- Run applicable tests, including a browser smoke test of the existing home page and booking flow, before promoting a change to `main`. If actual browser or production verification is blocked, disclose the limitation and keep the change in a preview branch unless the owner explicitly accepts the unverified deployment risk.
- Do not alter production data, actual rates, bookings, referrals, or notifications when testing. No real booking submissions.
- Experimental visual work belongs in an authenticated, separate owner preview, never directly on the public home page. The owner must approve any later public rollout.
- Verify the commit and deployment separately; never describe an unverified deployment or test as successful.
