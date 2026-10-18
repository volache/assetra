import { supabase } from "../../supabase";

// Changes the signed-in user's password; throws when the current password is wrong.
export async function changePassword(currentPassword, nextPassword) {
  const { error } = await supabase.auth.updateUser({
    password: nextPassword,
    current_password: currentPassword,
  });
  if (error) throw error;
}
