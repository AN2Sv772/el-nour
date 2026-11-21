import re

with open('combined_migrations_fixed.sql', 'r') as f:
    content = f.read()

# Add helper function for idempotent policy creation at the beginning
helper_function = '''
-- Helper function for idempotent policy creation
CREATE OR REPLACE FUNCTION create_policy_if_not_exists(
    p_policy_name TEXT,
    p_table_name TEXT,
    p_command TEXT,
    p_roles TEXT,
    p_using TEXT,
    p_with_check TEXT DEFAULT NULL
) RETURNS VOID AS $$
BEGIN
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', p_policy_name, p_table_name);
    IF p_with_check IS NOT NULL THEN
        EXECUTE format('CREATE POLICY %I ON %I FOR %s TO %s USING (%s) WITH CHECK (%s)',
            p_policy_name, p_table_name, p_command, p_roles, p_using, p_with_check);
    ELSE
        EXECUTE format('CREATE POLICY %I ON %I FOR %s TO %s USING (%s)',
            p_policy_name, p_table_name, p_command, p_roles, p_using);
    END IF;
EXCEPTION WHEN duplicate_object THEN
    -- Policy already exists, ignore
    NULL;
END;
$$ LANGUAGE plpgsql;

'''

# Insert after the first CREATE EXTENSION block
content = re.sub(
    r'(CREATE EXTENSION IF NOT EXISTS "uuid-ossp";\s*CREATE EXTENSION IF NOT EXISTS "pgcrypto";\s*\n)',
    r'\1\n' + helper_function,
    content,
    count=1
)

with open('combined_migrations_fixed.sql', 'w') as f:
    f.write(content)

print("Added idempotent policy helper function")
EOF