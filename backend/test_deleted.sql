-- Test script per verificare il funzionamento del flag deleted

-- 1. Verifica lo stato attuale
SELECT 'SERIES DELETED STATUS' as info;
SELECT id, title, deleted, sonarr_id FROM series;

SELECT 'SEASONS DELETED STATUS' as info;
SELECT id, series_id, season_number, title, deleted FROM seasons;

-- 2. Per testare, marca manualmente una serie come deleted
-- UPDATE series SET deleted = 1 WHERE id = 1;

-- 3. Per testare, marca manualmente una stagione come deleted
-- UPDATE seasons SET deleted = 1 WHERE id = 1;

-- 4. Per resettare tutto
-- UPDATE series SET deleted = 0;
-- UPDATE seasons SET deleted = 0;
