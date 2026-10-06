// Synthetic strings are constructed at execution time, never committed as usable tokens.
export function secretCanaries() {
  const opaque = ['synthetic', 'never', 'authenticate', '123456789'].join('-');
  const token = prefix => prefix.join('') + 'a'.repeat(36);
  const keys = ['api_key', 'apiKey', 'client_secret', 'clientSecret', 'access_token', 'refresh_token',
    'id_token', 'session_token', 'client_token', 'authorization', 'password', 'credential', 'private_key'];
  const cases = keys.map(key => ({ name: key, secret: opaque, text: JSON.stringify({ nested: [{ [key]: opaque }] }) }));
  for (const label of ['PRIVATE KEY', 'ENCRYPTED PRIVATE KEY', 'DSA PRIVATE KEY', 'PGP PRIVATE KEY BLOCK']) {
    cases.push({ name: label, secret: opaque, text: ['-----BEGIN ', label, '-----\n', opaque, '\n-----END ', label, '-----'].join('') });
  }
  for (const [name, parts] of Object.entries({ github: ['gh', 'p_'], npm: ['np', 'm_'], openai: ['s', 'k-'], google: ['AI', 'za'], slack: ['xo', 'xb-'], stripe: ['sk', '_test_'] })) {
    const secret = token(parts); cases.push({ name, secret, text: `diagnostic ${secret}` });
  }
  const aws = ['AK', 'IA', 'A'.repeat(16)].join(''); cases.push({ name: 'aws', secret: aws, text: aws });
  const jwt = ['ey' + 'J' + 'a'.repeat(12), 'b'.repeat(16), 'c'.repeat(16)].join('.');
  cases.push({ name: 'jwt', secret: jwt, text: jwt });
  cases.push({ name: 'bearer', secret: opaque, text: ['Author', 'ization', ': ', 'Bearer ', opaque].join('') });
  cases.push({ name: 'url', secret: opaque, text: 'https://' + 'fixture:' + opaque + '@example.invalid/path' });
  cases.push({ name: 'environment', secret: opaque, text: ['REFRESH_TOKEN', '=', opaque].join('') });
  cases.push({ name: 'inline-unquoted', secret: opaque, text: 'diagnostic ' + ['clientToken', ': ', opaque].join('') });
  cases.push({ name: 'quoted-spaces', secret: opaque + ' with spaces', text: ['log pass', 'word=', '"', opaque, ' with spaces', '"'].join('') });
  cases.push({ name: 'short-quoted', secret: 'c' + 'ny', text: ['log pass', 'word=', '"', 'c', 'ny', '"'].join('') });
  cases.push({ name: 'escaped', secret: opaque, text: JSON.stringify({ message: JSON.stringify({ refresh_token: opaque }) }) });
  cases.push({ name: 'escaped-log', secret: opaque, text: 'log: ' + JSON.stringify(JSON.stringify({ session_token: opaque })) });
  return cases;
}
