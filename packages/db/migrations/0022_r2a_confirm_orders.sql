-- Website orders are confirmed from the Orders list by owner, manager, cashier and online staff (FR-ORD-03, SRS Appendix A).
INSERT INTO "platform"."role_permission" ("role_id", "permission") SELECT "id", 'online.confirm' FROM "platform"."role" WHERE "code" IN ('manager', 'cashier', 'online_staff') ON CONFLICT DO NOTHING;
