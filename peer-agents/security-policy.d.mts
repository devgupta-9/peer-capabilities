export function isSecretKey(key: string): boolean;
export function redactSecrets(value: string): string;
export function secretFindings(value: string): string[];
export const forbiddenSecretFile: RegExp;
