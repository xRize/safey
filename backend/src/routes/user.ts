import { Router } from 'express';
import { pool } from '../db/index.js';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';

export const userRouter = Router();

// Set current user plan (authenticated)
userRouter.post('/me/set-plan', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const { plan } = req.body;
    
    if (!['free', 'trial', 'premium'].includes(plan)) {
      return res.status(400).json({ error: 'Invalid plan. Must be: free, trial, or premium' });
    }
    
    const result = await pool.query(
      `UPDATE users 
       SET plan = $1,
           plan_started_at = CASE WHEN plan_started_at IS NULL THEN now() ELSE plan_started_at END,
           trial_expires_at = CASE WHEN $1 = 'trial' THEN now() + interval '30 days' ELSE NULL END
       WHERE id = $2
       RETURNING id, email, plan, plan_started_at`,
      [plan, userId]
    );
    
    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error('Set plan error:', err);
    res.status(500).json({ error: 'Failed to update plan' });
  }
});

// Admin endpoint to set user plan (for testing/admin use)
userRouter.post('/:userId/set-plan', async (req, res) => {
  try {
    const { userId } = req.params;
    const { plan } = req.body;
    
    if (!['free', 'trial', 'premium'].includes(plan)) {
      return res.status(400).json({ error: 'Invalid plan. Must be: free, trial, or premium' });
    }
    
    const result = await pool.query(
      `UPDATE users 
       SET plan = $1,
           plan_started_at = CASE WHEN plan_started_at IS NULL THEN now() ELSE plan_started_at END,
           trial_expires_at = CASE WHEN $1 = 'trial' THEN now() + interval '30 days' ELSE NULL END
       WHERE id = $2
       RETURNING id, email, plan, plan_started_at`,
      [plan, userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error('Set plan error:', err);
    res.status(500).json({ error: 'Failed to update plan' });
  }
});

// Get or create user by email (for testing)
userRouter.post('/by-email', async (req, res) => {
  try {
    const { email, plan = 'free' } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email required' });
    }
    
    // Check if user exists
    let result = await pool.query(
      'SELECT id, email, plan FROM users WHERE email = $1',
      [email]
    );
    
    if (result.rows.length === 0) {
      // Create user
      result = await pool.query(
        `INSERT INTO users (email, plan, plan_started_at)
         VALUES ($1, $2, now())
         RETURNING id, email, plan`,
        [email, plan]
      );
    }
    
    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error('Get/create user error:', err);
    res.status(500).json({ error: 'Failed to get/create user' });
  }
});

// Get current user plan (authenticated)
userRouter.get('/me/plan', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    
    const result = await pool.query(
      `SELECT id, email, plan, plan_started_at, trial_expires_at 
       FROM users 
       WHERE id = $1`,
      [userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const user = result.rows[0];
    
    // Check if trial expired
    if (user.plan === 'trial' && user.trial_expires_at) {
      const expiresAt = new Date(user.trial_expires_at);
      if (expiresAt < new Date()) {
        await pool.query(
          'UPDATE users SET plan = $1, trial_expires_at = NULL WHERE id = $2',
          ['free', userId]
        );
        user.plan = 'free';
      }
    }
    
    res.json(user);
  } catch (err) {
    console.error('Get user plan error:', err);
    res.status(500).json({ error: 'Failed to get user plan' });
  }
});

// Get user plan by ID (for backward compatibility)
userRouter.get('/:userId/plan', async (req, res) => {
  try {
    const { userId } = req.params;
    
    const result = await pool.query(
      `SELECT id, email, plan, plan_started_at, trial_expires_at 
       FROM users 
       WHERE id = $1`,
      [userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const user = result.rows[0];
    
    // Check if trial expired
    if (user.plan === 'trial' && user.trial_expires_at) {
      const expiresAt = new Date(user.trial_expires_at);
      if (expiresAt < new Date()) {
        // Update to free plan
        await pool.query(
          'UPDATE users SET plan = $1, trial_expires_at = NULL WHERE id = $2',
          ['free', userId]
        );
        user.plan = 'free';
      }
    }
    
    res.json(user);
  } catch (err) {
    console.error('Get user plan error:', err);
    res.status(500).json({ error: 'Failed to get user plan' });
  }
});

// Get current user history (authenticated)
userRouter.get('/me/history', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const limit = parseInt(req.query.limit as string) || 50;
    
    const result = await pool.query(
      `SELECT domain, url, link_text, trust_score, category, created_at
       FROM link_scans
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, limit]
    );
    
    res.json({ scans: result.rows });
  } catch (err) {
    console.error('Get history error:', err);
    res.status(500).json({ error: 'Failed to get history' });
  }
});

// Get user scan history by ID (for backward compatibility)
userRouter.get('/:userId/history', async (req, res) => {
  try {
    const { userId } = req.params;
    const limit = parseInt(req.query.limit as string) || 50;
    
    const result = await pool.query(
      `SELECT domain, url, link_text, trust_score, category, created_at
       FROM link_scans
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, limit]
    );
    
    res.json({ scans: result.rows });
  } catch (err) {
    console.error('Get history error:', err);
    res.status(500).json({ error: 'Failed to get history' });
  }
});

