ALTER TABLE "ChatSetting" ADD COLUMN "ackMaxRequiredUsers" INTEGER NOT NULL DEFAULT 50;
ALTER TABLE "ChatSetting" ADD COLUMN "ackMaxRequiredGroups" INTEGER NOT NULL DEFAULT 20;
ALTER TABLE "ChatSetting" ADD COLUMN "ackMaxRequiredRoles" INTEGER NOT NULL DEFAULT 20;

ALTER TABLE "ChatAckRequest" ADD COLUMN "requestedUserIds" JSONB;
ALTER TABLE "ChatAckRequest" ADD COLUMN "requestedGroupIds" JSONB;
ALTER TABLE "ChatAckRequest" ADD COLUMN "requestedRoles" JSONB;
