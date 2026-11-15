# Active Fund Report Freshness Audit

Checked 2026-11-15 using fresh Tushare fund_basic, fund_nav and fund_portfolio responses.

- Re-fetched 2025-12-31 and 2026-06-30 reports instead of merely changing their check date.
- Latest valid complete-portfolio snapshot remains 2026-06-30: 4,343 qualified funds, 65.57% coverage, 79.7010% Shanghai/Shenzhen A-share position and 20.4316% top-ten concentration.
- Probed 2026-09-30 explicitly: 176,013 portfolio rows; 10,419 fund/share-class NAV records; 162 complete-portfolio qualified samples after screening and deduplication; 1.58% coverage, below the existing 40% threshold.
- Quarterly top holdings must not be summed and presented as the full stock position or spliced into the semiannual series. This result is an API coverage audit, not a claim that Q3 reports do not exist or that no alternative quarterly aggregate-equity data can be obtained.
- The latest-quarter diagnostic is now part of the refresh pipeline. The two charts disclose the actual check date and latest-quarter coverage failure; the original historical frequency and sample thresholds are unchanged.

Machine-readable evidence: active-fund-latest-report-audit.json. Re-run work/audit_active_fund_latest.py to probe the latest completed quarter.
