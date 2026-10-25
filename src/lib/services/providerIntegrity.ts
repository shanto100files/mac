export const PROVIDER_MODULES = ['posts','meta','stream','catalog','episodes','settings'] as const;
export type ProviderIntegrity = Partial<Record<typeof PROVIDER_MODULES[number], string>>;

export function parseProviderIntegrity(value: unknown): ProviderIntegrity | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid provider integrity declaration');
  for (const [name, hash] of Object.entries(value)) {
    if (!(PROVIDER_MODULES as readonly string[]).includes(name) || typeof hash !== 'string' || !/^[a-f0-9]{64}$/i.test(hash)) throw new Error('Provider integrity requires SHA-256 hex digests');
  }
  for (const name of ['posts','meta','stream','catalog']) if (!Object.prototype.hasOwnProperty.call(value,name)) throw new Error('Provider integrity must cover all required modules');
  return value as ProviderIntegrity;
}

export async function verifyProviderModule(name: string, code: string, integrity?: ProviderIntegrity): Promise<void> {
  if (code.length > 2_000_000) throw new Error(`Provider ${name} module is too large`);
  if (!integrity) return; // Existing sources remain supported as untrusted code.
  const expected = integrity[name as keyof ProviderIntegrity];
  if (!expected) throw new Error(`Provider integrity is missing for ${name}`);
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code));
  const actual = Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2,'0')).join('');
  if (actual !== expected.toLowerCase()) throw new Error(`Provider integrity check failed for ${name}`);
}
