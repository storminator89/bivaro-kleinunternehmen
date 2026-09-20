/** Shared browser/server policy for newly stored passwords. Login keeps legacy verification. */
export const PASSWORD_MAX_BYTES = 72;
export const PASSWORD_POLICY_HINT = "Mindestens 8 Zeichen mit Großbuchstaben, Kleinbuchstaben und Zahl; maximal 72 UTF-8-Bytes. Umlaute und Emojis benötigen mehrere Bytes.";

export function validatePassword(password: string): { valid: boolean; message?: string } {
  if (!password || typeof password !== "string") {
    return { valid: false, message: "Passwort ist erforderlich" };
  }
  if (password.length < 8) {
    return { valid: false, message: "Passwort muss mindestens 8 Zeichen lang sein" };
  }
  if (new TextEncoder().encode(password).byteLength > PASSWORD_MAX_BYTES) {
    return { valid: false, message: "Passwort darf maximal 72 UTF-8-Bytes lang sein. Umlaute und Emojis benötigen mehrere Bytes." };
  }
  if (!/[A-Z]/.test(password)) return { valid: false, message: "Passwort muss mindestens einen Großbuchstaben enthalten" };
  if (!/[a-z]/.test(password)) return { valid: false, message: "Passwort muss mindestens einen Kleinbuchstaben enthalten" };
  if (!/[0-9]/.test(password)) return { valid: false, message: "Passwort muss mindestens eine Zahl enthalten" };
  return { valid: true };
}
