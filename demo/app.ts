export function greet(name: string, json = false): string {
  const msg = `Hello, ${name}!`;
  return json ? JSON.stringify({ message: msg }) : msg;
}
