DROP TABLE "orders"."contact_task" CASCADE;--> statement-breakpoint
-- The to-notify permission is withdrawn with the worklist (FR-ORD-18).
DELETE FROM "platform"."role_permission" WHERE "permission" = 'contact_task.manage';
--> statement-breakpoint
DELETE FROM "platform"."setting" WHERE "key" = 'contact_task.due_hours';
