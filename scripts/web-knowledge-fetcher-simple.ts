#!/usr/bin/env ts-node
/**
 * 网络知识自动获取器（简化版 - 不依赖 web_crawler.ts）
 * 
 * 从配置的 URL 列表抓取网页内容，提取知识并更新知识图谱
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface KnowledgeSource {
  id: string;
  name: string;
  url: string;
  type: string;
  tags: string[];
  priority: number;
  enabled: boolean;
}

interface SourcesConfig {
  sources: KnowledgeSource[];
  crawlConfig: {
    timeout: number;
    maxRetries: number;
    concurrency: number;
    cacheEnabled: boolean;
    cacheDir: string;
  };
}

interface CrawledPage {
  url: string;
  title: string;
  content: string;
  keywords: string[];
  crawledAt: string;
}

class WebKnowledgeFetcher {
  private config: SourcesConfig;
  private workspaceDir: string;
  private outputDir: string;

  constructor(agentId: string) {
    // 加载配置
    const configPath = path.join(__dirname, '../knowledge/sources.json');
    this.config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    
    // 设置输出目录
    this.workspaceDir = process.env.OPENCLAW_WORKSPACE || `~/.openclaw/workspace-${agentId}`;
    this.outputDir = path.join(this.workspaceDir, 'knowledge', 'web-sources');
    
    // 确保输出目录存在
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  /**
   * 抓取网页（使用 fetch API）
   */
  async crawl(url: string): Promise<CrawledPage> {
    console.log(`  🕷️  正在抓取：${url}`);
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Evo-Cortex/1.0; +https://github.com/luoboask/evo-cortex)'
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const html = await response.text();
    
    // 简单解析 HTML
    const title = this.extractTitle(html);
    const content = this.extractContent(html);
    const keywords = this.extractKeywords(content);
    
    return {
      url,
      title: title || 'Untitled',
      content,
      keywords,
      crawledAt: new Date().toISOString()
    };
  }

  /**
   * 提取标题
   */
  private extractTitle(html: string): string {
    const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    return match ? match[1].trim() : '';
  }

  /**
   * 提取正文内容（简化版）
   */
  private extractContent(html: string): string {
    // 移除 script 和 style
    let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    
    // 移除 HTML 标签
    text = text.replace(/<[^>]+>/g, ' ');
    
    // 清理空白
    text = text.replace(/\s+/g, ' ').trim();
    
    return text.substring(0, 10000); // 限制长度
  }

  /**
   * 提取关键词（基于词频）
   */
  private extractKeywords(content: string, limit: number = 10): string[] {
    // 分词（简单按空格和标点）
    const words = content.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3 && w.length < 30);
    
    // 统计词频
    const freq: Record<string, number> = {};
    words.forEach(word => {
      freq[word] = (freq[word] || 0) + 1;
    });
    
    // 排序并返回 top N
    return Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([word]) => word);
  }

  /**
   * 执行知识获取
   */
  async fetch(): Promise<void> {
    console.log('🌐 开始获取网络知识...');
    console.log(`工作区：${this.workspaceDir}`);
    console.log(`输出目录：${this.outputDir}\n`);

    const enabledSources = this.config.sources.filter(s => s.enabled);
    console.log(`启用 ${enabledSources.length}/${this.config.sources.length} 个知识源\n`);

    const results: any[] = [];
    let successCount = 0;
    let failCount = 0;

    for (const source of enabledSources) {
      try {
        console.log(`📡 抓取：${source.name}`);
        
        const page = await this.crawl(source.url);
        
        // 保存结果
        this.saveKnowledge(source, page);
        
        // 更新记忆文件
        this.appendMemory(source, page);
        
        successCount++;
        console.log(`  ✅ 成功 - 标题：${page.title.substring(0, 60)}...`);
        console.log(`     关键词：${page.keywords.slice(0, 5).join(', ')}...\n`);
        
      } catch (error: any) {
        failCount++;
        console.error(`  ❌ 失败：${source.name}`);
        console.error(`     错误：${error.message}\n`);
      }
      
      // 避免请求过快
      await this.sleep(2000);
    }

    // 生成报告
    this.generateReport(results, successCount, failCount);
    
    console.log('\n✨ 网络知识获取完成!');
    console.log(`成功：${successCount}, 失败：${failCount}`);
  }

  /**
   * 保存知识到文件
   */
  private saveKnowledge(source: KnowledgeSource, page: CrawledPage): void {
    const filename = `${source.id}-${new Date().toISOString().split('T')[0]}.json`;
    const filepath = path.join(this.outputDir, filename);
    
    const knowledge = {
      sourceId: source.id,
      sourceName: source.name,
      ...page,
      entities: page.keywords.map((k: string) => ({
        name: k,
        type: 'concept/keyword',
        description: `从 ${source.url} 提取的关键词`
      }))
    };
    
    fs.writeFileSync(filepath, JSON.stringify(knowledge, null, 2));
    console.log(`  📄 已保存：${filename}`);
  }

  /**
   * 追加到记忆文件
   */
  private appendMemory(source: KnowledgeSource, page: CrawledPage): void {
    const today = new Date().toISOString().split('T')[0];
    const memoryFile = path.join(this.workspaceDir, 'memory', `${today}.md`);
    
    const memoryEntry = `
## 【🌐 网络知识】${source.name}

**时间**: ${page.crawledAt}  
**来源**: ${source.name}  
**URL**: ${page.url}  
**标题**: ${page.title}

### 关键词
${page.keywords.map(k => `- ${k}`).join('\n')}

### 内容摘要
${page.content.substring(0, 800)}...

---
`;
    
    if (fs.existsSync(memoryFile)) {
      fs.appendFileSync(memoryFile, memoryEntry);
    } else {
      fs.writeFileSync(memoryFile, `# ${today} - Daily Memory\n\n${memoryEntry}`);
    }
    
    console.log(`  📝 已追加到记忆文件`);
  }

  /**
   * 生成报告
   */
  private generateReport(results: any[], success: number, fail: number): void {
    const reportFile = path.join(this.outputDir, `fetch-report-${new Date().toISOString().split('T')[0]}.md`);
    
    const report = `# 网络知识获取报告

**执行时间**: ${new Date().toISOString()}  
**成功**: ${success}  
**失败**: ${fail}  

## 获取的知识

${results.map(r => `
### ${r.sourceName}
- **URL**: ${r.url}
- **标题**: ${r.title}
- **关键词**: ${r.keywords?.slice(0, 5).join(', ')}
`).join('\n')}
`;
    
    fs.writeFileSync(reportFile, report);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// 主函数
async function main() {
  const agentId = process.argv[2];
  
  if (!agentId) {
    console.error('用法：ts-node web-knowledge-fetcher-simple.ts <agent-id>');
    process.exit(1);
  }
  
  const fetcher = new WebKnowledgeFetcher(agentId);
  await fetcher.fetch();
}

main().catch(console.error);
