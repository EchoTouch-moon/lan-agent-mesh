export function permissionWriteCommand(path) {
  return `Set-Content -LiteralPath '${path.replaceAll("'", "''")}' -Value 'fixture' -Encoding ascii`;
}

export function deniedWriteResult({ markerCreated, commandControlVerified, nativeRejection, initialSandboxDenialObserved }) {
  if (markerCreated) return { status: 'failed', markerCreated: true };
  return {
    status: commandControlVerified && nativeRejection && initialSandboxDenialObserved ? 'verified' : 'unknown',
    markerCreated: false,
  };
}
