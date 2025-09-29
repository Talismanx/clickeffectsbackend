// /api/verify.js
import { createClient } from "@supabase/supabase-js";
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  const key = String(req.query.key || "").trim().toUpperCase();

  // CE-XXXX-XXXX-XXXX
  if (!/^CE-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}$/.test(key)) {
    return res.status(200).json({ ok: false, reason: "invalid_format" });
  }

  const { data, error } = await supabase
    .from("licenses")
    .select("license_key,status")
    .eq("license_key", key)
    .maybeSingle();

  if (error) return res.status(500).json({ ok: false, reason: "db_error" });

  const valid = !!data && (data.status || "active") === "active";
  return res.status(200).json({ ok: valid });
}
