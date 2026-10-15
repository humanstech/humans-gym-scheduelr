-- ============================================================
-- Phase 1B — Bookings RLS: enforce allow_multiple_bookings flag
-- Esegui nel SQL Editor di Supabase
-- ============================================================

-- Sostituisce la policy bookings_insert_own con una versione che
-- controlla anche allow_multiple_bookings sulla tabella spaces:
-- se false, l'utente non può avere più di 1 prenotazione per
-- lo stesso spazio nella stessa data.

DROP POLICY IF EXISTS "bookings_insert_own" ON bookings;

CREATE POLICY "bookings_insert_own"
  ON bookings FOR INSERT
  TO authenticated
  WITH CHECK (
    -- L'utente prenota solo per sé
    user_id = auth.uid()

    -- Controllo capacità massima slot
    AND (
      SELECT COUNT(*) FROM bookings b WHERE b.slot_id = bookings.slot_id
    ) < (
      SELECT s.max_capacity FROM slots s WHERE s.id = bookings.slot_id
    )

    -- Controllo prenotazione singola per spazio+data (se allow_multiple_bookings = false)
    AND (
      -- Se lo spazio permette più prenotazioni, nessun vincolo aggiuntivo
      (
        SELECT sp.allow_multiple_bookings
        FROM spaces sp
        JOIN slots s ON s.space_id = sp.id
        WHERE s.id = bookings.slot_id
      ) = true

      OR

      -- Altrimenti: l'utente non deve avere già una prenotazione
      -- in un qualsiasi slot dello stesso spazio nella stessa data
      NOT EXISTS (
        SELECT 1
        FROM bookings b
        JOIN slots s       ON s.id = b.slot_id
        JOIN slots ts      ON ts.id = bookings.slot_id
        WHERE b.user_id    = auth.uid()
          AND s.space_id   = ts.space_id
          AND s.date       = ts.date
      )
    )
  );
