import { config } from "dotenv";

// Imported first by scripts so env is in place before lib/env reads process.env.
config({ path: [".env.local", ".env"], quiet: true });
