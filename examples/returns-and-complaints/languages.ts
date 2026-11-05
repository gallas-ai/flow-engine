// The languages the bot speaks. The application picks one before the first message; it stays for the whole conversation.
export const languages = ["en", "cs", "es"] as const;
export type Language = (typeof languages)[number];
