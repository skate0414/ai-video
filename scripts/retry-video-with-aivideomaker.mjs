#!/usr/bin/env node
/**
 * 设置 AIVideoMaker API Key 并重试 VIDEO_GEN 阶段
 * 
 * 用法：
 *   node scripts/retry-video-with-aivideomaker.mjs <YOUR_API_KEY>
 *   node scripts/retry-video-with-aivideomaker.mjs <YOUR_API_KEY> [PROJECT_ID]
 */

const API_KEY = process.argv[2];
const PROJECT_ID = process.argv[3] || 'proj_1775959231425';
const BASE = 'http://localhost:3220';

if (!API_KEY) {
  console.error('❌ 请提供 AIVideoMaker API Key');
  console.error('用法: node scripts/retry-video-with-aivideomaker.mjs <YOUR_API_KEY>');
  process.exit(1);
}

async function main() {
  // Step 1: 验证后端运行中
  console.log('🔍 检查后端服务...');
  try {
    const health = await fetch(`${BASE}/health`).then(r => r.json());
    console.log(`✅ 后端运行中 (uptime: ${Math.round(health.uptime)}s)`);
  } catch {
    console.error('❌ 后端服务未运行，请先启动: npm run dev:desktop');
    process.exit(1);
  }

  // Step 2: 设置 API Key（同时移除 Kling web 视频提供者以跳过无效尝试）
  console.log('\n📝 设置 AIVideoMaker API Key...');
  const configRes = await fetch(`${BASE}/api/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ aivideomakerApiKey: API_KEY }),
  }).then(r => r.json());
  console.log('✅ API Key 已设置:', JSON.stringify(configRes));

  // Step 3: 移除 Kling web 视频提供者（避免浪费时间尝试失败的 Kling）
  console.log('\n🔧 移除 Kling web 视频提供者（使 AIVideoMaker 成为主要提供者）...');
  const vpRes = await fetch(`${BASE}/api/config/video-provider`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(null),
  }).then(r => r.json());
  console.log('✅ Web 视频提供者已移除:', JSON.stringify(vpRes));

  // Step 4: 检查项目状态
  console.log(`\n📊 检查项目 ${PROJECT_ID} 状态...`);
  const pipeline = await fetch(`${BASE}/api/pipeline/${PROJECT_ID}`).then(r => r.json());
  console.log(`当前阶段: ${pipeline.currentStage}`);
  console.log(`VIDEO_GEN 状态: ${pipeline.stageStatus?.VIDEO_GEN || 'unknown'}`);

  if (pipeline.stageStatus?.VIDEO_GEN !== 'error' && pipeline.stageStatus?.VIDEO_GEN !== 'completed') {
    console.error(`⚠️  VIDEO_GEN 状态为 ${pipeline.stageStatus?.VIDEO_GEN}，可能正在运行中`);
  }

  // Step 5: 重试 VIDEO_GEN
  console.log('\n▶️  重试 VIDEO_GEN 阶段...');
  const retryRes = await fetch(`${BASE}/api/pipeline/${PROJECT_ID}/retry/VIDEO_GEN`, {
    method: 'POST',
  }).then(r => r.json());
  console.log('✅ 重试已启动:', JSON.stringify(retryRes));

  // Step 6: 开始监控
  console.log('\n📡 开始监控...\n');
  let lastLogCount = 0;
  const poll = async () => {
    try {
      const status = await fetch(`${BASE}/api/pipeline/${PROJECT_ID}`).then(r => r.json());
      const stage = status.currentStage;
      const stageStatus = status.stageStatus?.[stage] || 'unknown';
      const logs = status.logs || [];

      // Print new logs
      for (let i = lastLogCount; i < logs.length; i++) {
        const l = logs[i];
        const icon = l.type === 'success' ? '🟢' : l.type === 'error' ? '🔴' : l.type === 'warning' ? '🟡' : '📝';
        console.log(`  ${icon} ${l.message}`);
      }
      lastLogCount = logs.length;

      // Check completion
      if (status.stageStatus?.VIDEO_GEN === 'completed') {
        console.log('\n✅ VIDEO_GEN 完成！');
        
        // Check what's next
        if (stage !== 'VIDEO_GEN') {
          console.log(`当前进行: ${stage} (${stageStatus})`);
        }
        
        // Overall status
        const completed = Object.values(status.stageStatus).filter(s => s === 'completed').length;
        const total = Object.keys(status.stageStatus).length;
        console.log(`总进度: ${completed}/${total} 阶段完成`);
        
        if (status.stageStatus?.ASSEMBLY === 'completed' || status.stageStatus?.REFINEMENT === 'completed') {
          console.log('\n🎉 流水线全部完成！');
          process.exit(0);
        }
      } else if (status.stageStatus?.VIDEO_GEN === 'error') {
        console.log('\n❌ VIDEO_GEN 再次失败');
        console.log('错误:', status.error);
        process.exit(1);
      }

      // Keep polling
      setTimeout(poll, 15000);
    } catch (err) {
      console.error('监控出错:', err.message);
      setTimeout(poll, 30000);
    }
  };
  
  // Start polling after a short delay
  setTimeout(poll, 5000);
}

main().catch(err => {
  console.error('❌ 错误:', err);
  process.exit(1);
});
