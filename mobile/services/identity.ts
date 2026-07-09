import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "fschool_uid";

function generateUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// Mirrors getOrCreateUserId() in src/context/AppContext.tsx — the web app's
// "users" row is keyed by this locally-persisted uuid, not the Supabase Auth
// session id. Reuse the same identity model here so a signed-up account's
// data (courses, assignments, gpa) is reachable the same way on mobile.
export async function getOrCreateUserId(): Promise<string> {
  let uid = await AsyncStorage.getItem(KEY);
  if (!uid) {
    uid = generateUUID();
    await AsyncStorage.setItem(KEY, uid);
  }
  return uid;
}
