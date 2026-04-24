import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { serverEnv } from "@/lib/env";
import * as schema from "./schema";

// Vercel serverless: postgres-js default max=10 can saturate Supavisor.
// Keep it low to avoid "protocol handshake over the pooler hangs".
const client = postgres(serverEnv().DATABASE_URL, {
  prepare: false, // required for transaction pooler (6543)
  max: 1,         // serverless: keep backend connections per warm instance minimal
});
export const db = drizzle(client, { schema });
