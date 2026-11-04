import bcrypt from 'bcryptjs';
import { env } from '../config/env';

export const hashPassword = (plain: string) => bcrypt.hash(plain, env.BCRYPT_ROUNDS);
export const verifyPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);

/** Compared against when the email doesn't exist, so timing is the same either way. */
export const DUMMY_HASH = bcrypt.hashSync('never-a-real-password', env.BCRYPT_ROUNDS);
