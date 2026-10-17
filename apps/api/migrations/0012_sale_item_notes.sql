-- Add a per-sale-item note to the original canonical sale item record.
-- Existing sale_items_locked_update trigger blocks writes to completed/suspended
-- sales; service validation rejects controls/oversized content before updating.
ALTER TABLE sale_items ADD COLUMN note TEXT NOT NULL DEFAULT '' CHECK(length(note)<=240);
