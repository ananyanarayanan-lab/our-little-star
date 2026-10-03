export function friendlyError(problem, message = 'Something went wrong. Please try again.') {
  // Keep backend details out of the child-facing app and React Native overlays.
  void problem
  return message
}
