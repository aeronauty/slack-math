(() => {
  if (globalThis.__slackInlineLatex || !document.body) return;
  globalThis.__slackInlineLatex = true;
  // shortcut: Slack's message DOM is not a public API; update these selectors if Slack changes it.
  const messages = '.c-message_kit__text, .p-rich_text_block, [data-message-id] .c-message__body';
  const excluded = '.slack-inline-math, pre, a, textarea, input, [contenteditable="true"], [role="textbox"]';

  function renderMessage(message) {
    if (message.closest(excluded)) return;
    const walker = document.createTreeWalker(message, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const parent = node.parentElement;
      if (!parent || parent.closest(excluded)) continue;
      const parts = SlackMath.splitMath(node.data);
      if (!parts.some(part => part.tex !== undefined)) continue;
      // Slack otherwise interprets underscores and asterisks in TeX as message formatting.
      // Explicitly delimited math in inline code is supported; ordinary code stays untouched.
      const code = parent.closest('code');
      if (code && (code.textContent !== node.data || parts.length !== 1 || parts[0].tex === undefined)) continue;
      const fragment = document.createDocumentFragment();
      for (const part of parts) {
        if (part.tex === undefined) { fragment.append(document.createTextNode(part.text)); continue; }
        const span = document.createElement('span');
        span.className = 'slack-inline-math';
        span.dataset.latexSource = part.source;
        span.title = part.source;
        try {
          katex.render(part.tex, span, {
            displayMode: part.display,
            throwOnError: true,
            trust: false,
            strict: 'error',
            maxExpand: 200,
            maxSize: 20,
            output: 'htmlAndMathml'
          });
          fragment.append(span);
        } catch {
          // Invalid or unsupported TeX stays readable and editable as the original source.
          fragment.append(document.createTextNode(part.source));
        }
      }
      if (code) code.classList.add('slack-math-code');
      node.replaceWith(fragment);
    }
  }

  function scan(root) {
    if (!(root instanceof Element)) return;
    const message = root.closest(messages);
    if (message) renderMessage(message);
    root.querySelectorAll(messages).forEach(renderMessage);
  }

  // Process changed subtrees, rather than rescanning the full conversation on every update.
  let disposed = false;
  const pending = new Set();
  let scheduled = false;
  const observer = new MutationObserver(records => {
    for (const record of records) {
      const parent = record.target.nodeType === Node.TEXT_NODE ? record.target.parentElement : record.target;
      if (parent?.closest?.('.slack-inline-math')) continue;
      if (record.type === 'characterData') pending.add(parent);
      else {
        // Text replacements and removals can change an existing message too.
        if (parent?.closest?.(messages)) pending.add(parent);
        for (const added of record.addedNodes) if (added instanceof Element) pending.add(added);
      }
    }
    if (!pending.size || scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      if (disposed) return;
      const roots = [...pending];
      pending.clear();
      // Disconnect while rendering to avoid observing our own replacements.
      observer.disconnect();
      try { roots.filter(root => root?.isConnected).forEach(scan); }
      finally { observe(); }
    });
  });
  function observe() { observer.observe(document.body, { subtree: true, childList: true, characterData: true }); }
  scan(document.body);
  observe();

  // Keep normal copy useful: selected formulas become their original LaTeX delimiters and source.
  const copySource = event => {
    const selection = window.getSelection();
    if (!selection?.rangeCount || selection.isCollapsed || !event.clipboardData) return;
    const range = selection.getRangeAt(0);
    const start = range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer.parentElement : range.startContainer;
    const formula = start.closest?.('.slack-inline-math');
    const fragment = range.cloneContents();
    const formulas = fragment.querySelectorAll('.slack-inline-math');
    if (formula && formula.contains(range.endContainer)) {
      event.clipboardData.setData('text/plain', formula.dataset.latexSource);
    } else if (formulas.length) {
      formulas.forEach(span => span.replaceWith(document.createTextNode(span.dataset.latexSource)));
      fragment.querySelectorAll('br').forEach(br => br.replaceWith(document.createTextNode('\n')));
      event.clipboardData.setData('text/plain', fragment.textContent);
    } else return;
    event.preventDefault();
  };
  document.addEventListener('copy', copySource);
  globalThis.__slackInlineLatexStop = () => {
    disposed = true;
    observer.disconnect();
    pending.clear();
    document.removeEventListener('copy', copySource);
    document.querySelectorAll('.slack-inline-math').forEach(span => span.replaceWith(document.createTextNode(span.dataset.latexSource)));
    document.querySelectorAll('.slack-math-code').forEach(code => code.classList.remove('slack-math-code'));
    document.querySelectorAll('style[data-slack-inline-latex]').forEach(style => style.remove());
    delete globalThis.__slackInlineLatex;
    delete globalThis.__slackInlineLatexStop;
  };
})();
