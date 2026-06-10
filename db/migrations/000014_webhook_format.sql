-- B-20: format de livraison des webhooks. 'lore' = événement brut signé ;
-- 'xapi' = statement xAPI (le récepteur est alors un LRS).
ALTER TABLE webhook_subscriptions
    ADD COLUMN IF NOT EXISTS format TEXT NOT NULL DEFAULT 'lore'
        CHECK (format IN ('lore', 'xapi'));
