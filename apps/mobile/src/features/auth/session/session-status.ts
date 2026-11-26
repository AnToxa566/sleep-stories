// 'restoring': the stored session is being read. Distinct from 'signedOut' so the app
// shows the splash instead of flashing the sign-in screen at a signed-in user.
export type SessionStatus = 'restoring' | 'signedOut' | 'signedIn';
