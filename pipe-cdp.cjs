// Chromium's private, NUL-delimited DevTools pipe. No listening socket is opened.
function connectPipe(child) {
  const input = child.stdio[3], output = child.stdio[4];
  const pending = new Map();
  let sequence = 0, buffer = Buffer.alloc(0), open = true;
  function disconnected() {
    if (!open) return;
    open = false;
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(Error('Slack debugging pipe closed.')); }
    pending.clear();
  }
  input.on('error', disconnected);
  output.on('error', disconnected);
  output.on('end', disconnected);
  child.on('exit', disconnected);
  output.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    let end;
    while ((end = buffer.indexOf(0)) !== -1) {
      const frame = buffer.subarray(0, end);
      buffer = buffer.subarray(end + 1);
      let message;
      try { message = JSON.parse(frame.toString()); } catch { continue; }
      const request = pending.get(message.id);
      if (!request) continue;
      pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(Error(message.error.message));
      else request.resolve(message.result);
    }
  });
  return {
    get open() { return open; },
    close() { disconnected(); input.end(); output.destroy(); },
    call(method, params = {}, sessionId) {
      return new Promise((resolve, reject) => {
        if (!open) return reject(Error('Slack debugging pipe closed.'));
        const id = ++sequence;
        const timer = setTimeout(() => { pending.delete(id); reject(Error('Slack debugging request timed out.')); }, 8000);
        pending.set(id, { resolve, reject, timer });
        input.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
      });
    }
  };
}
function isSlackTarget(target) {
  if (!['page', 'webview'].includes(target.type)) return false;
  try {
    const url = new URL(target.url);
    return url.protocol === 'https:' && (url.hostname === 'slack.com' || url.hostname.endsWith('.slack.com'));
  } catch { return false; }
}
module.exports = { connectPipe, isSlackTarget };
