// D13: where a FRESH sign-in lands. Always Home, unless something else already
// owns the destination: a stashed bank return (DeepLinkHandler replays it on
// wd:session-established), the F2 /oauth/consent detour (AuthProvider init), or
// a tapped notification path (NotificationNavigator). Returns null when the
// caller must not navigate. A cold start with a stored token never calls this.
export interface PostSignInInputs {
  pendingBankReturn: boolean;
  pendingNotificationPath: boolean;
  oauthDetour: boolean;
}

export function postSignInDestination(i: PostSignInInputs): string | null {
  if (i.pendingBankReturn || i.pendingNotificationPath || i.oauthDetour) return null;
  return "/";
}
