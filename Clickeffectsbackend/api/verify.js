// /api/verify.js
import { createClient } from "@supabase/supabase-js";
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();

  const key = String(req.query.key || "").trim().toUpperCase();
  if (!/^CE-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}$/.test(key)) {
    return res.status(200).json({ ok:false, reason:"invalid_format" });
  }

  const { data, error } = await supabase
    .from("licenses")
    .select("license_key,status")
    .eq("license_key", key)
    .maybeSingle();

  if (error) return res.status(500).json({ ok:false, reason:"db_error" });

  const valid = !!data && (data.status || "active") === "active";
  return res.status(200).json({ ok: valid });
}
