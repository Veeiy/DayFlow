import Stripe from "npm:stripe@14";
import { createClient } from "npm:@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!);
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

Deno.serve(async (req) => {
  const sig  = req.headers.get("stripe-signature")!;
  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      body, sig,
      Deno.env.get("STRIPE_WEBHOOK_SECRET")!
    );
  } catch (err) {
    console.error("Webhook signature failed:", err);
    return new Response("Webhook Error", { status: 400 });
  }

  const setPlan = async (userId: string, plan: string) => {
    await supabase.from("user_settings").upsert({
      user_id: userId,
      plan,
      updated_at: new Date().toISOString(),
    });
    console.log(`Set plan=${plan} for user=${userId}`);
  };

  switch (event.type) {

    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const { userId, plan } = session.metadata || {};
      if (userId && plan) await setPlan(userId, plan);
      break;
    }

    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      const { userId, plan } = sub.metadata || {};
      // If subscription is active or trialing, keep plan active
      if (userId && plan && ["active","trialing"].includes(sub.status)) {
        await setPlan(userId, plan);
      }
      // If past_due or unpaid, don't downgrade yet — Stripe retries
      break;
    }

    case "customer.subscription.deleted": {
      // Subscription cancelled or payment failed — downgrade to free
      const sub = event.data.object as Stripe.Subscription;
      const { userId } = sub.metadata || {};
      if (userId) await setPlan(userId, "free");
      break;
    }

    case "invoice.payment_failed": {
      // Payment failed — could notify user, but don't downgrade immediately
      // Stripe will retry and send subscription.deleted if all retries fail
      const invoice = event.data.object as Stripe.Invoice;
      console.log(`Payment failed for invoice ${invoice.id}`);
      break;
    }

    default:
      console.log(`Unhandled event: ${event.type}`);
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
