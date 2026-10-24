/** Client-side checks that mirror the backend rules, for instant feedback. */

/** Same rule as the backend: 8–72 characters with at least one letter and one number. */
export function passwordProblem(password: string): string | undefined {
  if (password.length < 8) return 'Use at least 8 characters.'
  if (password.length > 72) return 'Use 72 characters or fewer.'
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'Include at least one letter and one number.'
  return undefined
}

export function emailProblem(email: string): string | undefined {
  const value = email.trim()
  if (!value) return 'Enter your email address.'
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) return 'Enter a valid email address.'
  return undefined
}

export const PASSWORD_HINT = 'At least 8 characters, with a letter and a number.'
