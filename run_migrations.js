const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: require('path').join(__dirname, '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  }
});

async function runMigrations() {
  const migrationFiles = [
    'supabase/migrations/20240101000000_initial_schema.sql',
    'supabase/migrations/20240102000000_fix_rls_policies.sql',
    'supabase/migrations/20240103000000_atomic_order_function.sql',
    'supabase/migrations/20240104000000_fix_whatsapp_and_orders.sql',
    'supabase/migrations/20240105000000_easyorders_integration.sql',
  ];

  for (const file of migrationFiles) {
    const sql = fs.readFileSync(file, 'utf8');
    console.log(`Running migration: ${file}`);
    
    // Split by semicolon and execute each statement
    const statements = sql.split(';').filter(s => s.trim());
    
    for (const stmt of statements) {
      if (stmt.trim()) {
        try {
          const { error } = await supabase.rpc('exec_sql', { sql: stmt + ';' });
          if (error) {
            console.error(`Error in ${file}:`, error);
          } else {
            console.log(`  ✓ Executed`);
          }
        } catch (e) {
          console.error(`Exception in ${file}:`, e.message);
        }
      }
    }
    
    console.log(`Completed: ${file}`);
  }
  
  console.log('All migrations completed!');
}

runMigrations().catch(console.error);
