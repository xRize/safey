import { Router } from 'express';
import { pool } from '../db/index.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { rateLimiter } from '../middleware/rateLimit.js';

export const authRouter = Router();

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// Register
authRouter.post('/register', rateLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }
    
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    
    // Check if user exists
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'User already exists' });
    }
    
    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);
    
    // Create user
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, plan, plan_started_at)
       VALUES ($1, $2, 'free', now())
       RETURNING id, email, plan, created_at`,
      [email, passwordHash]
    );
    
    const user = result.rows[0];
    
    // Generate token
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions
    );
    
    res.json({
      user: {
        id: user.id,
        email: user.email,
        plan: user.plan
      },
      token
    });
  } catch (err: any) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login
authRouter.post('/login', rateLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }
    
    // Find user
    const result = await pool.query(
      'SELECT id, email, password_hash, plan FROM users WHERE email = $1',
      [email]
    );
    
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    
    const user = result.rows[0];
    
    // Check password
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    
    // Generate token
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions
    );
    
    res.json({
      user: {
        id: user.id,
        email: user.email,
        plan: user.plan
      },
      token
    });
  } catch (err: any) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Verify token
authRouter.get('/verify', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }
    
    const token = authHeader.substring(7);
    
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as { userId: string; email: string };
      
      // Get user from database
      const result = await pool.query(
        'SELECT id, email, plan, plan_started_at, trial_expires_at FROM users WHERE id = $1',
        [decoded.userId]
      );
      
      if (result.rows.length === 0) {
        return res.status(401).json({ error: 'User not found' });
      }
      
      const user = result.rows[0];
      
      res.json({
        user: {
          id: user.id,
          email: user.email,
          plan: user.plan,
          plan_started_at: user.plan_started_at,
          trial_expires_at: user.trial_expires_at
        }
      });
    } catch (jwtErr) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  } catch (err: any) {
    console.error('Verify error:', err);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// Logout (client-side, but endpoint for consistency)
authRouter.post('/logout', (req, res) => {
  res.json({ message: 'Logged out successfully' });
});

