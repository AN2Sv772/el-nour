const { Client } = require('pg');
const fs = require('fs');
require('dotenv').config({ path: '.env.local' });

async function runMigration() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL not set in .env.local');
    process.exit(1);
  }

  console.log('Connecting to database...');
  const client = new Client({ connectionString });
  
  try {
    await client.connect();
    console.log('Connected successfully!');

    // Read the migration file
    const sql = fs.readFileSync('combined_migrations_fixed.sql', 'utf8');
    console.log(`Migration file loaded: ${sql.length} characters`);

    // Execute the migration
    console.log('Executing migration...');
    await client.query(sql);
    console.log('Migration executed successfully!');

    // Verify
    const tables = await client.query(`SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`);
    console.log(`Tables created: ${tables.rows[0].count}`);

    const enums = await client.query(`SELECT COUNT(*) FROM pg_type WHERE typtype = 'e' AND typnamespace = 'public'::regnamespace`);
    console.log(`Enums created: ${enums.rows[0].count}`);

    const policies = await client.query(`SELECT COUNT(*) FROM pg_policies WHERE schemaname = 'public'`);
    console.log(`RLS policies created: ${policies.rows[0].count}`);

    const seedData = await client.query(`SELECT COUNT(*) FROM business_settings`);
    console.log(`business_settings rows: ${seedData.rows[0].count}`);

  } catch (err) {
    console.error('Migration failed:', err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration();
