-- Row count per First Five table. The caller picks the schema:
--   psql -v schema=first_five -f row-counts.sql   (default: public)
\if :{?schema}
\else
  \set schema public
\endif
SET search_path TO :"schema";

SELECT 'users' AS table_name, count(*) AS row_count FROM "users"
UNION ALL SELECT 'password_setup_tokens' AS table_name, count(*) AS row_count FROM "password_setup_tokens"
UNION ALL SELECT 'auth_sessions' AS table_name, count(*) AS row_count FROM "auth_sessions"
UNION ALL SELECT 'access_grants' AS table_name, count(*) AS row_count FROM "access_grants"
UNION ALL SELECT 'invitation_codes' AS table_name, count(*) AS row_count FROM "invitation_codes"
UNION ALL SELECT 'invitation_code_redemptions' AS table_name, count(*) AS row_count FROM "invitation_code_redemptions"
UNION ALL SELECT 'waitlist_leads' AS table_name, count(*) AS row_count FROM "waitlist_leads"
UNION ALL SELECT 'conversion_events' AS table_name, count(*) AS row_count FROM "conversion_events"
UNION ALL SELECT 'projects' AS table_name, count(*) AS row_count FROM "projects"
UNION ALL SELECT 'project_origins' AS table_name, count(*) AS row_count FROM "project_origins"
UNION ALL SELECT 'project_sdk_configs' AS table_name, count(*) AS row_count FROM "project_sdk_configs"
UNION ALL SELECT 'setup_sessions' AS table_name, count(*) AS row_count FROM "setup_sessions"
UNION ALL SELECT 'sdk_tickets' AS table_name, count(*) AS row_count FROM "sdk_tickets"
UNION ALL SELECT 'sdk_credentials' AS table_name, count(*) AS row_count FROM "sdk_credentials"
UNION ALL SELECT 'discovered_pages' AS table_name, count(*) AS row_count FROM "discovered_pages"
UNION ALL SELECT 'discovered_elements' AS table_name, count(*) AS row_count FROM "discovered_elements"
UNION ALL SELECT 'discovered_custom_events' AS table_name, count(*) AS row_count FROM "discovered_custom_events"
UNION ALL SELECT 'studies' AS table_name, count(*) AS row_count FROM "studies"
UNION ALL SELECT 'study_versions' AS table_name, count(*) AS row_count FROM "study_versions"
UNION ALL SELECT 'participant_invites' AS table_name, count(*) AS row_count FROM "participant_invites"
UNION ALL SELECT 'study_sessions' AS table_name, count(*) AS row_count FROM "study_sessions"
UNION ALL SELECT 'critical_event_receipts' AS table_name, count(*) AS row_count FROM "critical_event_receipts"
UNION ALL SELECT 'event_records' AS table_name, count(*) AS row_count FROM "event_records"
UNION ALL SELECT 'interview_questions' AS table_name, count(*) AS row_count FROM "interview_questions"
UNION ALL SELECT 'interview_responses' AS table_name, count(*) AS row_count FROM "interview_responses"
UNION ALL SELECT 'reports' AS table_name, count(*) AS row_count FROM "reports"
UNION ALL SELECT 'report_findings' AS table_name, count(*) AS row_count FROM "report_findings"
UNION ALL SELECT 'report_approvals' AS table_name, count(*) AS row_count FROM "report_approvals"
UNION ALL SELECT 'agent_runs' AS table_name, count(*) AS row_count FROM "agent_runs"
UNION ALL SELECT 'analysis_steps' AS table_name, count(*) AS row_count FROM "analysis_steps"
UNION ALL SELECT 'orders' AS table_name, count(*) AS row_count FROM "orders"
UNION ALL SELECT 'payments' AS table_name, count(*) AS row_count FROM "payments"
UNION ALL SELECT 'payment_webhook_events' AS table_name, count(*) AS row_count FROM "payment_webhook_events"
UNION ALL SELECT 'provider_connections' AS table_name, count(*) AS row_count FROM "provider_connections"
UNION ALL SELECT 'outbox_messages' AS table_name, count(*) AS row_count FROM "outbox_messages"
UNION ALL SELECT 'audit_logs' AS table_name, count(*) AS row_count FROM "audit_logs"
UNION ALL SELECT 'analytics_snapshots' AS table_name, count(*) AS row_count FROM "analytics_snapshots"
UNION ALL SELECT '_prisma_migrations' AS table_name, count(*) AS row_count FROM "_prisma_migrations"
ORDER BY table_name;
