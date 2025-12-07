import rateLimit from 'express-rate-limit';

export const rateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 requests per minute
  message: 'Too many requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false
});

export const gptRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 GPT requests per minute
  message: 'GPT analysis rate limit exceeded. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false
});

