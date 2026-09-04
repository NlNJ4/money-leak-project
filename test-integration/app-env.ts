// Wires the APPLICATION modules at the local Supabase stack and the test
// mock servers. Import this before importing anything from lib/ — module
// constants (LINE base URL, timeouts) are read at load time.
import { SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL } from "./env";

// The app's server-side clients read these names.
process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = SUPABASE_SERVICE_ROLE_KEY;

// Fake credentials for the mocked external APIs.
process.env.LINE_CHANNEL_ACCESS_TOKEN = "test-line-token";
process.env.LINE_CHANNEL_SECRET = "test-line-secret";
process.env.GEMINI_API_KEY = "test-gemini-key";

// Keep failure-path tests fast.
process.env.LINE_TIMEOUT_MS = "400";
process.env.GEMINI_TIMEOUT_MS = "400";
