-- ============================================================================
-- MIGRATION: Auto-create user_profiles on auth user creation
-- Ensures user profile exists even if API registration fails
-- ============================================================================

-- Function to create user profile on auth user creation
--
-- The account starts with NO authority: role `viewer` and INACTIVE.
--
-- WHY THIS CHANGED
-- ----------------
-- This trigger used to mint role `employee` with `is_active = true`. Every
-- `auth.users` insert — including a stranger who found the public /register
-- link — became a business-WRITE account: create orders, edit prices,
-- adjust stock, and export every customer's name, phone and address.
--
-- `viewer` + inactive is the safe default: the registration route promotes
-- the account to the intended role, and an admin promotes it later. A
-- deactivated account resolves to DENY in `require-role.ts`, so an account
-- that never gets promoted can do nothing at all.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_profiles (
    id,
    email,
    full_name,
    role,
    is_active
  ) VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name',
    'viewer',
    false
  )
  ON CONFLICT (id) DO NOTHING;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop existing trigger if exists
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Create trigger
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Also ensure the updated_at trigger exists on user_profiles
DROP TRIGGER IF EXISTS update_user_profiles_updated_at ON public.user_profiles;
CREATE TRIGGER update_user_profiles_updated_at
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
