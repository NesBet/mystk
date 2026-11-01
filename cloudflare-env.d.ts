import type { D1Database, Fetcher } from "@cloudflare/workers-types";

declare global {
  interface CloudflareEnv {
    ASSETS: Fetcher;
    DB: D1Database;
    NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY?: string;
    PAYSTACK_SECRET_KEY?: string;
    PAYSTACK_WEBHOOK_SECRET?: string;
  }
}

export {};
