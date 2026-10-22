export function mergeChatMessages(current, incoming) {
  const messages = new Map();
  for (const message of [...current, ...incoming]) {
    messages.set(`${message.is_internal ? 'internal' : 'public'}:${message.id}`, message);
  }
  return [...messages.values()].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
}
