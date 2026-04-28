import { MemorySystem } from '../src/memory/memory_system.js';
import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';

const testDir = '/tmp/evo-cortex-debug3';
if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true });
fs.mkdirSync(testDir, { recursive: true });

async function main() {
  const ms = new MemorySystem('test-agent', testDir, testDir);
  await ms.init();
  
  const entryId = await ms.record({
    type: 'conversation',
    title: '测试',
    content: '测试内容',
    importance: 8.0,
    tags: ['test'],
    source: 'test',
    sourceRef: 'test-001'
  });
  console.log('Inserted:', entryId);
  
  const dbPath = path.join(testDir, 'test-agent', 'memory.db');
  const db = new sqlite3.Database(dbPath);
  
  const rows = await new Promise<any[]>((resolve, reject) => {
    db.all('SELECT id, importance, expires_at FROM working_memory', [], (err, rows) => err ? reject(err) : resolve(rows));
  });
  console.log('All WM rows:', JSON.stringify(rows));
  
  await new Promise<void>((resolve, reject) => {
    db.run("UPDATE working_memory SET expires_at = datetime('now', '-1 day') WHERE id = ?", [entryId], function(err) {
      if (err) reject(err);
      else {
        console.log('Updated rows:', this.changes);
        resolve();
      }
    });
  });
  
  const rows2 = await new Promise<any[]>((resolve, reject) => {
    db.all('SELECT id, importance, expires_at FROM working_memory', [], (err, rows) => err ? reject(err) : resolve(rows));
  });
  console.log('After update:', JSON.stringify(rows2));
  
  const now = new Date().toISOString();
  console.log('Now:', now);
  
  const rows3 = await new Promise<any[]>((resolve, reject) => {
    db.all('SELECT id FROM working_memory WHERE expires_at < ? AND importance >= 7', [now], (err, rows) => err ? reject(err) : resolve(rows));
  });
  console.log('Consolidate query:', JSON.stringify(rows3));
  
  const result = await ms.consolidate({
    onPromoted: async (ltmId, row) => {
      console.log('Callback fired for:', ltmId);
    }
  });
  console.log('Consolidate result:', JSON.stringify(result));
  
  db.close();
}

main().catch(console.error);
