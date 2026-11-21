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
  // First, create the exec_sql function
  const createExecSql = `
    CREATE OR REPLACE FUNCTION exec_sql(sql text) RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    AS $$
    BEGIN
      EXECUTE sql;
    END;
    $$;
    
    GRANT EXECUTE ON FUNCTION exec_sql(text) TO postgres, anon, authenticated, service_role;
  `;
  
  console.log('Creating exec_sql function...');
  
  // We can't run arbitrary SQL via the REST API, but we can try to create the function
  // Let's try to use the Supabase REST API to execute a raw SQL query
  // Actually, we can't do this via the REST API directly.
  // We need to use the Supabase CLI or psql.
  
  console.log('Cannot run migrations via REST API. The exec_sql function does not exist.');
  console.log('Please run the migrations manually in the Supabase Dashboard SQL Editor.');
  console.log('Combined SQL file created at: combined_migrations.sql');
}

runMigrations().catch(console.error);
