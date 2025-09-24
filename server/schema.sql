-- Create the main media_items table
CREATE TABLE IF NOT EXISTS media_items (
                                           id SERIAL PRIMARY KEY,
                                           external_id TEXT UNIQUE,
                                           guid TEXT,
                                           title TEXT,
                                           series_title TEXT,
                                           season_number INTEGER,
                                           episode_number INTEGER,
                                           content_type TEXT,
                                           availability_state TEXT,
                                           countries TEXT[],
                                           premium_features TEXT[],
                                           updated_timestamp BIGINT,
                                           added_timestamp BIGINT,
                                           created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                                           updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                                           provider TEXT,
                                           description TEXT,
                                           available_date TIMESTAMP NULL,
                                           expiration_date TIMESTAMP NULL,
                                           ratings JSONB,
                                           youtube_video_ids TEXT[],
                                           primary_category_name TEXT,
                                           primary_category_id TEXT,
                                           source_partner TEXT,
                                           video_id TEXT,
                                           pub_date TIMESTAMP NULL,
                                           content JSONB,
                                           thumbnails JSONB,
                                           cbs JSONB,
                                           ytcp JSONB,
                                           yt JSONB,
                                           msn JSONB,
                                           pl2 JSONB
);

-- Create staging table for CSV imports
CREATE TABLE IF NOT EXISTS media_items_staging (
                                                   id TEXT,
                                                   guid TEXT,
                                                   title TEXT,
                                                   series_title TEXT,
                                                   season_number TEXT,
                                                   episode_number TEXT,
                                                   content_type TEXT,
                                                   availabilityState TEXT,
                                                   countries TEXT,
                                                   premium_features TEXT,
                                                   updated TEXT,
                                                   added TEXT,
                                                   provider TEXT,
                                                   description TEXT,
                                                   availableDate TEXT,
                                                   expirationDate TEXT,
                                                   ratings TEXT,
                                                   pubDate TEXT,
                                                   primary_category_name TEXT,
                                                   primary_category_id TEXT,
                                                   source_partner TEXT,
                                                   video_id TEXT,
                                                   youtube_video_ids TEXT,
                                                   raw_row JSONB
);

-- Create function to import CSV data from staging table
CREATE OR REPLACE FUNCTION import_media_csv()
RETURNS INTEGER AS $$
DECLARE
inserted_count INTEGER := 0;
    rec RECORD;
BEGIN
FOR rec IN SELECT * FROM media_items_staging LOOP
    INSERT INTO media_items (
    external_id,
    guid,
    title,
    series_title,
    season_number,
    episode_number,
    content_type,
    availability_state,
    countries,
    premium_features,
    updated_timestamp,
    added_timestamp
) VALUES (
               rec.id,
               rec.guid,
               rec.title,
               rec.series_title,
               CASE WHEN rec.season_number ~ '^\d+(\.\d+)?$' THEN rec.season_number::NUMERIC::INTEGER ELSE NULL END,
               CASE WHEN rec.episode_number ~ '^\d+(\.\d+)?$' THEN rec.episode_number::NUMERIC::INTEGER ELSE NULL END,
               rec.content_type,
               rec.availabilityState,
               string_to_array(rec.countries, ','),
               string_to_array(rec.premium_features, ','),
               CASE WHEN rec.updated ~ '^\d+$' THEN rec.updated::BIGINT ELSE NULL END,
               CASE WHEN rec.added ~ '^\d+$' THEN rec.added::BIGINT ELSE NULL END
               )
           ON CONFLICT (external_id) DO UPDATE SET
    guid = EXCLUDED.guid,
                                            title = EXCLUDED.title,
                                            series_title = EXCLUDED.series_title,
                                            season_number = EXCLUDED.season_number,
                                            episode_number = EXCLUDED.episode_number,
                                            content_type = EXCLUDED.content_type,
                                            availability_state = EXCLUDED.availability_state,
                                            countries = EXCLUDED.countries,
                                            premium_features = EXCLUDED.premium_features,
                                            updated_timestamp = EXCLUDED.updated_timestamp,
                                            added_timestamp = EXCLUDED.added_timestamp,
                                            updated_at = CURRENT_TIMESTAMP;

inserted_count := inserted_count + 1;
END LOOP;

RETURN inserted_count;
END;
$$ LANGUAGE plpgsql;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_media_items_title ON media_items(title);
CREATE INDEX IF NOT EXISTS idx_media_items_series_title ON media_items(series_title);
CREATE INDEX IF NOT EXISTS idx_media_items_content_type ON media_items(content_type);
CREATE INDEX IF NOT EXISTS idx_media_items_availability_state ON media_items(availability_state);
CREATE INDEX IF NOT EXISTS idx_media_items_external_id ON media_items(external_id);