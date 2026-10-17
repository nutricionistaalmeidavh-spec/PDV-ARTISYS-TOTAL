-- P3: user-facing note is part of original immutable sale item snapshot.
-- No item configuration or additional stock ledger is introduced.
ALTER TABLE sale_items ADD COLUMN note TEXT NOT NULL DEFAULT '' CHECK(length(note)<=240);
CREATE TRIGGER sale_item_note_no_control BEFORE UPDATE OF note ON sale_items
WHEN NEW.note LIKE '%'||char(0)||'%' OR length(NEW.note)>240
BEGIN SELECT RAISE(ABORT,'ITEM_NOTE_INVALID'); END;
