# 2026 Q3 Disclosure Update

Checked on 2026-11-14; reporting period 2026-09-30.

- National-team direct A shares: 35 companies, 48 positions, CNY 37,688.98 hundred million. Share counts crosschecked between Eastmoney top-ten shareholder records and Tushare. Prices use period-end closes.
- Social-security investment portfolios: 562 companies, CNY 1,875.12 hundred million; no unmatched share-count differences in this run.
- CCB Central Huijin: 267,392,944 A shares included; 142,590,494,651 H shares excluded. Source: https://www.ccb.com/chn/2026-10/30/article_2026103017440584080.shtml
- All 14 sample ETFs' 2026 interim and Q3 original reports were downloaded and parsed. None disclosed an identifiable named top-ten holder table. ETF amounts, ownership ratios and combined totals remain null, not zero. Source report identifiers, document hashes and publication dates are retained in national_team_etf_history.json.
- Q3 all-A market value: 1,113,415.0416651913 hundred million CNY, 5,572 companies. Shanghai and Shenzhen exchange totals exclude B shares and reconcile to their constituent boards. Beijing uses the sum of all 348 listed A shares from Tushare daily_basic. All observations are dated 2026-09-30. Overall national-team and social holding ratios use this denominator.
- Per-company A-share capital remains unverified for Q3. Individual-company ownership ratios are unavailable; this does not prevent the overall market-value ratios above.

## Update Procedure

When the user requests a data update, check whether a new reporting season has completed. Refresh direct stocks, social portfolios, ETF holder disclosures and denominators as separate datasets. Never infer freshness from the daily quote date, never reuse prior-period ETF units, and never convert an undisclosed value to zero. Preserve existing historical periods during incremental exports. No periodic background check is requested.
