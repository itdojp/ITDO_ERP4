-- Chat migration (Step 5) verification checks
-- Purpose: Verify old ProjectChat* rows are present in Chat* tables before dropping legacy tables.
--
-- Usage:
--   psql "$DATABASE_URL_PSQL" -v ON_ERROR_STOP=1 -f scripts/checks/chat-migration-step5.sql
--
-- Notes:
-- - This script expects legacy tables (ProjectChat*) to still exist.
-- - If you already applied the drop migration, this script will fail (tables not found).

-- 1) Row counts (legacy vs new)
select count(*) as legacy_project_chat_message_count from "ProjectChatMessage";
select count(*) as legacy_project_chat_ack_request_count from "ProjectChatAckRequest";
select count(*) as legacy_project_chat_ack_count from "ProjectChatAck";
select count(*) as legacy_project_chat_attachment_count from "ProjectChatAttachment";
select count(*) as legacy_project_chat_read_state_count from "ProjectChatReadState";

select count(*) as chat_message_total_count from "ChatMessage";
select count(*) as chat_ack_request_total_count from "ChatAckRequest";
select count(*) as chat_ack_total_count from "ChatAck";
select count(*) as chat_attachment_total_count from "ChatAttachment";
select count(*) as chat_read_state_total_count from "ChatReadState";

-- 2) Inclusion checks (legacy IDs must exist in new tables)
select count(*) as missing_chat_messages
from "ProjectChatMessage" legacy
left join "ChatMessage" chat on chat.id = legacy.id
where chat.id is null;

select count(*) as mismatched_room_ids
from "ProjectChatMessage" legacy
join "ChatMessage" chat on chat.id = legacy.id
where chat."roomId" <> legacy."projectId";

select legacy."projectId", count(*) as missing_count
from "ProjectChatMessage" legacy
left join "ChatMessage" chat on chat.id = legacy.id
where chat.id is null
group by legacy."projectId"
order by missing_count desc, legacy."projectId"
limit 20;

select count(*) as missing_chat_ack_requests
from "ProjectChatAckRequest" legacy
left join "ChatAckRequest" chat on chat.id = legacy.id
where chat.id is null;

select count(*) as missing_chat_acks
from "ProjectChatAck" legacy
left join "ChatAck" chat on chat.id = legacy.id
where chat.id is null;

select count(*) as missing_chat_attachments
from "ProjectChatAttachment" legacy
left join "ChatAttachment" chat on chat.id = legacy.id
where chat.id is null;

select count(*) as missing_chat_read_states
from "ProjectChatReadState" legacy
left join "ChatReadState" chat on chat.id = legacy.id
where chat.id is null;

select count(*) as mismatched_read_state_room_ids
from "ProjectChatReadState" legacy
join "ChatReadState" chat on chat.id = legacy.id
where chat."roomId" <> legacy."projectId";

-- 3) Freshness checks (legacy should not receive new writes after migration)
select max("createdAt") as legacy_project_chat_message_max_created_at from "ProjectChatMessage";
select max("createdAt") as chat_message_max_created_at from "ChatMessage";

select max("updatedAt") as legacy_project_chat_read_state_max_updated_at from "ProjectChatReadState";
select max("updatedAt") as chat_read_state_max_updated_at from "ChatReadState";

