CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  created_by_user_id UUID NOT NULL REFERENCES users(id),
  customer_name VARCHAR(150) NOT NULL,
  phone_number VARCHAR(50) NOT NULL,
  address TEXT NOT NULL,
  total_cost NUMERIC(12, 2) NOT NULL CHECK (total_cost > 0),
  payment_amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (payment_amount >= 0 AND payment_amount <= total_cost),
  payment_details TEXT,
  balance_amount NUMERIC(12, 2) NOT NULL CHECK (balance_amount >= 0),
  balance_due_date DATE,
  delivery_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT orders_balance_matches_payments CHECK (balance_amount = total_cost - payment_amount),
  CONSTRAINT orders_balance_due_date_required CHECK (balance_amount = 0 OR balance_due_date IS NOT NULL),
  CONSTRAINT orders_customer_name_not_blank CHECK (length(btrim(customer_name)) > 0),
  CONSTRAINT orders_phone_number_not_blank CHECK (length(btrim(phone_number)) > 0),
  CONSTRAINT orders_address_not_blank CHECK (length(btrim(address)) > 0)
);

CREATE INDEX IF NOT EXISTS orders_created_at_index ON orders (created_at DESC);
CREATE INDEX IF NOT EXISTS orders_created_by_user_id_index ON orders (created_by_user_id);