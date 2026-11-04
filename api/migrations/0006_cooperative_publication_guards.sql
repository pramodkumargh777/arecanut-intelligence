DROP TRIGGER cooperative_verify_guard;

CREATE TRIGGER cooperative_verify_guard
BEFORE UPDATE ON cooperative_quotes
WHEN NEW.status = 'verified' AND (
  NEW.minimum_price IS NULL OR NEW.maximum_price IS NULL OR NEW.average_price IS NULL
  OR NEW.minimum_price <= 0 OR NEW.average_price < NEW.minimum_price OR NEW.average_price > NEW.maximum_price
  OR trim(NEW.branch) = '' OR trim(NEW.variety) = '' OR NEW.validation_message IS NOT NULL
  OR length(NEW.reporting_date) != 10 OR date(NEW.reporting_date, '+0 days') IS NULL
  OR date(NEW.reporting_date, '+0 days') != NEW.reporting_date OR NEW.reporting_date > date('now'))
BEGIN
  SELECT RAISE(ABORT, 'Invalid cooperative quotation cannot be published');
END;

CREATE TRIGGER cooperative_verify_insert_guard
BEFORE INSERT ON cooperative_quotes
WHEN NEW.status = 'verified' AND (
  NEW.minimum_price IS NULL OR NEW.maximum_price IS NULL OR NEW.average_price IS NULL
  OR NEW.minimum_price <= 0 OR NEW.average_price < NEW.minimum_price OR NEW.average_price > NEW.maximum_price
  OR trim(NEW.branch) = '' OR trim(NEW.variety) = '' OR NEW.validation_message IS NOT NULL
  OR length(NEW.reporting_date) != 10 OR date(NEW.reporting_date, '+0 days') IS NULL
  OR date(NEW.reporting_date, '+0 days') != NEW.reporting_date OR NEW.reporting_date > date('now'))
BEGIN
  SELECT RAISE(ABORT, 'Invalid cooperative quotation cannot be published');
END;
