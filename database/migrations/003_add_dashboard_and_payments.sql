ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS delivery_status VARCHAR(20) NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_delivery_status_check'
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_delivery_status_check
      CHECK (delivery_status IN ('pending', 'delivered'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  recorded_by_user_id UUID NOT NULL REFERENCES users(id),
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  payment_method VARCHAR(50) NOT NULL,
  reference VARCHAR(150),
  notes TEXT,
  is_initial BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT payments_method_not_blank CHECK (length(btrim(payment_method)) > 0)
);

CREATE INDEX IF NOT EXISTS payments_order_id_index ON payments (order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payments_recorded_by_user_id_index ON payments (recorded_by_user_id);
CREATE UNIQUE INDEX IF NOT EXISTS payments_one_initial_per_order_index
  ON payments (order_id) WHERE is_initial = TRUE;
CREATE INDEX IF NOT EXISTS orders_delivery_status_index ON orders (delivery_status);
CREATE INDEX IF NOT EXISTS orders_balance_due_date_index ON orders (balance_due_date) WHERE balance_amount > 0;

INSERT INTO payments (
  order_id,
  recorded_by_user_id,
  amount,
  payment_date,
  payment_method,
  notes,
  is_initial,
  created_at
)
SELECT
  orders.id,
  orders.created_by_user_id,
  orders.payment_amount,
  orders.created_at::date,
  'Initial payment',
  orders.payment_details,
  TRUE,
  orders.created_at
FROM orders
WHERE orders.payment_amount > 0
  AND NOT EXISTS (
    SELECT 1 FROM payments
    WHERE payments.order_id = orders.id AND payments.is_initial = TRUE
  );