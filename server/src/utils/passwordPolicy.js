/**
 * The password rule for every password someone chooses or is given: 8–72
 * characters (bcrypt reads at most 72 bytes) with a capital letter, a small
 * letter, a number and a symbol. Checked when a password is set, never at
 * sign-in, so existing accounts keep working until they next change it.
 */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 72;

const RULES = [
  [/[A-Z]/, 'Password must contain a capital letter'],
  [/[a-z]/, 'Password must contain a small letter'],
  [/\d/, 'Password must contain a number'],
  [/[^A-Za-z0-9\s]/, 'Password must contain a symbol'],
];

/** Add the rule to an express-validator chain. */
export function withPasswordRules(chain, min = PASSWORD_MIN) {
  let out = chain.isString().isLength({ min, max: PASSWORD_MAX }).withMessage(`Password must be ${min}–${PASSWORD_MAX} characters`);
  for (const [re, message] of RULES) out = out.matches(re).withMessage(message);
  return out;
}

/** The first rule this password breaks, or null. */
export function passwordProblem(value, min = PASSWORD_MIN) {
  if (typeof value !== 'string' || value.length < min || value.length > PASSWORD_MAX) return `Password must be ${min}–${PASSWORD_MAX} characters`;
  return RULES.find(([re]) => !re.test(value))?.[1] || null;
}
