-- Daily account-level budget guard for optional Analytics Engine writes.
-- Conservative 80k cap below Cloudflare Workers Free 100k datapoints/day.
-- Existing telemetry events remain stored locally when the external cap is reached.
CREATE TABLE IF NOT EXISTS saas_telemetry_analytics_budget (
 utc_day TEXT PRIMARY KEY CHECK(length(utc_day)=10),
 data_points INTEGER NOT NULL CHECK(data_points BETWEEN 0 AND 80000),
 updated_at TEXT NOT NULL
);
