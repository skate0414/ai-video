#!/usr/bin/env node
import WebSocket from 'ws';
import { writeFileSync } from 'fs';

const targetId = process.argv[2] || '8381ECB596ABA35E7BDAA9CC389E0EBC';
const target = `ws://localhost:9222/devtools/page/${targetId}`;
const socket = new WebSocket(target);

socket.on('open', () => {
  socket.send(JSON.stringify({
    id: 1,
    method: 'Page.captureScreenshot',
    params: { format: 'png' },
  }));
});

socket.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.id === 1 && msg.result) {
    writeFileSync('/tmp/gemini-current.png', Buffer.from(msg.result.data, 'base64'));
    console.log('Screenshot saved');
    socket.close();
    process.exit(0);
  }
});

setTimeout(() => process.exit(1), 10000);
