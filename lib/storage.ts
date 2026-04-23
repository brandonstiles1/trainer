import "server-only";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";

const BUCKET = "photos";

export type PhotoKind = "before" | "goal" | "progress";

/**
 * Returns a signed upload URL the client can PUT image bytes to.
 * Path format: {user_id}/{kind}/{iso-date}-{uuid}.{ext}
 */
export async function createSignedUploadUrl(params: {
  userId: string;
  kind: PhotoKind;
  ext: "jpg" | "jpeg" | "png" | "webp" | "heic";
}): Promise<{ path: string; token: string; signedUrl: string }> {
  const supabase = await createClient();
  const date = new Date().toISOString().slice(0, 10);
  const filename = `${date}-${randomUUID()}.${params.ext}`;
  const path = `${params.userId}/${params.kind}/${filename}`;

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUploadUrl(path);

  if (error || !data) throw new Error(`signed url failed: ${error?.message ?? "unknown"}`);

  return { path, token: data.token, signedUrl: data.signedUrl };
}

/**
 * Returns a signed URL the client can GET to display a stored image.
 * Expires in 1 hour.
 */
export async function createSignedReadUrl(path: string): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, 3600);
  if (error || !data) throw new Error(`signed read url failed: ${error?.message ?? "unknown"}`);
  return data.signedUrl;
}
