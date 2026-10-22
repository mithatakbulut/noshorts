(() => {
  'use strict';
  const dialog = document.querySelector('#widget-dialog');
  let trigger;
  document.querySelectorAll('[data-open-preview]').forEach(button => {
    button.addEventListener('click', () => {
      trigger = button;
      dialog.showModal();
      dialog.scrollTop = 0;
    });
  });
  document.querySelector('.close-preview').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    const bounds = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) dialog.close();
  });
  dialog.addEventListener('close', () => trigger?.focus());
  document.querySelector('#copy-help').addEventListener('click', async () => {
    const status = document.querySelector('#copy-status');
    try {
      await navigator.clipboard.writeText(document.querySelector('#setup-prompt').textContent);
      status.textContent = 'Copied. Paste it into ChatGPT.';
    } catch {
      document.querySelector('.prompt-fallback').open = true;
      status.textContent = 'Select and copy the prompt below.';
    }
  });
})();
