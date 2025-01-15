export function hello(name: string, json = false): string {
  const who = name.trim() || 'world';
  const msg = `Hello, ${who}!`;
  return json ? JSON.stringify({ message: msg }) : msg;
}
