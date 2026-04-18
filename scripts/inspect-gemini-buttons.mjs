#!/usr/bin/env node
import WebSocket from 'ws';

const target = 'ws://localhost:9222/devtools/page/968BDB8CDCD4E2E621BCB7BBA1985428';
const socket = new WebSocket(target);
let id = 1;

socket.on('open', () => {
  socket.send(JSON.stringify({
    id: id++,
    method: 'Runtime.evaluate',
    params: {
      expression: `
        (() => {
          // Check ALL buttons for send-like attributes  
          const allBtns = document.querySelectorAll('button, [role="button"]');
          const results = [];
          for (const btn of allBtns) {
            const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
            const text = (btn.textContent || '').trim().toLowerCase();
            const cls = (btn.className || '').toString().toLowerCase();
            const dataTestId = btn.getAttribute('data-test-id') || '';
            // Look for send/submit patterns
            if (aria.includes('send') || aria.includes('submit') || aria.includes('发送') ||
                text.includes('send') || text.includes('submit') || text.includes('发送') ||
                cls.includes('send') || cls.includes('submit') ||
                dataTestId.includes('send') || dataTestId.includes('submit') ||
                btn.getAttribute('type') === 'submit') {
              const rect = btn.getBoundingClientRect();
              results.push({
                tag: btn.tagName,
                ariaLabel: btn.getAttribute('aria-label'),
                dataTestId: dataTestId,
                className: cls.substring(0, 200),
                text: text.substring(0, 80),
                type: btn.getAttribute('type'),
                hidden: btn.hidden,
                disabled: btn.disabled,
                visible: btn.offsetParent !== null,
                rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
                allAttrs: [...btn.attributes].map(a => a.name + '=' + a.value.substring(0, 100)),
              });
            }
          }
          return JSON.stringify({ count: results.length, buttons: results }, null, 2);
        })()
      `,
      returnByValue: true,
    },
  }));
});

socket.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.id === 1) {
    console.log(msg.result?.result?.value || JSON.stringify(msg, null, 2));
    socket.close();
    process.exit(0);
  }
});

setTimeout(() => process.exit(1), 10000);
