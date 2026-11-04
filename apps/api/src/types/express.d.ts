declare global {
  namespace Express {
    interface Request {
      valid: unknown;
    }
  }
}

export {};
