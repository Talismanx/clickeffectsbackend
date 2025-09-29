// /api/stripe-webhook.js
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

// Tell Vercel not to parse the body (Stripe needs the raw payload)
export const config = { api: { bodyParser: false } };

const stripe   = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const resend   = new Resend(process.env.RESEND_API_KEY);

// Collect raw body for signature verification
function buffer(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// Generate a CE-XXXX-XXXX-XXXX license (hex)
function makeLicense() {
  // Node 18+: global crypto is available
  const bytes = crypto.getRandomValues(new Uint8Array(6)); // 12 hex chars; we’ll split into groups of 4
  const hex = [...bytes].map(b => b.toString(16).padStart(2, "0")).join("").toUpperCase();
  // e.g. ABCDEF123456 -> CE-ABCD-EF12-3456
  return `CE-${hex.slice(0,4)}-${hex.slice(4,8)}-${hex.slice(8,12)}`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  const sig = req.headers["stripe-signature"];
  const rawBody = await buffer(req);

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const s = event.data.object;
    const email = s.customer_details?.email || s.customer_email || null;

    if (email) {
      // Idempotent: reuse same license if this email already bought before
      const { data: existing } = await supabase
        .from("licenses")
        .select("license_key")
        .eq("email", email)
        .limit(1)
        .maybeSingle();

      const license = existing?.license_key || makeLicense();

      await supabase.from("licenses").upsert(
        {
          license_key: license,
          email,
          stripe_customer_id: s.customer || null,
          stripe_session_id: s.id || null,
          status: "active"
        },
        { onConflict: "license_key" }
      );

      // Email the license (no-reply address you’ve verified at Resend)
      const from = process.env.LICENSE_FROM_EMAIL || "noreply@yourdomain.com";
      const subject = "Your ClickEffects Pro License Key";
      const html = `
        <div style="font-family:system-ui,Segoe UI,Roboto,Arial">
          <h2>Thanks for your purchase!</h2>
          <p>Here is your ClickEffects Pro license key:</p>
          <p style="font-size:20px;font-weight:700;padding:10px 14px;background:#0f1220;color:#e6ecff;border-radius:10px;display:inline-block">
            ${license}
          </p>
          <p>Open the extension’s Options page, paste this key, and click <b>Activate</b>.</p>
          <p style="color:#8ea0d0">Tip: save or screenshot this email for your records.</p>
        </div>`;

      try {
        await resend.emails.send({ from, to: email, subject, html });
      } catch (e) {
        console.error("Resend send error:", e?.message || e);
        // Not fatal: license is already stored in Supabase
      }
    }
  }

  return res.json({ received: true });
}
