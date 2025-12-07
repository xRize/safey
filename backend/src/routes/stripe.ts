import { Router } from 'express';
import Stripe from 'stripe';
import { pool } from '../db/index.js';
import express from 'express';

// Initialize Stripe only if real key is provided
const getStripe = () => {
  const key = process.env.STRIPE_SECRET_KEY || '';
  if (!key || key.includes('placeholder') || key === 'sk_test_your_stripe_secret_key_here') {
    return null;
  }
  return new Stripe(key, { apiVersion: '2023-10-16' });
};

const stripe = getStripe();

export const stripeRouter = Router();

// Stripe webhook endpoint
stripeRouter.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    if (!stripe) {
      return res.status(503).json({ error: 'Stripe not configured' });
    }
    
    const sig = req.headers['stripe-signature'];
    
    if (!sig) {
      return res.status(400).send('Missing stripe-signature');
    }
    
    let event: Stripe.Event;
    
    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET || ''
      );
    } catch (err: any) {
      console.error('Webhook signature verification failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }
    
    // Handle the event
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await handleSubscriptionUpdate(event.data.object as Stripe.Subscription);
        break;
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;
      default:
        console.log(`Unhandled event type: ${event.type}`);
    }
    
    res.json({ received: true });
  }
);

async function handleSubscriptionUpdate(subscription: Stripe.Subscription) {
  const customerId = subscription.customer as string;
  const status = subscription.status;
  
  let plan: string = 'free';
  if (status === 'active' || status === 'trialing') {
    plan = subscription.status === 'trialing' ? 'trial' : 'premium';
  }
  
  await pool.query(
    `UPDATE users 
     SET plan = $1, 
         stripe_subscription_id = $2,
         plan_started_at = CASE WHEN plan_started_at IS NULL THEN now() ELSE plan_started_at END,
         trial_expires_at = CASE WHEN $3 = 'trial' THEN now() + interval '30 days' ELSE trial_expires_at END
     WHERE stripe_customer_id = $4`,
    [plan, subscription.id, plan, customerId]
  );
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const customerId = subscription.customer as string;
  
  await pool.query(
    `UPDATE users 
     SET plan = 'free', 
         stripe_subscription_id = NULL,
         trial_expires_at = NULL
     WHERE stripe_customer_id = $1`,
    [customerId]
  );
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const customerId = session.customer as string;
  const subscriptionId = session.subscription as string;
  
  // Update user with customer ID if not set
  await pool.query(
    `UPDATE users 
     SET stripe_customer_id = $1
     WHERE email = $2 AND stripe_customer_id IS NULL`,
    [customerId, session.customer_email]
  );
}

// Create checkout session
stripeRouter.post('/create-checkout', async (req, res) => {
  if (!stripe) {
    return res.status(503).json({ error: 'Stripe not configured. Please add STRIPE_SECRET_KEY to .env' });
  }
  
  try {
    const { userId, email } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email required' });
    }
    
    const session = await stripe.checkout.sessions.create({
      customer_email: email,
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'SmartTrust Premium',
              description: 'AI-powered link trust verification with GPT insights'
            },
            unit_amount: 500, // $5.00
            recurring: {
              interval: 'month'
            }
          },
          quantity: 1
        }
      ],
      mode: 'subscription',
      success_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/cancel`,
      subscription_data: {
        trial_period_days: 30
      }
    });
    
    res.json({ sessionId: session.id, url: session.url });
  } catch (err: any) {
    console.error('Stripe checkout error:', err);
    res.status(500).json({ error: err.message });
  }
});

